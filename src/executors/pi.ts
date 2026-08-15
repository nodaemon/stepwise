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
 * - --mode json + -p：stdout 为逐行 JSON（NDJSON）事件流，每行对应一个 AgentSessionEvent
 *   包含完整过程：thinking、text、tool_call（tool_execution_start/update/end）、
 *   turn/agent lifecycle 等。verbose_output.txt 中按事件类型格式化输出。
 *   首行为 SessionHeader（{"type":"session","id":"<uuid>",...}），从中提取 session_id。
 * - 不使用 text 模式（-p 默认行为），因为它只输出最终 assistant 文本，
 *   缺少中间过程（思考、工具调用、工具结果）。
 *
 * Session ID 获取策略：
 * - 新会话/恢复：首行 SessionHeader 包含 id 字段，由 ndjsonFormatter 提取后回填
 * - Fork：在 execute() 中预生成派生 ID，通过 --session-id 指定给 pi，
 *   并立即通过 onDerivedSessionId 回调通知 StepWise（无需从输出解析）。
 *   SessionHeader 的 id 字段同样会与派生 ID 匹配，可用于校验。
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
   * Pi 使用 NDJSON 输出格式（--mode json）
   * stdout 为逐行 JSON，每行按 type 格式化后写入 verbose_output.txt，
   * 空行无意义需跳过。
   */
  protected usesNDJsonOutput(): boolean {
    return true;
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

    // print 模式 + JSON 事件流，stdout 为 NDJSON，每行一个 AgentSessionEvent，
    // 包含完整过程（思考、文本、工具调用与结果），由 ndjsonFormatter 格式化输出
    args.push('--mode', 'json');
    args.push('-p', prompt);

    return args;
  }

  /**
   * fork 模式下返回预生成的派生 session ID
   * 使 BaseExecutor 能将派生 ID 作为最终 sessionId 返回
   *
   * 非 fork 场景下，session_id 由 ndjsonFormatter 从首行 SessionHeader.id 提取，
   * 并通过 parseAndFormatNDJson().sessionId 回填到 BaseExecutor（无需在此返回）。
   * 这里仍保留返回 fork 派生 ID 的能力，覆盖 fork 路径。
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
