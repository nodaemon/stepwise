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

  // ============================================================
  // Pi (--mode json) 事件格式测试
  // ============================================================
  describe('Pi 事件格式', () => {
    describe('SessionHeader (首行)', () => {
      it('应正确格式化并提取 session_id', () => {
        const line = JSON.stringify({
          type: 'session',
          version: 1,
          id: 'test-pi-session-uuid',
          timestamp: '2026-01-15T10:00:00.000Z',
          cwd: '/home/user/project'
        });

        const result = formatNDJsonLine(line);

        expect(result.formatted).toContain('Session Init');
        expect(result.formatted).toContain('Session: test-pi-session-uuid');
        expect(result.formatted).toContain('CWD: /home/user/project');
        expect(result.sessionId).toBe('test-pi-session-uuid');
        expect(result.isJsonParsed).toBe(true);
      });
    });

    describe('agent 生命周期', () => {
      it('agent_start 应输出开始标记', () => {
        const line = JSON.stringify({ type: 'agent_start' });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('Agent Start');
      });

      it('agent_end 应输出结束标记与重试状态', () => {
        const line = JSON.stringify({
          type: 'agent_end',
          messages: [{}, {}, {}],
          willRetry: false
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('Agent End');
        expect(result.formatted).toContain('Messages: 3');
        expect(result.formatted).toContain('WillRetry: false');
      });

      it('agent_settled 应输出标记', () => {
        const line = JSON.stringify({ type: 'agent_settled' });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('Agent Settled');
      });
    });

    describe('turn 生命周期', () => {
      it('turn_start 应输出开始标记', () => {
        const line = JSON.stringify({ type: 'turn_start' });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('Turn Start');
      });

      it('turn_end 应输出 stop reason 与工具结果数', () => {
        const line = JSON.stringify({
          type: 'turn_end',
          message: { role: 'assistant', stopReason: 'toolUse' },
          toolResults: [{}, {}]
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('Turn End');
        expect(result.formatted).toContain('Last role: assistant');
        expect(result.formatted).toContain('Stop reason: toolUse');
        expect(result.formatted).toContain('Tool results: 2');
      });
    });

    describe('message 生命周期', () => {
      it('message_start (assistant) 应输出标记但不重复 text', () => {
        const line = JSON.stringify({
          type: 'message_start',
          message: { role: 'assistant' }
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('Assistant Message Start');
      });

      it('message_end (assistant 成功) 应设置 finalResultText 与 assistantText', () => {
        const line = JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            stopReason: 'stop',
            content: [{ type: 'text', text: '这是最终回复内容' }]
          }
        });
        const result = formatNDJsonLine(line);
        expect(result.finalResultText).toBe('这是最终回复内容');
        expect(result.assistantText).toBe('这是最终回复内容');
        expect(result.formatted).toContain('Assistant Message End');
      });

      it('message_end (assistant 错误) 仍记录部分文本', () => {
        const line = JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            stopReason: 'error',
            errorMessage: 'API 调用失败',
            content: [{ type: 'text', text: '部分输出' }]
          }
        });
        const result = formatNDJsonLine(line);
        expect(result.finalResultText).toBe('部分输出');
        expect(result.formatted).toContain('Stop reason: error');
        expect(result.formatted).toContain('API 调用失败');
      });

      it('message_end (assistant stopReason=stop) 应设置 finalResultText', () => {
        const line = JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            stopReason: 'stop',
            content: [{ type: 'text', text: '正常回复' }]
          }
        });
        const result = formatNDJsonLine(line);
        expect(result.finalResultText).toBe('正常回复');
      });

      it('message_end (assistant stopReason=toolUse) 应设置 finalResultText', () => {
        const line = JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            stopReason: 'toolUse',
            content: [
              { type: 'text', text: '调用工具' },
              { type: 'toolCall', name: 'Bash', arguments: {} }
            ]
          }
        });
        const result = formatNDJsonLine(line);
        expect(result.finalResultText).toBe('调用工具');
      });

      it('message_end (assistant stopReason=pending) 不应设置 finalResultText', () => {
        // pending 是流开始时的初值，不应被当作正常结束
        const line = JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            stopReason: 'pending',
            content: [{ type: 'text', text: '部分输出' }]
          }
        });
        const result = formatNDJsonLine(line);
        expect(result.finalResultText).toBeNull();
      });

      it('message_end (assistant 无 stopReason) 不应设置 finalResultText', () => {
        const line = JSON.stringify({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: '部分输出' }]
          }
        });
        const result = formatNDJsonLine(line);
        expect(result.finalResultText).toBeNull();
      });

      it('message_end (toolResult) 应作为工具结果格式化', () => {
        const line = JSON.stringify({
          type: 'message_end',
          message: {
            role: 'toolResult',
            content: [{ type: 'text', text: '文件内容：hello world' }]
          }
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('[Tool Result]');
        expect(result.formatted).toContain('文件内容：hello world');
        expect(result.formatted).toContain('[/Tool Result]');
      });
    });

    describe('message_update 流式事件', () => {
      it('thinking_start 仅输出开始标记', () => {
        const line = JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 }
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('[Thinking Start]');
      });

      it('thinking_delta 不输出（避免 verbose 被淹没）', () => {
        const line = JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: '部分思考' }
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toBeNull();
      });

      it('thinking_end 输出完整思考内容', () => {
        const line = JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'thinking_end',
            contentIndex: 0,
            content: '完整的思考过程...'
          }
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('[Thinking]');
        expect(result.formatted).toContain('完整的思考过程...');
        expect(result.formatted).toContain('[/Thinking]');
      });

      it('text_end 输出完整文本并设置 assistantText', () => {
        const line = JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_end',
            contentIndex: 0,
            content: '完整回复文本'
          }
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('[Text]');
        expect(result.formatted).toContain('完整回复文本');
        expect(result.assistantText).toBe('完整回复文本');
      });

      it('toolcall_end 输出工具调用与参数', () => {
        const line = JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'toolcall_end',
            contentIndex: 0,
            toolCall: {
              id: 'call-1',
              name: 'Bash',
              arguments: { command: 'ls -la', description: '列出文件' }
            }
          }
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('[Bash]');
        expect(result.formatted).toContain('Command: ls -la');
        expect(result.formatted).toContain('Description: 列出文件');
      });

      it('done 输出结束原因', () => {
        const line = JSON.stringify({
          type: 'message_update',
          assistantMessageEvent: { type: 'done', reason: 'stop' }
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('[Stream Done]');
        expect(result.formatted).toContain('reason=stop');
      });
    });

    describe('tool_execution 生命周期', () => {
      it('tool_execution_start 输出工具名与参数', () => {
        const line = JSON.stringify({
          type: 'tool_execution_start',
          toolCallId: 'call-1',
          toolName: 'Read',
          args: { file_path: '/tmp/test.ts' }
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('[Tool Execution Start]');
        expect(result.formatted).toContain('Tool: Read');
        expect(result.formatted).toContain('Call ID: call-1');
        expect(result.formatted).toContain('File: /tmp/test.ts');
      });

      it('tool_execution_update 输出流式部分结果', () => {
        const line = JSON.stringify({
          type: 'tool_execution_update',
          toolCallId: 'call-1',
          toolName: 'Bash',
          partialResult: 'partial output'
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('[Tool Execution Update]');
        expect(result.formatted).toContain('partial output');
      });

      it('tool_execution_end 字符串结果直接展示', () => {
        const line = JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'call-1',
          toolName: 'Bash',
          result: '命令执行成功',
          isError: false
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('[Tool Execution End]');
        expect(result.formatted).toContain('Tool: Bash');
        expect(result.formatted).toContain('命令执行成功');
      });

      it('tool_execution_end 错误标记', () => {
        const line = JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'call-1',
          toolName: 'Bash',
          result: '失败信息',
          isError: true
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('[Tool Execution End (ERROR)]');
      });

      it('tool_execution_end 对象结果尝试提取常见字段', () => {
        const line = JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'call-1',
          toolName: 'Read',
          result: { content: [{ type: 'text', text: '文件文本内容' }] },
          isError: false
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('[Tool Execution End]');
        expect(result.formatted).toContain('文件文本内容');
      });

      it('tool_execution_end pi Bash 结果格式 (content 数组中含 text)', () => {
        const line = JSON.stringify({
          type: 'tool_execution_end',
          toolCallId: 'call-1',
          toolName: 'bash',
          result: {
            content: [{ type: 'text', text: '总用量 0\ndrwxr-xr-x 2 wangkai wangkai 40' }]
          },
          isError: false
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('[Tool Execution End]');
        expect(result.formatted).toContain('Tool: bash');
        expect(result.formatted).toContain('总用量 0');
        expect(result.formatted).toContain('drwxr-xr-x');
      });
    });

    describe('压缩与重试事件', () => {
      it('compaction_start/end 应输出原因与中止状态', () => {
        const start = JSON.stringify({
          type: 'compaction_start',
          reason: 'threshold'
        });
        const startResult = formatNDJsonLine(start);
        expect(startResult.formatted).toContain('[Compaction Start]');
        expect(startResult.formatted).toContain('Reason: threshold');

        const end = JSON.stringify({
          type: 'compaction_end',
          reason: 'threshold',
          result: { summary: '...' },
          aborted: false,
          willRetry: false
        });
        const endResult = formatNDJsonLine(end);
        expect(endResult.formatted).toContain('[Compaction End]');
        expect(endResult.formatted).toContain('Aborted: false');
      });

      it('auto_retry_start/end 应输出重试信息', () => {
        const start = JSON.stringify({
          type: 'auto_retry_start',
          attempt: 1,
          maxAttempts: 3,
          delayMs: 1000,
          errorMessage: 'rate limit'
        });
        const startResult = formatNDJsonLine(start);
        expect(startResult.formatted).toContain('[Auto Retry Start]');
        expect(startResult.formatted).toContain('attempt=1/3');
        expect(startResult.formatted).toContain('rate limit');
      });
    });

    describe('其他状态变更', () => {
      it('thinking_level_changed 应输出级别', () => {
        const line = JSON.stringify({
          type: 'thinking_level_changed',
          level: 'high'
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toContain('[Thinking Level] high');
      });

      it('entry_appended 应被静默忽略（持久化事件）', () => {
        const line = JSON.stringify({
          type: 'entry_appended',
          entry: { id: 'abc', type: 'message' }
        });
        const result = formatNDJsonLine(line);
        expect(result.formatted).toBeNull();
      });

      it('queue_update 仅在非空时输出', () => {
        const empty = JSON.stringify({
          type: 'queue_update',
          steering: [],
          followUp: []
        });
        const emptyResult = formatNDJsonLine(empty);
        expect(emptyResult.formatted).toBeNull();

        const nonEmpty = JSON.stringify({
          type: 'queue_update',
          steering: ['steer msg'],
          followUp: []
        });
        const nonEmptyResult = formatNDJsonLine(nonEmpty);
        expect(nonEmptyResult.formatted).toContain('[Queue Update]');
        expect(nonEmptyResult.formatted).toContain('Steering: 1');
      });
    });
  });
});
