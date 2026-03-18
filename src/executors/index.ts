/**
 * 执行器模块
 * 统一导出所有执行器相关类型和实现
 */

// 类型定义
export type { AgentExecutor, AgentExecutorOptions, ExecutorRawResult } from './types';

// 执行器实现
export { BaseExecutor } from './base';
export { ClaudeExecutor } from './claude';
export { OpenCodeExecutor } from './opencode';
export { FallbackExecutor, getFallbackState, resetFallbackState } from './fallback';

// 内部执行器回调注册（用于 FallbackExecutor 降级）
export { registerTaskCallback, getTaskCallback } from './internal';
export type { TaskExecutionCallback } from './internal';