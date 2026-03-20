/**
 * 执行器抽象基类
 * 包含所有执行器共用的逻辑：重试机制、错误处理、速率限制检测
 */

import * as childProcess from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { ExecutionResult } from '../types';
import { MAX_RETRIES, DEFAULT_TIMEOUT_MS, DEFAULT_503_WAIT_MS } from '../constants';
import { Logger } from '../utils/logger';
import { AgentExecutorOptions, AgentExecutor, ExecutorRawResult } from './types';

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
 * 提供 Claude 和 OpenCode 执行器的公共功能
 */
export abstract class BaseExecutor implements AgentExecutor {
  /** 子类必须实现：返回执行器类型 */
  abstract readonly agentType: 'claude' | 'opencode';

  /** 子类必须实现：构建命令行参数 */
  protected abstract buildArgs(
    prompt: string,
    sessionId: string,
    isResume: boolean,
    debugFile?: string
  ): string[];

  /** 子类必须实现：返回 CLI 命令名称 */
  protected abstract getCommand(): string;

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

        // 退出码为 0 表示成功
        if (result.exitCode === 0) {
          // 尝试获取 sessionId（OpenCode 通过 session list 获取）
          const parsedSessionId = await this.getSessionIdAfterExecution();
          if (parsedSessionId) {
            sessionId = parsedSessionId;
          }

          const duration = Date.now() - startTime;
          return {
            sessionId,
            output: result.stdout,
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
    const args = this.buildArgs(prompt, sessionId, options.useResume === true, debugFile);
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

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        clearAllTimers();
        reject(error);
      });

      child.on('close', (code) => {
        clearAllTimers();
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
      timestamp: new Date().toISOString(),
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
   * 构建默认的速率限制信息（无具体时间，等待 10 分钟）
   */
  private buildDefaultRateLimitInfo(): RateLimitInfo {
    const resetTime = new Date(Date.now() + 10 * 60 * 1000);
    const message = `已达到 API 使用限额（429 错误）。未获取到具体重置时间，将等待 10 分钟后重试。`;
    return { resetTime, message };
  }

  /**
   * 构建 503 错误的速率限制信息（等待 5 分钟）
   * 503 错误表示 API 服务暂时不可用（No available providers）
   */
  private build503ErrorRateLimitInfo(): RateLimitInfo {
    const resetTime = new Date(Date.now() + DEFAULT_503_WAIT_MS);
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
    lines.push(`时间: ${new Date().toISOString()}`);
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