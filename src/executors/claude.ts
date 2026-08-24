/**
 * Claude Code 执行器
 * 封装 claude 命令的执行逻辑
 */

import { BaseExecutor } from './base';
import { AgentType } from '../types';

/**
 * Claude Code 执行器
 *
 * 命令格式：
 * - 新会话: claude --dangerously-skip-permissions --session-id <uuid> -p "prompt"
 * - 恢复会话: claude --dangerously-skip-permissions --resume <uuid> -p "prompt"
 *
 * 本类同时作为 CodeAgent 执行器的基类（CodeAgent 命令参数与 Claude 一致，
 * 仅可执行程序名不同），故 agentType 使用联合类型 AgentType 而非字面量 'claude'，
 * 以便子类覆盖为 'codeagent'。
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
   * 构建命令行参数
   *
   * @param prompt 提示词内容
   * @param sessionId 会话 ID
   * @param isResume 是否使用恢复模式
   * @param debugFile debug 日志文件路径（可选）
   * @param fork 是否 fork 模式（从 sessionId 派生新会话，原会话保留）
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

    // 跳过权限确认，允许自动化执行
    args.push('--dangerously-skip-permissions');

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

    // 提示词
    args.push('-p', prompt);

    return args;
  }

  /**
   * 构建探测命令参数
   * 使用 --no-session-persistence 避免探测 session 落盘
   * 需要 --dangerously-skip-permissions 避免探测命令等待交互式权限确认
   */
  protected buildProbeArgs(): string[] {
    return ['--dangerously-skip-permissions', '--no-session-persistence', '-p', 'reply ok'];
  }
}