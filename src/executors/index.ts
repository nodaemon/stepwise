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

// NDJSON 解析器
export { parseAndFormatNDJson, formatNDJsonLine } from './ndjsonFormatter';
export type { ParsedNDJsonResult, NDJsonLineResult } from './ndjsonFormatter';
