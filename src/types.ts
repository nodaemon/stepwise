/**
 * 智能体类型
 * - 'claude': 使用 Claude Code 智能体
 * - 'opencode': 使用 OpenCode 智能体（自动降级机制）
 * - 'codeagent': 使用 CodeAgent 智能体（命令参数与 claude 一致，仅可执行程序名不同）
 * - 'pi': 使用 Pi 智能体（@earendil-works/pi-coding-agent，纯文本输出，无 JSON 解析）
 */
export type AgentType = 'claude' | 'opencode' | 'codeagent' | 'pi';

/**
 * JSON 输出校验选项
 */
export interface ValidateOptions {
  /** 是否启用校验，默认 true */
  enabled?: boolean;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 文件不存在时是否触发重试，默认 true */
  retryOnFileMissing?: boolean;
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
   * 指定会话 ID（可选）
   * - 指定后直接使用该 sessionId 执行，而非复用上一个任务的 session id
   * - 指定 sessionId 即视为恢复已存在的会话，强制使用 resume 模式（--resume）
   * - 与 newSession: true 同时指定时为 fork 语义：从该 sessionId 派生新会话（原会话保留），
   *   底层用 --resume <sessionId> --fork-session（Claude/CodeAgent）或 --session <sessionId> --fork（OpenCode）
   * - 适用场景：跨 StepWise 实例或跨进程复用某个已知会话，或从某个会话派生分支
   */
  sessionId?: string;
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
  /**
   * 允许读取的目录路径列表。设置后 agent 只能读取这些目录内的文件。
   * 支持相对路径和 ~ 展开。与全局设置合并时，步骤级别覆盖全局。
   */
  allowRead?: string[];
  /**
   * 允许写入的目录路径列表。设置后 agent 只能写入这些目录内的文件。
   * 支持相对路径和 ~ 展开。与全局设置合并时，步骤级别覆盖全局。
   */
  allowWrite?: string[];
}

/**
 * 属性定义接口
 * 用于定义输出格式中每个字段的类型和描述
 */
export interface PropertyDef {
  /** 字段类型 */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** 字段描述 */
  description?: string;
  /** 是否必填，默认 true */
  required?: boolean;
  /** 可复用子结构定义，语义同 JsonSchemaDef.defs（仅顶层 OutputFormat 有效） */
  defs?: Record<string, PropertyDef>;
  /** JSON Pointer 引用（如 '#/$defs/Dependency'），语义同 JsonSchemaDef.ref */
  ref?: string;
}

/**
 * 输出格式定义
 * 直接使用 Record<string, PropertyDef>，框架自动提取必填字段列表
 * 第一个 required 字段（默认为第一个字段）作为去重 key
 */
export type OutputFormat = Record<string, PropertyDef>;

// ============ Schema 驱动输出相关类型 ============

/**
 * JSON Schema 定义
 * 支持任意嵌套结构的递归类型定义
 * 用于 execPromptSchema 接口定义输出结构
 */
export interface JsonSchemaDef {
  /**
   * 字段类型
   * ref 引用节点可省略（结构由所引用的 defs 组件决定）
   */
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** 字段描述（可选） */
  description?: string;
  /**
   * type === 'object' 时的字段定义
   * 每个字段又是一个 JsonSchemaDef，支持任意嵌套
   */
  properties?: Record<string, JsonSchemaDef>;
  /**
   * type === 'object' 时的必填字段列表
   * 不指定时，所有字段默认为必填
   */
  required?: string[];
  /**
   * type === 'array' 时的数组元素结构定义
   * items 本身又是一个 JsonSchemaDef，支持数组元素为复杂结构
   */
  items?: JsonSchemaDef;
  /**
   * type === 'array' 时的元组定义（与 items 互斥）
   * 按位置定义每个元素的类型，分量可为任意 type
   * 数组长度必须严格等于 prefixItems.length（固定长度元组）
   */
  prefixItems?: JsonSchemaDef[];
  /**
   * 固定值约束（仅 type === 'string' | 'number' | 'boolean' 时有效）
   * 输出中该字段的值必须严格等于 const 指定的值
   * 典型场景：固定节点名（如树的根/分支节点名为 "1"/"2"/"3"）、固定标签
   */
  const?: string | number | boolean;
  /**
   * 是否为递归树形结构（仅 type === 'object' 时有效）
   * 标记后，该对象的某些字段可以自引用，形成树形嵌套
   */
  recursive?: boolean;
  /**
   * 递归字段名称列表（仅 recursive === true 时有效）
   * 列出的字段必须是 type === 'array' 的属性，且仅允许 type/description（白名单）
   * 框架在 schema 展开时自动填充 items 为自引用结构
   */
  recursiveFields?: string[];
  /**
   * 递归最大深度（仅 recursive === true 时有效）
   * 默认 3，范围 1~10
   * 超过最大深度的节点为叶子节点，递归字段为空数组
   */
  maxDepth?: number;
  /**
   * 可复用子结构定义（仅顶层 schema 有效，嵌套层的 defs 被忽略 + console.warn）
   * 对应 JSON Schema 标准的 $defs；组件可互相 ref（含自引用递归），禁止循环引用（构建期检测）
   */
  defs?: Record<string, JsonSchemaDef>;
  /**
   * JSON Pointer 引用（如 '#/$defs/Dependency'）
   * 含 ref 的字段上仅允许 ref + description，其它字段出现即抛异常（白名单校验）
   */
  ref?: string;
}

/**
 * token 消耗与 AI 耗时
 * 来自 Claude stream-json result 块的 usage/duration 字段
 * 仅 NDJSON 执行器（Claude/CodeAgent）产出；Pi/OpenCode 不支持
 */
export interface TokenUsage {
  /** 输入 token 数 */
  inputTokens: number;
  /** 输出 token 数 */
  outputTokens: number;
  /** 缓存创建 token 数 */
  cacheCreationTokens: number;
  /** 缓存读取 token 数 */
  cacheReadTokens: number;
  /** 总成本（美元） */
  costUsd: number;
  /** Claude result.duration_ms（总耗时，毫秒） */
  durationMs: number;
  /** Claude result.duration_api_ms（纯 API 耗时，毫秒） */
  durationApiMs: number;
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
  /** token 消耗与 AI 耗时（仅 NDJSON 执行器：Claude/CodeAgent；缺省表示该执行器不支持） */
  tokenUsage?: TokenUsage;
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
 * Schema 输出结果
 * 用于 execPromptSchema 接口
 * data 的具体类型由 JsonSchemaDef.type 决定
 * - type: 'object' → data 为单个对象
 * - type: 'array' → data 为数组
 * - type: 'string'/'number'/'boolean' → data 为对应基础类型
 */
export interface SchemaResult extends ExecutionResult {
  /** 输出数据，类型由 schema.type 决定 */
  data: unknown;
}

/**
 * 任务状态枚举
 */
export type TaskStatusType = 'pending' | 'in_progress' | 'completed';

/**
 * 任务类型
 */
export type TaskType = 'task' | 'collect' | 'process' | 'process_collect' | 'report' | 'check' | 'summarize' | 'shell' | 'schema';

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
  /** 任务是否完全完成，用于 forEachParallel 恢复时判断任务是否真正完成 */
  isCompleted?: boolean;
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
   * 环境变量数组，格式为 "KEY=VALUE"
   * 会转换为对象后与 process.env 合并，传递给子进程
   * 例如：['NODE_ENV=production', 'DEBUG=true']
   */
  env?: string[];
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