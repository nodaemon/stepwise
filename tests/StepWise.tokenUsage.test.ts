/**
 * StepWise usage.json 按步导出测试
 */
import * as fs from 'fs';
import * as path from 'path';
import { StepWise, initTask, _resetState } from '../src/index';

// Mock executor：返回含 tokenUsage 的成功结果
jest.mock('../src/utils/executor', () => {
  const makeMockExecute = () => async (): Promise<any> => ({
    sessionId: 'mock-session-id',
    output: 'mock output',
    success: true,
    timestamp: Date.now(),
    duration: 100,
    tokenUsage: {
      inputTokens: 15230,
      outputTokens: 1204,
      cacheCreationTokens: 8002,
      cacheReadTokens: 45210,
      costUsd: 0.0834,
      durationMs: 44800,
      durationApiMs: 41200
    }
  });

  return {
    ClaudeExecutor: jest.fn().mockImplementation(() => ({ execute: makeMockExecute() })),
    CodeAgentExecutor: jest.fn().mockImplementation(() => ({ execute: makeMockExecute() })),
    createExecutor: jest.fn().mockImplementation(() => ({ execute: makeMockExecute() }))
  };
});

describe('StepWise usage.json 导出', () => {
  let tempDir: string;
  let originalCwd: string;
  // 取得 mock 后的 executor 模块（供用例内替换 createExecutor 实现）
  const executorModule: any = require('../src/utils/executor');

  beforeEach(() => {
    _resetState();

    // 恢复默认 mock：返回含 tokenUsage 的成功结果（保证用例顺序无关）
    executorModule.createExecutor.mockImplementation(() => ({
      execute: async (): Promise<any> => ({
        sessionId: 'mock-session-id',
        output: 'mock output',
        success: true,
        timestamp: Date.now(),
        duration: 100,
        tokenUsage: {
          inputTokens: 15230,
          outputTokens: 1204,
          cacheCreationTokens: 8002,
          cacheReadTokens: 45210,
          costUsd: 0.0834,
          durationMs: 44800,
          durationApiMs: 41200
        }
      })
    }));

    // 创建临时目录作为 cwd，避免测试产物污染仓库
    tempDir = path.join(__dirname, '.temp_token_usage_test');
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

  it('execPrompt 后应写 usage.json 到 logs/1_task/，结构完整', async () => {
    initTask('TokenUsageTest');
    const agent = new StepWise('UsageAgent');
    await agent.execPrompt('test task');

    const taskDir = (agent as any).agentDir as string;
    const usagePath = path.join(taskDir, 'logs', '1_task', 'usage.json');
    expect(fs.existsSync(usagePath)).toBe(true);

    const usage = JSON.parse(fs.readFileSync(usagePath, 'utf-8'));
    expect(usage.taskIndex).toBe(1);
    expect(usage.sessionId).toBe('mock-session-id');
    expect(usage.duration).toBe(100);
    expect(usage.tokenUsage).toEqual({
      inputTokens: 15230,
      outputTokens: 1204,
      cacheCreationTokens: 8002,
      cacheReadTokens: 45210,
      costUsd: 0.0834,
      durationMs: 44800,
      durationApiMs: 41200
    });
  });

  it('executor 无 tokenUsage 时不写 usage.json', async () => {
    // 先替换 mock（去掉 tokenUsage），再构造 StepWise：
    // executor 在 StepWise 构造函数中创建，构造后再替换 mock 对已创建实例无效
    executorModule.createExecutor.mockImplementation(() => ({
      execute: async (): Promise<any> => ({
        sessionId: 'mock-session-id',
        output: 'mock output',
        success: true,
        timestamp: Date.now(),
        duration: 100
      })
    }));

    initTask('TokenUsageTest');
    const agent = new StepWise('NoUsageAgent');

    await agent.execPrompt('test task');

    const taskDir = (agent as any).agentDir as string;
    const usagePath = path.join(taskDir, 'logs', '1_task', 'usage.json');
    expect(fs.existsSync(usagePath)).toBe(false);
  });
});
