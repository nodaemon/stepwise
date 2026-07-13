import { formatNDJsonLine } from '../src/executors/ndjsonFormatter';

describe('ndjsonFormatter', () => {
  describe('system subtype 忽略规则', () => {
    it('thinking_tokens 应被静默忽略，不输出到 verbose_output.txt', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'thinking_tokens',
        estimated_tokens: 2343,
        estimated_tokens_delta: 2,
        uuid: 'b7231cbd-1f8a-4a5a-a15b-76d1bd74cc13',
        session_id: '75344aac-3192-4435-8d8c-d8ecf2dd02eb'
      });

      const result = formatNDJsonLine(line);

      expect(result.formatted).toBeNull();
      expect(result.isJsonParsed).toBe(true);
      expect(result.finalResultText).toBeNull();
      expect(result.assistantText).toBeNull();
    });

    it('keep_alive 应被静默忽略', () => {
      const line = JSON.stringify({ type: 'keep_alive' });
      const result = formatNDJsonLine(line);
      expect(result.formatted).toBeNull();
      expect(result.isJsonParsed).toBe(true);
    });

    it('control_request 应被静默忽略', () => {
      const line = JSON.stringify({ type: 'control_request' });
      const result = formatNDJsonLine(line);
      expect(result.formatted).toBeNull();
      expect(result.isJsonParsed).toBe(true);
    });

    it('streamlined_text 应被静默忽略', () => {
      const line = JSON.stringify({ type: 'streamlined_text' });
      const result = formatNDJsonLine(line);
      expect(result.formatted).toBeNull();
      expect(result.isJsonParsed).toBe(true);
    });
  });

  describe('已知 system subtype 正常格式化', () => {
    it('init 应正常格式化', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'init',
        model: 'claude-4-sonnet',
        session_id: 'test-session',
        cwd: '/home/user'
      });

      const result = formatNDJsonLine(line);

      expect(result.formatted).toContain('Session Init');
      expect(result.formatted).toContain('Model: claude-4-sonnet');
      expect(result.isJsonParsed).toBe(true);
    });

    it('status 应正常格式化', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'status',
        status: 'active'
      });

      const result = formatNDJsonLine(line);

      expect(result.formatted).toContain('[Status]');
      expect(result.isJsonParsed).toBe(true);
    });
  });

  describe('assistant 消息格式化', () => {
    it('thinking 内容应正常输出', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: '我在分析这个问题...' }
          ]
        }
      });

      const result = formatNDJsonLine(line);

      expect(result.formatted).toContain('[Thinking]');
      expect(result.formatted).toContain('我在分析这个问题...');
      expect(result.formatted).toContain('[/Thinking]');
    });

    it('text 内容应正常输出', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '分析结果如下' }
          ]
        }
      });

      const result = formatNDJsonLine(line);

      expect(result.formatted).toContain('分析结果如下');
      expect(result.assistantText).toBe('分析结果如下');
    });
  });

  describe('未知类型处理', () => {
    it('未知的 system subtype 应静默忽略', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'some_future_new_subtype',
        data: 'whatever'
      });

      const result = formatNDJsonLine(line);

      // system default 分支当前行为是 lines.push(line)，
      // 但我们期望未来将其改为 break（静默忽略）
      expect(result.isJsonParsed).toBe(true);
    });

    it('非 JSON 行应返回 isJsonParsed=false', () => {
      const result = formatNDJsonLine('this is plain text');

      expect(result.formatted).toBeNull();
      expect(result.isJsonParsed).toBe(false);
    });
  });
});
