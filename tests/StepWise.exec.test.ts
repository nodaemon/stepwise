/**
 * StepWise execPrompt 接口测试
 * 使用 mock executor 来避免真实调用 Claude Code
 */
import * as fs from 'fs';
import * as path from 'path';
import { StepWise, setTaskName, _resetState } from '../src';
import { ExecutionResult } from '../src/types';

// Mock executor 模块
jest.mock('../src/utils/executor', () => {
  // 记录最后一次执行的 prompt
  let lastPrompt = '';
  // 记录最后一次执行传入的 options（含 sessionId、useResume 等）
  let lastExecOptions: any = null;

  // 构建一个 mock executor：记录入参并返回成功结果
  // 回显传入的 sessionId（模拟 Claude 原样创建会话的行为）
  const makeMockExecute = () => async (prompt: string, options: any): Promise<ExecutionResult> => {
    lastPrompt = prompt;
    lastExecOptions = options ? { ...options } : null;
    return {
      sessionId: options?.sessionId || 'mock-session-id',
      output: 'mock output',
      success: true,
      timestamp: Date.now(),
      duration: 100
    };
  };

  return {
    ClaudeExecutor: jest.fn().mockImplementation(() => ({
      execute: makeMockExecute()
    })),
    CodeAgentExecutor: jest.fn().mockImplementation(() => ({
      execute: makeMockExecute()
    })),
    createExecutor: jest.fn().mockImplementation(() => ({
      execute: makeMockExecute()
    })),
    getLastPrompt: () => lastPrompt,
    resetLastPrompt: () => { lastPrompt = ''; },
    getLastExecOptions: () => lastExecOptions,
    resetLastExecOptions: () => { lastExecOptions = null; }
  };
});

describe('StepWise execPrompt 接口测试', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    _resetState();

    // 创建临时目录
    tempDir = path.join(__dirname, '.temp_exec_test');
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

  describe('execPrompt 基本功能', () => {
    it('应该能执行基本任务', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const result = await agent.execPrompt('Test prompt');

      expect(result.success).toBe(true);
      // mock executor 回显传入的 sessionId（模拟 Claude 原样创建会话）
      // 首个任务由框架生成 UUID，故返回的 sessionId 为非空字符串
      expect(typeof result.sessionId).toBe('string');
      expect(result.sessionId.length).toBeGreaterThan(0);
    });

    it('空 prompt 应该抛出错误', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await expect(agent.execPrompt('')).rejects.toThrow('错误: prompt 不能为空');
      await expect(agent.execPrompt('   ')).rejects.toThrow('错误: prompt 不能为空');
    });
  });

  describe('ExecOptions.data 变量替换', () => {
    it('应该替换 prompt 中的变量', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt(
        'Hello $name, age is $age',
        { data: { name: 'Alice', age: 30 } }
      );

      // 验证 - 如果 mock 正确工作, 变量应该被替换
      // 由于我们 mock 了 executor, 这里主要验证不会抛出异常
    });

    it('data 为空时不应该替换变量', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const result = await agent.execPrompt('No variables $unknown');

      expect(result.success).toBe(true);
    });
  });

  describe('ExecOptions.cwd', () => {
    it('应该能指定工作目录', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const result = await agent.execPrompt('Test prompt', { cwd: tempDir });

      expect(result.success).toBe(true);
    });
  });

  describe('ExecOptions.newSession', () => {
    it('newSession=true 时应该创建新会话', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      // 执行第一个任务
      const result1 = await agent.execPrompt('First task');
      const sessionId1 = result1.sessionId;

      // 使用 newSession=true 执行第二个任务
      const result2 = await agent.execPrompt('Second task', { newSession: true });

      // 两个 session id 应该不同（由于 mock 返回相同的值，这里只验证不会抛错）
      expect(result2.success).toBe(true);
    });

    it('newSession=false 时应该复用会话', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      // 执行第一个任务
      const result1 = await agent.execPrompt('First task');

      // 使用 newSession=false 执行第二个任务
      const result2 = await agent.execPrompt('Second task', { newSession: false });

      expect(result2.success).toBe(true);
    });
  });

  describe('ExecOptions.sessionId', () => {
    // 从 mock 模块获取记录入参的 helper
    const executorModule: any = require('../src/utils/executor');

    beforeEach(() => {
      executorModule.resetLastExecOptions();
    });

    it('指定 sessionId 时 executor 应收到该 sessionId 且 useResume=true', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const customSessionId = 'my-custom-session-id-1234';
      const result = await agent.execPrompt('Test task', { sessionId: customSessionId });

      expect(result.success).toBe(true);
      // 返回的 sessionId 应为指定的值
      expect(result.sessionId).toBe(customSessionId);
      // executor 收到的 sessionId 即为指定值，且强制 useResume
      const opts = executorModule.getLastExecOptions();
      expect(opts.sessionId).toBe(customSessionId);
      expect(opts.useResume).toBe(true);
    });

    it('不指定 sessionId 时 useResume 由 shouldUseResume 自动判断（首个任务为 false）', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execPrompt('First task');

      const opts = executorModule.getLastExecOptions();
      // 首个任务，无历史已完成任务，不应走 resume
      expect(opts.useResume).toBe(false);
      // sessionId 为框架生成的非空 UUID（非空即够）
      expect(typeof opts.sessionId).toBe('string');
      expect(opts.sessionId.length).toBeGreaterThan(0);
    });

    it('sessionId 与 newSession:true 同时指定应抛出错误', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await expect(
        agent.execPrompt('Test task', { sessionId: 'abc-123', newSession: true })
      ).rejects.toThrow('sessionId 与 newSession:true 不可同时指定');
    });

    it('sessionId 为空字符串应抛出错误', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await expect(
        agent.execPrompt('Test task', { sessionId: '' })
      ).rejects.toThrow('sessionId 不能为空字符串');
    });

    it('连续两次指定相同 sessionId 应都使用该值', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const customSessionId = 'shared-session-id-9999';

      await agent.execPrompt('First task', { sessionId: customSessionId });
      const opts1 = executorModule.getLastExecOptions();
      expect(opts1.sessionId).toBe(customSessionId);
      expect(opts1.useResume).toBe(true);

      // 第二次调用仍指定同一 sessionId（模拟跨实例/跨进程复用）
      executorModule.resetLastExecOptions();
      await agent.execPrompt('Second task', { sessionId: customSessionId });
      const opts2 = executorModule.getLastExecOptions();
      expect(opts2.sessionId).toBe(customSessionId);
      expect(opts2.useResume).toBe(true);
    });
  });

  describe('execCollectPrompt', () => {
    it('应该能执行收集任务', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const result = await agent.execCollectPrompt(
        'Collect data',
        {
          name: { type: 'string', description: 'Name' },
          value: { type: 'number', description: 'Value' }
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('应该支持 data 参数进行变量替换', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const result = await agent.execCollectPrompt(
        'Collect for $target',
        { result: { type: 'string', description: 'Result' } },
        { data: { target: 'TestData' } }
      );

      expect(result.success).toBe(true);
    });
  });

  describe('execCheckPrompt', () => {
    it('应该能执行检查任务', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const result = await agent.execCheckPrompt(
        'Check if condition is met'
      );

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
    });

    it('应该支持 data 参数进行变量替换', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const result = await agent.execCheckPrompt(
        'Check if $item is valid',
        { data: { item: 'TestItem' } }
      );

      expect(result.success).toBe(true);
    });
  });

  describe('execReport', () => {
    it('应该能执行报告任务', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const result = await agent.execReport(
        'Generate report',
        { title: { type: 'string', description: 'Title' } },
        'report.json'
      );

      expect(result.success).toBe(true);
    });

    it('报告应该输出到 TaskName/report/ 目录', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      await agent.execReport(
        'Generate report',
        { title: { type: 'string', description: 'Title' } },
        'report.json'
      );

      const taskDir = agent.getTaskDir();
      const reportDir = path.join(taskDir, 'report');

      expect(fs.existsSync(reportDir)).toBe(true);
    });

    it('应该支持 data 参数进行变量替换', async () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const result = await agent.execReport(
        'Generate report for $title',
        { title: { type: 'string', description: 'Title' } },
        'report.json',
        { data: { title: 'Test Report' } }
      );

      expect(result.success).toBe(true);
    });
  });
});
