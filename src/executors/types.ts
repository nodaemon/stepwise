/**
 * 执行器类型定义
 * 定义统一的执行器接口，确保 Claude 和 OpenCode 实现相同的方法
 */

import { ExecutionResult, TaskType } from '../types';
import { Logger } from '../utils/logger';

/**
 * 执行器选项
 * 所有执行器共用的配置选项
 */
export interface AgentExecutorOptions {
  /** 工作目录，未指定则使用当前进程的 cwd */
  cwd?: string;

  /**
   * 会话 ID
   * - 新会话时：传入新生成的 UUID
   * - 恢复会话时：传入之前的 UUID
   */
  sessionId?: string;

  /**
   * 是否使用恢复模式
   * - true: 恢复已有会话继续执行
   * - false: 创建新会话或复用当前会话
   */
  useResume?: boolean;

  /**
   * fork 模式：从 sessionId 派生新会话（原会话保留，新会话独立继续）
   * - Claude/CodeAgent：拼装 --resume <sessionId> --fork-session
   * - OpenCode：拼装 --session <sessionId> --fork
   * - 仅当 sessionId 与 newSession 同时指定时由 StepWise 置为 true
   */
  fork?: boolean;

  /**
   * 派生 sessionId 回调（fork 模式专用）
   * 子进程 stdout 解析到 system/init 块时，若其 session_id 不同于传入的 sessionId
   * （即 fork 已派生出新 ID），立即回调通知 StepWise 把派生 ID 写入 progress，
   * 使 fork 执行中断后仍可按派生 ID 恢复（而非重新派生）。
   * 仅 Claude/CodeAgent 的 NDJSON init 块能在执行中途暴露派生 ID，OpenCode 无此能力。
   */
  onDerivedSessionId?: (sessionId: string) => void;

  /** 任务日志目录，用于保存执行日志 */
  taskLogDir?: string;

  /** 日志记录器实例 */
  logger?: Logger;

  /** 任务序号 */
  taskIndex?: number;

  /** 任务类型 */
  taskType?: TaskType;

  /** 执行超时时间（毫秒），默认 3 小时 */
  timeout?: number;

  /** 额外的环境变量数组，格式为 "KEY=VALUE" */
  env?: string[];

  /**
   * 提示词日志文件名（相对任务日志目录，默认 prompt.txt）
   *
   * 执行器把本次实际下发的提示词写入该文件（长期留存），
   * 复现脚本 command.sh 引用它——提示词不在命令行参数里，复现靠的是这个文件。
   *
   * 同一任务目录内会用不同提示词重复执行，调用方应按提示词类型给出不同文件名
   * （如任务本体用 prompt.txt、postCheck 用 post_check_prompt.txt），
   * 避免后一次执行覆盖前一次的记录。
   */
  promptLogFile?: string;

  /**
   * 产物文件名前缀（相对任务日志目录）
   *
   * 同一任务目录内会用不同提示词重复执行（任务本体、postCheck、自检复盘），
   * 每次执行都会生成 command.sh / execution_info.json / debug.log /
   * verbose_output.txt 等产物。加前缀后，本次执行的产物带前缀落盘，
   * 不覆盖目录里已有同名文件。
   *
   * 作用范围：执行器自己生成的产物文件。
   * **提示词记录文件不受影响**——它的文件名由 options.promptLogFile 显式指定，
   * 避免「前缀 + 已带前缀的名字」造成二次加前缀。
   */
  artifactPrefix?: string;
}

/**
 * 执行器原始执行结果
 * spawn 命令执行后的原始输出
 */
export interface ExecutorRawResult {
  /** 标准输出 */
  stdout: string;

  /** 标准错误输出 */
  stderr: string;

  /** 退出码，0 表示成功 */
  exitCode: number | null;
}

/**
 * 智能体执行器接口
 * 所有智能体执行器（Claude、OpenCode、CodeAgent）必须实现此接口
 */
export interface AgentExecutor {
  /**
   * 执行器类型标识
   * 返回当前执行器对应的智能体类型
   */
  readonly agentType: 'claude' | 'opencode' | 'codeagent' | 'pi' | 'mcode';

  /**
   * 执行提示词任务
   * @param prompt 要执行的提示词内容
   * @param options 执行选项
   * @returns 执行结果，包含 sessionId、output、success 等信息
   */
  execute(prompt: string, options: AgentExecutorOptions): Promise<ExecutionResult>;

  /**
   * fork 能力前置校验（可选）
   *
   * StepWise 在写入 progress（标记任务 in_progress）之前调用，用于让不支持
   * fork 的后端提前失败，避免任务永久停留在 in_progress 且续跑必然再次失败。
   * 未实现该方法的后端视为支持 fork。
   */
  assertForkSupported?(): void;
}
