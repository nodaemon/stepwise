import { MAX_PROBE_ATTEMPTS, PROBE_TIMEOUT_MS } from '../src/constants';
import { ClaudeExecutor } from '../src/executors/claude';
import { PiExecutor } from '../src/executors/pi';
import { OpenCodeExecutor } from '../src/executors/opencode';
import { AgentExecutorOptions } from '../src/executors/types';

// Mock child_process 模块，避免实际执行命令
jest.mock('child_process', () => {
  const mockSpawnSync = jest.fn();

  return {
    spawnSync: mockSpawnSync
  };
});

// 导入被 mock 的模块（必须在 jest.mock 之后）
import * as childProcess from 'child_process';

describe('429 探测恢复常量', () => {
  it('MAX_PROBE_ATTEMPTS 应为 10', () => {
    expect(MAX_PROBE_ATTEMPTS).toBe(10);
  });

  it('PROBE_TIMEOUT_MS 应为 30000（30 秒）', () => {
    expect(PROBE_TIMEOUT_MS).toBe(30000);
  });
});

describe('buildProbeArgs 各执行器', () => {
  it('ClaudeExecutor 应返回 --no-session-persistence -p "reply ok"', () => {
    const executor = new ClaudeExecutor();
    const args = (executor as any).buildProbeArgs();
    expect(args).toEqual(['--no-session-persistence', '-p', 'reply ok']);
  });

  it('PiExecutor 应返回 --no-session --mode json -p "reply ok"', () => {
    const executor = new PiExecutor();
    const args = (executor as any).buildProbeArgs();
    expect(args).toEqual(['--no-session', '--mode', 'json', '-p', 'reply ok']);
  });

  it('OpenCodeExecutor 调用 buildProbeArgs 应抛错', () => {
    const executor = new OpenCodeExecutor();
    expect(() => (executor as any).buildProbeArgs()).toThrow('429 探测不适用于 OpenCode');
  });
});

describe('probeRateLimit', () => {
  const { BaseExecutor } = require('../src/executors/base');

  class TestExecutor extends BaseExecutor {
    readonly agentType = 'claude' as const;
    protected getCommand(): string { return 'echo'; }
    protected buildArgs(): string[] { return []; }
    protected buildProbeArgs(): string[] { return ['--no-session-persistence', '-p', 'reply ok']; }
  }

  const options: AgentExecutorOptions = { cwd: process.cwd() };
  let mockSpawnSync: jest.Mock;

  beforeEach(() => {
    mockSpawnSync = childProcess.spawnSync as jest.Mock;
    mockSpawnSync.mockReset();
    // 默认行为：探测成功
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: '',
      stderr: '',
      pid: 12345,
      output: [null, '', ''],
      signal: null
    });
  });

  it('探测成功（非 429）应返回 true', async () => {
    const executor = new TestExecutor();
    const result = await (executor as any).probeRateLimit(options);
    expect(result).toBe(true);
  });

  it('探测也返回 429 应返回 false', async () => {
    const executor = new TestExecutor();
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: '429 rate_limit_error',
      pid: 12345,
      output: [null, '', '429 rate_limit_error'],
      signal: null
    });
    const result = await (executor as any).probeRateLimit(options);
    expect(result).toBe(false);
  });

  it('探测超时应返回 false', async () => {
    const executor = new TestExecutor();
    mockSpawnSync.mockReturnValue({
      status: null,
      stdout: '',
      stderr: '',
      pid: 12345,
      output: [null, '', ''],
      signal: 'SIGTERM'
    });
    const result = await (executor as any).probeRateLimit(options);
    expect(result).toBe(false);
  });

  it('探测命令执行异常应返回 false', async () => {
    const executor = new TestExecutor();
    mockSpawnSync.mockImplementation(() => {
      throw new Error('command not found');
    });
    const result = await (executor as any).probeRateLimit(options);
    expect(result).toBe(false);
  });

  it('探测成功应调用 spawnSync 且参数包含 buildProbeArgs 的结果', async () => {
    const executor = new TestExecutor();
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'ok',
      stderr: '',
      pid: 12345,
      output: [null, 'ok', ''],
      signal: null
    });
    await (executor as any).probeRateLimit(options);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'echo',
      ['--no-session-persistence', '-p', 'reply ok'],
      expect.objectContaining({
        cwd: process.cwd(),
        timeout: 30000
      })
    );
  });
});
