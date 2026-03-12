import * as childProcess from 'child_process';
import * as path from 'path';
import { ExecutionResult } from '../types';
import { generateUUID } from './uuid';
import { MAX_RETRIES } from '../constants';
import { Logger } from './logger';
import * as fs from 'fs';

/** 默认执行超时时间：3 小时 */
const DEFAULT_TIMEOUT_MS = 3 * 60 * 60 * 1000;

/**
 * Claude 执行器选项
 */
export interface ExecutorOptions {
  cwd?: string;
  sessionId?: string;
  /** 是否使用 resume 模式，true 时使用 --resume，false 时使用 --session-id */
  useResume?: boolean;
  taskLogDir?: string;
  logger?: Logger;
  taskIndex?: number;
  taskType?: string;
  /** 执行超时时间（毫秒），默认 10 分钟 */
  timeout?: number;
  /** 额外的环境变量数组，格式为 "KEY=VALUE" */
  env?: string[];
}

/**
 * Claude 执行结果
 */
export interface ExecutorResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Claude 执行器
 * 封装 claude 命令的执行逻辑
 */
export class ClaudeExecutor {
  /**
   * 执行 claude 命令
   */
  async execute(
    prompt: string,
    options: ExecutorOptions
  ): Promise<ExecutionResult> {
    let sessionId = options.sessionId || generateUUID();
    const startTime = Date.now();

    let lastError: string | undefined;
    let lastStdout: string = '';
    let lastStderr: string = '';
    let lastExitCode: number | null = null;
    let attempts = 0;

    while (attempts < MAX_RETRIES) {
      attempts++;

      try {
        // 重试时（attempts > 1）使用 --resume 模式恢复 session
        const retryOptions = attempts > 1
          ? { ...options, useResume: true }
          : options;
        const result = await this.runClaudeCommand(prompt, sessionId, retryOptions);

        lastStdout = result.stdout;
        lastStderr = result.stderr;
        lastExitCode = result.exitCode;

        if (result.exitCode === 0) {
          const duration = Date.now() - startTime;
          return {
            sessionId,
            output: result.stdout,
            success: true,
            timestamp: startTime,
            duration
          };
        }

        // 检查是否是使用限额达到上限（需要等待后重试)
        const rateLimitInfo = this.checkRateLimitError(result.stdout, result.stderr);
        if (rateLimitInfo) {
          console.log(`\n${rateLimitInfo.message}`);
          // 重要：不增加 attempts，等待后继续循环重试
          await this.waitUntilReset(rateLimitInfo.resetTime);
          continue; // 不增加重试次数
        }

        // 非零退出码，构建完整错误信息
        lastError = this.buildErrorMessage(result);

        if (attempts < MAX_RETRIES) {
          options.logger?.logTaskRetry(
            options.taskIndex || 0,
            (options.taskType as any) || 'task',
            attempts,
            lastError
          );
        }
      } catch (error) {
        // 捕获所有异常，构建完整错误信息
        lastError = this.buildCatchErrorMessage(error);

        // 检查异常信息中是否包含使用限额错误
        const errorStr = String(error);
        const rateLimitInfo = this.checkRateLimitError(errorStr, '');
        if (rateLimitInfo) {
          console.log(`\n${rateLimitInfo.message}`);
          await this.waitUntilReset(rateLimitInfo.resetTime);
          continue; // 等待后重试
        }

        if (attempts < MAX_RETRIES) {
          options.logger?.logTaskRetry(
            options.taskIndex || 0,
            (options.taskType as any) || 'task',
            attempts,
            lastError
          );
        }
      }
    }

    // 所有重试都失败，打印完整诊断信息
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

    console.error(fullErrorReport);

    // 保存完整错误报告到日志文件
    if (options.taskLogDir) {
      const errorReportFile = path.join(options.taskLogDir, 'error_report.txt');
      fs.writeFileSync(errorReportFile, fullErrorReport, 'utf-8');
    }

    process.exit(1);
    // 以下代码不会执行，但 TypeScript 需要返回值
    return {
      sessionId,
      output: '',
      success: false,
      error: lastError,
      timestamp: startTime,
      duration
    };
  }

  /**
   * 检查是否是使用限额达到上限的错误
   * @returns 如果检测到限额错误，返回包含重置时间和消息的对象；否则返回 null
   */
  private checkRateLimitError(stdout: string, stderr: string): { resetTime: Date; message: string } | null {
    const combinedOutput = stdout + stderr;

    // 检查是否包含 429 错误或 rate_limit_error
    if (/429|rate_limit_error|usage limit exceeded/i.test(combinedOutput)) {
      // 尝试匹配具体的重置时间
      for (const pattern of ClaudeExecutor.RATE_LIMIT_PATTERNS) {
        const match = combinedOutput.match(pattern);
        if (match && match[1]) {
          // 有些正则只捕获时间，有些捕获小时数和时间
          const hours = !match[1].includes('-') ? match[1] : '5';
          const resetTimeStr = match[2] || match[1];
          return this.buildRateLimitInfo(hours, resetTimeStr.trim());
        }
      }

      // 没有匹配到具体时间，使用默认等待时间（10分钟）
      return this.buildDefaultRateLimitInfo();
    }

    return null;
  }

  /**
   * 构建 rate limit 信息对象（有具体时间）
   */
  private buildRateLimitInfo(hours: string, resetTimeStr: string): { resetTime: Date; message: string } {
    const resetTime = new Date(resetTimeStr);
    const message = `已达到 ${hours} 小时的使用上限。您的限额将在 ${resetTimeStr} 重置。`;
    return { resetTime, message };
  }

  /**
   * 构建默认的 rate limit 信息对象（无具体时间，等待 10 分钟）
   */
  private buildDefaultRateLimitInfo(): { resetTime: Date; message: string } {
    const resetTime = new Date(Date.now() + ClaudeExecutor.DEFAULT_WAIT_MS);
    const message = `已达到 API 使用限额（429 错误）。未获取到具体重置时间，将等待 10 分钟后重试。`;
    return { resetTime, message };
  }

  /**
   * 等待直到指定时间（异步）
   * @param resetTime 重置时间
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

    // 使用异步等待
    await new Promise(resolve => setTimeout(resolve, waitMs));

    clearInterval(intervalId);
    console.log('已达到重置时间，正在继续...');
  }

  /** 速率限制正则表达式列表 - 按优先级匹配 */
  private static readonly RATE_LIMIT_PATTERNS = [
    // 中文格式：已达到5小时的使用上限。您的限额将在 2026-03-07 04:09:41 重置
    /已达到\s*(\d+)\s*小时\s*的?使用上限[。\.]?\s*您的?限额将在\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s*重置/i,
    // 英文格式1：You have reached your 5 hour usage limit. Your limit will reset at 2026-03-07 04:09:41
    /(?:you\s+)?have\s+reached\s+(?:your\s+)?(\d+)\s*hours?\s*(?:usage|rate)?\s*limit.*?(?:will\s+)?reset\s+(?:at\s+)?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/is,
    // 英文格式2：usage limit exceeded, resets at 2026-03-07 04:09:41
    /(?:usage|rate)\s*limit\s*(?:exceeded|reached).*?resets?\s*(?:at\s+)?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/is,
    // 429 错误格式（无重置时间）：API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"usage limit exceeded (2056)"}}
    /429.*?(?:rate_limit_error|usage\s*limit\s*exceeded)/is,
  ];

  /** 默认等待时间（毫秒）：10 分钟 */
  private static readonly DEFAULT_WAIT_MS = 10 * 60 * 1000;

  /**
   * 构建错误消息（非零退出码情况）
   */
  private buildErrorMessage(result: ExecutorResult): string {
    const parts: string[] = [];
    parts.push(`Claude exited with code ${result.exitCode}`);

    if (result.stderr) {
      parts.push(`stderr: ${result.stderr}`);
    }

    if (result.stdout) {
      // stdout 可能很长，但为了调试需要完整输出
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

      // 检查是否有 cause
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
    options: ExecutorOptions
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
   * 运行 claude 命令
   */
  private async runClaudeCommand(
    prompt: string,
    sessionId: string,
    options: ExecutorOptions
  ): Promise<ExecutorResult> {
    const taskLogDir = options.taskLogDir;
    const cwd = options.cwd || process.cwd();
    const timeout = options.timeout || DEFAULT_TIMEOUT_MS;

    // 校验 timeout 必须为正数
    if (options.timeout !== undefined && options.timeout <= 0) {
      console.error(`错误: timeout 必须为正数，当前值: ${options.timeout}`);
      process.exit(1);
    }

    // 校验 cwd 是否存在
    if (!fs.existsSync(cwd)) {
      console.error(`错误: 工作目录不存在: ${cwd}`);
      console.error('请检查传入的 cwd 参数是否正确');
      process.exit(1);
    }

    // 构建 debug 日志文件路径
    const claudeDebugFile = taskLogDir ? path.join(taskLogDir, 'claude_debug.log') : undefined;

    const args = this.buildArgs(prompt, sessionId, options.useResume === true, claudeDebugFile);

    // 构建完整的命令字符串用于日志记录
    const fullCommand = this.buildCommandString('claude', args);

    return new Promise((resolve, reject) => {
      // 记录完整命令到汇总日志
      options.logger?.writeSummaryLog(`执行命令: ${fullCommand}`);

      // 构建环境变量
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        // 禁用分页，确保输出完整
        PAGER: 'cat'
      };

      // 解析并添加额外的环境变量
      if (options.env && options.env.length > 0) {
        for (const envStr of options.env) {
          const equalIndex = envStr.indexOf('=');
          if (equalIndex > 0) {
            const key = envStr.substring(0, equalIndex);
            const value = envStr.substring(equalIndex + 1);
            env[key] = value;
          }
        }
      }

      // 保存执行信息到日志目录
      if (taskLogDir) {
        const execInfoFile = path.join(taskLogDir, 'execution_info.json');
        const execInfo = {
          command: fullCommand,
          sessionId,
          args,
          cwd,
          timeout,
          timestamp: new Date().toISOString(),
          useResume: options.useResume === true,
          claudeDebugFile,
          env: options.env || []
        };
        fs.writeFileSync(execInfoFile, JSON.stringify(execInfo, null, 2), 'utf-8');

        // 单独保存完整命令到文件，包含 cwd 和 env 信息
        const commandFile = path.join(taskLogDir, 'command.txt');
        const commandContent = this.buildCommandFileContent(fullCommand, cwd, options.env);
        fs.writeFileSync(commandFile, commandContent, 'utf-8');
      }

      const child = childProcess.spawn('claude', args, {
        cwd,
        env
      });

      // 设置超时
      const timeoutId = setTimeout(() => {
        const timeoutError = new Error(
          `Claude process timed out after ${timeout}ms (${timeout / 1000}s)`
        );
        // 先尝试优雅终止
        child.kill('SIGTERM');

        // 3秒后强制终止
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 3000);

        reject(timeoutError);
      }, timeout);

      child.stdin.end();

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        resolve({
          stdout,
          stderr,
          exitCode: code
        });
      });
    });
  }

  /**
   * 构建命令行参数
   * @param claudeDebugFile Claude debug 日志文件路径，用于记录 Claude 内部执行过程
   */
  private buildArgs(
    prompt: string,
    sessionId: string,
    isResume?: boolean,
    claudeDebugFile?: string
  ): string[] {
    const args = ['--dangerously-skip-permissions'];

    // 添加 debug 日志输出，记录 Claude 思考和执行过程
    if (claudeDebugFile) {
      args.push('--debug-file', claudeDebugFile);
    }

    if (isResume) {
      args.push('--resume', sessionId);
    } else {
      args.push('--session-id', sessionId);
    }

    args.push('-p', prompt);

    return args;
  }

  /**
   * 构建完整的命令字符串用于日志记录
   * 对包含特殊字符的参数进行适当的引号处理
   */
  private buildCommandString(command: string, args: string[]): string {
    const escapedArgs = args.map(arg => {
      // 如果参数包含空格、换行、引号等特殊字符，需要用单引号包裹
      if (/[\s'"`\$\n\r\t\\]/.test(arg)) {
        // 先转义单引号（单引号内不能直接包含单引号，需要用 '\'' 来结束引用、转义单引号、重新开始引用）
        const escaped = arg.replace(/'/g, "'\\''");
        return `'${escaped}'`;
      }
      return arg;
    });
    return `${command} ${escapedArgs.join(' ')}`;
  }

  /**
   * 构建命令文件内容，包含 cwd 和 env 信息
   */
  private buildCommandFileContent(fullCommand: string, cwd: string, env?: string[]): string {
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
        lines.push(`export ${envStr}`);
      }
      lines.push('');
    }

    lines.push('# 可直接复制执行的完整命令（含环境变量）');
    if (env && env.length > 0) {
      for (const envStr of env) {
        lines.push(`export ${envStr} && \\`);
      }
    }
    lines.push(`cd "${cwd}" && ${fullCommand}`);

    return lines.join('\n');
  }
}

/**
 * 创建执行器实例
 */
export function createExecutor(): ClaudeExecutor {
  return new ClaudeExecutor();
}