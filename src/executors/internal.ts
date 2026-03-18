/**
 * 内部执行器
 * 直接调用当前 AI 的工具能力执行任务，不依赖外部 CLI 工具
 */

import { ExecutionResult } from '../types';
import { AgentExecutorOptions } from './types';

/**
 * 任务执行回调函数类型
 * @param prompt 提示词
 * @param options 执行选项
 * @returns 执行结果
 */
export type TaskExecutionCallback = (
  prompt: string,
  options: AgentExecutorOptions
) => Promise<ExecutionResult>;

/**
 * 全局任务执行回调
 * 由外部（如当前 AI）注册
 */
let globalTaskCallback: TaskExecutionCallback | null = null;

/**
 * 注册任务执行回调
 * @param callback 回调函数
 */
export function registerTaskCallback(callback: TaskExecutionCallback): void {
  globalTaskCallback = callback;
}

/**
 * 获取当前注册的任务执行回调
 */
export function getTaskCallback(): TaskExecutionCallback | null {
  return globalTaskCallback;
}

/**
 * 内部执行器
 * 不调用外部 CLI，直接使用注册的回调函数执行任务
 */
export class InternalExecutor {
  readonly agentType = 'internal' as const;

  /**
   * 执行提示词任务
   * @param prompt 提示词内容
   * @param options 执行选项
   * @returns 执行结果
   */
  async execute(prompt: string, options: AgentExecutorOptions): Promise<ExecutionResult> {
    const startTime = Date.now();
    const sessionId = options.sessionId || this.generateSessionId();

    if (!globalTaskCallback) {
      return {
        sessionId,
        output: '',
        success: false,
        error: '[InternalExecutor] 未注册任务执行回调，请先调用 registerTaskCallback()',
        timestamp: startTime,
        duration: 0
      };
    }

    try {
      const result = await globalTaskCallback(prompt, options);
      return {
        ...result,
        sessionId: result.sessionId || sessionId,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        sessionId,
        output: '',
        success: false,
        error: `[InternalExecutor] 执行失败: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: startTime,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 生成会话 ID
   */
  private generateSessionId(): string {
    return `internal_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}