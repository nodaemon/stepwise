/**
 * Claude Code 执行器
 * 封装 claude 命令的执行逻辑
 */

import { BaseExecutor } from './base';
import { AgentType } from '../types';

/**
 * Claude Code 执行器
 *
 * 命令格式（提示词经 stdin 管道下发，不出现在命令行参数中）：
 * - 新会话: claude --dangerously-skip-permissions --session-id <uuid> -p  < prompt
 * - 恢复会话: claude --dangerously-skip-permissions --resume <uuid> -p  < prompt
 *
 * 说明：`-p` 是打印模式开关，claude 在 -p 模式下会从 stdin 读取提示词；
 * 提示词若走命令行参数，Linux 单个 argv 上限 128 KiB，超长提示词会直接
 * 导致 spawn 报 E2BIG，故统一经管道下发。
 *
 * 本类同时作为 CodeAgent 执行器的基类（CodeAgent 命令参数与 Claude 基本一致，
 * 差别仅是可执行程序名，以及 CodeAgent 独有的 --skip-safe-check），
 * 故 agentType 使用联合类型 AgentType 而非字面量 'claude'，以便子类覆盖为 'codeagent'。
 *
 * 子类如需追加自身专属参数，应覆写 buildSafetyArgs()（安全确认类）
 * 或重写 buildArgs()，不要直接改动本类 buildArgs() 中的共享参数。
 */
export class ClaudeExecutor extends BaseExecutor {
  /** 执行器类型标识 */
  readonly agentType: AgentType = 'claude';

  /**
   * 返回 CLI 命令名称
   */
  protected getCommand(): string {
    return 'claude';
  }

  /**
   * Claude 使用 stream-json（NDJSON）输出格式
   * 空行无意义需跳过，每行按 type 格式化后写入 verbose_output.txt
   */
  protected usesNDJsonOutput(): boolean {
    return true;
  }

  /**
   * 构建「安全确认类」参数（追加在 --dangerously-skip-permissions 之后）
   *
   * 默认返回空数组：Claude Code 无需额外参数。
   * CodeAgent 覆写为 ['--skip-safe-check']，跳过目录首次使用时的安全确认，
   * 避免该确认产生的报错被写入 verbose_output.txt / error_report.txt。
   */
  protected buildSafetyArgs(): string[] {
    return [];
  }

  /**
   * 构建命令行参数（**不含提示词**）
   *
   * 提示词统一由基类经 stdin 管道下发：`-p`（打印模式）保留，
   * 但不再携带提示词本身。
   *
   * @param sessionId 会话 ID
   * @param isResume 是否使用恢复模式
   * @param debugFile debug 日志文件路径（可选）
   * @param fork 是否 fork 模式（从 sessionId 派生新会话，原会话保留）
   * @returns 命令行参数数组
   */
  protected buildArgs(
    sessionId: string,
    isResume: boolean,
    debugFile?: string,
    fork?: boolean
  ): string[] {
    const args: string[] = [];

    // 跳过权限确认，允许自动化执行
    args.push('--dangerously-skip-permissions');

    // 执行器专属的安全确认参数（Claude 为空，CodeAgent 为 --skip-safe-check）
    args.push(...this.buildSafetyArgs());

    // 添加 debug 日志输出，记录 Claude 思考和执行过程
    if (debugFile) {
      args.push('--debug-file', debugFile);
    }

    // 使用 stream-json 格式捕获完整过程（思考、工具调用、结果）
    args.push('--verbose', '--output-format', 'stream-json');

    // 根据是否恢复会话，使用不同的参数
    if (isResume) {
      // 恢复已有会话
      args.push('--resume', sessionId);
      // fork 模式：在 resume 时派生新 session ID（原会话保留，新会话独立）
      // --fork-session 必须配合 --resume 使用
      if (fork) {
        args.push('--fork-session');
      }
    } else {
      // 创建新会话
      args.push('--session-id', sessionId);
    }

    // 打印模式开关：提示词由基类经 stdin 管道下发（claude -p 会从 stdin 读提示词）
    args.push('-p');

    return args;
  }

  /**
   * 构建探测命令参数
   * 使用 --no-session-persistence 避免探测 session 落盘
   * 需要 --dangerously-skip-permissions 避免探测命令等待交互式权限确认
   *
   * 探测与正式执行使用相同 cwd，故同样需要 buildSafetyArgs()：
   * 目录首次使用时探测命令也会触发安全确认
   *
   * 探测提示词同样经 stdin 管道下发（见基类 probeRateLimit），不在参数中携带
   */
  protected buildProbeArgs(): string[] {
    return [
      '--dangerously-skip-permissions',
      ...this.buildSafetyArgs(),
      '--no-session-persistence',
      '-p'
    ];
  }
}