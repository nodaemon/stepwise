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

// 类型定义
export * from './types';

// 常量（仅导出类型，不导出内部常量）
export type { TaskType } from './constants';

// 导出测试用的内部函数
export {
  _resetState,
  _getTaskName,
  _getResumePath,
  _isDebugMode,
  _shouldSkipSummarize,
  _registerName
} from './globalState';
