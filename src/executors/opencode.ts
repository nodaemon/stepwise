/**
 * OpenCode 执行器
 * 封装 opencode 命令的执行逻辑
 * 
 * 【设计说明】
 * 
 * 1. 会话管理：
 *    - OpenCode 的 --session 参数用于恢复已有会话，而非创建新会话
 *    - 新会话：不使用 --session，OpenCode 会自动生成 session ID
 *    - 恢复会话：使用 --session 指定已有的 session ID
 * 
 * 2. 同步执行：
 *    - 使用 --format json 参数确保同步阻塞执行
 *    - OpenCode 会输出 JSON 事件流（每行一个 JSON 对象）
 *    - 从事件流中提取 AI 文本响应和自动生成的 session ID
 * 
 * 3. 权限处理：
 *    - OPENCODE_PERMISSION 环境变量格式要求严格，暂不设置
 *    - 让 OpenCode 使用默认配置，避免工具无法执行
 */

import { BaseExecutor } from './base';
import { ExecutionResult } from '../types';
import { AgentExecutorOptions } from './types';

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
 * - 新会话: opencode run --format json "prompt"
 * - 恢复会话: opencode run --format json --session <session_id> "prompt"
 *
 * 注意：
 * - 新会话时不要使用 --session，OpenCode 会自动生成 session ID
 * - 恢复会话时使用 --session 指定已有的 session ID
 * - 使用 --format json 参数确保同步阻塞执行，并输出 JSON 事件流
 * - 从 JSON 输出中提取自动生成的 session ID
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
   * 注意：OpenCode 的权限配置格式要求严格，暂不设置自动跳过
   * @param extraEnv 额外的环境变量数组，格式为 "KEY=VALUE"
   */
  protected buildEnv(extraEnv?: string[]): NodeJS.ProcessEnv {
    // 调用父类方法获取基础环境变量（包含 extraEnv 解析）
    const env = super.buildEnv(extraEnv);
    // 注意：OPENCODE_PERMISSION 格式要求严格，设置不当会导致工具无法执行
    // 暂不设置，让 OpenCode 使用默认配置
    return env;
  }

  /**
   * 构建命令行参数
   * 
   * 【关键设计】
   * 
   * OpenCode 的 --session 参数行为与 Claude 不同：
   * - Claude: --session-id 创建新会话，--resume 恢复会话
   * - OpenCode: --session 仅用于恢复已有会话，新会话不需要此参数
   * 
   * 因此，我们根据 isResume 参数决定是否使用 --session：
   * - isResume=false (新会话): 不添加 --session，让 OpenCode 自动生成
   * - isResume=true (恢复会话): 添加 --session，指定要恢复的会话
   *
   * @param prompt 提示词内容
   * @param sessionId 会话 ID（仅恢复会话时使用）
   * @param isResume 是否使用恢复模式
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

    // 使用 JSON 格式输出，确保同步阻塞执行
    args.push('--format', 'json');

    // 仅在恢复会话时使用 --session 参数
    // 新会话不使用 --session，OpenCode 会自动生成 session ID
    if (isResume) {
      args.push('--session', sessionId);
    }

    // 提示词（放在最后）
    args.push(prompt);

    return args;
  }

  /**
   * 执行提示词任务
   * 
   * 【重写原因】
   * 
   * OpenCode 使用 --format json 时，输出的是 JSON 事件流，而非纯文本。
   * 需要额外处理：
   * 1. 从 JSON 事件流中提取 AI 文本响应（event.type === 'text'）
   * 2. 从事件流中获取 OpenCode 自动生成的 session ID（新会话场景）
   * 
   * 【Session ID 处理】
   * - 新会话：OpenCode 自动生成 session ID，从输出中提取并更新 result.sessionId
   * - 恢复会话：使用传入的 sessionId，不需要更新
   */
  async execute(prompt: string, options: AgentExecutorOptions): Promise<ExecutionResult> {
    const result = await super.execute(prompt, options);
    
    // 解析 JSON 输出，提取文本和 session ID
    const parsed = this.parseJsonOutput(result.output);
    result.output = parsed.text;
    
    // 如果是新会话，更新 session ID（OpenCode 自动生成的）
    if (!options.useResume && parsed.sessionId) {
      result.sessionId = parsed.sessionId;
    }
    
    return result;
  }

  /**
   * 解析 OpenCode 的 JSON 事件流输出
   * 
   * 【输出格式说明】
   * 
   * OpenCode 使用 --format json 时，输出 JSON 事件流，每行一个 JSON 对象：
   * 
   * 示例：
   * {"type":"step_start","sessionID":"ses_xxx",...}
   * {"type":"text","part":{"text":"AI 响应内容"},...}
   * {"type":"tool_use","part":{"tool":"read",...},...}
   * {"type":"step_finish",...}
   * 
   * 【提取逻辑】
   * 1. 逐行解析 JSON
   * 2. 从任意事件中提取 sessionID 字段（用于新会话）
   * 3. 从 type="text" 事件中提取 part.text 字段（AI 文本响应）
   * 
   * @param output 原始 JSON 事件流输出
   * @returns 解析结果，包含文本内容和 session ID
   */
  private parseJsonOutput(output: string): { text: string; sessionId?: string } {
    if (!output || !output.trim()) {
      return { text: output };
    }

    const textParts: string[] = [];
    let sessionId: string | undefined;
    const lines = output.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const event = JSON.parse(trimmed);
        
        // 提取 session ID（从任意事件中）
        if (event.sessionID && !sessionId) {
          sessionId = event.sessionID;
        }
        
        // 提取文本内容
        if (event.type === 'text' && event.part && typeof event.part.text === 'string') {
          textParts.push(event.part.text);
        }
      } catch {
        // 忽略无法解析的行
      }
    }

    const text = textParts.length > 0 ? textParts.join('') : output;
    return { text, sessionId };
  }
}