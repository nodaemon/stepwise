// StepWise 类
export { StepWise } from './StepWise';

// 全局设置接口
export {
  setTaskName,
  setResumePath,
  enableDebugMode,
  setSkipSummarize,
  saveCollectData,
  loadCollectData
} from './globalState';

// 并发处理接口
export { forEachParallel } from './forEachParallel';
export type { WorkerConfig, WorkerContext, ForEachParallelOptions } from './forEachParallel';

// 类型定义
export * from './types';

// 常量（仅导出类型，不导出内部常量）
export type { TaskType } from './constants';

// 校验工具类型
export type {
  ValidationErrorType,
  ValidationError,
  ValidationResult
} from './utils/validator';

// 导出测试用的内部函数
export {
  _resetState,
  _getTaskName,
  _getResumePath,
  _isDebugMode,
  _shouldSkipSummarize,
  _registerName,
  _getWorkerId,
  _setWorkerId
} from './globalState';
