/**
 * CodeAgent 执行器
 *
 * CodeAgent 的命令行参数与 Claude Code 完全一致，输出格式同样为
 * stream-json（NDJSON），唯一区别是可执行程序名为 codeagent。
 *
 * 因此本类直接继承 ClaudeExecutor，复用其 buildArgs() 逻辑，
 * 仅覆盖 agentType 标识与 CLI 命令名。
 *
 * 命令格式：
 * - 新会话: codeagent --dangerously-skip-permissions --session-id <uuid> -p "prompt"
 * - 恢复会话: codeagent --dangerously-skip-permissions --resume <uuid> -p "prompt"
 */
import { ClaudeExecutor } from './claude';

export class CodeAgentExecutor extends ClaudeExecutor {
  /** 执行器类型标识 */
  readonly agentType = 'codeagent' as const;

  /**
   * 返回 CLI 命令名称
   * CodeAgent 使用独立的可执行程序名，参数与 claude 完全一致
   */
  protected getCommand(): string {
    return 'codeagent';
  }
}
