import { PiExecutor } from '../src/executors/pi';
import { ExecutorRawResult } from '../src/executors/types';

/**
 * PiExecutor 单元测试
 * 重点覆盖 NDJSON 输出的成功/失败判断（isExecutionSuccessful）
 * 这是修复 429 重试机制 bug 的关键
 */
describe('PiExecutor', () => {
  const executor = new PiExecutor();

  // 通过 as any 访问 protected 方法
  const isSuccessful = (result: ExecutorRawResult): boolean =>
    (executor as any).isExecutionSuccessful(result);

  /**
   * 构造 pi --mode json 输出的辅助函数
   * 默认最后一条 message_end 的 stopReason 由 stopReason 参数控制
   */
  function buildNdjsonOutput(stopReason: string, errorMessage?: string): string {
    const lines = [
      JSON.stringify({ type: 'session', id: 'test-session', cwd: '/tmp' }),
      JSON.stringify({ type: 'agent_start' }),
      JSON.stringify({ type: 'turn_start' }),
      JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }),
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason,
          errorMessage,
          content: []
        }
      }),
      JSON.stringify({ type: 'turn_end', message: { role: 'assistant' }, toolResults: [] }),
      JSON.stringify({ type: 'agent_end', messages: [], willRetry: false }),
      JSON.stringify({ type: 'agent_settled' })
    ];
    return lines.join('\n');
  }

  describe('isExecutionSuccessful（429 重试修复）', () => {
    it('stopReason=error + exitCode=0 (pi --mode json) 应判定为失败，触发 retry', () => {
      const stdout = buildNdjsonOutput('error', '429 Budget has been exceeded!');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(false);
    });

    it('stopReason=aborted + exitCode=0 应判定为失败，触发 retry', () => {
      const stdout = buildNdjsonOutput('aborted');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(false);
    });

    it('stopReason=stop + exitCode=0 应判定为成功', () => {
      const stdout = buildNdjsonOutput('stop');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(true);
    });

    it('stopReason=toolUse + exitCode=0 应判定为成功（工具调用导致流中断是正常的）', () => {
      const stdout = buildNdjsonOutput('toolUse');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(true);
    });

    it('stopReason=length + exitCode=0 应判定为成功（上下文截断属于可接受结束）', () => {
      const stdout = buildNdjsonOutput('length');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(true);
    });

    it('exitCode=1 应判定为失败（与 stopReason 无关）', () => {
      const stdout = buildNdjsonOutput('stop');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 1 });
      expect(result).toBe(false);
    });

    it('空 stdout + exitCode=0 应判定为成功（由 base.ts "空输出视为失败"逻辑兜底）', () => {
      const result = isSuccessful({ stdout: '', stderr: '', exitCode: 0 });
      expect(result).toBe(true);
    });

    it('非 JSON 的 stdout + exitCode=0 应判定为成功（容错）', () => {
      const result = isSuccessful({
        stdout: 'not json at all\nrandom text',
        stderr: '',
        exitCode: 0
      });
      expect(result).toBe(true);
    });

    it('多 message_end 场景应取最后一个', () => {
      // 第一轮 stop，第二轮 error → 应判定为失败
      const stdout = buildNdjsonOutput('stop') + '\n' +
        JSON.stringify({ type: 'turn_start' }) + '\n' +
        JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }) + '\n' +
        JSON.stringify({
          type: 'message_end',
          message: { role: 'assistant', stopReason: 'error', errorMessage: '429 budget' }
        }) + '\n' +
        JSON.stringify({ type: 'turn_end', message: { role: 'assistant' }, toolResults: [] });
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(false);
    });

    it('多 message_end 场景：最后一轮成功应判定为成功', () => {
      // 第一轮 error，第二轮 stop → 应判定为成功
      const stdout = buildNdjsonOutput('error', '429 budget') + '\n' +
        JSON.stringify({ type: 'turn_start' }) + '\n' +
        JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }) + '\n' +
        JSON.stringify({
          type: 'message_end',
          message: { role: 'assistant', stopReason: 'stop' }
        }) + '\n' +
        JSON.stringify({ type: 'turn_end', message: { role: 'assistant' }, toolResults: [] });
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(true);
    });

    it('混合 user / assistant message_end 时只检查 assistant', () => {
      const stdout = [
        JSON.stringify({ type: 'message_end', message: { role: 'user' } }),  // user 角色，忽略
        JSON.stringify({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } })
      ].join('\n');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(true);
    });
  });

  describe('基本属性', () => {
    it('agentType 应为 pi', () => {
      expect(executor.agentType).toBe('pi');
    });

    it('usesNDJsonOutput 应返回 true', () => {
      expect((executor as any).usesNDJsonOutput()).toBe(true);
    });
  });
});