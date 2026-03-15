/**
 * 常量定义
 */

/** 执行信息目录名 */
export const EXEC_INFO_DIR = 'stepwise_exec_infos';

/** 数据目录名 */
export const DATA_DIR = 'data';

/** 日志目录名 */
export const LOGS_DIR = 'logs';

/** 收集数据目录名 */
export const COLLECT_DIR = 'collect';

/** 报告数据目录名 */
export const REPORT_DIR = 'report';

/** 进度文件名 */
export const PROGRESS_FILE = 'progress.json';

/** 汇总日志文件名 */
export const EXECUTE_LOG = 'execute.log';

/** 最大重试次数 */
export const MAX_RETRIES = 3;

/** 默认执行超时时间：3 小时（毫秒）- AI 任务 */
export const DEFAULT_TIMEOUT_MS = 3 * 60 * 60 * 1000;

// ============ Shell 任务相关常量 ============

/**
 * Shell 任务默认超时时间：5 分钟（毫秒）
 * Shell 命令通常比 AI 任务快，所以超时时间较短
 */
export const DEFAULT_SHELL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Shell 任务默认重试次数
 * 某些命令（如网络请求）可能因临时故障失败，支持自动重试
 */
export const DEFAULT_SHELL_RETRY_COUNT = 3;

// ============ Claude Code 相关常量 ============

/** Claude Code 命令 */
export const CLAUDE_COMMAND = 'claude';

// ============ OpenCode 相关常量 ============

/** OpenCode 命令 */
export const OPENCODE_COMMAND = 'opencode';

/** OpenCode 权限配置：允许所有操作，跳过权限确认 */
export const OPENCODE_PERMISSION_ALL = '{"allow": ["*"]}';

/** 任务类型 */
export type TaskType = 'task' | 'collect' | 'process' | 'process_collect' | 'report' | 'check' | 'summarize' | 'shell';

/** 任务类型名称映射 */
export const TASK_TYPE_NAMES: Record<TaskType, string> = {
  task: 'task',
  collect: 'collect',
  process: 'process',
  process_collect: 'process_and_collect',
  report: 'report',
  check: 'check',
  summarize: 'summarize',
  shell: 'shell'
};