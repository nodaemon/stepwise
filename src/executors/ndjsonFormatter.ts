/**
 * NDJSON 解析器和格式化器
 * 将 Claude Code 的 stream-json 输出解析并格式化为可读文本
 */

/**
 * NDJSON 解析结果
 */
export interface ParsedNDJsonResult {
  /** 从 result 消息提取的最终文本 */
  finalResultText: string;
  /** 最后一段 assistant text（作为 fallback） */
  lastAssistantText: string;
  /** 格式化后的完整过程日志 */
  formattedTranscript: string;
  /** 是否成功解析（至少解析出一行有效 JSON） */
  parsedSuccessfully: boolean;
  /** 解析过程中的警告/错误 */
  parseErrors: string[];
  /** 从 system/init 块提取的 session_id（fork 模式下为派生的新 ID） */
  sessionId: string | null;
}

/** 工具输入参数截断阈值 */
const TOOL_INPUT_MAX_LENGTH = 200;
/** 工具结果截断阈值 */
const TOOL_RESULT_MAX_LENGTH = 5000;
/** Hook 输出截断阈值 */
const HOOK_OUTPUT_MAX_LENGTH = 300;

/**
 * 从 assistant 消息 content 数组中提取纯文本
 * 兼容 pi (TextContent) 和 Claude (text block) 的字段命名
 */
function extractAssistantTextFromContent(content: any): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    // pi: { type: 'text', text: string }
    // Claude: { type: 'text', text: string }
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

/**
 * 截断字符串，超长时显示省略信息
 */
function truncate(text: string, maxLength: number): string {
  if (typeof text !== 'string') text = String(text ?? '');
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.substring(0, maxLength)}... [truncated, ${text.length} total chars]`;
}

/**
 * 格式化工具输入参数（按工具名定制）
 */
function formatToolInput(toolName: string, input: Record<string, any>): string {
  const lines: string[] = [];

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
      if (input.file_path) lines.push(`  File: ${input.file_path}`);
      if (input.old_string) lines.push(`  Old: ${truncate(input.old_string, TOOL_INPUT_MAX_LENGTH)}`);
      if (input.new_string) lines.push(`  New: ${truncate(input.new_string, TOOL_INPUT_MAX_LENGTH)}`);
      if (input.content) lines.push(`  Content: ${truncate(input.content, TOOL_INPUT_MAX_LENGTH)}`);
      break;

    case 'Bash':
      if (input.command) lines.push(`  Command: ${truncate(input.command, TOOL_INPUT_MAX_LENGTH)}`);
      if (input.description) lines.push(`  Description: ${input.description}`);
      break;

    case 'Grep':
      if (input.pattern) lines.push(`  Pattern: ${input.pattern}`);
      if (input.path) lines.push(`  Path: ${input.path}`);
      if (input.glob) lines.push(`  Glob: ${input.glob}`);
      break;

    case 'Glob':
      if (input.pattern) lines.push(`  Pattern: ${input.pattern}`);
      if (input.path) lines.push(`  Path: ${input.path}`);
      break;

    default:
      // 通用 key-value 格式
      for (const [key, value] of Object.entries(input)) {
        const valueStr = typeof value === 'string' ? truncate(value, TOOL_INPUT_MAX_LENGTH) : JSON.stringify(value);
        lines.push(`  ${key}: ${valueStr}`);
      }
      break;
  }

  return lines.join('\n');
}

/**
 * 提取 tool_result 中的文本内容
 */
function extractToolResultContent(content: any): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((block: any) => {
      if (typeof block === 'string') return block;
      if (block?.text) return block.text;
      return JSON.stringify(block);
    }).join('\n');
  }
  if (content?.text) {
    return content.text;
  }
  return JSON.stringify(content);
}

/**
 * 解析并格式化 NDJSON 输出（批量模式）
 * 内部调用 formatNDJsonLine() 逐行处理，复用格式化逻辑
 *
 * @param rawStdout Claude Code --verbose --output-format=stream-json 的 stdout 输出
 * @returns 解析结果，包含最终文本、过程日志等
 */
export function parseAndFormatNDJson(rawStdout: string): ParsedNDJsonResult {
  const transcriptLines: string[] = [];
  let finalResultText = '';
  let lastAssistantText = '';
  let sessionId: string | null = null;
  let parsedAnyLine = false;
  const parseErrors: string[] = [];

  const lines = rawStdout.split('\n').filter(line => line.trim() !== '');

  for (const line of lines) {
    const result = formatNDJsonLine(line);
    if (result.formatted) {
      transcriptLines.push(result.formatted);
      parsedAnyLine = true;
    } else if (!result.isJsonParsed && line.trim()) {
      // JSON 解析失败，记录错误
      parseErrors.push(`Invalid JSON: ${line.substring(0, 100)}`);
    } else {
      // JSON 解析成功但无需格式化（keep_alive 等），标记为已解析
      parsedAnyLine = true;
    }

    if (result.finalResultText) {
      finalResultText = result.finalResultText;
      parsedAnyLine = true;
    }
    if (result.assistantText) {
      lastAssistantText = result.assistantText;
      parsedAnyLine = true;
    }
    // 记录首个 init 块的 session_id（fork 模式下为派生的新 ID）
    if (result.sessionId && !sessionId) {
      sessionId = result.sessionId;
    }
  }

  return {
    finalResultText,
    lastAssistantText,
    formattedTranscript: transcriptLines.join('\n'),
    parsedSuccessfully: parsedAnyLine,
    parseErrors,
    sessionId
  };
}

/**
 * 单行 NDJSON 格式化结果
 */
export interface NDJsonLineResult {
  /** 格式化后的文本（可能多行），为 null 表示该行无需输出 */
  formatted: string | null;
  /** 如果是 result 类型消息，提取的最终结果文本 */
  finalResultText: string | null;
  /** 如果是 assistant text 类型，提取的文本 */
  assistantText: string | null;
  /** 从 system/init 块提取的 session_id（fork 模式下为派生的新 ID） */
  sessionId: string | null;
  /** JSON 是否解析成功（用于区分"解析失败"和"解析成功但无需格式化"） */
  isJsonParsed: boolean;
}

/**
 * 格式化单行 NDJSON
 * 用于实时逐行处理，每收到一行 stdout 就调用一次
 *
 * @param line 一行 JSON 字符串
 * @returns 格式化结果，JSON 解析失败时返回 formatted=null
 */
export function formatNDJsonLine(line: string): NDJsonLineResult {
  const trimmed = line.trim();
  if (!trimmed) {
    return { formatted: null, finalResultText: null, assistantText: null, sessionId: null, isJsonParsed: false };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { formatted: null, finalResultText: null, assistantText: null, sessionId: null, isJsonParsed: false };
  }

  const lines: string[] = [];
  let finalResultText: string | null = null;
  let assistantText: string | null = null;
  let sessionId: string | null = null;

  switch (parsed.type) {
    case 'system': {
      const subtype = parsed.subtype;
      switch (subtype) {
        case 'init':
          lines.push('--- Session Init ---');
          if (parsed.model) lines.push(`Model: ${parsed.model}`);
          if (parsed.session_id) {
            lines.push(`Session: ${parsed.session_id}`);
            sessionId = parsed.session_id;  // 提取 session_id（fork 模式下为派生的新 ID）
          }
          if (parsed.cwd) lines.push(`CWD: ${parsed.cwd}`);
          lines.push('');
          break;
        case 'hook_started':
          lines.push(`[Hook Started] ${parsed.hook_name || ''} (${parsed.hook_event || ''})`);
          lines.push('');
          break;
        case 'hook_progress': {
          const output = parsed.output || parsed.stdout || '';
          lines.push(`[Hook Progress] ${parsed.hook_name || ''}: ${truncate(output, HOOK_OUTPUT_MAX_LENGTH)}`);
          lines.push('');
          break;
        }
        case 'hook_response':
          lines.push(`[Hook Response] ${parsed.hook_name || ''}: ${parsed.outcome || ''}` +
            (parsed.exit_code !== undefined ? ` (exit=${parsed.exit_code})` : ''));
          lines.push('');
          break;
        case 'task_started':
          lines.push(`[Task Started] ${parsed.description || ''} (id=${parsed.task_id || ''})`);
          lines.push('');
          break;
        case 'task_progress':
          lines.push(`[Task Progress] ${parsed.description || ''} (id=${parsed.task_id || ''})`);
          lines.push('');
          break;
        case 'task_notification':
          lines.push(`[Task Notification] ${parsed.status || ''}: ${parsed.summary || ''} (id=${parsed.task_id || ''})`);
          lines.push('');
          break;
        case 'post_turn_summary':
          lines.push(`[Turn Summary] ${parsed.title || ''}`);
          if (parsed.status_category) lines.push(`  Category: ${parsed.status_category}`);
          if (parsed.recent_action) lines.push(`  Action: ${parsed.recent_action}`);
          lines.push('');
          break;
        case 'status':
          lines.push(`[Status] ${parsed.status || 'idle'}${parsed.permissionMode ? ' | Mode: ' + parsed.permissionMode : ''}`);
          lines.push('');
          break;
        case 'api_retry':
          lines.push(`[API Retry] Attempt ${parsed.attempt || '?'}/${parsed.max_retries || '?'} (${parsed.error || ''})`);
          lines.push('');
          break;
        case 'rate_limit_event': {
          const info = parsed.rate_limit_info;
          if (info) {
            lines.push(`[Rate Limit] ${info.status || ''} (type=${info.rateLimitType || ''}, utilization=${info.utilization || ''})`);
          } else {
            lines.push('[Rate Limit] event received');
          }
          lines.push('');
          break;
        }
        case 'auth_status':
          lines.push(`[Auth] ${parsed.isAuthenticating ? 'Authenticating...' : 'Authenticated'}`);
          if (parsed.error) lines.push(`  Error: ${parsed.error}`);
          lines.push('');
          break;
        case 'session_state_changed':
          lines.push(`[Session] ${parsed.state || ''}`);
          lines.push('');
          break;
        case 'compact_boundary':
          lines.push(`[Compact] trigger=${parsed.compact_metadata?.trigger || ''}`);
          lines.push('');
          break;
        case 'thinking_tokens':
          break;
        default:
          // 未知 subtype：输出原始 JSON（兼容 OpenCode 等非 Claude 执行器）
          lines.push(line);
          break;
      }
      break;
    }

    case 'assistant': {
      const content = parsed.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          switch (block.type) {
            case 'thinking': {
              const thinkingText = block.thinking || '';
              if (thinkingText) {
                lines.push('[Thinking]');
                lines.push(thinkingText);
                lines.push('[/Thinking]');
                lines.push('');
              }
              break;
            }
            case 'text': {
              const text = block.text || '';
              if (text) {
                lines.push(text);
                lines.push('');
                assistantText = text;
              }
              break;
            }
            case 'tool_use': {
              const toolName = block.name || 'Unknown';
              const toolInput = block.input || {};
              lines.push(`[${toolName}]`);
              lines.push(formatToolInput(toolName, toolInput));
              lines.push('');
              break;
            }
          }
        }
      }
      break;
    }

    case 'user': {
      const content = parsed.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'tool_result') {
            const resultContent = extractToolResultContent(block.content);
            lines.push('[Tool Result]');
            lines.push(`  ${truncate(resultContent, TOOL_RESULT_MAX_LENGTH)}`);
            lines.push('[/Tool Result]');
            lines.push('');
          }
        }
      }
      break;
    }

    case 'result': {
      const resultText = parsed.result || '';
      if (resultText) {
        finalResultText = resultText;
      }
      lines.push('--- Result ---');
      lines.push(finalResultText || '(no result)');
      if (parsed.duration_ms !== undefined) {
        const durationSec = (parsed.duration_ms / 1000).toFixed(1);
        lines.push(`Duration: ${durationSec}s` +
          (parsed.total_cost_usd !== undefined ? ` | Cost: $${parsed.total_cost_usd.toFixed(4)}` : ''));
      }
      lines.push('');
      break;
    }

    // ============================================================
    // Pi (--mode json) 事件格式
    // 参见 @earendil-works/pi-coding-agent 的 AgentSessionEvent 定义：
    //   packages/coding-agent/src/core/agent-session.ts
    // ============================================================

    // Pi 首行：SessionHeader
    // { type: 'session', version?: number, id: uuid, timestamp, cwd, parentSession? }
    case 'session': {
      lines.push('--- Session Init ---');
      if (parsed.id) {
        lines.push(`Session: ${parsed.id}`);
        sessionId = parsed.id;
      }
      if (parsed.cwd) lines.push(`CWD: ${parsed.cwd}`);
      if (parsed.parentSession) lines.push(`Parent: ${parsed.parentSession}`);
      lines.push('');
      break;
    }

    // Pi: agent 生命周期
    case 'agent_start': {
      lines.push('--- Agent Start ---');
      lines.push('');
      break;
    }
    case 'agent_end': {
      const msgCount = Array.isArray(parsed.messages) ? parsed.messages.length : 0;
      lines.push('--- Agent End ---');
      lines.push(`Messages: ${msgCount} | WillRetry: ${parsed.willRetry === true}`);
      lines.push('');
      break;
    }
    case 'agent_settled': {
      lines.push('[Agent Settled]');
      lines.push('');
      break;
    }

    // Pi: turn 生命周期（一轮 = 一次 assistant 响应 + 任意工具调用/结果）
    case 'turn_start': {
      lines.push('--- Turn Start ---');
      lines.push('');
      break;
    }
    case 'turn_end': {
      const msg = parsed.message;
      const toolResultCount = Array.isArray(parsed.toolResults) ? parsed.toolResults.length : 0;
      lines.push('--- Turn End ---');
      if (msg?.role) lines.push(`  Last role: ${msg.role}`);
      if (msg?.stopReason) lines.push(`  Stop reason: ${msg.stopReason}`);
      lines.push(`  Tool results: ${toolResultCount}`);
      lines.push('');
      break;
    }

    // Pi: message 生命周期（user / assistant / toolResult）
    case 'message_start': {
      const msg = parsed.message;
      if (msg?.role === 'assistant') {
        // 仅标记开始，不重复输出 text；实际 text 在 text_end 输出
        lines.push('[Assistant Message Start]');
        lines.push('');
      }
      break;
    }
    case 'message_end': {
      const msg = parsed.message;
      if (msg?.role === 'assistant') {
        // 提取最终文本作为 result（pi 无独立 result 事件）
        const text = extractAssistantTextFromContent(msg.content);
        const stopReason = msg.stopReason;
        if (stopReason === 'error' || stopReason === 'aborted') {
          lines.push('[Assistant Message End]');
          lines.push(`  Stop reason: ${stopReason}`);
          if (msg.errorMessage) lines.push(`  Error: ${msg.errorMessage}`);
          // 失败时仍把已有文本作为 finalResultText，便于上层拿到部分结果
          if (text) finalResultText = text;
          lines.push('');
        } else if (text) {
          // 成功结束：覆盖式记录最终文本
          finalResultText = text;
          assistantText = text;
          // 详细文本不重复输出（流式 delta 中已有累积），
          // 仅在 stopReason 标记结尾时给一条紧凑记录
          lines.push('[Assistant Message End]');
          lines.push(`  Stop reason: ${stopReason || 'stop'}`);
          lines.push('');
        } else {
          lines.push('[Assistant Message End]');
          lines.push(`  Stop reason: ${stopReason || 'stop'}`);
          lines.push('');
        }
      } else if (msg?.role === 'user') {
        lines.push('[User Message End]');
        lines.push('');
      } else if (msg?.role === 'toolResult') {
        lines.push('[Tool Result]');
        const resultText = extractAssistantTextFromContent(msg.content);
        if (resultText) {
          lines.push(`  ${truncate(resultText, TOOL_RESULT_MAX_LENGTH)}`);
        } else {
          // content 为非 text 块（如 image）时回退为 JSON
          lines.push(`  ${truncate(JSON.stringify(msg.content), TOOL_RESULT_MAX_LENGTH)}`);
        }
        lines.push('[/Tool Result]');
        lines.push('');
      }
      break;
    }

    // Pi: 流式 message_update，包含嵌套 assistantMessageEvent
    // assistantMessageEvent.type: start / text_start / text_delta / text_end /
    //                            thinking_start / thinking_delta / thinking_end /
    //                            toolcall_start / toolcall_delta / toolcall_end /
    //                            done / error
    case 'message_update': {
      const ame = parsed.assistantMessageEvent;
      if (!ame || typeof ame !== 'object') break;

      switch (ame.type) {
        case 'start': {
          lines.push('[Assistant Stream Start]');
          lines.push('');
          break;
        }
        case 'thinking_start': {
          // 累积开始：仅记录开始标记，完整内容在 thinking_end 输出
          lines.push('[Thinking Start]');
          lines.push('');
          break;
        }
        case 'thinking_delta': {
          // delta 不单独输出（避免 verbose_output.txt 被大量短行淹没），
          // 完整内容在 thinking_end 输出。如需看流式过程可改此处输出 ame.delta。
          break;
        }
        case 'thinking_end': {
          // 完整思考内容一次性输出
          const thinkingText = ame.content || '';
          if (thinkingText) {
            lines.push('[Thinking]');
            lines.push(thinkingText);
            lines.push('[/Thinking]');
            lines.push('');
          }
          break;
        }
        case 'text_start': {
          // 文本块开始，仅记录标记
          lines.push('[Text Start]');
          lines.push('');
          break;
        }
        case 'text_delta': {
          // delta 不单独输出；完整内容在 text_end 输出
          break;
        }
        case 'text_end': {
          // 完整文本块一次性输出
          const text = ame.content || '';
          if (text) {
            lines.push('[Text]');
            lines.push(text);
            lines.push('[/Text]');
            lines.push('');
            assistantText = text;
          }
          break;
        }
        case 'toolcall_start': {
          lines.push('[Tool Call Start]');
          lines.push('');
          break;
        }
        case 'toolcall_delta': {
          // 工具调用参数增量（JSON 字符串 delta），在 toolcall_end 一次性输出
          break;
        }
        case 'toolcall_end': {
          // 完整 ToolCall 对象
          const tc = ame.toolCall;
          if (tc) {
            const toolName = tc.name || 'Unknown';
            const toolInput = tc.arguments || tc.input || {};
            lines.push(`[${toolName}]`);
            lines.push(formatToolInput(toolName, toolInput));
            lines.push('');
          }
          break;
        }
        case 'done': {
          // 流结束（reason: stop | length | toolUse）
          lines.push(`[Stream Done] reason=${ame.reason || ''}`);
          lines.push('');
          break;
        }
        case 'error': {
          lines.push(`[Stream Error] reason=${ame.reason || ''}`);
          if (ame.error?.errorMessage) lines.push(`  ${ame.error.errorMessage}`);
          lines.push('');
          break;
        }
        default:
          // 未知的 assistantMessageEvent 子类型：原样输出，保留诊断信息
          lines.push(line);
          break;
      }
      break;
    }

    // Pi: 工具执行生命周期
    case 'tool_execution_start': {
      const toolName = parsed.toolName || 'Unknown';
      lines.push('[Tool Execution Start]');
      lines.push(`  Tool: ${toolName}`);
      lines.push(`  Call ID: ${parsed.toolCallId || ''}`);
      if (parsed.args !== undefined) {
        lines.push(formatToolInput(toolName, parsed.args || {}));
      }
      lines.push('');
      break;
    }
    case 'tool_execution_update': {
      // 流式中间结果（长命令输出等）。delta 结构视工具而定。
      lines.push('[Tool Execution Update]');
      lines.push(`  Tool: ${parsed.toolName || ''}`);
      lines.push(`  Call ID: ${parsed.toolCallId || ''}`);
      if (parsed.partialResult !== undefined) {
        const partial = typeof parsed.partialResult === 'string'
          ? parsed.partialResult
          : JSON.stringify(parsed.partialResult);
        lines.push(`  Partial: ${truncate(partial, HOOK_OUTPUT_MAX_LENGTH)}`);
      }
      lines.push('');
      break;
    }
    case 'tool_execution_end': {
      const toolName = parsed.toolName || 'Unknown';
      const isError = parsed.isError === true;
      const result = parsed.result;
      lines.push(isError ? '[Tool Execution End (ERROR)]' : '[Tool Execution End]');
      lines.push(`  Tool: ${toolName}`);
      lines.push(`  Call ID: ${parsed.toolCallId || ''}`);
      // 工具结果：
      // - 字符串：直接展示
      // - 对象：优先尝试 pi 的 { content: [{ type:'text', text:'...' }] } 结构
      //         再退回到 extractToolResultContent 兼容 Claude 格式，
      //         最终退回到 JSON.stringify 保留原始信息
      if (typeof result === 'string') {
        lines.push(`  Result: ${truncate(result, TOOL_RESULT_MAX_LENGTH)}`);
      } else if (result !== undefined && result !== null) {
        const extractedFromPiShape = extractAssistantTextFromContent(
          Array.isArray((result as any)?.content) ? (result as any).content : null
        );
        if (extractedFromPiShape) {
          lines.push(`  Result: ${truncate(extractedFromPiShape, TOOL_RESULT_MAX_LENGTH)}`);
        } else {
          const extracted = extractToolResultContent(result);
          if (extracted && extracted !== '{}') {
            lines.push(`  Result: ${truncate(extracted, TOOL_RESULT_MAX_LENGTH)}`);
          } else {
            lines.push(`  Result: ${truncate(JSON.stringify(result), TOOL_RESULT_MAX_LENGTH)}`);
          }
        }
      }
      lines.push('');
      break;
    }

    // Pi: 队列更新（steering / followUp）
    case 'queue_update': {
      const steering = Array.isArray(parsed.steering) ? parsed.steering : [];
      const followUp = Array.isArray(parsed.followUp) ? parsed.followUp : [];
      if (steering.length > 0 || followUp.length > 0) {
        lines.push('[Queue Update]');
        if (steering.length > 0) lines.push(`  Steering: ${steering.length}`);
        if (followUp.length > 0) lines.push(`  FollowUp: ${followUp.length}`);
        lines.push('');
      }
      break;
    }

    // Pi: 压缩
    case 'compaction_start': {
      lines.push('[Compaction Start]');
      lines.push(`  Reason: ${parsed.reason || ''}`);
      lines.push('');
      break;
    }
    case 'compaction_end': {
      lines.push('[Compaction End]');
      lines.push(`  Reason: ${parsed.reason || ''}`);
      lines.push(`  Aborted: ${parsed.aborted === true}`);
      lines.push(`  WillRetry: ${parsed.willRetry === true}`);
      if (parsed.errorMessage) lines.push(`  Error: ${parsed.errorMessage}`);
      lines.push('');
      break;
    }

    // Pi: 自动重试 / 总结重试
    case 'auto_retry_start': {
      lines.push(`[Auto Retry Start] attempt=${parsed.attempt || '?'}/${parsed.maxAttempts || '?'} delay=${parsed.delayMs || '?'}ms`);
      if (parsed.errorMessage) lines.push(`  Error: ${parsed.errorMessage}`);
      lines.push('');
      break;
    }
    case 'auto_retry_end': {
      lines.push(`[Auto Retry End] success=${parsed.success === true} attempt=${parsed.attempt || '?'}`);
      if (parsed.finalError) lines.push(`  Final error: ${parsed.finalError}`);
      lines.push('');
      break;
    }
    case 'summarization_retry_scheduled': {
      lines.push(`[Summary Retry Scheduled] attempt=${parsed.attempt || '?'}/${parsed.maxAttempts || '?'} delay=${parsed.delayMs || '?'}ms`);
      lines.push('');
      break;
    }
    case 'summarization_retry_attempt_start': {
      lines.push(`[Summary Retry Attempt Start] source=${parsed.source || ''}`);
      lines.push('');
      break;
    }
    case 'summarization_retry_finished': {
      lines.push('[Summary Retry Finished]');
      lines.push('');
      break;
    }

    // Pi: bash 执行流式输出
    case 'bash_execution_update': {
      lines.push('[Bash Update]');
      if (parsed.delta) {
        lines.push(truncate(parsed.delta, HOOK_OUTPUT_MAX_LENGTH));
      }
      lines.push('');
      break;
    }

    // Pi: 其他状态变更
    case 'thinking_level_changed': {
      lines.push(`[Thinking Level] ${parsed.level || ''}`);
      lines.push('');
      break;
    }
    case 'session_info_changed': {
      if (parsed.name !== undefined) {
        lines.push(`[Session Name] ${parsed.name || '(cleared)'}`);
        lines.push('');
      }
      break;
    }
    case 'entry_appended': {
      // session 持久化事件，verbose 中不展开
      break;
    }

    case 'tool_progress':
      lines.push(`[Tool Progress] ${parsed.tool_name || ''} (${parsed.elapsed_time_seconds || 0}s)`);
      lines.push('');
      break;

    case 'rate_limit_event': {
      const info = parsed.rate_limit_info;
      lines.push(`[Rate Limit] ${info?.status || 'unknown'} (type=${info?.rateLimitType || ''})`);
      lines.push('');
      break;
    }

    case 'auth_status':
      lines.push(`[Auth] ${parsed.isAuthenticating ? 'Authenticating...' : 'Authenticated'}`);
      lines.push('');
      break;

    // 已知但无需格式化的类型：静默忽略
    case 'control_request':
    case 'control_response':
    case 'control_cancel_request':
    case 'stream_event':
    case 'keep_alive':
    case 'streamlined_text':
    case 'streamlined_tool_use_summary':
      break;

    default:
      // 未知 type（或非 Claude 执行器的 JSON 输出）：原样输出原始行
      lines.push(line);
      break;
  }

  return {
    formatted: lines.length > 0 ? lines.join('\n') : null,
    finalResultText,
    assistantText,
    sessionId,
    isJsonParsed: true
  };
}
