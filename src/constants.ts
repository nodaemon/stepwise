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

/** 默认执行超时时间：5 小时（毫秒）- AI 任务 */
export const DEFAULT_TIMEOUT_MS = 5 * 60 * 60 * 1000;

/**
 * 进程终止宽限期（毫秒）
 *
 * 超时后先给子进程发 SIGTERM，宽限期到了还没退出才升级为 SIGKILL。
 * SIGKILL 无法被捕获，是「超时后子进程一定退出」的最终保障。
 */
export const PROCESS_TERMINATE_GRACE_MS = 3000;

/** 错误重试默认等待时间（毫秒）：5 分钟 */
export const DEFAULT_RETRY_WAIT_MS = 5 * 60 * 1000;

/** 429 探测恢复最大探测次数 */
export const MAX_PROBE_ATTEMPTS = 10;

/** 校验错误提示词最多显示的错误条数（超出则在末尾补充说明，避免提示词超长） */
export const MAX_DISPLAY_ERRORS = 50;

/** debug 模式自检报告文件名（与 output.txt 同级，落在任务日志目录下） */
export const SELF_CHECK_FILE = 'self_check.md';

/**
 * debug 模式自检提示词文件名（与 output.txt 同级，落在任务日志目录下）
 *
 * 自检不再使用独立的 self_check 目录，而是与步骤产物同处一个步骤目录；
 * 凡是与步骤本体重名的文件都加 SELF_CHECK_ARTIFACT_PREFIX 前缀，
 * 提示词记录文件由调用方显式指定（执行器不对它加前缀，避免二次加前缀）。
 */
export const SELF_CHECK_PROMPT_FILE = 'self_check_prompt.txt';

/**
 * debug 模式自检产物的文件名前缀
 *
 * 作用范围：执行器生成的产物（command.sh / execution_info.json / debug.log /
 * verbose_output.txt / error_report.txt / stdin 临时文件）。
 *
 * 用前缀替代独立目录：审查者与步骤本体共用一个步骤目录，靠文件名区分，
 * 既保留「审查者不覆盖步骤本地产物」的保证，又不必再开一个 self_check 目录。
 */
export const SELF_CHECK_ARTIFACT_PREFIX = 'self_check_';

// ============ 任务日志目录内的提示词日志文件名 ============
// 同一任务目录内会用不同提示词重复执行（任务本体、postCheck、输出校验重试、
// 会话末尾 summarize），每种提示词各记一个文件、互不覆盖——
// debug 模式自检复盘要按文件核对「这一步到底要求 agent 做什么」。
// 写入方（StepWise 与执行器）与读取方必须使用同一常量，改名时不会出现
// 「写端已改、读端仍指向旧名」而导致自检静默降级的情况。

/**
 * 任务提示词日志文件名（写入方：各 exec 方法执行前 + 执行器实际下发前）
 *
 * 语义是「这一步要求 agent 做什么」——同一步骤内稳定不变。
 */
export const PROMPT_FILE = 'prompt.txt';

/** 后检查提示词日志文件名（postCheckPrompt） */
export const POST_CHECK_PROMPT_FILE = 'post_check_prompt.txt';

/**
 * 后检查判定结果文件名（postCheckPrompt）
 *
 * 后检查是「用同会话再问一次」的检查动作，判定文本此前只回显在会话里、
 * 没有任何文件承载。落盘后，debug 模式的自检复盘才能把它当作输入：
 * 提示词审「后检查要求是否清晰」，输出审「步骤产出是否满足后检查要求」。
 */
export const POST_CHECK_OUTPUT_FILE = 'post_check_output.txt';

// ============ 同一步骤目录内多次执行的产物前缀 ============
// 一个步骤目录里会先后跑好几次执行：步骤本体、后检查、输出缺失重试、
// 校验失败修复、会话末尾总结、自检复盘。每次执行都会生成 command.sh /
// execution_info.json / debug.log / verbose_output.txt 等产物——
// 不加区分时，后一次执行会覆盖前一次的产物，步骤本体的复现脚本也会消失。
//
// 规则：**步骤本体**独占无前缀的名字（command.sh 就是「这一步」的复现脚本），
// 其余每种执行都带自己的前缀（post_check_command.sh、file_missing_command.sh……），
// 与该次执行的提示词记录文件同名前缀（post_check_prompt.txt ↔ post_check_command.sh）。
//
// 提示词记录文件不加前缀——它的名字由调用方显式指定（options.promptLogFile），
// 避免「前缀 + 已带前缀的名字」造成二次加前缀。

/** 后检查执行的产物前缀 */
export const POST_CHECK_ARTIFACT_PREFIX = 'post_check_';

/** 输出文件缺失重试的产物前缀 */
export const FILE_MISSING_ARTIFACT_PREFIX = 'file_missing_';

/** 输出校验失败修复的产物前缀 */
export const VALIDATION_FIX_ARTIFACT_PREFIX = 'validation_fix_';

/** 会话末尾总结的产物前缀（总结落在步骤目录内时使用） */
export const SUMMARIZE_ARTIFACT_PREFIX = 'summarize_';

/** 会话末尾总结提示词日志文件名（summarize） */
export const SUMMARIZE_PROMPT_FILE = 'summarize_prompt.txt';

/** 输出文件缺失时的重试提示词日志文件名 */
export const FILE_MISSING_PROMPT_FILE = 'file_missing_prompt.txt';

/** 输出校验失败后的修复提示词日志文件名 */
export const VALIDATION_FIX_PROMPT_FILE = 'validation_fix_prompt.txt';

// ============ 最终输出与执行轨迹文件名 ============

/** 最终输出文件名（写入方：writeTaskLogs / shell 任务） */
export const OUTPUT_FILE = 'output.txt';

/** 执行轨迹文件名（写入方：executor 子进程执行期间实时追加） */
export const TRACE_FILE = 'verbose_output.txt';

// ============ stdin 提示词临时文件名 ============
// 不属于日志文件：进程退出即删，目录里不留残留。

/**
 * stdin 提示词临时文件名（写入方：执行器，子进程退出即删）
 *
 * 运行时把提示词写进该固定名文件，再从它读出喂给子进程 stdin；
 * 子进程退出后立即删除。长期留存的是上面的提示词日志文件，
 * 复现脚本（command.sh）引用的是它们，不是这个临时文件。
 *
 * 固定名的意义：所有执行（任务 / postCheck / 校验重试 / summarize / 自检）
 * 在底层走同一条通路——写固定名文件 → 从它读 → 喂 stdin → 退出即删。
 */
export const STDIN_PROMPT_FILE = '.stdin_prompt';

/**
 * 提示词投递通道
 *
 * 提示词统一经 stdin 管道下发，不进入命令行参数（Linux 单个 argv 上限 128 KiB，
 * 超长提示词会直接导致 spawn 报 E2BIG）。此常量仅用于在日志与
 * execution_info.json 中显式标注投递方式。
 */
export const PROMPT_DELIVERY = 'stdin';

/** 429 探测恢复单次探测超时时间（毫秒）：30 秒 */
export const PROBE_TIMEOUT_MS = 30 * 1000;

/**
 * 429 探测使用的提示词
 *
 * 与正式执行一样，探测提示词也经 stdin 管道下发，不进入命令行参数，
 * 以维持「提示词永远不进 argv」这一不变量。
 */
export const PROBE_PROMPT = 'reply ok';

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