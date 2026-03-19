/**
 * 执行器工厂模块
 * 根据智能体类型创建对应的执行器实例
 */

import { _getAgentType } from '../globalState';
import { AgentType } from '../types';
import { AgentExecutor } from '../executors/types';
import { ClaudeExecutor } from '../executors/claude';
import { OpenCodeExecutor } from '../executors/opencode';

// 向后兼容：重新导出类型（从 executors/types.ts）
export type { AgentExecutorOptions as ExecutorOptions } from '../executors/types';

/**
 * 执行器工厂映射
 * 使用对象映射替代字符串比较，便于扩展新的执行器类型
 */
const executorFactories: Record<AgentType, () => AgentExecutor> = {
  claude: () => new ClaudeExecutor(),
  opencode: () => new OpenCodeExecutor(),
};

/**
 * 创建执行器实例
 * 根据全局设置的智能体类型返回对应的执行器
 *
 * @returns 执行器实例（ClaudeExecutor 或 OpenCodeExecutor）
 *
 * @example
 * // 默认返回 Claude 执行器
 * const executor = createExecutor();
 *
 * // 切换到 OpenCode
 * setAgentType('opencode');
 * const executor = createExecutor();
 */
export function createExecutor(): AgentExecutor {
  const agentType = _getAgentType();
  return executorFactories[agentType]();
}

// 向后兼容：导出 ClaudeExecutor 类（已废弃，建议使用 createExecutor）
export { ClaudeExecutor };