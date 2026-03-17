/**
 * Claude Code 执行器
 * 封装 claude 命令的执行逻辑
 * 
 * 【设计说明】
 * 
 * 1. 会话管理：
 *    - 新会话：使用 --session-id <uuid> 创建新会话
 *    - 恢复会话：使用 --resume <uuid> 恢复已有会话
 * 
 * 2. Windows 兼容性：
 *    - Windows 下通过 npm 全局安装的命令，spawn 需要使用 .cmd 扩展名
 *    - 例如：spawn('claude') 会失败，需要使用 spawn('claude.cmd')
 *    - Linux/macOS 不需要扩展名
 * 
 * 3. 权限处理：
 *    - 使用 --dangerously-skip-permissions 跳过交互式确认
 *    - 实现无人值守的自动化执行
 */

import { BaseExecutor } from './base';

/**
 * 检测当前是否为 Windows 系统
 */
function isWindows(): boolean {
  return process.platform === 'win32';
}

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
   * 
   * 【Windows 兼容性】
   * 
   * 在 Windows 下，npm 全局安装的命令实际上是 .cmd 文件。
   * 使用 child_process.spawn() 执行时：
   * - spawn('claude') 会失败（找不到命令）
   * - spawn('claude.cmd') 可以正常执行
   * 
   * Linux/macOS 不存在此问题，直接使用命令名即可。
   */
  protected getCommand(): string {
    return isWindows() ? 'claude.cmd' : 'claude';
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