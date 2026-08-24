import { MAX_PROBE_ATTEMPTS, PROBE_TIMEOUT_MS } from '../src/constants';
import { ClaudeExecutor } from '../src/executors/claude';
import { PiExecutor } from '../src/executors/pi';
import { OpenCodeExecutor } from '../src/executors/opencode';

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
