/**
 * Pi 执行器
 *
 * Pi 是一个最小化的终端编程智能体（@earendil-works/pi-coding-agent）。
 * 与 Claude Code 不同，Pi 没有 permission popups，不需要 --dangerously-skip-permissions。
 *
 * Pi 的 session 管理：
 * - --session-id <id>：使用精确的 session ID，不存在则自动创建，已存在则打开（resume）
 * - --fork <id> --session-id <newId>：从已有 session fork 出新会话，并指定新会话 ID
 *
 * 输出模式：
 * - text 模式（-p）：stdout 直接输出 assistant 的最终文本，纯文本无需解析 JSON
 * - 不使用 --mode json，避免复杂的 JSON 事件流解析
 *
 * Session ID 获取策略：
 * - 新会话/恢复：通过 --session-id <uuid> 指定，pi 自动创建或打开
 * - Fork：在 execute() 中预生成派生 ID，通过 --session-id 指定给 pi，
 *   并立即通过 onDerivedSessionId 回调通知 StepWise（无需从输出解析）
 *
 * Pi 的 session 存储路径：
 * - 默认：~/.pi/agent/sessions/--<escaped-cwd>--/<sessionId>.jsonl
 * - 可通过 PI_CODING_AGENT_DIR 环境变量覆盖配置目录
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BaseExecutor } from './base';
import { AgentType, ExecutionResult } from '../types';
import { AgentExecutorOptions } from './types';

/**
 * 检测当前是否为 Windows 系统
 */
function isWindows(): boolean {
  return process.platform === 'win32';
}

export class PiExecutor extends BaseExecutor {
  /** 执行器类型标识 */
  readonly agentType: AgentType = 'pi';

  /**
   * fork 模式下预生成的派生 session ID
   * 在 execute() 中生成，在 buildArgs() 中使用
   */
  private forkNewSessionId: string | null = null;

  /** 当前执行的 cwd（用于检查 pi session 文件是否存在） */
  private currentCwd: string = '';

  /**
   * 返回 CLI 命令名称
   * Windows 下需要使用 pi.cmd
   */
  protected getCommand(): string {
    return isWindows() ? 'pi.cmd' : 'pi';
  }

  /**
   * Pi 使用纯文本输出格式（text 模式）
   * stdout 为 assistant 最终文本，空行保留以维持可读性
   */
  protected usesNDJsonOutput(): boolean {
    return false;
  }

  /**
   * 重写 execute：fork 模式下预生成派生 session ID
   *
   * Pi 的 --fork <id> --session-id <newId> 允许在 fork 时指定新会话 ID，
   * 因此可以在执行前就知道派生 ID，无需从输出解析。
   * 立即通过 onDerivedSessionId 回调通知 StepWise，
   * 使 fork 执行中断后仍可按派生 ID 恢复。
   */
  async execute(prompt: string, options: AgentExecutorOptions): Promise<ExecutionResult> {
    this.currentCwd = options.cwd || process.cwd();

    if (options.fork && options.sessionId) {
      this.forkNewSessionId = this.generateUUID();
      // 立即通知 StepWise，使其在执行中断前就记录派生 ID
      options.onDerivedSessionId?.(this.forkNewSessionId);
    } else {
      this.forkNewSessionId = null;
    }

    return super.execute(prompt, options);
  }

  /**
   * 构建命令行参数
   *
   * @param prompt 提示词内容
   * @param sessionId 会话 ID
   * @param isResume 是否使用恢复模式（Pi 的 --session-id 自动判断创建/恢复，此参数仅用于逻辑判断）
   * @param debugFile debug 日志文件路径（Pi 无此参数，忽略）
   * @param fork 是否 fork 模式
   * @returns 命令行参数数组
   */
  protected buildArgs(
    prompt: string,
    sessionId: string,
    isResume: boolean,
    debugFile?: string,
    fork?: boolean
  ): string[] {
    const args: string[] = [];

    if (fork && this.forkNewSessionId) {
      // fork 模式
      if (this.isPiSessionExists(this.forkNewSessionId)) {
        // 派生 session 已存在（重试场景：第一次 fork 成功创建了 session 但后续执行失败）
        // 直接用 --session-id 打开已存在的派生 session（pi 会自动 resume）
        args.push('--session-id', this.forkNewSessionId);
      } else {
        // 派生 session 不存在，fork 并指定新 ID
        args.push('--fork', sessionId);
        args.push('--session-id', this.forkNewSessionId);
      }
    } else {
      // 新会话或恢复：pi 的 --session-id 会自动判断创建或打开
      // - session 不存在 → 创建新会话
      // - session 已存在 → 打开（resume）
      args.push('--session-id', sessionId);
    }

    // print 模式，纯文本输出
    args.push('-p', prompt);

    return args;
  }

  /**
   * fork 模式下返回预生成的派生 session ID
   * 使 BaseExecutor 能将派生 ID 作为最终 sessionId 返回
   */
  protected async getSessionIdAfterExecution(): Promise<string | null> {
    return this.forkNewSessionId;
  }

  /**
   * 检查 pi session 文件是否存在
   * pi 的 session 存储在 <agentDir>/sessions/--<escaped-cwd>--/<sessionId>.jsonl
   * agentDir 默认为 ~/.pi/agent，可通过 PI_CODING_AGENT_DIR 环境变量覆盖
   */
  private isPiSessionExists(sessionId: string): boolean {
    if (!this.currentCwd) return false;

    const homedir = os.homedir();
    const agentDir = process.env.PI_CODING_AGENT_DIR
      || path.join(homedir, '.pi', 'agent');

    // pi 的 cwd 编码规则：去掉前导 / 或 \，将 / \ : 替换为 -，前后加 --
    const escapedCwd = `--${this.currentCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
    const sessionDir = path.join(agentDir, 'sessions', escapedCwd);
    const sessionFile = path.join(sessionDir, `${sessionId}.jsonl`);

    return fs.existsSync(sessionFile);
  }
}
