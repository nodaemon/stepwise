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

/** 错误重试默认等待时间（毫秒）：5 分钟 */
export const DEFAULT_RETRY_WAIT_MS = 5 * 60 * 1000;

/** 429 探测恢复最大探测次数 */
export const MAX_PROBE_ATTEMPTS = 10;

/** 校验错误提示词最多显示的错误条数（超出则在末尾补充说明，避免提示词超长） */
export const MAX_DISPLAY_ERRORS = 50;

/** debug 模式自检报告文件名（与 output.txt 同级，落在任务日志目录下） */
export const SELF_CHECK_FILE = 'self_check.md';

// ============ 任务日志目录内的文件名 ============
// 以下三个文件构成任务的完整证据集：写入方（StepWise / executor）
// 与读取方（debug 模式自检复盘）必须使用同一常量，改名时不会出现
// 「写端已改、读端仍指向旧名」而导致自检静默降级的情况

/** 提示词文件名（写入方：各 exec 方法执行前） */
export const PROMPT_FILE = 'prompt.txt';

/** 最终输出文件名（写入方：writeTaskLogs / shell 任务） */
export const OUTPUT_FILE = 'output.txt';

/** 执行轨迹文件名（写入方：executor 子进程执行期间实时追加） */
export const TRACE_FILE = 'verbose_output.txt';

/** 429 探测恢复单次探测超时时间（毫秒）：30 秒 */
export const PROBE_TIMEOUT_MS = 30 * 1000;

// ============ Shell 任务相关常量 ============

/**
 * Shell 任务默认超时时间：5 分钟（毫秒）
 * Shell 命令通常比 AI 任务快，所以超时时间较短
 */
export const DEFAULT_SHELL_TIMEOUT_MS = 5 * 60 * 1000;

// ============ Claude Code 相关常量 ============

/** Claude Code 命令 */
export const CLAUDE_COMMAND = 'claude';

// ============ OpenCode 相关常量 ============

/** OpenCode 命令 */
export const OPENCODE_COMMAND = 'opencode';

// ============ CodeAgent 相关常量 ============

/** CodeAgent 命令（参数与 claude 基本一致，另额外携带 --skip-safe-check） */
export const CODEAGENT_COMMAND = 'codeagent';

// ============ Pi 相关常量 ============

/** Pi 命令（@earendil-works/pi-coding-agent） */
export const PI_COMMAND = 'pi';

// ============ mcode 相关常量 ============

/** mcode 命令（Minimax Code，@minimax-ai/code） */
export const MCODE_COMMAND = 'mcode';

/** 任务类型 */
export type TaskType = 'task' | 'collect' | 'process' | 'process_collect' | 'report' | 'check' | 'summarize' | 'shell' | 'schema' | 'self_check';

/** 任务类型名称映射 */
export const TASK_TYPE_NAMES: Record<TaskType, string> = {
  task: 'task',
  collect: 'collect',
  process: 'process',
  process_collect: 'process_and_collect',
  report: 'report',
  check: 'check',
  summarize: 'summarize',
  shell: 'shell',
  schema: 'schema',
  self_check: 'self_check'
};