// 注册 source-map-support，支持运行时将 JS 行号映射回 TS 源码行号
import 'source-map-support/register';

// StepWise 类
export { StepWise } from './StepWise';

// 全局设置接口
export {
  setTaskName,
  setResumePath,
  enableDebugMode,
  setSkipSummarize,
  saveCollectData,
  loadCollectData,
  setAgentType
} from './globalState';

// 并发处理接口
export { forEachParallel } from './forEachParallel';
export type { WorkerConfig, WorkerContext, ForEachParallelOptions } from './forEachParallel';

// 类型定义
export * from './types';

// 常量（仅导出类型，不导出内部常量）
export type { TaskType } from './constants';

// 校验工具类型 - ValidationResult 直接使用 SchemaValidationResult
export type { ValidationResult } from './utils/validator';

// Schema 工具类型
export type {
  JsonSchema,
  SchemaValidationError,
  SchemaValidationResult
} from './utils/schemaUtils';

// Schema 工具函数
export {
  buildJsonSchema,
  getFirstRequiredField,
  getRequiredFields,
  checkDuplicateKeys,
  validateAgainstSchema,
  formatValidationErrors
} from './utils/schemaUtils';

// 导出测试用的内部函数
export {
  _resetState,
  _getTaskName,
  _getResumePath,
  _isDebugMode,
  _shouldSkipSummarize,
  _registerName,
  _getAgentType,
  _getTaskDir,
  _setTaskDir,
  _clearRegisteredNames
} from './globalState';