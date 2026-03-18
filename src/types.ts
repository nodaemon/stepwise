/**
 * 智能体类型
 * - 'claude': 使用 Claude Code 智能体
 * - 'opencode': 使用 OpenCode 智能体
 */
export type AgentType = 'claude' | 'opencode';

/**
 * JSON 输出校验选项
 */
export interface ValidateOptions {
  /** 是否启用校验，默认 true */
  enabled?: boolean;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
}

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
  postCheckPrompt?: string;
  /**
   * 额外的环境变量数组，格式为 "KEY=VALUE"
   */
  env?: string[];
  /**
   * JSON 输出校验选项
   * 用于 execCollectPrompt、execCheckPrompt、execReport 等接口
   */
  validateOptions?: ValidateOptions;
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
 * 任务类型
 */
export type TaskType = 'task' | 'collect' | 'process' | 'process_collect' | 'report' | 'check' | 'summarize' | 'shell';

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
  taskType: TaskType;
  /** 输出文件名（仅收集类任务） */
  outputFileName?: string;
  /** check 任务的结果（仅 check 类型任务） */
  checkResult?: boolean;
  /**
   * Shell 命令内容（仅 shell 类型任务）
   * 用于断点恢复时识别和跳过已执行的命令
   */
  command?: string;
}

/**
 * 总结选项
 */
export interface SummarizeOptions {
  /** 工作目录，未指定则使用当前进程的cwd */
  cwd?: string;
  /** 自定义提示词 */
  customPrompt?: string;
  /**
   * 额外的环境变量数组，格式为 "KEY=VALUE"
   */
  env?: string[];
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

// ============ Shell 执行相关类型 ============

/**
 * Shell 执行选项
 * 用于配置 execShell 方法的行为
 */
export interface ShellOptions {
  /**
   * 工作目录
   * 未指定则使用 process.cwd()
   * 例如：'/home/user/project'
   */
  cwd?: string;

  /**
   * 超时时间（毫秒）
   * 默认 5 分钟 (300000ms)
   * 超时后命令会被强制终止
   */
  timeout?: number;

  /**
   * 环境变量
   * 会与 process.env 合并后传递给子进程
   * 例如：{ NODE_ENV: 'production', DEBUG: 'true' }
   */
  env?: Record<string, string>;

  /**
   * 失败时是否自动重试
   * 默认 false
   * 如果为 true，命令失败后会自动重试
   */
  retry?: boolean;

  /**
   * 重试次数
   * 默认 3 次
   * 仅当 retry 为 true 时生效
   */
  retryCount?: number;
}

/**
   * Shell 执行结果
   * execShell 方法的返回类型
   */
export interface ShellResult {
  /**
   * 标准输出 (stdout)
   * 命令的正常输出内容
   */
  stdout: string;

  /**
   * 标准错误输出 (stderr)
   * 命令的错误输出内容
   */
  stderr: string;

  /**
   * 退出码
   * 0 表示成功，非 0 表示失败
   */
  exitCode: number;

  /**
   * 是否成功
   * exitCode === 0 时为 true
   */
  success: boolean;

  /**
   * 执行耗时（毫秒）
   * 从命令开始执行到完成的时间
   */
  duration: number;

  /**
   * 任务序号
   * 在整个任务流程中的序号
   */
  taskIndex: number;
}

// ============ 性能统计相关类型 ============

/**
 * 性能统计类型
 * - prompt: execPrompt、execCollectPrompt、execCheckPrompt、execReport
 * - shell: execShell
 * - summarize: summarize 方法
 * - postCheck: ExecOptions.postCheckPrompt 选项触发的验证检查
 */
export type PerformanceType = 'prompt' | 'shell' | 'summarize' | 'postCheck';

/**
 * 单个类型的性能统计
 */
export interface PerformanceTypeStats {
  /** 执行次数 */
  count: number;
  /** 总耗时（毫秒） */
  totalDuration: number;
  /** 最大耗时（毫秒） */
  maxDuration: number;
  /** 最小耗时（毫秒） */
  minDuration: number;
  /** 最大耗时对应的日志目录路径（相对于 cwd） */
  maxDurationLogDir?: string;
}

/**
 * 单个 key 的性能统计
 */
export interface PerformanceStats {
  /** 统计 key，格式为 "文件名:行号" */
  key: string;
  /** 各类型的性能统计 */
  types: Record<PerformanceType, PerformanceTypeStats>;
}

/**
 * 性能统计报告
 */
export interface PerformanceReport {
  /** 任务名称 */
  taskName: string;
  /** 生成时间 */
  generatedAt: string;
  /** 汇总信息 */
  summary: {
    /** 总执行次数 */
    totalCount: number;
    /** 总耗时（毫秒） */
    totalDuration: number;
    /** 唯一 key 数量 */
    uniqueKeys: number;
  };
  /** 各 key 的性能统计 */
  stats: PerformanceStats[];
}