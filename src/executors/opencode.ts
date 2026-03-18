/**
 * OpenCode 执行器
 * 封装 opencode 命令的执行逻辑
 */

import * as childProcess from 'child_process';
import { BaseExecutor } from './base';
import { OPENCODE_PERMISSION_ALL } from '../constants';

/**
 * 检测当前是否为 Windows 系统
 */
function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * OpenCode 执行器
 *
 * 命令格式：
 * - 新会话/恢复会话: opencode run --session <session-id> "prompt"
 *
 * Session ID 获取策略：
 * 1. 首次执行时不传 --session，让 OpenCode 创建新会话
 * 2. 从 stdout 的 JSON 输出中解析 sessionId
 * 3. 如果 stdout 解析失败，调用 `opencode session list` 获取最新的 sessionId
 *
 * 权限处理：
 * 通过环境变量 OPENCODE_PERMISSION 设置权限，跳过交互式确认
 */
export class OpenCodeExecutor extends BaseExecutor {
  /** 执行器类型标识 */
  readonly agentType = 'opencode';

  /** 缓存的 sessionId（在 Node 进程内存中保存） */
  private cachedSessionId: string | null = null;

  /**
   * 返回 CLI 命令名称
   * Windows 下需要使用 opencode.cmd
   */
  protected getCommand(): string {
    return isWindows() ? 'opencode.cmd' : 'opencode';
  }

  /**
   * 构建执行环境变量
   * 设置权限配置，跳过所有权限确认
   */
  protected buildEnv(extraEnv?: string[]): NodeJS.ProcessEnv {
    const env = super.buildEnv(extraEnv);
    env.OPENCODE_PERMISSION = OPENCODE_PERMISSION_ALL;
    return env;
  }

  /**
   * 判断是否是 OpenCode 格式的 session ID
   * OpenCode 的 session ID 格式: ses_xxx
   */
  private isOpenCodeSessionId(sessionId: string): boolean {
    return sessionId.startsWith('ses_');
  }

  /**
   * 构建命令行参数
   */
  protected buildArgs(
    prompt: string,
    sessionId: string,
    isResume: boolean,
    debugFile?: string
  ): string[] {
    const args: string[] = [];

    args.push('run');

    // 仅当是 OpenCode 格式时才传入 --session
    if (this.isOpenCodeSessionId(sessionId)) {
      args.push('--session', sessionId);
    }

    args.push('--format', 'json');
    args.push(prompt);

    return args;
  }

  /**
   * 从 stdout 解析 OpenCode 的 sessionId
   */
  protected parseSessionIdFromStdout(stdout: string): string | null {
    if (!stdout || stdout.trim() === '') {
      return null;
    }

    const lines = stdout.split('\n');
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      try {
        const json = JSON.parse(trimmedLine);
        if (json.sessionID && typeof json.sessionID === 'string') {
          return json.sessionID;
        }
      } catch {
        // 忽略解析失败的行
      }
    }

    return null;
  }

  /**
   * 通过 `opencode session list` 获取最新的 sessionId
   * 当 stdout 解析失败时使用此方法作为备选
   * 
   * @returns 最新的 sessionId，如果获取失败返回 null
   */
  private async fetchLatestSessionId(): Promise<string | null> {
    return new Promise((resolve) => {
      const command = this.getCommand();
      const args = ['session', 'list'];

      const child = childProcess.spawn(command, args, {
        env: this.buildEnv(),
        shell: isWindows()
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
        console.error(`[OpenCode] 获取 session list 失败: ${error.message}`);
        resolve(null);
      });

      child.on('close', (code) => {
        if (code !== 0) {
          console.error(`[OpenCode] session list 退出码: ${code}`);
          resolve(null);
          return;
        }

        // 解析 session list 输出
        // 格式：Session ID                      Title                    Updated
        //       ses_xxx                         xxx                      18:25
        const sessionId = this.parseSessionListOutput(stdout);
        resolve(sessionId);
      });

      child.stdin?.end();
    });
  }

  /**
   * 解析 `opencode session list` 的输出
   * 提取最新的（第一个）sessionId
   * 
   * @param output session list 命令的输出
   * @returns 最新的 sessionId，如果解析失败返回 null
   */
  private parseSessionListOutput(output: string): string | null {
    if (!output || output.trim() === '') {
      return null;
    }

    const lines = output.split('\n');
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      // 跳过表头行
      if (trimmedLine.startsWith('Session ID') || trimmedLine.startsWith('─')) {
        continue;
      }

      // 提取第一个字段（Session ID）
      // 格式：ses_xxx 后面跟着空格
      const match = trimmedLine.match(/^(ses_[a-zA-Z0-9]+)/);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * 获取 sessionId（供外部调用）
   * 返回缓存的 sessionId
   */
  getCachedSessionId(): string | null {
    return this.cachedSessionId;
  }

  /**
   * 设置缓存的 sessionId（供外部调用）
   */
  setCachedSessionId(sessionId: string): void {
    this.cachedSessionId = sessionId;
  }

  /**
   * 执行完成后获取 sessionId
   * 优先从 stdout 解析，失败时调用 session list
   * 
   * @param stdout 命令的标准输出
   * @returns 解析出的 sessionId
   */
  protected async getSessionIdAfterExecution(stdout: string): Promise<string | null> {
    // 优先从 stdout 解析
    let sessionId = this.parseSessionIdFromStdout(stdout);

    if (sessionId) {
      this.cachedSessionId = sessionId;
      return sessionId;
    }

    // stdout 解析失败，尝试从 session list 获取
    console.log('[OpenCode] stdout 解析 sessionId 失败，尝试从 session list 获取...');
    sessionId = await this.fetchLatestSessionId();

    if (sessionId) {
      this.cachedSessionId = sessionId;
      return sessionId;
    }

    return null;
  }
}