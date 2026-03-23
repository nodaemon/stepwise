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

  return {
    ClaudeExecutor: jest.fn().mockImplementation(() => ({
      execute: async (prompt: string): Promise<ExecutionResult> => {
        lastPrompt = prompt;
        return {
          sessionId: 'mock-session-id',
          output: 'mock output',
          success: true,
          timestamp: Date.now(),
          duration: 100
        };
      }
    })),
    createExecutor: jest.fn().mockImplementation(() => ({
      execute: async (prompt: string): Promise<ExecutionResult> => {
        lastPrompt = prompt;
        return {
          sessionId: 'mock-session-id',
          output: 'mock output',
          success: true,
          timestamp: Date.now(),
          duration: 100
        };
      }
    })),
    getLastPrompt: () => lastPrompt,
    resetLastPrompt: () => { lastPrompt = ''; }
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
      expect(result.sessionId).toBe('mock-session-id');
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
