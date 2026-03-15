/**
 * Claude Code 执行器
 * 封装 claude 命令的执行逻辑
 */

import { BaseExecutor } from './base';

/**
 * Claude Code 执行器
 *
 * 命令格式：
 * - 新会话: claude --dangerously-skip-permissions --session-id <uuid> -p "prompt"
 * - 恢复会话: claude --dangerously-skip-permissions --resume <uuid> -p "prompt"
 */
export class ClaudeExecutor extends BaseExecutor {
  /** 执行器类型标识 */
  readonly agentType = 'claude';

  /**
   * 返回 CLI 命令名称
   */
  protected getCommand(): string {
    return 'claude';
  }

  /**
   * 构建命令行参数
   *
   * @param prompt 提示词内容
   * @param sessionId 会话 ID
   * @param isResume 是否使用恢复模式
   * @param debugFile debug 日志文件路径（可选）
   * @returns 命令行参数数组
   */
  protected buildArgs(
    prompt: string,
    sessionId: string,
    isResume: boolean,
    debugFile?: string
  ): string[] {
    const args: string[] = [];

    // 跳过权限确认，允许自动化执行
    args.push('--dangerously-skip-permissions');

    // 添加 debug 日志输出，记录 Claude 思考和执行过程
    if (debugFile) {
      args.push('--debug-file', debugFile);
    }

    // 根据是否恢复会话，使用不同的参数
    if (isResume) {
      // 恢复已有会话
      args.push('--resume', sessionId);
    } else {
      // 创建新会话
      args.push('--session-id', sessionId);
    }

    // 提示词
    args.push('-p', prompt);

    return args;
  }
}