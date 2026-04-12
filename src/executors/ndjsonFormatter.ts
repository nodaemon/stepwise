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
}

/** 工具输入参数截断阈值 */
const TOOL_INPUT_MAX_LENGTH = 200;
/** 工具结果截断阈值 */
const TOOL_RESULT_MAX_LENGTH = 5000;
/** Hook 输出截断阈值 */
const HOOK_OUTPUT_MAX_LENGTH = 300;

/**
 * 截断字符串，超长时显示省略信息
 */
function truncate(text: string, maxLength: number): string {
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
  }

  return {
    finalResultText,
    lastAssistantText,
    formattedTranscript: transcriptLines.join('\n'),
    parsedSuccessfully: parsedAnyLine,
    parseErrors
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
    return { formatted: null, finalResultText: null, assistantText: null, isJsonParsed: false };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { formatted: null, finalResultText: null, assistantText: null, isJsonParsed: false };
  }

  const lines: string[] = [];
  let finalResultText: string | null = null;
  let assistantText: string | null = null;

  switch (parsed.type) {
    case 'system': {
      const subtype = parsed.subtype;
      switch (subtype) {
        case 'init':
          lines.push('--- Session Init ---');
          if (parsed.model) lines.push(`Model: ${parsed.model}`);
          if (parsed.session_id) lines.push(`Session: ${parsed.session_id}`);
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
        default:
          // 未知 subtype：静默忽略
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

    // 静默忽略：control_request, control_response, control_cancel_request,
    // stream_event, keep_alive, streamlined_text, streamlined_tool_use_summary
  }

  return {
    formatted: lines.length > 0 ? lines.join('\n') : null,
    finalResultText,
    assistantText,
    isJsonParsed: true
  };
}
