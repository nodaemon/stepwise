/**
 * 性能统计装饰器
 * 使用 TC39 装饰器实现 AOP，性能统计逻辑与业务代码分离
 */

import { getCallSite } from './callSite';
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

      // 从结果中提取 duration
      const duration = extractDuration(result);

      // 跳过的任务不记录（执行时间不足 3 秒）
      if (duration >= SKIPPED_THRESHOLD_MS) {
        const key = getCallSite(2);
        PerformanceTracker.getInstance().record(key, type, duration);
        PerformanceTracker.getInstance().saveReport(getPerformanceReportPath());
      }

      return result;
    };
  };
}