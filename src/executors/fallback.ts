/**
 * 自动降级执行器
 * 优先使用 OpenCode，如果检测到 ruleset 问题则自动切换到内部执行器
 */

import { ExecutionResult } from '../types';
import { AgentExecutorOptions } from './types';
import { OpenCodeExecutor } from './opencode';
import { InternalExecutor, getTaskCallback } from './internal';

/**
 * Ruleset 错误的特征字符串
 */
const RULESET_ERROR_PATTERNS = [
  'ruleset',
  'action',
  'Invalid option: expected one of "allow"|"deny"|"ask"',
  'invalid_value'
];

/**
 * 检测输出是否包含 ruleset 错误
 */
function isRulesetError(output: string): boolean {
  if (!output) return false;
  const lowerOutput = output.toLowerCase();
  return RULESET_ERROR_PATTERNS.some(pattern => 
    lowerOutput.includes(pattern.toLowerCase())
  );
}

/**
 * 降级状态
 */
interface FallbackState {
  /** 是否已切换到内部执行器 */
  useInternal: boolean;
  /** 切换原因 */
  reason?: string;
}

/** 全局降级状态 */
const fallbackState: FallbackState = {
  useInternal: false
};

/**
 * 获取当前降级状态
 */
export function getFallbackState(): FallbackState {
  return { ...fallbackState };
}

/**
 * 重置降级状态（用于测试）
 */
export function resetFallbackState(): void {
  fallbackState.useInternal = false;
  fallbackState.reason = undefined;
}

/**
 * 自动降级执行器
 * 
 * 执行策略：
 * 1. 如果已经切换到内部执行器，直接使用内部执行器
 * 2. 否则尝试使用 OpenCode 执行
 * 3. 如果检测到 ruleset 错误，切换到内部执行器并重试
 */
export class FallbackExecutor {
  readonly agentType = 'opencode' as const;

  private openCodeExecutor: OpenCodeExecutor;
  private internalExecutor: InternalExecutor;

  constructor() {
    this.openCodeExecutor = new OpenCodeExecutor();
    this.internalExecutor = new InternalExecutor();
  }

  /**
   * 执行提示词任务
   */
  async execute(prompt: string, options: AgentExecutorOptions): Promise<ExecutionResult> {
    // 如果已经切换到内部执行器，直接使用
    if (fallbackState.useInternal) {
      console.log('[FallbackExecutor] 使用内部执行器（已降级）');
      return this.executeWithInternal(prompt, options);
    }

    // 检查是否注册了内部执行器回调
    if (!getTaskCallback()) {
      console.log('[FallbackExecutor] 未注册内部执行器回调，使用 OpenCode');
      return this.openCodeExecutor.execute(prompt, options);
    }

    // 尝试使用 OpenCode 执行
    console.log('[FallbackExecutor] 尝试使用 OpenCode 执行...');
    
    try {
      const result = await this.openCodeExecutor.execute(prompt, options);

      // 检查是否有 ruleset 错误
      if (this.hasRulesetError(result)) {
        console.log('[FallbackExecutor] 检测到 OpenCode ruleset 错误，切换到内部执行器');
        fallbackState.useInternal = true;
        fallbackState.reason = 'OpenCode ruleset 配置错误';
        
        // 使用内部执行器重试
        return this.executeWithInternal(prompt, options);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 检查错误是否是 ruleset 相关或 OpenCode 崩溃
      if (isRulesetError(errorMessage) || this.isOpenCodeCrash(errorMessage)) {
        console.log('[FallbackExecutor] OpenCode 执行失败，切换到内部执行器');
        fallbackState.useInternal = true;
        fallbackState.reason = 'OpenCode 执行失败: ' + (isRulesetError(errorMessage) ? 'ruleset 配置错误' : '程序崩溃');
        
        return this.executeWithInternal(prompt, options);
      }

      // 其他错误直接抛出
      throw error;
    }
  }

  /**
   * 检测是否是 OpenCode 崩溃
   */
  private isOpenCodeCrash(errorMessage: string): boolean {
    // 非常规退出码（如 3221226505）表示程序崩溃
    if (errorMessage.includes('exited with code')) {
      const match = errorMessage.match(/exited with code (\d+)/);
      if (match) {
        const exitCode = parseInt(match[1], 10);
        // 非常规退出码（非 0、1、2）通常是崩溃
        return exitCode > 2 && exitCode !== 127;
      }
    }
    return false;
  }

  /**
   * 检查执行结果是否包含 ruleset 错误
   */
  private hasRulesetError(result: ExecutionResult): boolean {
    // 检查 output
    if (isRulesetError(result.output)) {
      return true;
    }

    // 检查 error
    if (result.error && isRulesetError(result.error)) {
      return true;
    }

    // 检查是否成功但没有实际输出（可能是工具被阻止）
    if (result.success && result.output) {
      // 检查 JSON 输出中是否有 tool_use 错误
      try {
        const lines = result.output.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          const json = JSON.parse(trimmed);
          if (json.type === 'tool_use' && json.part?.state?.status === 'error') {
            const toolError = json.part.state.error;
            if (typeof toolError === 'string' && isRulesetError(toolError)) {
              return true;
            }
          }
        }
      } catch {
        // 忽略解析错误
      }
    }

    return false;
  }

  /**
   * 使用内部执行器执行
   */
  private async executeWithInternal(prompt: string, options: AgentExecutorOptions): Promise<ExecutionResult> {
    const callback = getTaskCallback();
    
    if (!callback) {
      return {
        sessionId: options.sessionId || '',
        output: '',
        success: false,
        error: '[FallbackExecutor] 内部执行器回调未注册，请先调用 registerTaskCallback()',
        timestamp: Date.now(),
        duration: 0
      };
    }

    return this.internalExecutor.execute(prompt, options);
  }
}