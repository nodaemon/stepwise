/**
 * 性能追踪器
 * 单例模式，所有 Worker 共享
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  PerformanceType,
  PerformanceTypeStats,
  PerformanceStats,
  PerformanceReport
} from '../types';
import { ensureDir } from './fileHelper';

/**
 * 性能追踪器单例类
 */
export class PerformanceTracker {
  private static instance: PerformanceTracker;

  /** 性能统计数据，key 为 "文件名:行号" */
  private statsMap: Map<string, PerformanceStats> = new Map();

  /** 任务名称 */
  private taskName: string = '';

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): PerformanceTracker {
    if (!this.instance) {
      this.instance = new PerformanceTracker();
    }
    return this.instance;
  }

  /**
   * 初始化追踪器
   * @param taskName 任务名称
   */
  init(taskName: string): void {
    this.taskName = taskName;
    this.statsMap.clear();
  }

  /**
   * 记录性能数据
   * @param key 统计 key，格式为 "文件名:行号"
   * @param type 性能类型
   * @param duration 耗时（毫秒）
   */
  record(key: string, type: PerformanceType, duration: number): void {
    let stats = this.statsMap.get(key);

    if (!stats) {
      // 初始化所有类型的统计
      const emptyStats: PerformanceTypeStats = {
        count: 0,
        totalDuration: 0,
        maxDuration: 0,
        minDuration: Infinity
      };

      stats = {
        key,
        types: {
          prompt: { ...emptyStats },
          shell: { ...emptyStats },
          summarize: { ...emptyStats },
          postCheck: { ...emptyStats }
        }
      };

      this.statsMap.set(key, stats);
    }

    // 更新对应类型的统计
    const typeStats = stats.types[type];
    typeStats.count++;
    typeStats.totalDuration += duration;
    typeStats.maxDuration = Math.max(typeStats.maxDuration, duration);
    typeStats.minDuration = Math.min(typeStats.minDuration, duration);
  }

  /**
   * 生成性能报告
   */
  generateReport(): PerformanceReport {
    const stats = Array.from(this.statsMap.values());

    // 计算汇总信息
    let totalCount = 0;
    let totalDuration = 0;

    for (const stat of stats) {
      for (const type of Object.values(stat.types)) {
        totalCount += type.count;
        totalDuration += type.totalDuration;
      }
    }

    return {
      taskName: this.taskName,
      generatedAt: new Date().toISOString(),
      summary: {
        totalCount,
        totalDuration,
        uniqueKeys: stats.length
      },
      stats
    };
  }

  /**
   * 保存性能报告
   * @param outputPath JSON 文件输出路径
   */
  saveReport(outputPath: string): void {
    const report = this.generateReport();

    // 确保目录存在
    const dir = path.dirname(outputPath);
    ensureDir(dir);

    // 保存 JSON 文件
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');

    // 生成并保存文本格式报告
    const txtPath = outputPath.replace('.json', '.txt');
    const txtContent = this.generateTextReport(report);
    fs.writeFileSync(txtPath, txtContent, 'utf-8');
  }

  /**
   * 生成文本格式报告
   */
  private generateTextReport(report: PerformanceReport): string {
    const lines: string[] = [];

    lines.push('================================================================================');
    lines.push('StepWise 性能统计报告');
    lines.push(`任务名称: ${report.taskName}`);
    lines.push(`生成时间: ${report.generatedAt}`);
    lines.push('================================================================================');
    lines.push('');

    for (const stat of report.stats) {
      lines.push(stat.key);

      const typeEntries = Object.entries(stat.types)
        .filter(([, typeStats]) => typeStats.count > 0);

      typeEntries.forEach(([type, typeStats], index) => {
        const isLast = index === typeEntries.length - 1;
        const prefix = isLast ? '└─' : '├─';

        const avgDuration = typeStats.count > 0
          ? Math.round(typeStats.totalDuration / typeStats.count)
          : 0;

        lines.push(`  ${prefix} ${type.padEnd(10)}: ${typeStats.count} 次, 总计 ${this.formatDuration(typeStats.totalDuration)} (平均 ${this.formatDuration(avgDuration)}, 最大 ${this.formatDuration(typeStats.maxDuration)}, 最小 ${this.formatDuration(typeStats.minDuration)})`);
      });

      lines.push('--------------------------------------------------------------------------------');
    }

    lines.push('');
    lines.push('================================================================================');
    lines.push(`汇总: ${report.summary.totalCount} 次执行, 总耗时 ${this.formatDuration(report.summary.totalDuration)}, ${report.summary.uniqueKeys} 个调用位置`);
    lines.push('================================================================================');

    return lines.join('\n');
  }

  /**
   * 格式化持续时间
   * @param ms 毫秒
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      const seconds = Math.round(ms / 1000);
      return `${seconds}s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.round((ms % 60000) / 1000);
      return `${minutes}m${seconds}s`;
    }
  }

  /**
   * 加载已有的性能报告（用于恢复模式）
   * @param inputPath JSON 文件路径
   */
  loadReport(inputPath: string): void {
    if (!fs.existsSync(inputPath)) {
      return;
    }

    try {
      const content = fs.readFileSync(inputPath, 'utf-8');
      const report: PerformanceReport = JSON.parse(content);

      // 恢复 taskName
      if (report.taskName) {
        this.taskName = report.taskName;
      }

      // 合并统计数据
      for (const stat of report.stats) {
        this.statsMap.set(stat.key, stat);
      }
    } catch (error) {
      // 解析失败时忽略，继续使用空的 statsMap
      console.warn(`[PerformanceTracker] 加载性能报告失败: ${inputPath}`);
    }
  }

  /**
   * 清空统计数据
   */
  clear(): void {
    this.statsMap.clear();
  }
}