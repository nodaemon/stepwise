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
import { AgentExecutorOptions, ExecutorRawResult } from './types';

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
   * 判断 pi 执行结果是否真的成功
   *
   * Pi 在 --mode json 模式下，进程退出码始终是 0（即使 assistant.stopReason 是 error/aborted
   * 或内部 auto-retry 全部失败）。仅靠 exitCode === 0 会让 base.ts 把错误结果误判为成功，
   * 并绕过 checkRateLimitError() 的 429 重试机制。
   *
   * 此方法扫描 NDJSON stdout，检查最后一条 assistant message_end 的 stopReason，
   * 如为 error/aborted 则返回 false，让基类走非零退出码路径触发 rate limit 重试。
   */
  protected isExecutionSuccessful(result: ExecutorRawResult): boolean {
    if (!super.isExecutionSuccessful(result)) {
      return false;
    }
    const lastAssistantStopReason = this.extractLastAssistantStopReason(result.stdout);
    return lastAssistantStopReason !== 'error' && lastAssistantStopReason !== 'aborted';
  }

  /**
   * 从 NDJSON 流中提取最后一个 assistant message_end 事件的 stopReason
   * 返回 null 表示未找到；返回字符串表示找到（包含 'stop' / 'toolUse' / 'length' / 'error' / 'aborted' / 'pending' 等）
   */
  private extractLastAssistantStopReason(ndjsonStdout: string): string | null {
    if (!ndjsonStdout) return null;
    const lines = ndjsonStdout.split('\n');
    let lastStopReason: string | null = null;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed.type === 'message_end' &&
          parsed.message?.role === 'assistant' &&
          typeof parsed.message.stopReason === 'string'
        ) {
          lastStopReason = parsed.message.stopReason;
        }
      } catch {
        // 忽略非 JSON 行（不预期出现，但容错）
      }
    }
    return lastStopReason;
  }

  /**
   * 重写 execute：fork 模式下预生成派生 session ID
   *
   * Pi 的 --fork <id> --session-id <newId> 允许在 fork 时指定新会话 ID，
   * 因此可以在执行前就知道派生 ID，无需从输出解析。
   * 立即通过 onDerivedSessionId 回调通知 StepWise，
   * 使 fork 执行中断后仍可按派生 ID 恢复。
   *
   * 防幽灵 ID：fork 前必须确认 fork 源会话真实存在。
   * 若 fork 源不存在（progress.json 中的幽灵 ID / 会话已过期 / 跨 cwd 等场景），
   * 降级为新建会话（不 fork），避免 pi 报 "No session found"。
   * 此时 onDerivedSessionId 不调用，progress.json 保留旧 sessionId，
   * 下次恢复仍可被此处拦截（不会无限传播）。
   */
  async execute(prompt: string, options: AgentExecutorOptions): Promise<ExecutionResult> {
    this.currentCwd = options.cwd || process.cwd();

    if (options.fork && options.sessionId) {
      if (this.isPiSessionExists(options.sessionId)) {
        // fork 源存在：预生成派生 ID 并回写 progress.json
        this.forkNewSessionId = this.generateUUID();
        options.onDerivedSessionId?.(this.forkNewSessionId);
      } else {
        // fork 源不存在（幽灵 ID / 过期会话）：降级为新建会话
        this.forkNewSessionId = null;
        options.fork = false;
        options.sessionId = this.generateUUID();
        // 不调用 onDerivedSessionId：派生 ID 是真的新建会话 ID，
        // 但执行前不确定 spawn 是否成功，回写会造成新的幽灵。
        // 即便这里不更新，下次恢复时本方法同样会拦截 fork 源不存在的情况。
      }
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
   * pi 的 session 存储在 <agentDir>/sessions/--<escaped-cwd>--/<timestamp>_<sessionId>.jsonl
   * 文件名带时间戳前缀，需用 readdir + 后缀匹配，不能精确匹配
   * agentDir 默认为 ~/.pi/agent，可通过 PI_CODING_AGENT_DIR 环境变量覆盖
   *
   * 注意：需跳过悬空 symlink（worktree 中指向主仓库已清理会话的 symlink）。
   * 使用 fs.statSync（跟随 symlink）验证目标可达，避免误判。
   */
  private isPiSessionExists(sessionId: string): boolean {
    if (!this.currentCwd) return false;

    const homedir = os.homedir();
    const agentDir = process.env.PI_CODING_AGENT_DIR
      || path.join(homedir, '.pi', 'agent');

    // pi 的 cwd 编码规则：去掉前导 / 或 \，将 / \ : 替换为 -，前后加 --
    const escapedCwd = `--${this.currentCwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
    const sessionDir = path.join(agentDir, 'sessions', escapedCwd);

    if (!fs.existsSync(sessionDir)) return false;
    try {
      const files = fs.readdirSync(sessionDir);
      // pi 文件名格式: <timestamp>_<sessionId>.jsonl
      // 精确匹配 <sessionId>.jsonl 永远找不到，必须按后缀匹配
      // 需 statSync 跟随 symlink，跳过悬空链接（主仓库会话已清理时）
      return files.some(f => {
        if (!f.endsWith(`_${sessionId}.jsonl`)) return false;
        try {
          fs.statSync(path.join(sessionDir, f));  // 跟随 symlink，目标不存在则抛错
          return true;
        } catch {
          return false;  // 悬空 symlink 或不可访问
        }
      });
    } catch {
      return false;
    }
  }
}
