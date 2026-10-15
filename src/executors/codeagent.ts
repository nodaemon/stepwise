/**
 * CodeAgent 执行器
 *
 * CodeAgent 的命令行参数与 Claude Code 基本一致，输出格式同样为
 * stream-json（NDJSON），区别是可执行程序名为 codeagent，
 * 且额外支持 --skip-safe-check（跳过目录首次使用时的安全确认）。
 *
 * 因此本类直接继承 ClaudeExecutor，复用其 buildArgs() 逻辑，
 * 仅覆盖 agentType 标识、CLI 命令名与安全确认参数。
 *
 * 命令格式：
 * - 新会话: codeagent --dangerously-skip-permissions --skip-safe-check --session-id <uuid> -p "prompt"
 * - 恢复会话: codeagent --dangerously-skip-permissions --skip-safe-check --resume <uuid> -p "prompt"
 */
import { ClaudeExecutor } from './claude';

export class CodeAgentExecutor extends ClaudeExecutor {
  /** 执行器类型标识 */
  readonly agentType = 'codeagent' as const;

  /**
   * 返回 CLI 命令名称
   * CodeAgent 使用独立的可执行程序名，参数与 claude 基本一致
   */
  protected getCommand(): string {
    return 'codeagent';
  }

  /**
   * 追加 --skip-safe-check，跳过目录首次使用时的安全确认
   * 该确认在无头执行下无人应答，其报错会被写入 verbose_output.txt / error_report.txt
   */
  protected buildSafetyArgs(): string[] {
    return ['--skip-safe-check'];
  }
}
