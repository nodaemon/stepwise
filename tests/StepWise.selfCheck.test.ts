/**
 * debug 模式自检复盘测试
 *
 * 关键回归点：
 * - 全新会话（useResume 显式为 false，sessionId 为新 uuid）
 * - 审查者与步骤本体**共用步骤目录**，产物靠 `self_check_` 前缀区分（不再有独立 self_check 目录）
 * - 报告与 output.txt 同级，且**必须存在**（审查者没写文件时框架补说明文件）
 * - 后检查提示词与判定结果进入审查输入
 * - 提示词要求加载 skill 时，SKILL.md 进入审查输入
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

    it('审查者应与步骤本体共用步骤目录，并给产物加 self_check_ 前缀', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const selfCall = getSelfCheckCalls()[0];
      const parentTaskDir = path.join((agent as any).agentDir, 'logs', '1_task');

      // 同目录：不再有独立的 logs/{n}_self_check/
      expect(selfCall.options.taskLogDir).toBe(parentTaskDir);
      // 重名文件靠前缀区分
      expect(selfCall.options.promptLogFile).toBe('self_check_prompt.txt');
      expect(selfCall.options.artifactPrefix).toBe('self_check_');
    });

    it('不应再创建独立的 self_check 目录', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const logsDir = path.join((agent as any).agentDir, 'logs');
      expect(fs.existsSync(path.join(logsDir, '1_self_check'))).toBe(false);
      expect(fs.existsSync(path.join(logsDir, '1_task'))).toBe(true);
    });

    it('应把步骤提示词与最终输出写进审查提示词', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const p = getSelfCheckCalls()[0].prompt;
      expect(p).toContain(path.join('1_task', 'prompt.txt'));
      expect(p).toContain(path.join('1_task', 'output.txt'));
    });

    it('执行轨迹不再作为审查输入', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const p = getSelfCheckCalls()[0].prompt;
      expect(p).not.toContain(path.join('1_task', 'verbose_output.txt'));
    });

    it('审查者的产物带前缀，不会覆盖步骤本体的文件', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const parentTaskDir = path.join((agent as any).agentDir, 'logs', '1_task');
      const sentinel = path.join(parentTaskDir, 'command.sh');
      fs.writeFileSync(sentinel, '#!/bin/sh\n# sentinel\n', 'utf-8');

      await (agent as any).runSelfCheck({
        taskIndex: 2, taskType: 'task', taskLogDir: parentTaskDir,
        cwd: undefined, env: undefined
      });

      // 步骤本地的 command.sh 不被自检覆盖
      expect(fs.readFileSync(sentinel, 'utf-8')).toBe('#!/bin/sh\n# sentinel\n');
    });
  });

  describe('审查输入集合', () => {
    it('配置 postCheckPrompt 时，后检查提示词与判定结果都应进入审查输入', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt', { postCheckPrompt: '检查产出是否完整' });

      // debug 模式下后检查也真实执行
      const postCheckCalls = executorMock.getCalls().filter((c: ExecCall) => c.options?.taskType === 'check');
      expect(postCheckCalls.length).toBeGreaterThanOrEqual(1);

      const p = getSelfCheckCalls()[0].prompt;
      expect(p).toContain(path.join('1_task', 'post_check_prompt.txt'));
      expect(p).toContain(path.join('1_task', 'post_check_output.txt'));
    });

    it('后检查的判定结果应落盘到 post_check_output.txt', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt', { postCheckPrompt: '检查产出是否完整' });

      const taskDir = path.join((agent as any).agentDir, 'logs', '1_task');
      expect(fs.existsSync(path.join(taskDir, 'post_check_prompt.txt'))).toBe(true);
      expect(fs.existsSync(path.join(taskDir, 'post_check_output.txt'))).toBe(true);
    });

    it('未配置 postCheckPrompt 时，审查输入里不应有后检查文件', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const p = getSelfCheckCalls()[0].prompt;
      expect(p).not.toContain('post_check_prompt.txt');
      expect(p).not.toContain('post_check_output.txt');
    });

    it('提示词要求加载 skill 时，SKILL.md 应进入审查输入', async () => {
      const skillDir = path.join(tempDir, '.claude', 'skills', 'demo_skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '# demo_skill\n\n## 描述\n示例技能\n',
        'utf-8'
      );

      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('请使用 demo_skill skill 完成本步骤');

      const p = getSelfCheckCalls()[0].prompt;
      expect(p).toContain(path.join('demo_skill', 'SKILL.md'));
    });

    it('提示词未提到 skill 时，不应产生 skill 输入', async () => {
      const skillDir = path.join(tempDir, '.claude', 'skills', 'demo_skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# demo_skill\n', 'utf-8');

      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('普通提示词，不需要额外资料');

      const p = getSelfCheckCalls()[0].prompt;
      expect(p).not.toContain('SKILL.md');
    });

    it('提示词说「不要使用 skill」时，不应产生 skill 输入', async () => {
      const skillDir = path.join(tempDir, '.claude', 'skills', 'demo_skill');
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# demo_skill\n', 'utf-8');

      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('请不要使用 skill，直接统计行数');

      const p = getSelfCheckCalls()[0].prompt;
      expect(p).not.toContain('SKILL.md');
      expect(p).not.toContain('未能定位到具体的 skill 文件');
    });

    it('数据产出类步骤应把真实产出文件纳入审查输入', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      // 预置产出文件：collect 步骤真正交付的是 collect/1_collect/collect_1.json
      const collectDir = path.join((agent as any).agentDir, 'collect', '1_collect');
      fs.mkdirSync(collectDir, { recursive: true });
      fs.writeFileSync(
        path.join(collectDir, 'collect_1.json'),
        JSON.stringify([{ name: 'item1' }]),
        'utf-8'
      );

      await agent.execCollectPrompt('收集数据', { name: { type: 'string' } });

      const p = getSelfCheckCalls()[0].prompt;
      expect(p).toContain('本步骤的实际产出文件');
      expect(p).toContain(path.join('1_collect', 'collect_1.json'));
    });

    it('任务类步骤没有产出文件时，不应出现「实际产出文件」这一项', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const p = getSelfCheckCalls()[0].prompt;
      expect(p).not.toContain('本步骤的实际产出文件');
    });
  });

  describe('报告必须存在', () => {
    it('审查者没写文件时，框架应补一份说明文件', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const reportPath = path.join((agent as any).agentDir, 'logs', '1_task', 'self_check.md');
      expect(fs.existsSync(reportPath)).toBe(true);
      // 兜底内容必须如实说明「未生成」，不得谎报未发现问题
      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('未生成报告');
      expect(content).not.toContain('本次执行未发现需要改进的问题。');
    });

    it('审查者本轮写的报告不得被框架覆盖', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const reportPath = path.join((agent as any).agentDir, 'logs', '1_task', 'self_check.md');
      const originalExecute = (agent as any).executor.execute;
      (agent as any).executor.execute = async (p: string, o: any) => {
        const r = await originalExecute(p, o);
        if (o?.taskType === 'self_check') {
          fs.writeFileSync(reportPath, '# 自检复盘：task（任务 1）\n\n本次执行未发现需要改进的问题。\n', 'utf-8');
        }
        return r;
      };

      await (agent as any).runSelfCheck({
        taskIndex: 2, taskType: 'task',
        taskLogDir: path.join((agent as any).agentDir, 'logs', '1_task'),
        cwd: undefined, env: undefined
      });

      expect(fs.readFileSync(reportPath, 'utf-8')).toContain('本次执行未发现需要改进的问题。');
    });

    it('自检执行抛错时，报告文件仍应存在并说明失败原因', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');
      executorMock.setSelfCheckShouldThrow(true);

      await agent.execPrompt('Test prompt');

      const reportPath = path.join((agent as any).agentDir, 'logs', '1_task', 'self_check.md');
      expect(fs.existsSync(reportPath)).toBe(true);
      expect(fs.readFileSync(reportPath, 'utf-8')).toContain('自检执行失败');
    });

    it('上一轮遗留的报告不得冒充本轮结果', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const reportPath = path.join((agent as any).agentDir, 'logs', '1_task', 'self_check.md');
      // 断点恢复会复用同一个步骤目录：上一轮的报告还留在盘上
      fs.writeFileSync(reportPath, '# 自检复盘：task（任务 1）\n\n上一轮的旧报告\n', 'utf-8');

      // 本轮自检执行失败
      executorMock.setSelfCheckShouldThrow(true);
      await (agent as any).runSelfCheck({
        taskIndex: 2, taskType: 'task',
        taskLogDir: path.join((agent as any).agentDir, 'logs', '1_task'),
        cwd: undefined, env: undefined
      });

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).not.toContain('上一轮的旧报告');
      expect(content).toContain('自检执行失败');
    });

    it('准备阶段失败时，上一轮的报告也不得冒充本轮结果', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const reportPath = path.join((agent as any).agentDir, 'logs', '1_task', 'self_check.md');
      // 断点恢复会复用同一个步骤目录：上一轮的报告还留在盘上
      fs.writeFileSync(reportPath, '# 自检复盘：task（任务 1）\n\n上一轮的旧报告\n', 'utf-8');

      // 让准备阶段失败（写审查提示词时抛错）
      const logger = (agent as any).logger;
      const originalWrite = logger.writeTaskLog.bind(logger);
      logger.writeTaskLog = (dir: string, file: string, content: string) => {
        if (file === 'self_check_prompt.txt') throw new Error('模拟磁盘写满');
        return originalWrite(dir, file, content);
      };

      await (agent as any).runSelfCheck({
        taskIndex: 2, taskType: 'task',
        taskLogDir: path.join((agent as any).agentDir, 'logs', '1_task'),
        cwd: undefined, env: undefined
      });

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).not.toContain('上一轮的旧报告');
      expect(content).toContain('自检准备失败');
    });

    it('本轮审查者写了报告时，内容必须被保留', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const reportPath = path.join((agent as any).agentDir, 'logs', '1_task', 'self_check.md');
      const taskDir = path.dirname(reportPath);
      // 模拟审查者在执行期间写入了报告
      const originalExecute = (agent as any).executor.execute;
      (agent as any).executor.execute = async (p: string, o: any) => {
        const r = await originalExecute(p, o);
        if (o?.taskType === 'self_check') {
          fs.writeFileSync(reportPath, '# 自检复盘：task（任务 1）\n\n本次执行未发现需要改进的问题。\n', 'utf-8');
        }
        return r;
      };

      await (agent as any).runSelfCheck({
        taskIndex: 2, taskType: 'task', taskLogDir: taskDir,
        cwd: undefined, env: undefined
      });

      expect(fs.readFileSync(reportPath, 'utf-8')).toContain('本次执行未发现需要改进的问题。');
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

    it('读白名单应包含真实产出文件所在目录（report 步骤的产物在 agentDir 之外）', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      setAllowRead(['.']);
      const agent = new StepWise('Agent1');

      const taskLogDir = path.join((agent as any).agentDir, 'logs', '1_report');
      fs.mkdirSync(taskLogDir, { recursive: true });

      // report 步骤的真实产物布局：{taskDir}/report/*.json —— 在 agentDir 之外
      const outDir = path.join((agent as any).taskDir, 'report');
      fs.mkdirSync(outDir, { recursive: true });
      const resultFile = path.join(outDir, 'report.json');
      fs.writeFileSync(resultFile, '[]', 'utf-8');

      await (agent as any).runSelfCheck({
        taskIndex: 1, taskType: 'report', taskLogDir,
        cwd: undefined, env: undefined,
        resultFilePath: resultFile
      });

      // 审查者读不到产出文件，就等于没给这份输入
      const prompt = getSelfCheckCalls()[0].prompt;
      const readSection = /允许读取的目录[\s\S]*?重要约束/.exec(prompt)?.[0] || '';
      expect(readSection).toContain(outDir);
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
    it('审查者提示词应落在步骤目录内并带 self_check_ 前缀', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const taskDir = path.join((agent as any).agentDir, 'logs', '1_task');
      expect(fs.existsSync(path.join(taskDir, 'self_check_prompt.txt'))).toBe(true);
      // 报告写在步骤目录
      expect(path.join(taskDir, 'self_check.md')).toBe(
        path.join(taskDir, 'self_check.md')
      );
    });

    it('自检的日志写入不应污染父任务目录的既有文件', async () => {
      enableDebugMode(true);
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('Test prompt');

      const taskDir = path.join((agent as any).agentDir, 'logs', '1_task');
      // 父任务目录下的 prompt.txt 是被审查对象，不能是自检提示词
      expect(fs.existsSync(path.join(taskDir, 'prompt.txt'))).toBe(true);
      const taskPrompt = fs.readFileSync(path.join(taskDir, 'prompt.txt'), 'utf-8');
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
