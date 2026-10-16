/**
 * debug 模式自检复盘测试
 *
 * 关键回归点：
 * - 全新会话（useResume 显式为 false，sessionId 为新 uuid）
 * - 审查者日志目录独立于父任务目录（防止自指污染 + 覆盖 command.sh）
 * - 报告与 output.txt 同级
 * - 不改动 progress.json / currentSessionId
 * - 失败不影响主流程
 */
import * as fs from 'fs';
import * as path from 'path';
import { StepWise, setTaskName, enableDebugMode, setAllowRead, _resetState } from '../src';
import { ExecutionResult } from '../src/types';

interface ExecCall {
  prompt: string;
  options: any;
}

// Mock executor 模块：记录全部调用，便于区分主任务调用与自检调用
jest.mock('../src/utils/executor', () => {
  let calls: ExecCall[] = [];
  // 控制下一次（自检）调用是否抛错
  let selfCheckShouldThrow = false;

  const execute = async (prompt: string, options: any): Promise<ExecutionResult> => {
    calls.push({ prompt, options: options ? { ...options } : null });
    if (options?.taskType === 'self_check' && selfCheckShouldThrow) {
      throw new Error('模拟自检执行失败');
    }
    return {
      sessionId: options?.sessionId || 'mock-session-id',
      output: 'mock output',
      success: true,
      timestamp: Date.now(),
      duration: 100
    };
  };

  return {
    ClaudeExecutor: jest.fn().mockImplementation(() => ({ execute })),
    CodeAgentExecutor: jest.fn().mockImplementation(() => ({ execute })),
    createExecutor: jest.fn().mockImplementation(() => ({ execute })),
    getCalls: () => calls,
    resetCalls: () => { calls = []; },
    setSelfCheckShouldThrow: (v: boolean) => { selfCheckShouldThrow = v; }
  };
});

const executorMock = require('../src/utils/executor');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('debug 模式自检复盘', () => {
  let tempDir: string;
  let originalCwd: string;

  const getSelfCheckCalls = () =>
    executorMock.getCalls().filter((c: ExecCall) => c.options?.taskType === 'self_check');

  beforeEach(() => {
    _resetState();
    executorMock.resetCalls();
    executorMock.setSelfCheckShouldThrow(false);

    tempDir = path.join(__dirname, '.temp_selfcheck_test');
    originalCwd = process.cwd();
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    _resetState();
  });

  describe('触发条件', () => {
    it('debug 关闭时不应触发自检', async () => {
      enableDebugMode(false);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      expect(getSelfCheckCalls()).toHaveLength(0);
    });

    it('debug 开启且任务成功时应触发一次自检', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      expect(getSelfCheckCalls()).toHaveLength(1);
    });

    it('任务失败时不应触发自检', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');
      // 强制主任务失败：构造非法 JSON 让校验失败不影响此断言——
      // 这里改为直接断言成功路径已覆盖，失败路径通过 executor 返回值控制
      (agent as any).executor.execute = async () => ({
        sessionId: 's1', output: '', success: false, error: 'boom', timestamp: Date.now(), duration: 1
      });

      await agent.execPrompt('Test prompt');

      expect(getSelfCheckCalls()).toHaveLength(0);
    });

    it('自检抛异常时主流程仍正常返回', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');
      executorMock.setSelfCheckShouldThrow(true);

      const result = await agent.execPrompt('Test prompt');

      expect(result.success).toBe(true);
      expect(getSelfCheckCalls()).toHaveLength(1);
    });
  });

  describe('全新会话', () => {
    it('应显式使用 useResume: false 创建全新会话', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      // 执行器 base.ts:353 用 `options.useResume === true` 判定，
      // 显式传 false 才会走 claude 的 --session-id 分支新建会话
      expect(getSelfCheckCalls()[0].options.useResume).toBe(false);
    });

    it('自检 sessionId 应为新的 uuid v4，且不等于主任务 sessionId', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const result = await agent.execPrompt('Test prompt');

      const selfCall = getSelfCheckCalls()[0];
      expect(selfCall.options.sessionId).toMatch(UUID_V4);
      expect(selfCall.options.sessionId).not.toBe(result.sessionId);
    });

    it('自检不得污染 currentSessionId', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');
      const afterFirst = (agent as any).currentSessionId;

      // 第二个任务应复用主会话，而不是接到自检会话上
      await agent.execPrompt('Second prompt');
      const afterSecond = (agent as any).currentSessionId;

      expect(afterFirst).not.toBe(getSelfCheckCalls()[0].options.sessionId);
      expect(afterSecond).not.toBe(getSelfCheckCalls()[1].options.sessionId);
    });
  });

  describe('产物路径', () => {
    it('报告路径应与 output.txt 同级，而不是子目录', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const selfCall = getSelfCheckCalls()[0];
      const prompt = selfCall.prompt;
      const reportPath = /将报告写入：(\S+)/.exec(prompt)![1];
      expect(reportPath.endsWith('self_check.md')).toBe(true);
      // 父任务日志目录：logs/1_task/
      expect(path.basename(path.dirname(reportPath))).toBe('1_task');
    });

    it('审查者日志目录应为 logs/{n}_self_check，且不同于父任务目录', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const selfCall = getSelfCheckCalls()[0];
      expect(path.basename(selfCall.options.taskLogDir)).toBe('1_self_check');
      expect(selfCall.options.taskLogDir).not.toBe('1_task');
    });

    it('应把父任务目录下的三个证据文件路径写进提示词', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const p = getSelfCheckCalls()[0].prompt;
      expect(p).toContain(path.join('1_task', 'prompt.txt'));
      expect(p).toContain(path.join('1_task', 'output.txt'));
      expect(p).toContain(path.join('1_task', 'verbose_output.txt'));
    });

    it('审查者日志目录必须与父任务目录不同（否则会覆盖父任务产物）', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const selfCall = getSelfCheckCalls()[0];
      const parentTaskDir = path.join((agent as any).agentDir, 'logs', '1_task');

      // 结构性保证：审查者绝不写入父任务目录
      expect(selfCall.options.taskLogDir).not.toBe(parentTaskDir);
      expect(selfCall.options.taskLogDir).toBe(path.join((agent as any).agentDir, 'logs', '1_self_check'));

      // 行为验证：父任务目录中的既有产物不被自检改动
      const sentinel = path.join(parentTaskDir, 'command.sh');
      fs.writeFileSync(sentinel, '#!/bin/sh\n# sentinel\n', 'utf-8');
      await (agent as any).runSelfCheck({
        taskIndex: 2, taskType: 'task', taskLogDir: parentTaskDir,
        cwd: undefined, env: undefined
      });
      expect(fs.readFileSync(sentinel, 'utf-8')).toBe('#!/bin/sh\n# sentinel\n');
    });
  });

  describe('任务序号与进度文件', () => {
    it('自检不得改变 progress.json 的任务列表（taskIndex 不漂移）', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');
      await agent.execPrompt('Second prompt');

      const progress = JSON.parse(fs.readFileSync(
        path.join((agent as any).agentDir, 'data', 'progress.json'), 'utf-8'
      ));
      // 只应有 2 条任务记录，自检不写 progress
      expect(progress.tasks).toHaveLength(2);
      expect(progress.tasks.map((t: any) => t.taskIndex)).toEqual([1, 2]);
      expect(progress.tasks.every((t: any) => t.taskType !== 'self_check')).toBe(true);
    });
  });

  describe('读取权限', () => {
    it('未配置 allowRead 时不注入文件访问提示词', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      expect(getSelfCheckCalls()[0].prompt).not.toContain('严格文件访问策略');
    });

    it('配置 allowRead 时，读白名单应包含 agentDir（否则审查者读不到证据）', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');
      setAllowRead(['.']);

      await agent.execPrompt('Test prompt');

      const prompt = getSelfCheckCalls()[0].prompt;
      expect(prompt).toContain('严格文件访问策略');
      // 只配置了 allowRead，提示词中没有写白名单小节，故截取到「重要约束」为止
      const readSection = /允许读取的目录[\s\S]*?重要约束/.exec(prompt)?.[0] || '';
      expect(readSection).toContain((agent as any).agentDir);
    });
  });

  describe('各 AI 步骤均触发自检', () => {
    it('execCollectPrompt 应触发自检', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execCollectPrompt('收集数据', { name: { type: 'string', description: 'Name' } });

      expect(getSelfCheckCalls().length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('性能统计', () => {
    it('runSelfCheck 必须返回 duration，否则装饰器永不记录（0 < 3000ms 阈值）', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      // 直接调用私有方法验证返回契约，与 @trackPerformance 的读取方式一致
      const ret = await (agent as any).runSelfCheck({
        taskIndex: 1,
        taskType: 'task',
        taskLogDir: path.join((agent as any).agentDir, 'logs', '1_task'),
        cwd: undefined,
        env: undefined
      });
      expect(typeof ret).toBe('object');
      expect(typeof ret.duration).toBe('number');
      expect(typeof ret.retryWaitMs).toBe('number');
    });

    it('debug 关闭时返回 0 耗时（低于阈值，不写入统计）', async () => {
      enableDebugMode(false);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const ret = await (agent as any).runSelfCheck({
        taskIndex: 1,
        taskType: 'task',
        taskLogDir: path.join((agent as any).agentDir, 'logs', '1_task'),
        cwd: undefined,
        env: undefined
      });
      expect(ret).toEqual({ duration: 0, retryWaitMs: 0 });
    });
  });

  describe('磁盘产物布局', () => {
    it('审查者日志目录应真实落盘，且与父任务目录平级', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const logsDir = path.join((agent as any).agentDir, 'logs');
      const taskDir = path.join(logsDir, '1_task');
      const reviewDir = path.join(logsDir, '1_self_check');

      expect(fs.existsSync(taskDir)).toBe(true);
      expect(fs.existsSync(reviewDir)).toBe(true);
      // 审查者自己的 prompt.txt 应落在独立目录
      expect(fs.existsSync(path.join(reviewDir, 'prompt.txt'))).toBe(true);
      // 报告写在父任务目录，但由 AI 产出，mock 不写文件，此处只验证路径可推导
      expect(path.join(taskDir, 'self_check.md')).not.toBe(path.join(reviewDir, 'self_check.md'));
    });

    it('自检的日志写入不应污染父任务目录的既有文件', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const taskDir = path.join((agent as any).agentDir, 'logs', '1_task');
      // 父任务目录不应出现审查者的执行信息
      expect(fs.existsSync(path.join(taskDir, 'prompt.txt'))).toBe(true);
      const taskPrompt = fs.readFileSync(path.join(taskDir, 'prompt.txt'), 'utf-8');
      // 父任务 prompt.txt 是被审查对象，不能是自检提示词
      expect(taskPrompt).not.toContain('你是一位独立的质量审查者');
    });
  });

  describe('性能类型向后兼容', () => {    it('旧 performance.json（缺 selfCheck）加载后 record 不应抛错', () => {
      const { PerformanceTracker } = require('../src/utils/performanceTracker');
      const tracker = PerformanceTracker.getInstance();
      tracker.clear();

      const legacy = {
        taskName: 'Legacy',
        generatedAt: '2026/01/01',
        summary: { totalCount: 1, totalDuration: 4000, totalRetryWaitMs: 0, uniqueKeys: 1 },
        stats: [{
          key: 'a.ts:1',
          // 旧格式：只有 4 种类型，且缺 totalRetryWaitMs
          types: {
            prompt: { count: 1, totalDuration: 4000, maxDuration: 4000, minDuration: 4000 },
            shell: { count: 0, totalDuration: 0, maxDuration: 0, minDuration: Infinity },
            summarize: { count: 0, totalDuration: 0, maxDuration: 0, minDuration: Infinity },
            postCheck: { count: 0, totalDuration: 0, maxDuration: 0, minDuration: Infinity }
          }
        }]
      };
      const legacyPath = path.join(tempDir, 'legacy_performance.json');
      fs.writeFileSync(legacyPath, JSON.stringify(legacy), 'utf-8');

      tracker.loadReport(legacyPath);
      // 关键回归点：旧数据缺 selfCheck 时自增会抛错
      expect(() => tracker.record('a.ts:1', 'selfCheck', 5000, 0)).not.toThrow();

      const report = tracker.generateReport();
      expect(report.stats[0].types.selfCheck.count).toBe(1);
      tracker.clear();
    });

    it('未使用的 selfCheck 类型不应出现在文本报告中', () => {
      const { PerformanceTracker } = require('../src/utils/performanceTracker');
      const tracker = PerformanceTracker.getInstance();
      tracker.clear();
      tracker.record('b.ts:2', 'prompt', 5000, 0);

      const txt = tracker['generateTextReport'](tracker.generateReport());
      expect(txt).not.toContain('selfCheck');
      expect(txt).toContain('prompt');
      tracker.clear();
    });
  });
});
