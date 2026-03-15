/**
 * OpenCode 执行器
 * 封装 opencode 命令的执行逻辑
 */

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
 * - 新会话/恢复会话: opencode run --session <uuid> "prompt"
 *
 * 注意：OpenCode 的 --session 参数会自动判断是新会话还是恢复会话
 *
 * 权限处理：
 * 通过环境变量 OPENCODE_PERMISSION 设置权限，跳过交互式确认
 */
export class OpenCodeExecutor extends BaseExecutor {
  /** 执行器类型标识 */
  readonly agentType = 'opencode';

  /**
   * 返回 CLI 命令名称
   * Windows 下需要使用 opencode.cmd
   */
  protected getCommand(): string {
    // Windows 下 npm 全局安装的命令需要使用 .cmd 扩展名
    return isWindows() ? 'opencode.cmd' : 'opencode';
  }

  /**
   * 构建执行环境变量
   * 设置权限配置，跳过所有权限确认
   * @param extraEnv 额外的环境变量数组，格式为 "KEY=VALUE"
   */
  protected buildEnv(extraEnv?: string[]): NodeJS.ProcessEnv {
    // 调用父类方法获取基础环境变量（包含 extraEnv 解析）
    const env = super.buildEnv(extraEnv);
    // 设置权限：允许所有操作，跳过交互式确认
    // 这样可以实现无人值守的自动化执行
    env.OPENCODE_PERMISSION = OPENCODE_PERMISSION_ALL;
    return env;
  }

  /**
   * 构建命令行参数
   *
   * @param prompt 提示词内容
   * @param sessionId 会话 ID
   * @param isResume 是否使用恢复模式
   *   - Claude: 需要根据此参数区分 --resume 和 --session-id
   *   - OpenCode: 统一使用 --session，CLI 工具自动检测，此参数不直接影响命令构建
   * @param debugFile debug 日志文件路径（暂未使用）
   * @returns 命令行参数数组
   */
  protected buildArgs(
    prompt: string,
    sessionId: string,
    isResume: boolean,
    debugFile?: string
  ): string[] {
    const args: string[] = [];

    // 使用 run 子命令进行非交互式执行
    args.push('run');

    // 指定会话 ID
    // OpenCode 会自动判断：
    // - 如果是新 ID，创建新会话
    // - 如果是已有 ID，恢复该会话
    args.push('--session', sessionId);

    // 提示词（放在最后）
    args.push(prompt);

    // TODO: 如果 OpenCode 后续支持 debug 日志输出，可以在这里添加
    // 目前 OpenCode 的 CLI 不支持 --debug-file 参数
    // 可以使用 --print-logs 和 --log-level 环境变量作为替代方案

    return args;
  }

  /**
   * 获取速率限制正则表达式列表
   * OpenCode 的错误格式可能与 Claude 不同，这里先使用基类的默认实现
   * 后续可以根据实际情况调整
   */
  // protected getRateLimitPatterns(): RegExp[] {
  //   // 如果 OpenCode 的错误格式不同，可以在这里重写
  //   return super.getRateLimitPatterns();
  // }
}