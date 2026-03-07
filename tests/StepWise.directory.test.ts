/**
 * StepWise 目录结构测试
 */
import * as fs from 'fs';
import * as path from 'path';
import { StepWise, setTaskName, _resetState } from '../src';

describe('StepWise Directory Structure', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    _resetState();

    // 创建临时目录
    tempDir = path.join(__dirname, '.temp_directory_test');
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

  describe('TaskName 目录结构', () => {
    it('TaskName 目录应该在 stepwise_exec_infos 下', () => {
      setTaskName('MyTask');
      const agent = new StepWise('Agent1');

      const taskDir = agent.getTaskDir();
      const parentDir = path.dirname(taskDir);

      expect(path.basename(parentDir)).toBe('stepwise_exec_infos');
    });

    it('TaskName 目录名应该包含时间戳', () => {
      setTaskName('MyTask');
      const agent = new StepWise('Agent1');

      const taskDir = agent.getTaskDir();
      const dirName = path.basename(taskDir);

      // 格式: MyTask_YYYYMMDD_HHmmss_毫秒
      expect(dirName).toMatch(/^MyTask_\d{8}_\d{6}_\d{3}$/);
    });
  });

  describe('Agent 目录结构', () => {
    it('Agent 目录应该在 TaskName 目录下', () => {
      setTaskName('MyTask');
      const agent = new StepWise('Agent1');

      const agentDir = agent.getAgentDir();
      const taskDir = agent.getTaskDir();

      expect(path.dirname(agentDir)).toBe(taskDir);
    });

    it('Agent 目录名应该包含时间戳', () => {
      setTaskName('MyTask');
      const agent = new StepWise('Agent1');

      const agentDir = agent.getAgentDir();
      const dirName = path.basename(agentDir);

      // 格式: Agent1_YYYYMMDD_HHmmss_毫秒
      expect(dirName).toMatch(/^Agent1_\d{8}_\d{6}_\d{3}$/);
    });

    it('多个 Agent 应该有各自的目录', () => {
      setTaskName('MyTask');
      const agent1 = new StepWise('Agent1');
      const agent2 = new StepWise('Agent2');

      expect(agent1.getAgentDir()).not.toBe(agent2.getAgentDir());
    });
  });

  describe('report 输出路径', () => {
    it('report 目录应该在 TaskName 目录下', () => {
      setTaskName('MyTask');
      const agent = new StepWise('Agent1');

      const taskDir = agent.getTaskDir();
      const reportDir = path.join(taskDir, 'report');

      expect(fs.existsSync(reportDir)).toBe(true);
    });
  });
});
