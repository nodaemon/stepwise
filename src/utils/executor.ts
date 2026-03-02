import * as childProcess from 'child_process';
import * as path from 'path';
import { ExecutionResult } from '../types';
import { generateUUID } from './uuid';
import { MAX_RETRIES } from '../constants';
import { Logger } from './logger';
import * as fs from 'fs';

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
    const sessionId = options.sessionId || generateUUID();
    const startTime = Date.now();

    let lastError: string | undefined;
    let attempts = 0;

    while (attempts < MAX_RETRIES) {
      attempts++;

      try {
        const result = await this.runClaudeCommand(prompt, sessionId, options);

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

        // 非零退出码
        lastError = result.stderr || `Claude exited with code ${result.exitCode}`;

        if (attempts < MAX_RETRIES) {
          options.logger?.logTaskRetry(
            options.taskIndex || 0,
            (options.taskType as any) || 'task',
            attempts,
            lastError
          );
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);

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

    // 所有重试都失败
    const duration = Date.now() - startTime;
    console.error(`任务执行失败，已重试 ${MAX_RETRIES} 次，退出进程`);
    console.error(`错误信息: ${lastError}`);
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
   * 运行 claude 命令
   */
  private async runClaudeCommand(
    prompt: string,
    sessionId: string,
    options: ExecutorOptions
  ): Promise<ExecutorResult> {
    const args = this.buildArgs(prompt, sessionId, options.useResume === true);
    const cwd = options.cwd || process.cwd();

    return new Promise((resolve, reject) => {
      const taskLogDir = options.taskLogDir;

      // 保存执行信息到日志目录
      if (taskLogDir) {
        const execInfoFile = path.join(taskLogDir, 'execution_info.json');
        const execInfo = {
          sessionId,
          args,
          cwd,
          timestamp: new Date().toISOString(),
          useResume: options.useResume === true
        };
        fs.writeFileSync(execInfoFile, JSON.stringify(execInfo, null, 2), 'utf-8');
      }

      const child = childProcess.spawn('claude', args, {
        cwd,
        shell: true,
        env: {
          ...process.env,
          // 禁用分页，确保输出完整
          PAGER: 'cat'
        }
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
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
   */
  private buildArgs(prompt: string, sessionId: string, isResume?: boolean): string[] {
    const args = ['--dangerously-skip-permissions'];

    if (isResume) {
      args.push('--resume', sessionId);
    } else {
      args.push('--session-id', sessionId);
    }

    args.push('-p', prompt);

    return args;
  }
}

/**
 * 创建执行器实例
 */
export function createExecutor(): ClaudeExecutor {
  return new ClaudeExecutor();
}