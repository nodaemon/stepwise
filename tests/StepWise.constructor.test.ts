/**
 * StepWise 构造函数测试
 */
import * as fs from 'fs';
import * as path from 'path';
import { StepWise, setTaskName, _resetState } from '../src';

describe('StepWise Constructor', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    _resetState();

    // 创建临时目录
    tempDir = path.join(__dirname, '.temp_constructor_test');
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

  describe('TaskName 未设置错误', () => {
    it('未设置 TaskName 时应该报错并退出', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

      // 不设置 TaskName 直接创建 StepWise
      expect(() => new StepWise('TestAgent')).toThrow('exit');

      expect(mockError).toHaveBeenCalledWith('[错误] TaskName 未设置');

      mockExit.mockRestore();
      mockError.mockRestore();
    });
  });

  describe('名字重复错误', () => {
    it('StepWise 名字重复时应该报错并退出', () => {
      setTaskName('TestTask');
      new StepWise('DuplicateAgent');

      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => new StepWise('DuplicateAgent')).toThrow('exit');

      expect(mockError).toHaveBeenCalledWith('[错误] StepWise 名字重复: "DuplicateAgent"');

      mockExit.mockRestore();
      mockError.mockRestore();
    });

    it('TaskName 和 StepWise 名字相同时应该报错', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });

      // setTaskName 内部会注册名字
      setTaskName('SameName');
      // 再次用相同名字创建 StepWise 应该报错
      expect(() => new StepWise('SameName')).toThrow('exit');

      mockExit.mockRestore();
    });
  });

  describe('启动打印', () => {
    it('第一个 StepWise 创建时应该打印启动信息', () => {
      const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});

      setTaskName('TestTask');
      new StepWise('Agent1');

      const calls = mockLog.mock.calls.map(call => call[0]);
      const output = calls.join('\n');
      expect(output).toContain('StepWise 任务启动');
      expect(output).toContain('任务名称: TestTask');
      expect(output).toContain('恢复命令: setResumePath');

      mockLog.mockRestore();
    });

    it('第二个 StepWise 创建时不应再次打印启动信息', () => {
      const mockLog = jest.spyOn(console, 'log').mockImplementation(() => {});

      setTaskName('TestTask');
      new StepWise('Agent1');
      mockLog.mockClear();
      new StepWise('Agent2');

      // 第二个 Agent 创建时不应再打印启动信息
      const calls = mockLog.mock.calls.map(call => call[0]);
      const secondOutput = calls.join('\n');
      expect(secondOutput).not.toContain('StepWise 任务启动');

      mockLog.mockRestore();
    });
  });

  describe('目录结构', () => {
    it('应该创建正确的目录结构', () => {
      setTaskName('TestTask');
      const agent = new StepWise('Agent1');

      const agentDir = agent.getAgentDir();
      const taskDir = agent.getTaskDir();

      // 检查目录存在
      expect(fs.existsSync(agentDir)).toBe(true);
      expect(fs.existsSync(taskDir)).toBe(true);

      // 检查目录名称格式
      expect(path.basename(agentDir)).toMatch(/^Agent1_\d{8}_\d{6}_\d{3}$/);
      expect(path.basename(taskDir)).toMatch(/^TestTask_\d{8}_\d{6}_\d{3}$/);

      // 检查 TaskName 目录下有 report 目录
      const reportDir = path.join(taskDir, 'report');
      expect(fs.existsSync(reportDir)).toBe(true);

      // 检查 Agent 目录下有 data, logs, collect 目录
      expect(fs.existsSync(path.join(agentDir, 'data'))).toBe(true);
      expect(fs.existsSync(path.join(agentDir, 'logs'))).toBe(true);
      expect(fs.existsSync(path.join(agentDir, 'collect'))).toBe(true);
    });

    it('多个 Agent 应该共享同一个 TaskName 目录', () => {
      setTaskName('TestTask');
      const agent1 = new StepWise('Agent1');
      const agent2 = new StepWise('Agent2');

      expect(agent1.getTaskDir()).toBe(agent2.getTaskDir());
    });
  });
});
