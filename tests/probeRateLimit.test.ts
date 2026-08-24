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
  it('ClaudeExecutor 应返回 --dangerously-skip-permissions --no-session-persistence -p "reply ok"', () => {
    const executor = new ClaudeExecutor();
    const args = (executor as any).buildProbeArgs();
    expect(args).toEqual(['--dangerously-skip-permissions', '--no-session-persistence', '-p', 'reply ok']);
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

describe('probeRateLimit spawnSync 集成', () => {
  let mockSpawnSync: jest.Mock;

  beforeEach(() => {
    mockSpawnSync = childProcess.spawnSync as jest.Mock;
    mockSpawnSync.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Pi 探测 429 应返回 false（模拟 Pi --mode json 退出码 0 但内容含 429）', async () => {
    const executor = new PiExecutor();
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: '429 budget exceeded' } }),
      stderr: '',
      pid: 12345,
      output: [null, '', ''],
      signal: null
    });
    const result = await (executor as any).probeRateLimit({ cwd: process.cwd() });
    expect(result).toBe(false);
  });

  it('Claude 探测成功应返回 true（模拟正常 "ok" 输出）', async () => {
    const executor = new ClaudeExecutor();
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'ok',
      stderr: '',
      pid: 12345,
      output: [null, 'ok', ''],
      signal: null
    });
    const result = await (executor as any).probeRateLimit({ cwd: process.cwd() });
    expect(result).toBe(true);
  });

  it('探测前 3 次 429，第 4 次成功应返回 true', async () => {
    const executor = new ClaudeExecutor();
    let callCount = 0;
    mockSpawnSync.mockImplementation(() => {
      callCount++;
      if (callCount <= 3) {
        return {
          status: 1,
          stdout: '',
          stderr: '429 rate_limit_error',
          pid: 12345,
          output: [null, '', '429 rate_limit_error'],
          signal: null
        };
      }
      return {
        status: 0,
        stdout: 'ok',
        stderr: '',
        pid: 12345,
        output: [null, 'ok', ''],
        signal: null
      };
    });
    // 使用 runProbeLoop（探测循环），因为它包含多次探测逻辑
    // 模拟 waitUntilReset 为立即返回，避免长时间等待
    jest.spyOn(executor as any, 'waitUntilReset').mockResolvedValue(undefined);
    const result = await (executor as any).runProbeLoop({ cwd: process.cwd() });
    expect(result).toBe(true);
    expect(callCount).toBe(4);
  });

  it('探测 10 次均失败应返回 false（探测耗尽场景）', async () => {
    const executor = new ClaudeExecutor();
    let callCount = 0;
    mockSpawnSync.mockImplementation(() => {
      callCount++;
      return {
        status: 1,
        stdout: '',
        stderr: '429 rate_limit_error',
        pid: 12345,
        output: [null, '', '429 rate_limit_error'],
        signal: null
      };
    });
    jest.spyOn(executor as any, 'waitUntilReset').mockResolvedValue(undefined);
    const result = await (executor as any).runProbeLoop({ cwd: process.cwd() });
    expect(result).toBe(false);
    expect(callCount).toBe(10);
  });

  it('探测耗尽时最后一次失败后不应等待（无多余 5 分钟延迟）', async () => {
    const executor = new ClaudeExecutor();
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: '429 rate_limit_error',
      pid: 12345,
      output: [null, '', '429 rate_limit_error'],
      signal: null
    });
    const waitSpy = jest.spyOn(executor as any, 'waitUntilReset').mockResolvedValue(undefined);
    await (executor as any).runProbeLoop({ cwd: process.cwd() });
    // waitUntilReset 应在 10 次探测之间调用 9 次（最后一次失败后不再等待）
    expect(waitSpy).toHaveBeenCalledTimes(9);
  });

  it('OpenCode 429 探测时 buildProbeArgs 抛错应返回 false（不导致死循环）', async () => {
    const executor = new OpenCodeExecutor();
    // OpenCode 的 buildProbeArgs() 抛错，probeRateLimit 应向上抛出
    // runProbeLoop 捕获后立即退出，不会循环 10 次
    const waitSpy = jest.spyOn(executor as any, 'waitUntilReset').mockResolvedValue(undefined);
    const result = await (executor as any).runProbeLoop({ cwd: process.cwd() });
    expect(result).toBe(false);
    // 不应发生任何等待
    expect(waitSpy).not.toHaveBeenCalled();
  });
});
