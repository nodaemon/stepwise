/**
 * BaseExecutor.execute 重试时的会话续接（resume）语义测试
 *
 * 背景（线上问题）：
 * 429/503 之后 stepwise 重试时报 `Session ID ... is already in use.`，
 * 整个重试机制失效。
 *
 * 根因：重试时「是否 resume」的判据是 `attempts > 1`，而 429/503 分支会
 * 执行 `attempts--` 把计数退回去。于是 429 之后的第一次重试 attempts 仍是 1，
 * 判据为 false —— 退化成「新建会话」模式。对 Claude 而言等于用同一个 uuid
 * 再次 `--session-id`，而该 uuid 的会话文件在首次执行时已落盘，
 * CLI 因此拒绝执行。
 *
 * 修复：引入独立的 `sessionStarted` 标志，与重试预算计数 `attempts` 彻底分离。
 * 只要本会话已启动过一次，后续任何重试都必须续接同一会话。
 *
 * 本用例覆盖：
 * - 429 重试保持 resume
 * - 429 → 普通错误 → 再重试，全程 resume
 * - 首次执行不强制 resume
 * - 429 不计入重试预算（既有契约不得被破坏）
 */

import { BaseExecutor } from '../src/executors/base';
import { AgentExecutorOptions } from '../src/executors/types';

/**
 * 记录每次 runCommand 的入参，便于断言「这一轮是否走了 resume」
 */
interface RunCall {
  useResume: boolean | undefined;
}

class TestExecutor extends BaseExecutor {
  readonly agentType = 'claude' as const;
  protected getCommand(): string { return 'echo'; }
  protected buildArgs(): string[] { return []; }
  protected buildProbeArgs(): string[] { return ['--no-session-persistence', '-p']; }
}

/** 429 响应：命中基类的 checkRateLimitError 正则 */
const RATE_LIMIT_OUTPUT = 'API Error: 429 rate_limit_error';

describe('execute 重试时的会话续接（resume）', () => {
  const options: AgentExecutorOptions = { cwd: process.cwd() };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * 装一个记录调用的假 runCommand
   * @param results 依次返回的结果；用完最后一个后重复返回最后一个
   */
  function mockRunCommand(executor: TestExecutor, results: ExecutorRawResultMock[]): RunCall[] {
    const calls: RunCall[] = [];
    let index = 0;
    jest.spyOn(executor as any, 'runCommand').mockImplementation(
      async (...args: unknown[]) => {
        const opts = args[2] as AgentExecutorOptions;
        calls.push({ useResume: opts.useResume });
        const result = results[Math.min(index, results.length - 1)];
        index++;
        return result;
      }
    );
    return calls;
  }

  /** 屏蔽 429 分支的等待与探测循环，测试只关心 resume 语义 */
  function stubRateLimitWaiting(executor: TestExecutor): void {
    jest.spyOn(executor as any, 'waitUntilReset').mockResolvedValue(0);
    jest.spyOn(executor as any, 'runProbeLoop').mockResolvedValue({ recovered: true, waitMs: 0 });
  }

  it('429 之后的重试必须走 resume，而不是新建会话', async () => {
    const executor = new TestExecutor();
    const calls = mockRunCommand(executor, [
      { stdout: RATE_LIMIT_OUTPUT, stderr: '', exitCode: 1 },
      { stdout: 'ok', stderr: '', exitCode: 0 }
    ]);
    stubRateLimitWaiting(executor);

    const result = await executor.execute('test prompt', options);

    expect(result.success).toBe(true);
    expect(calls.length).toBe(2);
    // 首次执行：不强制 resume（沿用调用方的原始选项）
    expect(calls[0].useResume).toBeUndefined();
    // 429 后的重试：必须 resume
    // 旧实现在这里会是 undefined —— attempts-- 把 attempts 退回 1，
    // `attempts > 1` 判据为 false，于是错误地用 --session-id 复用已落盘的会话
    expect(calls[1].useResume).toBe(true);
  });

  it('429 → 普通错误 → 再重试，全程保持 resume', async () => {
    const executor = new TestExecutor();
    const calls = mockRunCommand(executor, [
      { stdout: RATE_LIMIT_OUTPUT, stderr: '', exitCode: 1 },
      { stdout: '普通错误', stderr: '', exitCode: 1 },
      { stdout: 'ok', stderr: '', exitCode: 0 }
    ]);
    stubRateLimitWaiting(executor);

    const result = await executor.execute('test prompt', options);

    expect(result.success).toBe(true);
    expect(calls.length).toBe(3);
    expect(calls[0].useResume).toBeUndefined();
    // 第 2 次（429 后）与第 3 次（普通错误后）都必须 resume
    expect(calls[1].useResume).toBe(true);
    expect(calls[2].useResume).toBe(true);
  });

  it('首次执行不强制 resume（调用方未要求时保持原样）', async () => {
    const executor = new TestExecutor();
    const calls = mockRunCommand(executor, [
      { stdout: 'ok', stderr: '', exitCode: 0 }
    ]);

    const result = await executor.execute('test prompt', options);

    expect(result.success).toBe(true);
    expect(calls.length).toBe(1);
    // 首次执行不该被框架擅自改成 resume
    expect(calls[0].useResume).toBeUndefined();
  });

  it('调用方显式要求 resume 时，首次执行也保持 resume', async () => {
    const executor = new TestExecutor();
    const calls = mockRunCommand(executor, [
      { stdout: 'ok', stderr: '', exitCode: 0 }
    ]);

    const result = await executor.execute('test prompt', { ...options, useResume: true });

    expect(result.success).toBe(true);
    expect(calls[0].useResume).toBe(true);
  });

  it('429 不计入重试预算：1 次 429 + 3 次普通错误 = 4 次调用', async () => {
    const executor = new TestExecutor();
    const calls = mockRunCommand(executor, [
      { stdout: RATE_LIMIT_OUTPUT, stderr: '', exitCode: 1 },
      { stdout: '普通错误', stderr: '', exitCode: 1 }
    ]);
    stubRateLimitWaiting(executor);

    let caught: unknown;
    try {
      await executor.execute('test prompt', options);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    // 429 走 attempts-- 退回预算，其余 3 次普通错误消耗预算
    expect(calls.length).toBe(4);
    // 除首次外全部 resume
    expect(calls[0].useResume).toBeUndefined();
    expect(calls.slice(1).every(c => c.useResume === true)).toBe(true);
  });
});

/** mock runCommand 的返回结构（与 ExecutorRawResult 一致） */
interface ExecutorRawResultMock {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}
