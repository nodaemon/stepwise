import { OutputFormat } from '../types';

/** 校验错误类型 */
export type ValidationErrorType =
  | 'parse_error'       // JSON 解析失败
  | 'not_array'         // 不是数组
  | 'not_object'        // 不是对象
  | 'missing_field'     // 缺少字段
  | 'type_mismatch';    // 类型不匹配

/** 校验错误 */
export interface ValidationError {
  type: ValidationErrorType;
  message: string;
  details?: string;
}

/** 校验结果 */
export interface ValidationResult<T = unknown> {
  valid: boolean;
  errors: ValidationError[];
  data?: T;
}

/** 数组校验选项 */
export interface ArrayValidateOptions {
  format?: OutputFormat;
  validateFields?: boolean;
}

/** 对象校验选项 */
export interface ObjectValidateOptions {
  requiredFields: Array<{ name: string; type: 'string' | 'number' | 'boolean' | 'object' | 'array' }>;
}

/**
 * 尝试解析 JSON 字符串
 * @returns 解析成功返回 { success: true, data }，失败返回 { success: false, error }
 */
function tryParseJson(content: string): { success: true; data: unknown } | { success: false; error: string } {
  try {
    return { success: true, data: JSON.parse(content) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 创建解析错误结果 */
function createParseErrorResult(error: string): ValidationResult<never> {
  return {
    valid: false,
    errors: [{
      type: 'parse_error',
      message: 'JSON 格式错误，无法解析',
      details: error
    }]
  };
}

/**
 * 校验 JSON 文件内容是否为数组
 */
export function validateJsonArray(
  content: string,
  options: ArrayValidateOptions = {}
): ValidationResult<Record<string, any>[]> {
  // 1. JSON 解析
  const parseResult = tryParseJson(content);
  if (!parseResult.success) {
    return createParseErrorResult(parseResult.error);
  }

  // 2. 数组格式校验
  if (!Array.isArray(parseResult.data)) {
    const nestedPath = findNestedArray(parseResult.data);
    if (nestedPath) {
      return {
        valid: false,
        errors: [{
          type: 'not_array',
          message: `JSON 不是数组格式，检测到嵌套结构: "${nestedPath}"`,
          details: `请直接输出数组 [ ... ]，而非 { "${nestedPath}": [ ... ] }`
        }]
      };
    }
    return {
      valid: false,
      errors: [{
        type: 'not_array',
        message: 'JSON 不是数组格式',
        details: `期望: [ ... ]，实际类型: ${typeof parseResult.data}`
      }]
    };
  }

  const data = parseResult.data;
  const errors: ValidationError[] = [];

  // 3. 字段校验（可选）
  if (options.validateFields !== false && options.format && data.length > 0) {
    const firstItem = data[0];
    for (const key of options.format.keys) {
      if (!(key.name in firstItem)) {
        errors.push({
          type: 'missing_field',
          message: `缺少必填字段: "${key.name}"`,
          details: `字段描述: ${key.description}`
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: errors.length === 0 ? data : undefined
  };
}

/**
 * 校验 JSON 文件内容是否为指定格式的对象
 */
export function validateJsonObject<T extends Record<string, any>>(
  content: string,
  options: ObjectValidateOptions
): ValidationResult<T> {
  // 1. JSON 解析
  const parseResult = tryParseJson(content);
  if (!parseResult.success) {
    return createParseErrorResult(parseResult.error);
  }

  // 2. 对象格式校验
  if (typeof parseResult.data !== 'object' || parseResult.data === null || Array.isArray(parseResult.data)) {
    return {
      valid: false,
      errors: [{
        type: 'not_object',
        message: 'JSON 不是对象格式',
        details: `期望: { ... }，实际类型: ${Array.isArray(parseResult.data) ? 'array' : typeof parseResult.data}`
      }]
    };
  }

  const data = parseResult.data;
  const errors: ValidationError[] = [];

  // 3. 必填字段校验
  for (const field of options.requiredFields) {
    if (!(field.name in data)) {
      errors.push({
        type: 'missing_field',
        message: `缺少必填字段: "${field.name}"`,
        details: `期望类型: ${field.type}`
      });
    } else if (field.type === 'boolean' && typeof (data as Record<string, unknown>)[field.name] !== 'boolean') {
      errors.push({
        type: 'type_mismatch',
        message: `字段 "${field.name}" 类型错误`,
        details: `期望: ${field.type}，实际: ${typeof (data as Record<string, unknown>)[field.name]}`
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: errors.length === 0 ? (data as T) : undefined
  };
}

/**
 * 查找嵌套数组路径
 */
function findNestedArray(obj: unknown, path: string = ''): string | null {
  if (typeof obj !== 'object' || obj === null) return null;

  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      return path ? `${path}.${key}` : key;
    }
    if (typeof value === 'object' && value !== null) {
      const found = findNestedArray(value, path ? `${path}.${key}` : key);
      if (found) return found;
    }
  }
  return null;
}

/**
 * 生成修复提示词
 *
 * 当 AI 输出的 JSON 格式不正确时，生成一个提示词让 AI 修复文件。
 * 这个提示词会通过 executor.execute() 执行，作为重试机制的一部分。
 *
 * @param errors 校验错误列表
 * @param outputPath 需要修复的 JSON 文件路径
 * @param expectedFormat 期望的 JSON 格式：'array' 或 'object'
 * @returns 修复提示词字符串
 */
export function buildFixPrompt(
  errors: ValidationError[],
  outputPath: string,
  expectedFormat: 'array' | 'object'
): string {
  const errorDescriptions = errors.map(e =>
    `- ${e.message}${e.details ? `\n  ${e.details}` : ''}`
  ).join('\n');

  const formatExample = expectedFormat === 'array'
    ? '[\n  { "field1": "value1", "field2": "value2" },\n  { "field1": "value3", "field2": "value4" }\n]'
    : '{ "result": true }';

  return `上一次输出校验失败，请根据以下错误信息修复 JSON 文件：

## 错误信息
${errorDescriptions}

## 正确格式示例
\`\`\`json
${formatExample}
\`\`\`

## 修复要求
1. 读取文件 ${outputPath} 查看当前内容
2. 根据错误信息修复 JSON 格式
3. 确保输出为标准 JSON 格式
4. 不要使用嵌套结构
5. 修复后重新写入文件
6. 使用 Read 工具验证修复结果`;
}
