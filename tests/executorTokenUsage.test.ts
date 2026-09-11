/**
 * BaseExecutor tokenUsage 透传测试
 * mock 子进程返回含 usage 的 NDJSON stdout，验证 ExecutionResult.tokenUsage 组装
 */
import { ClaudeExecutor } from '../src/executors/claude';

// 含 result.usage 的最小合法 NDJSON 输出
const NDJSON_WITH_USAGE = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 'test-session-1' }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: 'done',
    duration_ms: 44800,
    duration_api_ms: 41200,
    total_cost_usd: 0.0834,
    usage: {
      input_tokens: 15230,
      output_tokens: 1204,
      cache_creation_input_tokens: 8002,
      cache_read_input_tokens: 45210
    }
  })
].join('\n');

describe('BaseExecutor tokenUsage 透传', () => {
  it('NDJSON 输出含 usage 时 ExecutionResult.tokenUsage 应组装完整', async () => {
    const executor = new ClaudeExecutor();
    // mock runCommand 返回 NDJSON（runCommand 为 private，TS 仅编译期私有，
    // 实例属性赋值可在运行时遮蔽原型方法；execute() 内部经 this.runCommand 调用）
    (executor as any).runCommand = async () => ({
      stdout: NDJSON_WITH_USAGE,
      stderr: '',
      exitCode: 0
    });

    const result = await executor.execute('test prompt', { sessionId: 'test-session-1' });

    expect(result.success).toBe(true);
    expect(result.tokenUsage).toEqual({
      inputTokens: 15230,
      outputTokens: 1204,
      cacheCreationTokens: 8002,
      cacheReadTokens: 45210,
      costUsd: 0.0834,
      durationMs: 44800,
      durationApiMs: 41200
    });
  });

  it('纯文本输出（无 NDJSON）时 tokenUsage 应为 undefined', async () => {
    const executor = new ClaudeExecutor();
    (executor as any).runCommand = async () => ({
      stdout: 'plain text output without any json',
      stderr: '',
      exitCode: 0
    });

    const result = await executor.execute('test prompt', { sessionId: 'test-session-2' });

    expect(result.success).toBe(true);
    expect(result.tokenUsage).toBeUndefined();
  });
});
