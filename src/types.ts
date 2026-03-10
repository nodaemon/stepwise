/**
 * 执行选项
 */
export interface ExecOptions {
  /** 工作目录，未指定则使用当前进程的cwd */
  cwd?: string;
  /**
   * 是否使用新会话，默认 false
   * - false: 复用上一个任务的 session id（如果没有则创建新的）
   * - true: 创建新的 session id
   */
  newSession?: boolean;
  /**
   * 数据对象，用于替换 prompt 中的变量
   * 例如：{ name: "test", desc: "description" } 会将 prompt 中的 $name 替换为 "test"，$desc 替换为 "description"
   */
  data?: Record<string, any>;
  /**
   * 执行完成后的检查提示词
   * 如果指定，主任务完成后会使用 --resume 模式执行此提示词
   * 支持 data 变量替换
   */
  checkPrompt?: string;
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
 * 检查任务结果
 */
export interface CheckResult extends ExecutionResult {
  /** 检查结果 */
  result: boolean;
}

/**
 * 任务状态枚举
 */
export type TaskStatusType = 'pending' | 'in_progress' | 'completed';

/**
 * 任务状态
 */
export interface TaskStatus {
  /** 任务序号 */
  taskIndex: number;
  /** 任务名称，如 1_task, 2_collect, 3_process */
  taskName: string;
  /** 会话ID */
  sessionId: string;
  /** 任务状态 */
  status: TaskStatusType;
  /** 执行时间戳 */
  timestamp: number;
  /** 任务类型 */
  taskType: 'task' | 'collect' | 'process' | 'process_collect' | 'report' | 'check' | 'summarize';
  /** 输出文件名（仅收集类任务） */
  outputFileName?: string;
  /** check 任务的结果（仅 check 类型任务） */
  checkResult?: boolean;
}

/**
 * 总结选项
 */
export interface SummarizeOptions {
  /** 工作目录，未指定则使用当前进程的cwd */
  cwd?: string;
  /** 自定义提示词 */
  customPrompt?: string;
}

/**
 * 总结结果
 */
export interface SummarizeResult extends ExecutionResult {
  /** 生成的 Skill 文件路径列表 */
  skillFiles: string[];
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
}