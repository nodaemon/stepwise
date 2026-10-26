/**
 * Shell 命令执行器
 *
 * 功能：
 * - 执行 shell 命令并捕获输出
 * - 支持超时控制
 * - 支持自定义工作目录和环境变量
 */

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ShellOptions, ShellResult } from '../types';
import { DEFAULT_SHELL_TIMEOUT_MS, PROCESS_TERMINATE_GRACE_MS } from '../constants';
import { parseEnvEntries } from './envHelper';
import { buildReproScript, writeReproScript } from './reproScript';

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
    const timeout = options.timeout || DEFAULT_SHELL_TIMEOUT_MS;
    const cwd = options.cwd || process.cwd();

    return this.runCommand(command, {
      cwd,
      timeout,
      env: options.env
    });
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
    options: { cwd: string; timeout: number; env?: string[] }
  ): Promise<ShellResult> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      // 构建环境变量对象（从 string[] 格式转换，解析规则与其他消费方共用）
      const envObject: Record<string, string> = {};
      const parsedEnv = parseEnvEntries(options.env);
      for (const { key, value } of parsedEnv.entries) {
        envObject[key] = value;
      }
      for (const invalidStr of parsedEnv.invalid) {
        console.warn(`[ShellExecutor] 忽略无效环境变量格式: "${invalidStr}"`);
      }

      // 构建执行环境
      const env = {
        ...process.env,
        ...envObject
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

        // 宽限期后强制终止。
        // 关键：这里不能写成 if (!child.killed) —— child.killed 只表示
        // 「信号已发出」，SIGTERM 发出后它就是 true，那个分支永远不执行，
        // 忽略 SIGTERM 的子进程会一直残留。SIGKILL 不可捕获，
        // 是「超时后子进程一定退出」的最终保障。
        sigkillTimerId = setTimeout(() => {
          child.kill('SIGKILL');
          // 命令派生的孙进程可能仍持有 stdout 管道：销毁它，
          // 否则框架自身的事件循环被挂住，框架反而退不出去
          child.stdout?.destroy?.();
          child.stderr?.destroy?.();
        }, PROCESS_TERMINATE_GRACE_MS);

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
    options: { cwd: string; timeout: number; env?: string[] },
    startTime: number
  ): void {
    if (!this.logDir) return;

    // 确保日志目录存在
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // 保存可直接执行的复现脚本（还原 cwd 与额外环境变量）
    // 不传 presetEnv：本路径的 spawn 未注入任何框架变量
    const commandFile = path.join(this.logDir, 'command.sh');
    const commandContent = buildReproScript({
      command,
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout
    });
    writeReproScript(commandFile, commandContent);

    // 保存执行信息到 JSON 文件
    const infoFile = path.join(this.logDir, 'execution_info.json');
    const info = {
      command,
      cwd: options.cwd,
      timeout: options.timeout,
      timestamp: new Date(startTime).toLocaleString('zh-CN', { hour12: false }),
      platform: process.platform
    };
    fs.writeFileSync(infoFile, JSON.stringify(info, null, 2), 'utf-8');
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