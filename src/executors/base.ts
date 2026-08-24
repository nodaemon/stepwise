/**
 * 执行器抽象基类
 * 包含所有执行器共用的逻辑：重试机制、错误处理、速率限制检测
 */

import * as childProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { ExecutionResult } from '../types';
import { MAX_RETRIES, DEFAULT_TIMEOUT_MS, DEFAULT_RETRY_WAIT_MS, PROBE_TIMEOUT_MS, MAX_PROBE_ATTEMPTS } from '../constants';
import { Logger } from '../utils/logger';
import { AgentExecutorOptions, AgentExecutor, ExecutorRawResult } from './types';
import { parseAndFormatNDJson, formatNDJsonLine } from './ndjsonFormatter';

/**
 * 生成当前时刻的时间戳前缀，形如 [2026-08-12 14:30:25.123]
 * 用于在 verbose_output.txt 中标记每个块（子进程实时输出该行的时刻）
 */
function nowTimestamp(): string {
  const d = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const ms = pad(d.getMilliseconds(), 3);
  return `[${date} ${time}.${ms}]`;
}

/**
 * 速率限制信息
 * 当检测到 API 限额达到上限时返回
 */
interface RateLimitInfo {
  /** 重置时间 */
  resetTime: Date;
  /** 提示消息 */
  message: string;
}

/**
 * 执行器抽象基类
 * 提供 Claude、OpenCode、CodeAgent 执行器的公共功能
 */
export abstract class BaseExecutor implements AgentExecutor {
  /** 子类必须实现：返回执行器类型 */
  abstract readonly agentType: 'claude' | 'opencode' | 'codeagent' | 'pi';

  /** 子类必须实现：构建命令行参数 */
  protected abstract buildArgs(
    prompt: string,
    sessionId: string,
    isResume: boolean,
    debugFile?: string,
    fork?: boolean
  ): string[];

  /** 子类必须实现：返回 CLI 命令名称 */
  protected abstract getCommand(): string;

  /**
   * 构建探测命令参数
   * 429 探测恢复时使用：用无持久化 session 发送简单请求，
   * 确认 API 限额是否恢复，探测 session 不落盘，无需清理。
   *
   * 子类必须实现，返回对应执行器的无持久化参数。
   * 不适用探测的执行器（如 OpenCode）应抛错。
   */
  protected abstract buildProbeArgs(): string[];

  /**
   * 是否输出 NDJSON（stream-json）格式
   * - true（Claude、CodeAgent）：stdout 为逐行 JSON，空行无意义需跳过，
   *   每行按 type 格式化后写入 verbose_output.txt
   * - false（OpenCode 等纯文本执行器）：stdout 为纯文本，空行保留以维持可读性，
   *   非 JSON 行原样写入
   *
   * 子类可重写以声明输出格式。基类默认 false（纯文本）。
   */
  protected usesNDJsonOutput(): boolean {
    return false;
  }

  /**
   * 判断执行结果是否真的成功
   *
   * 默认仅检查 exit code：exit code === 0 视为成功。
   *
   * 对于 NDJSON 输出且进程退出码不能准确反映运行结果的执行器（如 pi --mode json，
   * 该模式下 exit code 始终是 0，即使 assistant 报 error/aborted），
   * 可重写此方法检查 stdout 流中的错误事件（如最后一条 message_end 的 stopReason），
   * 将错误执行结果视为失败，从而触发基类的非零退出码路径（包括 rate limit 重试）。
   *
   * @param result 子进程原始执行结果（stdout / stderr / exitCode）
   * @returns true 视为成功，false 视为失败（会走错误路径）
   */
  protected isExecutionSuccessful(result: ExecutorRawResult): boolean {
    return result.exitCode === 0;
  }

  /**
   * 构建执行环境变量
   * 子类可以重写以添加额外的环境变量
   * @param extraEnv 额外的环境变量数组，格式为 "KEY=VALUE"
   */
  protected buildEnv(extraEnv?: string[]): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PAGER: 'cat'
    };

    // 解析并添加额外的环境变量
    if (extraEnv && extraEnv.length > 0) {
      for (const envStr of extraEnv) {
        const equalIndex = envStr.indexOf('=');
        if (equalIndex > 0) {
          const key = envStr.substring(0, equalIndex);
          const value = envStr.substring(equalIndex + 1);
          env[key] = value;
        }
      }
    }

    return env;
  }

/**
 * 执行完成后获取 sessionId（子类可重写）
 * OpenCode 等执行器可以重写此方法，通过 session list 获取 sessionId
 * 
 * @returns Promise<string | null> 解析出的 sessionId
 */
  protected async getSessionIdAfterExecution(): Promise<string | null> {
    return null;
  }

  /**
   * 执行提示词任务
   * 包含重试机制和错误处理
   */
  async execute(prompt: string, options: AgentExecutorOptions): Promise<ExecutionResult> {
    let sessionId = options.sessionId || this.generateUUID();
    const startTime = Date.now();

    let lastError: string | undefined;
    let lastStdout: string = '';
    let lastStderr: string = '';
    let lastExitCode: number | null = null;
    let attempts = 0;

    // 重试循环逻辑：
    // 1. 普通错误：attempts++，最多重试 MAX_RETRIES 次
    // 2. 速率限制(429)：等待重置时间后继续，不计入重试次数
    while (attempts < MAX_RETRIES) {
      attempts++;

      try {
        // 重试时使用恢复模式，在之前失败的基础上继续
        const retryOptions = attempts > 1
          ? { ...options, useResume: true }
          : options;

        const result = await this.runCommand(prompt, sessionId, retryOptions);

        lastStdout = result.stdout;
        lastStderr = result.stderr;
        lastExitCode = result.exitCode;

        // 退出码为 0 表示成功，但子类（NDJSON 执行器）可重写 isExecutionSuccessful()
        // 基于 stdout 内容进一步判断（如检查 message_end 的 stopReason）
        if (this.isExecutionSuccessful(result)) {
          // 检查 stdout 是否为空
          if (!result.stdout || result.stdout.trim() === '') {
            console.log(`[${this.agentType}] 警告: 任务执行完成但没有任何输出，将触发重试`);

            // 记录重试日志
            if (attempts > 1) {
              options.logger?.logTaskRetry(
                options.taskIndex || 0,
                options.taskType || 'task',
                attempts,
                '任务执行完成但没有任何输出'
              );
            }

            // 空输出视为失败，继续重试循环
            lastError = `${this.getCommand()} exited with code 0 but produced no output`;
            lastStdout = result.stdout;
            lastStderr = result.stderr;
            lastExitCode = result.exitCode;
            continue;
          }

          const duration = Date.now() - startTime;

          // 解析 NDJSON 提取最终结果文本（用于 output.txt）
          // verbose_output.txt 已由 runCommand() 实时写入
          // 同时从 system/init 块提取 session_id：fork 模式下为派生的新 ID
          const parsed = parseAndFormatNDJson(result.stdout);
          const isNDJson = parsed.parsedSuccessfully && parsed.finalResultText;
          const outputText = isNDJson
            ? parsed.finalResultText
            : result.stdout;

          // 尝试获取 sessionId（OpenCode 通过 session list 获取）
          const parsedSessionId = await this.getSessionIdAfterExecution();
          if (parsedSessionId) {
            sessionId = parsedSessionId;
          } else if (parsed.sessionId) {
            // Claude/CodeAgent：从 NDJSON init 块提取（fork 后为新派生的 ID）
            sessionId = parsed.sessionId;
          }

          return {
            sessionId,
            output: outputText,
            success: true,
            timestamp: startTime,
            duration
          };
        }

        // 检查是否是速率限制错误（需要等待后重试）
        const rateLimitInfo = this.checkRateLimitError(result.stdout, result.stderr);
        if (rateLimitInfo) {
          console.log(`\n${rateLimitInfo.message}`);
          // 重要：不增加 attempts，等待后继续循环重试
          await this.waitUntilReset(rateLimitInfo.resetTime);

          // 429 探测恢复：等待重置时间后，先用无持久化 session 探测限额是否恢复
          // 探测成功才 resume 正式 session，避免 429 错误响应累积在上下文中
          await this.runProbeLoop(options);

          attempts--; // 速率限制/503 不计入重试次数
          continue;
        }

        // 非零退出码，记录错误信息
        lastError = this.buildErrorMessage(result);

        // 记录重试日志（排除第一次尝试，只记录重试）
        if (attempts > 1) {
          options.logger?.logTaskRetry(
            options.taskIndex || 0,
            options.taskType || 'task',
            attempts,
            lastError
          );
        }
      } catch (error) {
        // 捕获异常，记录错误信息
        lastError = this.buildCatchErrorMessage(error);

        // 检查异常中是否包含速率限制错误
        const errorStr = String(error);
        const rateLimitInfo = this.checkRateLimitError(errorStr, '');
        if (rateLimitInfo) {
          console.log(`\n${rateLimitInfo.message}`);
          await this.waitUntilReset(rateLimitInfo.resetTime);

          // 429 探测恢复（同 try 块逻辑）
          await this.runProbeLoop(options);

          attempts--; // 速率限制/503 不计入重试次数
          continue;
        }

        // 记录重试日志（排除第一次尝试，只记录重试）
        if (attempts > 1) {
          options.logger?.logTaskRetry(
            options.taskIndex || 0,
            options.taskType || 'task',
            attempts,
            lastError
          );
        }
      }
    }

    // 所有重试都失败，生成完整错误报告
    const duration = Date.now() - startTime;
    const fullErrorReport = this.buildFullErrorReport(
      lastError,
      lastStdout,
      lastStderr,
      lastExitCode,
      attempts,
      duration,
      sessionId,
      options
    );

    // 保存错误报告到日志文件
    if (options.taskLogDir) {
      const errorReportFile = path.join(options.taskLogDir, 'error_report.txt');
      fs.writeFileSync(errorReportFile, fullErrorReport, 'utf-8');
    }

    // 使用 throw new Error() 代替 process.exit(1)
    throw new Error(fullErrorReport);
  }

  /**
   * 运行 CLI 命令
   * 执行实际的 spawn 调用
   */
  private async runCommand(
    prompt: string,
    sessionId: string,
    options: AgentExecutorOptions
  ): Promise<ExecutorRawResult> {
    const taskLogDir = options.taskLogDir;
    const cwd = options.cwd || process.cwd();
    const timeout = options.timeout || DEFAULT_TIMEOUT_MS;

    // 校验 timeout 必须为正数
    if (options.timeout !== undefined && options.timeout <= 0) {
      throw new Error(`[executor] timeout 必须为正数，当前值: ${options.timeout}`);
    }

    // 校验 cwd 是否存在
    if (!fs.existsSync(cwd)) {
      throw new Error(`[executor] 工作目录不存在: ${cwd}，请检查传入的 cwd 参数是否正确`);
    }

    // 构建 debug 日志文件路径
    const debugFile = taskLogDir ? path.join(taskLogDir, 'debug.log') : undefined;

    // 构建命令参数（由子类实现）
    const args = this.buildArgs(prompt, sessionId, options.useResume === true, debugFile, options.fork === true);
    const command = this.getCommand();
    const fullCommand = this.buildCommandString(command, args);

    return new Promise((resolve, reject) => {
      // 记录命令到汇总日志
      options.logger?.writeSummaryLog(`执行命令: ${fullCommand}`);

      // 保存执行信息到日志目录
      if (taskLogDir) {
        this.saveExecutionInfo(taskLogDir, fullCommand, sessionId, args, cwd, timeout, options.useResume, debugFile, options.env);
      }

      // 执行命令
      // Windows 下需要 shell: true 来正确执行 .cmd 文件并捕获 stdout
      const child = childProcess.spawn(command, args, {
        cwd,
        env: this.buildEnv(options.env),
        shell: process.platform === 'win32'
      });

      // SIGKILL 定时器引用，用于在 close 事件中清除
      let sigkillTimerId: NodeJS.Timeout | null = null;

      // 提取定时器清理逻辑，避免重复代码
      const clearAllTimers = () => {
        clearTimeout(timeoutId);
        if (sigkillTimerId) {
          clearTimeout(sigkillTimerId);
        }
      };

      // 设置超时
      const timeoutId = setTimeout(() => {
        const timeoutError = new Error(
          `${command} process timed out after ${timeout}ms (${timeout / 1000}s)`
        );
        // 先尝试优雅终止
        child.kill('SIGTERM');
        // 3秒后强制终止
        sigkillTimerId = setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 3000);
        reject(timeoutError);
      }, timeout);

      // 关闭 stdin
      child.stdin?.end();

      let stdout = '';
      let stderr = '';

      // 实时写入 verbose_output.txt
      let verboseStream: fs.WriteStream | null = null;
      let lineBuffer = '';
      // fork 派生 ID 回调去重：每个子进程只回调首次解析到的 init session_id
      let derivedSessionIdNotified = false;

      if (taskLogDir) {
        const verboseFile = path.join(taskLogDir, 'verbose_output.txt');
        verboseStream = fs.createWriteStream(verboseFile, { encoding: 'utf-8', flags: 'a' });
        // 如果文件已存在且有内容，添加分隔标记
        if (fs.existsSync(verboseFile) && fs.statSync(verboseFile).size > 0) {
          verboseStream.write('\n\n========== Resumed Execution ==========\n');
        }
      }

      // 将一块内容写入 verbose_output.txt，在块首行行首附加时间戳
      // 时间戳反映子进程实时输出该行的时刻；块内其余行保持原样
      const writeBlockWithTimestamp = (block: string) => {
        if (!verboseStream) return;
        const blockLines = block.split('\n');
        if (blockLines.length === 0) return;
        // 仅给首行加时间戳前缀，块内其余行不变
        blockLines[0] = `${nowTimestamp()} ${blockLines[0]}`;
        verboseStream.write(blockLines.join('\n') + '\n');
      };

      // 将一行内容写入 verbose_output.txt
      // - NDJSON 执行器（Claude、CodeAgent）：空行跳过，JSON 按 type 格式化
      // - 纯文本执行器（OpenCode）：空行保留以维持可读性，非 JSON 行原样写入
      const writeLineToVerbose = (line: string) => {
        if (!verboseStream) return;

        if (line.trim() === '') {
          // 纯文本执行器保留空行；NDJSON 空行无意义，跳过
          if (!this.usesNDJsonOutput()) {
            verboseStream.write('\n');
          }
          return;
        }

        const result = formatNDJsonLine(line);
        if (result.formatted) {
          writeBlockWithTimestamp(result.formatted);
        } else if (!result.isJsonParsed) {
          // 非 JSON 行（OpenCode 等纯文本输出）：原样写入
          writeBlockWithTimestamp(line);
        }
        // else: JSON 解析成功但类型被显式忽略（keep_alive 等），跳过

        // fork 模式：解析到 system/init 块的 session_id（派生的新 ID）时立即回调
        // 使 StepWise 能在中断前把派生 ID 写入 progress，恢复时按派生 ID 续传
        if (!derivedSessionIdNotified && result.sessionId && result.sessionId !== sessionId && options.onDerivedSessionId) {
          derivedSessionIdNotified = true;
          options.onDerivedSessionId(result.sessionId);
        }
      };

      child.stdout?.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // 逐行处理并实时写入文件
        if (verboseStream) {
          lineBuffer += chunk;
          const lines = lineBuffer.split('\n');
          // 最后一行可能不完整，保留在 buffer
          lineBuffer = lines.pop() || '';
          for (const line of lines) {
            writeLineToVerbose(line);
          }
        }
      });

      // stderr 也写入 verbose_output.txt（带前缀标记来源）
      let stderrLineBuffer = '';
      child.stderr?.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;

        if (verboseStream) {
          stderrLineBuffer += chunk;
          const lines = stderrLineBuffer.split('\n');
          stderrLineBuffer = lines.pop() || '';
          for (const line of lines) {
            if (line.trim() === '') {
              // 保留 stderr 中的空行结构（仅纯文本执行器）
              if (!this.usesNDJsonOutput()) {
                verboseStream.write('\n');
              }
              continue;
            }
            // stderr 行标记为 [stderr]，便于区分来源（同样附加时间戳）
            writeBlockWithTimestamp(`[stderr] ${line}`);
          }
        }
      });

      // 刷新 stdout 和 stderr 的剩余 buffer
      const flushLineBuffers = () => {
        if (!verboseStream) return;
        // 刷新 stdout lineBuffer
        if (lineBuffer.trim()) {
          const result = formatNDJsonLine(lineBuffer);
          if (result.formatted) {
            writeBlockWithTimestamp(result.formatted);
          } else if (!result.isJsonParsed) {
            writeBlockWithTimestamp(lineBuffer);
          }
          // fork 派生 ID 回调（与 writeLineToVerbose 一致，处理残留 init 块）
          if (!derivedSessionIdNotified && result.sessionId && result.sessionId !== sessionId && options.onDerivedSessionId) {
            derivedSessionIdNotified = true;
            options.onDerivedSessionId(result.sessionId);
          }
        }
        // 刷新 stderr lineBuffer
        if (stderrLineBuffer.trim()) {
          writeBlockWithTimestamp(`[stderr] ${stderrLineBuffer}`);
        }
      };

      child.on('error', (error) => {
        clearAllTimers();
        // 刷新剩余 buffer 并关闭流
        if (verboseStream) {
          flushLineBuffers();
          verboseStream.end();
          verboseStream = null; // 防止 close handler 重复关闭
        }
        reject(error);
      });

      child.on('close', (code) => {
        clearAllTimers();
        // 刷新剩余的不完整行
        if (verboseStream) {
          flushLineBuffers();
          verboseStream.end();
        }
        resolve({
          stdout,
          stderr,
          exitCode: code
        });
      });
    });
  }

  /**
   * 保存执行信息到日志文件
   */
  private saveExecutionInfo(
    taskLogDir: string,
    fullCommand: string,
    sessionId: string,
    args: string[],
    cwd: string,
    timeout: number,
    useResume?: boolean,
    debugFile?: string,
    env?: string[]
  ): void {
    // 保存执行信息 JSON
    const execInfoFile = path.join(taskLogDir, 'execution_info.json');
    const execInfo = {
      command: fullCommand,
      sessionId,
      args,
      cwd,
      timeout,
      timestamp: new Date().toLocaleString('zh-CN', { hour12: false }),
      useResume: useResume === true,
      debugFile,
      // 使用 null 区分"未设置"和"显式设置为空数组"
      env: env ?? null
    };
    fs.writeFileSync(execInfoFile, JSON.stringify(execInfo, null, 2), 'utf-8');

    // 单独保存完整命令到文件，包含 cwd 和 env 信息
    const commandFile = path.join(taskLogDir, 'command.txt');
    const commandContent = this.buildCommandFileContent(fullCommand, cwd, env);
    fs.writeFileSync(commandFile, commandContent, 'utf-8');
  }

  /**
   * 构建命令文件内容，包含 cwd 和 env 信息
   */
  protected buildCommandFileContent(fullCommand: string, cwd: string, env?: string[]): string {
    const lines: string[] = [];

    lines.push('# 执行命令');
    lines.push(fullCommand);
    lines.push('');

    lines.push('# 工作目录 (cwd)');
    lines.push(cwd);
    lines.push('');

    if (env && env.length > 0) {
      lines.push('# 额外环境变量');
      for (const envStr of env) {
        // 解析 KEY=VALUE 格式，对值进行引号保护
        const equalIndex = envStr.indexOf('=');
        if (equalIndex > 0) {
          const key = envStr.substring(0, equalIndex);
          const value = envStr.substring(equalIndex + 1);
          // 对值进行引号转义：如果值中包含双引号，先转义双引号
          const escapedValue = value.includes('"')
            ? `"${value.replace(/"/g, '\\"')}"`
            : `"${value}"`;
          lines.push(`export ${key}=${escapedValue}`);
        } else {
          // 没有 = 号的情况，直接输出
          lines.push(`export ${envStr}`);
        }
      }
      lines.push('');
    }

    lines.push('# 可直接复制执行的完整命令（含环境变量）');
    if (env && env.length > 0) {
      for (const envStr of env) {
        // 解析 KEY=VALUE 格式，对值进行引号保护
        const equalIndex = envStr.indexOf('=');
        if (equalIndex > 0) {
          const key = envStr.substring(0, equalIndex);
          const value = envStr.substring(equalIndex + 1);
          // 对值进行引号转义
          const escapedValue = value.includes('"')
            ? `"${value.replace(/"/g, '\\"')}"`
            : `"${value}"`;
          lines.push(`export ${key}=${escapedValue} && \\`);
        } else {
          lines.push(`export ${envStr} && \\`);
        }
      }
    }
    lines.push(`cd "${cwd}" && ${fullCommand}`);

    return lines.join('\n');
  }

  // ============ 工具方法 ============

  /**
   * 生成 UUID
   * 用于生成唯一的 session ID
   */
  protected generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 探测 API 限额是否已恢复
   *
   * 使用无持久化 session 发送简单请求（如 "reply ok"），
   * 如果请求成功（非 429），说明限额已恢复。
   * 探测 session 不落盘，无需清理。
   *
   * @param options 执行选项（需要 cwd 和 env）
   * @returns true 表示限额已恢复，false 表示仍未恢复
   */
  protected async probeRateLimit(options: AgentExecutorOptions): Promise<boolean> {
    const cwd = options.cwd || process.cwd();
    const command = this.getCommand();
    const env = this.buildEnv(options.env);

    try {
      // buildProbeArgs() 可能抛错（如 OpenCode 不支持探测），
      // 放在 try 内捕获，避免异常传播到 execute() 的 catch 块
      // 导致 checkRateLimitError 匹配异常消息中的 "429" 而形成循环
      // 不支持探测的执行器：直接抛出 PROBE_NOT_SUPPORTED 标记，
      // 由 runProbeLoop 捕获后立即退出，避免 10 次 × 5 分钟的无用等待
      const probeArgs = this.buildProbeArgs();

      const result = childProcess.spawnSync(command, probeArgs, {
        cwd,
        env,
        timeout: PROBE_TIMEOUT_MS,
        shell: process.platform === 'win32',
        encoding: 'utf-8'
      });

      // 超时（signal 非空）
      if (result.signal) {
        console.log(`[${this.agentType}] 探测命令超时（${PROBE_TIMEOUT_MS / 1000}s），限额可能未恢复`);
        return false;
      }

      // 非零退出码：可能是 429 或其他错误
      if (result.status !== 0) {
        console.log(`[${this.agentType}] 探测命令退出码 ${result.status}，限额可能未恢复`);
        return false;
      }

      // 退出码 0 但输出可能包含 429（Pi 的 --mode json 退出码始终为 0）
      const stdout = result.stdout || '';
      const stderr = result.stderr || '';
      if (this.checkRateLimitError(stdout, stderr)) {
        console.log(`[${this.agentType}] 探测命令输出包含 429，限额未恢复`);
        return false;
      }

      console.log(`[${this.agentType}] 探测成功，API 限额已恢复`);
      return true;
    } catch (error) {
      // buildProbeArgs() 抛出的"不支持探测"错误，向上传播让 runProbeLoop 立即退出
      if (error instanceof Error && error.message.includes('探测不适用')) {
        throw error;
      }
      console.log(`[${this.agentType}] 探测命令执行异常: ${error}，视为限额未恢复`);
      return false;
    }
  }

  /**
   * 执行探测循环
   *
   * 429 检测到后，在 waitUntilReset 之后调用。
   * 最多探测 MAX_PROBE_ATTEMPTS 次，每次超时 PROBE_TIMEOUT_MS。
   * 探测成功返回 true，探测耗尽返回 false。
   *
   * @param options 执行选项
   * @returns true 表示限额已恢复，false 表示探测耗尽仍未恢复
   */
  private async runProbeLoop(options: AgentExecutorOptions): Promise<boolean> {
    let probeCount = 0;
    let rateLimitRecovered = false;
    while (probeCount < MAX_PROBE_ATTEMPTS) {
      probeCount++;
      console.log(`[${this.agentType}] 429 探测 ${probeCount}/${MAX_PROBE_ATTEMPTS}...`);
      try {
        rateLimitRecovered = await this.probeRateLimit(options);
      } catch (error) {
        // probeRateLimit 抛出"探测不适用"错误：立即退出，不浪费等待时间
        if (error instanceof Error && error.message.includes('探测不适用')) {
          console.log(`[${this.agentType}] 探测不适用于当前执行器，跳过探测循环`);
          return false;
        }
        // 其他意外异常：记录后退出探测循环
        console.log(`[${this.agentType}] 探测循环异常退出: ${error}`);
        return false;
      }
      if (rateLimitRecovered) {
        break;
      }
      // 仅在还有下一次探测时等待，最后一次失败后无需等待
      if (probeCount < MAX_PROBE_ATTEMPTS) {
        console.log(`[${this.agentType}] 探测失败，限额未恢复，等待 ${DEFAULT_RETRY_WAIT_MS / 1000}s 后重试...`);
        await this.waitUntilReset(new Date(Date.now() + DEFAULT_RETRY_WAIT_MS));
      }
    }

    if (!rateLimitRecovered) {
      console.log(`[${this.agentType}] 探测 ${MAX_PROBE_ATTEMPTS} 次均失败，回到主重试循环`);
    }

    return rateLimitRecovered;
  }

  /**
   * 检查是否是速率限制错误
   * 子类可以重写以适配不同智能体的错误格式
   * @returns 如果检测到限额错误，返回重置时间和消息；否则返回 null
   */
  protected checkRateLimitError(stdout: string, stderr: string): RateLimitInfo | null {
    const combinedOutput = stdout + stderr;

    // 检查是否包含 429 错误或 rate_limit_error
    if (/429|rate_limit_error|usage limit exceeded/i.test(combinedOutput)) {
      // 尝试匹配具体的重置时间
      for (const pattern of this.getRateLimitPatterns()) {
        const match = combinedOutput.match(pattern);
        if (match && match[1]) {
          const hours = !match[1].includes('-') ? match[1] : '5';
          const resetTimeStr = match[2] || match[1];
          return this.buildRateLimitInfo(hours, resetTimeStr.trim());
        }
      }

      // 没有匹配到具体时间，使用默认等待时间（10分钟）
      return this.buildDefaultRateLimitInfo();
    }

    // 检查是否是 503 错误 "No available providers"
    if (/503|no available providers/i.test(combinedOutput)) {
      return this.build503ErrorRateLimitInfo();
    }

    return null;
  }

  /**
   * 获取速率限制正则表达式列表
   * 子类可以重写以适配不同智能体的错误格式
   */
  protected getRateLimitPatterns(): RegExp[] {
    return [
      // 中文格式：已达到5小时的使用上限。您的限额将在 2026-03-07 04:09:41 重置
      /已达到\s*(\d+)\s*小时\s*的?使用上限[。\.]?\s*您的?限额将在\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*重置/i,
      // 英文格式1：You have reached your 5 hour usage limit
      /(?:you\s+)?have\s+reached\s+(?:your\s+)?(\d+)\s*hours?\s*(?:usage|rate)?\s*limit.*?(?:will\s+)?reset\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/is,
      // 英文格式2：usage limit exceeded, resets at 2026-03-07 04:09:41
      /(?:usage|rate)\s*limit\s*(?:exceeded|reached).*?resets?\s*(?:at\s+)?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/is,
      // 429 错误格式（无重置时间）
      /429.*?(?:rate_limit_error|usage\s*limit\s*exceeded)/is,
    ];
  }

  /**
   * 构建速率限制信息（有具体时间）
   */
  private buildRateLimitInfo(hours: string, resetTimeStr: string): RateLimitInfo {
    const resetTime = new Date(resetTimeStr);
    const message = `已达到 ${hours} 小时的使用上限。您的限额将在 ${resetTimeStr} 重置。`;
    return { resetTime, message };
  }

  /**
   * 构建默认的速率限制信息（无具体时间，等待 5 分钟）
   */
  private buildDefaultRateLimitInfo(): RateLimitInfo {
    const resetTime = new Date(Date.now() + DEFAULT_RETRY_WAIT_MS);
    const message = `已达到 API 使用限额（429 错误）。未获取到具体重置时间，将等待 5 分钟后重试。`;
    return { resetTime, message };
  }

  /**
   * 构建 503 错误的速率限制信息（等待 5 分钟）
   * 503 错误表示 API 服务暂时不可用（No available providers）
   */
  private build503ErrorRateLimitInfo(): RateLimitInfo {
    const resetTime = new Date(Date.now() + DEFAULT_RETRY_WAIT_MS);
    const message = `API 服务暂时不可用（503/No available providers）。将等待 5 分钟后重试。`;
    return { resetTime, message };
  }

  /**
   * 等待直到指定时间
   */
  private async waitUntilReset(resetTime: Date): Promise<void> {
    const now = new Date();
    const waitMs = resetTime.getTime() - now.getTime();

    if (waitMs <= 0) {
      console.log('已达到重置时间，正在继续...');
      return;
    }

    const waitSeconds = Math.ceil(waitMs / 1000);
    const waitMinutes = Math.floor(waitSeconds / 60);
    const remainingSeconds = waitSeconds % 60;

    console.log(`需要等待 ${waitMinutes} 分 ${remainingSeconds} 秒...`);
    console.log(`预计在 ${resetTime.toLocaleString()} 继续执行`);

    // 每分钟打印一次等待进度
    let waitedMs = 0;
    const intervalId = setInterval(() => {
      waitedMs += 60000;
      const remaining = waitMs - waitedMs;
      if (remaining > 0) {
        const remainingMinutes = Math.floor(remaining / 60000);
        console.log(`仍在等待... 剩余约 ${remainingMinutes} 分钟`);
      }
    }, 60000);

    // 等待
    await new Promise(resolve => setTimeout(resolve, waitMs));

    clearInterval(intervalId);
    console.log('已达到重置时间，正在继续...');
  }

  /**
   * 构建错误消息（非零退出码情况）
   */
  private buildErrorMessage(result: ExecutorRawResult): string {
    const parts: string[] = [];
    parts.push(`${this.getCommand()} exited with code ${result.exitCode}`);

    if (result.stderr) {
      parts.push(`stderr: ${result.stderr}`);
    }

    if (result.stdout) {
      parts.push(`stdout: ${result.stdout}`);
    }

    return parts.join('\n');
  }

  /**
   * 构建异常错误消息
   */
  private buildCatchErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      const parts: string[] = [];
      parts.push(`Exception: ${error.message}`);

      if (error.stack) {
        parts.push(`Stack trace:\n${error.stack}`);
      }

      if ((error as any).cause) {
        parts.push(`Caused by: ${String((error as any).cause)}`);
      }

      return parts.join('\n');
    }
    return `Unknown error: ${String(error)}`;
  }

  /**
   * 构建完整错误报告
   */
  private buildFullErrorReport(
    lastError: string | undefined,
    lastStdout: string,
    lastStderr: string,
    lastExitCode: number | null,
    attempts: number,
    duration: number,
    sessionId: string,
    options: AgentExecutorOptions
  ): string {
    const lines: string[] = [];
    const separator = '='.repeat(80);

    lines.push(separator);
    lines.push('任务执行失败报告');
    lines.push(separator);
    lines.push('');

    lines.push('【基本信息】');
    lines.push(`时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
    lines.push(`任务序号: ${options.taskIndex || 0}`);
    lines.push(`任务类型: ${options.taskType || 'task'}`);
    lines.push(`会话ID: ${sessionId}`);
    lines.push(`重试次数: ${attempts}`);
    lines.push(`总耗时: ${(duration / 1000).toFixed(2)}s`);
    lines.push('');

    lines.push('【退出状态】');
    lines.push(`退出码: ${lastExitCode}`);
    lines.push('');

    lines.push('【错误信息】');
    lines.push(lastError || '(无)');
    lines.push('');

    lines.push('【stderr 输出】');
    lines.push(lastStderr || '(空)');
    lines.push('');

    lines.push('【stdout 输出】');
    lines.push(lastStdout || '(空)');
    lines.push('');

    lines.push('【工作目录】');
    lines.push(options.cwd || process.cwd());
    lines.push('');

    lines.push(separator);
    lines.push('所有重试均失败，进程退出');
    lines.push(separator);

    return lines.join('\n');
  }

  /**
   * 构建完整的命令字符串（用于日志记录）
   * 对包含特殊字符的参数进行引号处理
   */
  protected buildCommandString(command: string, args: string[]): string {
    const escapedArgs = args.map(arg => {
      // 如果参数包含空格、换行、引号等特殊字符，需要用单引号包裹
      if (/[\s'"`\$\n\r\t\\]/.test(arg)) {
        // 转义单引号
        const escaped = arg.replace(/'/g, "'\\''");
        return `'${escaped}'`;
      }
      return arg;
    });
    return `${command} ${escapedArgs.join(' ')}`;
  }
}