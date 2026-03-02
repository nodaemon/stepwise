/**
 * 执行选项
 */
export interface ExecOptions {
  /** 工作目录，未指定则使用当前进程的cwd */
  cwd?: string;
  /** 会话ID，有值则使用 --resume 恢复执行，无值则生成新 UUID 使用 --session-id */
  sessionId?: string;
}

/**
 * 输出键定义
 */
export interface OutputKey {
  /** 键名 */
  name: string;
  /** 键描述 */
  description: string;
  /** 键类型 */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
}

/**
 * 输出格式定义
 */
export interface OutputFormat {
  /** 主键，用于去重 */
  primaryKey?: string;
  /** 输出键列表 */
  keys: OutputKey[];
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  /** 会话ID */
  sessionId: string;
  /** 执行输出 */
  output: string;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 执行时间戳 */
  timestamp: number;
  /** 执行耗时（毫秒） */
  duration: number;
}

/**
 * 收集任务结果
 */
export interface CollectResult extends ExecutionResult {
  /** 收集到的数据 */
  data: Record<string, any>[];
}

/**
 * 任务状态
 */
export interface TaskStatus {
  /** 任务序号 */
  taskIndex: number;
  /** 任务层级名称，如 1_task, 2_collect, 3_1_process */
  taskName: string;
  /** 会话ID */
  sessionId: string;
  /** 是否完成 */
  completed: boolean;
  /** 执行时间戳 */
  timestamp: number;
  /** 任务类型 */
  taskType: 'task' | 'collect' | 'process' | 'process_collect' | 'report';
  /** 输出文件名（仅收集类任务） */
  outputFileName?: string;
  /** 日志层级路径，用于恢复时判断任务位置 */
  logLevelPath: number[];
}

/**
 * 进度信息
 */
export interface ProgressInfo {
  /** 任务名称 */
  taskName: string;
  /** 任务目录 */
  taskDir: string;
  /** 当前任务计数 */
  taskCounter: number;
  /** 任务状态列表 */
  tasks: TaskStatus[];
  /** 最后更新时间 */
  lastUpdated: number;
  /** 日志层级路径，用于嵌套任务的日志目录命名 */
  logLevelPath: number[];
}