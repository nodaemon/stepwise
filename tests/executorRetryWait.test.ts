/**
 * BaseExecutor.execute 重试等待累计集成测试
 * 覆盖：429 限额等待 + 探测循环等待累计到 ExecutionResult.retryWaitMs、
 * 失败路径抛出携带累计等待的 ExecutorError、无 429 时等待为 0
 */
import { BaseExecutor, ExecutorError } from '../src/executors/base';
import { AgentExecutorOptions } from '../src/executors/types';

class TestExecutor extends BaseExecutor {
  readonly agentType = 'claude' as const;
  protected getCommand(): string { return 'echo'; }
  protected buildArgs(): string[] { return []; }
  protected buildProbeArgs(): string[] { return ['--no-session-persistence', '-p', 'reply ok']; }
}

describe('execute 重试等待累计', () => {
  const options: AgentExecutorOptions = { cwd: process.cwd() };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('429 限额等待 + 探测等待应累计到 retryWaitMs 并随成功结果透传', async () => {
    const executor = new TestExecutor();
    let callCount = 0;
    jest.spyOn(executor as any, 'runCommand').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // 首次触发 429 速率限制（无具体重置时间 → 走默认等待分支）
        return { stdout: 'API Error: 429 rate_limit_error', stderr: '', exitCode: 1 };
      }
      return { stdout: 'ok', stderr: '', exitCode: 0 };
    });
    jest.spyOn(executor as any, 'waitUntilReset').mockResolvedValue(60000);
    jest.spyOn(executor as any, 'runProbeLoop').mockResolvedValue({ recovered: true, waitMs: 30000 });

    const result = await executor.execute('test prompt', options);

    expect(result.success).toBe(true);
    // 60000 限额等待 + 30000 探测等待
    expect(result.retryWaitMs).toBe(90000);
    expect(typeof result.duration).toBe('number');
  });

  it('所有重试失败时应抛出携带累计等待的 ExecutorError', async () => {
    const executor = new TestExecutor();
    let callCount = 0;
    jest.spyOn(executor as any, 'runCommand').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // 首次 429（触发等待 + 探测），后续普通错误耗尽重试次数
        return { stdout: 'API Error: 429 rate_limit_error', stderr: '', exitCode: 1 };
      }
      return { stdout: 'some error', stderr: '', exitCode: 1 };
    });
    jest.spyOn(executor as any, 'waitUntilReset').mockResolvedValue(60000);
    jest.spyOn(executor as any, 'runProbeLoop').mockResolvedValue({ recovered: true, waitMs: 30000 });

    let caught: unknown;
    try {
      await executor.execute('test prompt', options);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ExecutorError);
    expect((caught as ExecutorError).retryWaitMs).toBe(90000);
    // 1 次 429 + 3 次普通错误重试
    expect(callCount).toBe(4);
  });

  it('无 429 时 retryWaitMs 为 0', async () => {
    const executor = new TestExecutor();
    jest.spyOn(executor as any, 'runCommand')
      .mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 });

    const result = await executor.execute('test prompt', options);

    expect(result.success).toBe(true);
    expect(result.retryWaitMs).toBe(0);
  });
});
