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
 * 解析并格式化 NDJSON 输出
 *
 * @param rawStdout Claude Code --verbose --output-format=stream-json 的 stdout 输出
 * @returns 解析结果，包含最终文本、过程日志等
 */
export function parseAndFormatNDJson(rawStdout: string): ParsedNDJsonResult {
  const parseErrors: string[] = [];
  const transcriptLines: string[] = [];

  let finalResultText = '';
  let lastAssistantText = '';
  let parsedAnyLine = false;

  const lines = rawStdout.split('\n').filter(line => line.trim() !== '');

  for (let i = 0; i < lines.length; i++) {
    let parsed: any;
    try {
      parsed = JSON.parse(lines[i]);
    } catch {
      parseErrors.push(`Line ${i + 1}: invalid JSON`);
      continue;
    }

    parsedAnyLine = true;

    switch (parsed.type) {
      case 'system': {
        if (parsed.subtype === 'init') {
          transcriptLines.push('--- Session Init ---');
          if (parsed.model) transcriptLines.push(`Model: ${parsed.model}`);
          if (parsed.session_id) transcriptLines.push(`Session: ${parsed.session_id}`);
          transcriptLines.push('');
        }
        break;
      }

      case 'assistant': {
        const content = parsed.message?.content;
        if (!Array.isArray(content)) break;

        for (const block of content) {
          if (!block || typeof block !== 'object') continue;

          switch (block.type) {
            case 'thinking': {
              const thinkingText = block.thinking || '';
              if (thinkingText) {
                transcriptLines.push('[Thinking]');
                transcriptLines.push(thinkingText);
                transcriptLines.push('[/Thinking]');
                transcriptLines.push('');
              }
              break;
            }

            case 'text': {
              const text = block.text || '';
              if (text) {
                transcriptLines.push(text);
                transcriptLines.push('');
                lastAssistantText = text;
              }
              break;
            }

            case 'tool_use': {
              const toolName = block.name || 'Unknown';
              const toolInput = block.input || {};
              transcriptLines.push(`[${toolName}]`);
              transcriptLines.push(formatToolInput(toolName, toolInput));
              transcriptLines.push('');
              break;
            }
          }
        }
        break;
      }

      case 'user': {
        const content = parsed.message?.content;
        if (!Array.isArray(content)) break;

        for (const block of content) {
          if (!block || typeof block !== 'object') continue;

          if (block.type === 'tool_result') {
            const resultContent = extractToolResultContent(block.content);
            transcriptLines.push('[Tool Result]');
            transcriptLines.push(`  ${truncate(resultContent, TOOL_RESULT_MAX_LENGTH)}`);
            transcriptLines.push('[/Tool Result]');
            transcriptLines.push('');
          }
        }
        break;
      }

      case 'result': {
        const resultText = parsed.result || '';
        if (resultText) {
          finalResultText = resultText;
        }

        transcriptLines.push('--- Result ---');
        transcriptLines.push(finalResultText || lastAssistantText || '(no result)');
        if (parsed.duration_ms !== undefined) {
          const durationSec = (parsed.duration_ms / 1000).toFixed(1);
          transcriptLines.push(`Duration: ${durationSec}s` +
            (parsed.total_cost_usd !== undefined ? ` | Cost: $${parsed.total_cost_usd.toFixed(4)}` : ''));
        }
        transcriptLines.push('');
        break;
      }
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
