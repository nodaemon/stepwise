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
  readonly agentType: 'claude' | 'opencode' | 'codeagent';

  /**
   * 执行提示词任务
   * @param prompt 要执行的提示词内容
   * @param options 执行选项
   * @returns 执行结果，包含 sessionId、output、success 等信息
   */
  execute(prompt: string, options: AgentExecutorOptions): Promise<ExecutionResult>;
}