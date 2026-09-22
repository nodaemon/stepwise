/**
 * 性能统计装饰器
 * 使用 TC39 装饰器实现 AOP，性能统计逻辑与业务代码分离
 */

import { getUserCallSite } from './callSite';
import { PerformanceTracker } from './performanceTracker';
import { PerformanceType, ExecutionResult, CollectResult, CheckResult, SummarizeResult, ShellResult } from '../types';
import { _getTaskDir } from '../globalState';
import { LOGS_DIR } from '../constants';
import * as path from 'path';

/** 跳过记录的时间阈值（毫秒）- 执行时间不足此值的任务不记录性能 */
const SKIPPED_THRESHOLD_MS = 3000;

/**
 * 获取性能报告输出路径
 */
function getPerformanceReportPath(): string {
  const taskDir = _getTaskDir();
  return path.join(taskDir, LOGS_DIR, 'performance.json');
}

/**
 * 从结果中提取 duration
 */
function extractDuration(result: any): number {
  if (result && typeof result.duration === 'number') {
    return result.duration;
  }
  return 0;
}

/**
 * 从结果中提取累计重试等待耗时
 * 缺省（如 shell 任务、旧版 mock）返回 0
 */
function extractRetryWaitMs(result: any): number {
  if (result && typeof result.retryWaitMs === 'number') {
    return result.retryWaitMs;
  }
  return 0;
}

/**
 * 性能统计装饰器
 * @param type 性能类型
 *
 * 使用示例：
 * ```typescript
 * class StepWise {
 *   @trackPerformance('prompt')
 *   async execPrompt(prompt: string, options?: ExecOptions): Promise<ExecutionResult> {
 *     // 业务逻辑
 *   }
 * }
 * ```
 */
export function trackPerformance(type: PerformanceType) {
  return function (
    target: any,
    context: ClassMethodDecoratorContext
  ) {
    return async function (this: any, ...args: any[]): Promise<any> {
      const result = await target.call(this, ...args);

      // 从结果中提取 duration 与累计重试等待耗时
      const duration = extractDuration(result);
      const retryWaitMs = extractRetryWaitMs(result);

      // 跳过的任务不记录（执行时间不足 3 秒）
      // 注意：阈值按总时长（含重试等待）判断，含长等待的任务同样值得记录
      if (duration >= SKIPPED_THRESHOLD_MS) {
        const key = getUserCallSite();
        // 从 StepWise 实例获取当前任务日志目录
        const logDir = this.getCurrentTaskLogDir?.();
        PerformanceTracker.getInstance().record(key, type, duration, retryWaitMs, logDir);
        PerformanceTracker.getInstance().saveReport(getPerformanceReportPath());
      }

      return result;
    };
  };
}