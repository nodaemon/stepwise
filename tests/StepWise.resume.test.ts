/**
 * StepWise 恢复功能测试
 */
import * as fs from 'fs';
import * as path from 'path';
import { StepWise, setTaskName, setResumePath, _resetState } from '../src';

/**
 * 创建模拟的历史任务目录结构
 */
function createMockHistoryStructure(baseDir: string, taskName: string, agentName: string): string {
  const timestamp = '20260307_120000_123';
  const taskDir = path.join(baseDir, 'stepwise_exec_infos', `${taskName}_${timestamp}`);
  const agentDir = path.join(taskDir, `${agentName}_20260307_120001_4566`);
  const dataDir = path.join(agentDir, 'data');

  // 创建目录结构
  fs.mkdirSync(dataDir, { recursive: true });

  // 创建进度文件
  const progressFile = path.join(dataDir, 'progress.json');
  const progress = {
    taskName: agentName,
    taskDir: agentDir,
    taskCounter: 2,
    tasks: [
      {
        taskIndex: 1,
        taskName: '1_task',
        sessionId: 'session-1',
        status: 'completed',
        timestamp: Date.now(),
        taskType: 'task'
      },
      {
        taskIndex: 2,
        taskName: '2_collect',
        sessionId: 'session-2',
        status: 'completed',
        timestamp: Date.now(),
        taskType: 'collect',
        outputFileName: 'collect_2.json'
      }
    ],
    lastUpdated: Date.now()
  };

  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));

  return taskDir;
}

describe('StepWise Resume', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    _resetState();

    // 创建临时目录
    tempDir = path.join(__dirname, '.temp_resume_test');
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

  describe('恢复成功', () => {
    it('应该能找到存在的 Agent 目录', () => {
      const taskDir = createMockHistoryStructure(tempDir, 'TestTask', 'Agent1');

      setTaskName('TestTask');
      setResumePath(path.basename(taskDir));

      const agent = new StepWise('Agent1');

      expect(agent.getAgentDir()).toContain('Agent1');
    });

    it('应该能加载历史进度', () => {
      const taskDir = createMockHistoryStructure(tempDir, 'TestTask', 'Agent1');

      setTaskName('TestTask');
      setResumePath(path.basename(taskDir));

      const agent = new StepWise('Agent1');

      // 任务计数器应该从历史记录中恢复
      expect(agent.getTaskCounter()).toBe(2);
    });
  });

  describe('恢复失败错误', () => {
    it('找不到 Agent 目录时应该报错退出', () => {
      const taskDir = createMockHistoryStructure(tempDir, 'TestTask', 'OtherAgent');

      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

      setTaskName('TestTask');
      setResumePath(path.basename(taskDir));

      // 尝试使用不存在的 Agent 名
      expect(() => new StepWise('NonExistentAgent')).toThrow('exit');

      const errorCalls = mockError.mock.calls.map(call => call[0]);
      const errorMessage = errorCalls.join('\n');
      expect(errorMessage).toContain('[错误] 无法恢复任务');
      expect(errorMessage).toContain('找不到Agent 目录');

      mockExit.mockRestore();
      mockError.mockRestore();
    });

    it('找不到任务目录时应该报错退出', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

      setTaskName('TestTask');
      setResumePath('NonExistentTask_20260307_120000_123');

      expect(() => new StepWise('Agent1')).toThrow('exit');

      const errorCalls = mockError.mock.calls.map(call => call[0]);
      const errorMessage = errorCalls.join('\n');
      expect(errorMessage).toContain('[错误] 无法恢复任务');

      mockExit.mockRestore();
      mockError.mockRestore();
    });
  });
});
