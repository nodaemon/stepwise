/**
 * PerformanceTracker 单元测试
 * 覆盖：retryWaitMs 累计、报告三项耗时格式（总计/实际/重试等待）、旧格式 performance.json 兼容加载
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PerformanceTracker } from '../src/utils/performanceTracker';

describe('PerformanceTracker', () => {
  let tracker: PerformanceTracker;
  let tempDir: string;

  beforeEach(() => {
    tracker = PerformanceTracker.getInstance();
    tracker.init('PerfTest');
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepwise-perf-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('record 累计重试等待', () => {
    it('同一 key 同一类型多次 record 应正确累加 totalDuration 与 totalRetryWaitMs', () => {
      tracker.record('a.ts:10', 'prompt', 10000, 2000);
      tracker.record('a.ts:10', 'prompt', 5000, 1000);

      const report = tracker.generateReport();
      expect(report.summary.totalCount).toBe(2);
      expect(report.summary.totalDuration).toBe(15000);
      expect(report.summary.totalRetryWaitMs).toBe(3000);

      const promptStats = report.stats[0].types.prompt;
      expect(promptStats.count).toBe(2);
      expect(promptStats.totalDuration).toBe(15000);
      expect(promptStats.totalRetryWaitMs).toBe(3000);
    });

    it('不同类型分开累计，互不干扰', () => {
      tracker.record('a.ts:10', 'prompt', 10000, 2000);
      tracker.record('a.ts:10', 'postCheck', 4000, 0);

      const report = tracker.generateReport();
      expect(report.stats[0].types.prompt.totalRetryWaitMs).toBe(2000);
      expect(report.stats[0].types.postCheck.totalRetryWaitMs).toBe(0);
      expect(report.summary.totalRetryWaitMs).toBe(2000);
    });

    it('最大/最小按实际耗时统计，最大耗时日志指向实际耗时最大的那次', () => {
      // 第一次执行：总 500s（等待 400s，实际 100s）
      tracker.record('a.ts:10', 'prompt', 500000, 400000, '/logs/1_task');
      // 第二次执行：总 150s（无等待，实际 150s）—— 实际耗时最大
      tracker.record('a.ts:10', 'prompt', 150000, 0, '/logs/2_task');

      const report = tracker.generateReport();
      const promptStats = report.stats[0].types.prompt;
      // 最大按实际耗时 150s（而非总耗时 500s 的那次）
      expect(promptStats.maxDuration).toBe(150000);
      expect(promptStats.maxDurationLogDir).toBe('/logs/2_task');
      // 最小为第一次的实际耗时 100s
      expect(promptStats.minDuration).toBe(100000);
    });
  });

  describe('文本报告格式', () => {
    it('有重试等待时，类型行与汇总行均显示 总耗时/任务耗时/重试等待耗时 三项', () => {
      tracker.record('a.ts:10', 'prompt', 15000, 3000);
      tracker.record('a.ts:10', 'prompt', 8000, 0);

      const outputPath = path.join(tempDir, 'performance.json');
      tracker.saveReport(outputPath);
      const txt = fs.readFileSync(outputPath.replace('.json', '.txt'), 'utf-8');

      // 总耗时 23s，任务耗时 20s（23s - 3s），重试等待耗时 3s
      // 平均值/最大值/最小值按任务耗时口径：两次任务耗时 12s、8s → 平均 10s、最大 12s、最小 8s
      expect(txt).toContain('  └─ prompt    : 2 次, 总耗时 23s (任务耗时 20s, 重试等待耗时 3s), 任务耗时平均值 10s, 任务耗时最大值 12s, 任务耗时最小值 8s');
      expect(txt).toContain('总耗时 23s (任务耗时 20s, 重试等待耗时 3s)');
    });

    it('无重试等待时三项仍显示（等待为 0ms），不出现 NaN', () => {
      tracker.record('b.ts:20', 'shell', 5000, 0);

      const outputPath = path.join(tempDir, 'performance.json');
      tracker.saveReport(outputPath);
      const txt = fs.readFileSync(outputPath.replace('.json', '.txt'), 'utf-8');

      // 整行匹配，防止格式回归（如括号不配对）
      expect(txt).toContain('  └─ shell     : 1 次, 总耗时 5s (任务耗时 5s, 重试等待耗时 0ms), 任务耗时平均值 5s, 任务耗时最大值 5s, 任务耗时最小值 5s');
      expect(txt).toContain('总耗时 5s (任务耗时 5s, 重试等待耗时 0ms)');
      expect(txt).not.toContain('NaN');
    });
  });

  describe('loadReport 旧格式兼容', () => {
    it('加载缺 totalRetryWaitMs 字段的旧 performance.json 应补 0，继续累计不产生 NaN', () => {
      // 旧格式：types 各统计无 totalRetryWaitMs 字段
      const oldReport = {
        taskName: 'OldTask',
        generatedAt: '2026/1/1 00:00:00',
        summary: { totalCount: 1, totalDuration: 10000, uniqueKeys: 1 },
        stats: [{
          key: 'old.ts:1',
          types: {
            prompt: { count: 1, totalDuration: 10000, maxDuration: 10000, minDuration: 10000 }
          }
        }]
      };
      const oldPath = path.join(tempDir, 'old_performance.json');
      fs.writeFileSync(oldPath, JSON.stringify(oldReport), 'utf-8');

      tracker.loadReport(oldPath);

      // 加载旧数据后继续累计新数据
      tracker.record('old.ts:1', 'prompt', 4000, 1000);

      const report = tracker.generateReport();
      // 旧数据等待补 0 + 新数据 1000
      expect(report.summary.totalRetryWaitMs).toBe(1000);
      expect(report.stats[0].types.prompt.totalRetryWaitMs).toBe(1000);
      expect(report.stats[0].types.prompt.totalDuration).toBe(14000);

      // 文本报告不出现 NaN，且等待按补 0 + 新增值计算
      const outputPath = path.join(tempDir, 'performance.json');
      tracker.saveReport(outputPath);
      const txt = fs.readFileSync(outputPath.replace('.json', '.txt'), 'utf-8');
      expect(txt).not.toContain('NaN');
      expect(txt).toContain('总耗时 14s (任务耗时 13s, 重试等待耗时 1s)');
    });
  });
});
