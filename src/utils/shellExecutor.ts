/**
 * Shell 命令执行器
 *
 * 功能：
 * - 执行 shell 命令并捕获输出
 * - 支持超时控制
 * - 支持重试机制
 * - 支持自定义工作目录和环境变量
 */

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ShellOptions, ShellResult } from '../types';
import { DEFAULT_SHELL_TIMEOUT_MS, DEFAULT_SHELL_RETRY_COUNT } from '../constants';

/**
 * Shell 命令执行器类
 *
 * 负责执行 shell 命令，处理输出、超时和重试逻辑
 */
export class ShellExecutor {
  /**
   * 日志目录路径
   * 用于保存命令执行日志
   */
  private logDir?: string;

  /**
   * 构造函数
   * @param logDir - 日志目录路径（可选）
   */
  constructor(logDir?: string) {
    this.logDir = logDir;
  }

  /**
   * 执行 shell 命令
   *
   * @param command - 要执行的命令
   * @param options - 执行选项
   * @returns 执行结果
   *
   * @example
   * const executor = new ShellExecutor();
   * const result = await executor.execute('npm run build');
   * console.log(result.success);
   */
  async execute(command: string, options: ShellOptions = {}): Promise<ShellResult> {
    const startTime = Date.now();
    let attempts = 0;
    let lastError: Error | null = null;
    let lastResult: ShellResult | null = null;

    // 获取配置参数，使用默认值
    const maxRetries = options.retry ? (options.retryCount || DEFAULT_SHELL_RETRY_COUNT) : 1;
    const timeout = options.timeout || DEFAULT_SHELL_TIMEOUT_MS;
    const cwd = options.cwd || process.cwd();

    // 重试循环
    while (attempts < maxRetries) {
      attempts++;

      try {
        // 执行命令
        const result = await this.runCommand(command, {
          cwd,
          timeout,
          env: options.env
        });

        // 保存结果
        lastResult = result;

        // 如果成功，直接返回
        if (result.success) {
          return result;
        }

        // 如果失败且不重试，直接返回
        if (!options.retry) {
          return result;
        }

        // 记录失败信息，准备重试
        lastError = new Error(`Command failed with exit code ${result.exitCode}`);
      } catch (error) {
        // 捕获执行异常
        lastError = error instanceof Error ? error : new Error(String(error));

        // 如果不重试，抛出异常
        if (!options.retry) {
          throw lastError;
        }
      }

      // 如果不是最后一次重试，等待一段时间再重试
      if (attempts < maxRetries) {
        await this.sleep(1000 * attempts); // 递增等待时间：1s, 2s, 3s...
      }
    }

    // 所有重试都失败，返回最后一次结果（统一返回结果而非抛异常）
    if (lastResult) {
      return lastResult;
    }

    // 如果没有任何结果（异常情况），构造一个失败结果返回
    const duration = Date.now() - startTime;
    return {
      stdout: '',
      stderr: lastError?.message || 'Command execution failed',
      exitCode: 1,
      success: false,
      duration,
      taskIndex: 0
    };
  }

  /**
   * 执行单个 shell 命令（内部方法）
   *
   * @param command - 要执行的命令
   * @param options - 执行选项
   * @returns 执行结果
   */
  private async runCommand(
    command: string,
    options: { cwd: string; timeout: number; env?: Record<string, string> }
  ): Promise<ShellResult> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      // 构建执行环境
      const env = {
        ...process.env,
        ...options.env
      };

      // 判断操作系统，Windows 使用 cmd.exe，其他使用 /bin/sh
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'cmd.exe' : '/bin/sh';
      const shellArgs = isWindows ? ['/c', command] : ['-c', command];

      // 保存执行信息到日志目录
      if (this.logDir) {
        this.saveExecutionInfo(command, options, startTime);
      }

      // spawn 子进程执行命令
      const child = childProcess.spawn(shell, shellArgs, {
        cwd: options.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'] // stdin 忽略，捕获 stdout 和 stderr
      });

      // SIGKILL 定时器引用，用于在 close/error 事件中清除
      let sigkillTimerId: NodeJS.Timeout | null = null;

      // 提取定时器清理逻辑，避免重复代码
      const clearAllTimers = () => {
        clearTimeout(timeoutId);
        if (sigkillTimerId) {
          clearTimeout(sigkillTimerId);
        }
      };

      // 设置超时定时器
      const timeoutId = setTimeout(() => {
        const timeoutError = new Error(
          `Command timed out after ${options.timeout}ms: ${command}`
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
      }, options.timeout);

      // 捕获标准输出
      let stdout = '';
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      // 捕获标准错误
      let stderr = '';
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // 处理执行错误
      child.on('error', (error) => {
        clearAllTimers();
        reject(error);
      });

      // 处理执行完成
      child.on('close', (exitCode) => {
        clearAllTimers();

        const duration = Date.now() - startTime;

        resolve({
          stdout,
          stderr,
          exitCode: exitCode ?? 1,
          success: exitCode === 0,
          duration,
          taskIndex: 0 // taskIndex 由 StepWise 类设置
        });
      });
    });
  }

  /**
   * 保存执行信息到日志文件
   *
   * @param command - 执行的命令
   * @param options - 执行选项
   * @param startTime - 开始时间
   */
  private saveExecutionInfo(
    command: string,
    options: { cwd: string; timeout: number },
    startTime: number
  ): void {
    if (!this.logDir) return;

    // 确保日志目录存在
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // 保存命令到文件
    const commandFile = path.join(this.logDir, 'command.txt');
    fs.writeFileSync(commandFile, command, 'utf-8');

    // 保存执行信息到 JSON 文件
    const infoFile = path.join(this.logDir, 'execution_info.json');
    const info = {
      command,
      cwd: options.cwd,
      timeout: options.timeout,
      timestamp: new Date(startTime).toISOString(),
      platform: process.platform
    };
    fs.writeFileSync(infoFile, JSON.stringify(info, null, 2), 'utf-8');
  }

  /**
   * 异步等待（工具方法）
   *
   * @param ms - 等待毫秒数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 设置日志目录
   *
   * @param logDir - 日志目录路径
   */
  setLogDir(logDir: string): void {
    this.logDir = logDir;
  }
}