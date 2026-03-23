import Ajv, { ErrorObject } from 'ajv';
import { OutputFormat } from '../types';

// 创建 AJV 实例（单例）
const ajv = new Ajv({
  allErrors: true,      // 显示所有错误
  strict: false,        // 允许非标准关键字（如 description）
});

/**
 * JSON Schema 类型定义
 */
export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema | { type: string; description?: string }>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
}

/**
 * JSON Schema 校验错误
 * 直接映射 AJV ErrorObject，保留完整的原始信息
 */
export interface SchemaValidationError {
  /** AJV 实例路径，如 "/0/name" */
  path: string;
  /** AJV 原始错误消息（英文） */
  message: string;
  /** AJV 错误关键字，如 'required'、'type'、'additionalProperties' 等 */
  keyword: string;
  /** AJV 错误参数 */
  params: Record<string, unknown>;
  /** 实际的数据值 */
  data: unknown;
}

/**
 * JSON Schema 校验结果
 */
export interface SchemaValidationResult<T> {
  valid: boolean;
  data?: T;
  errors: SchemaValidationError[];
}

/**
 * 将 OutputFormat 转换为 JSON Schema
 * @param format 输出格式定义（直接是 Record<string, PropertyDef>）
 * @returns JSON Schema 对象
 */
export function buildJsonSchema(format: OutputFormat): JsonSchema {
  const required: string[] = [];
  const properties: Record<string, { type: string; description?: string }> = {};

  for (const [name, def] of Object.entries(format)) {
    properties[name] = {
      type: def.type,
      ...(def.description && { description: def.description })
    };
    // required 默认为 true，只有显式设置为 false 时才不是必填
    if (def.required !== false) {
      required.push(name);
    }
  }

  return {
    type: 'array',
    items: {
      type: 'object',
      properties,
      ...(required.length > 0 && { required })
    }
  };
}

/**
 * 获取第一个 required 字段作为去重 key
 * @param format 输出格式定义（直接是 Record<string, PropertyDef>）
 * @returns 第一个必填字段名，如果没有则返回 null
 */
export function getFirstRequiredField(format: OutputFormat): string | null {
  // 找第一个 required 字段
  for (const [name, def] of Object.entries(format)) {
    if (def.required !== false) {
      return name;
    }
  }
  return null;
}

/**
 * 获取所有必填字段列表
 * @param format 输出格式定义（直接是 Record<string, PropertyDef>）
 * @returns 必填字段名数组
 */
export function getRequiredFields(format: OutputFormat): string[] {
  const required: string[] = [];
  for (const [name, def] of Object.entries(format)) {
    if (def.required !== false) {
      required.push(name);
    }
  }
  return required;
}

/**
 * 校验数据中指定字段是否有重复
 * @param data 数据数组
 * @param keyField 用于去重的字段名
 * @returns 是否有重复及重复值列表
 */
export function checkDuplicateKeys(
  data: Record<string, unknown>[],
  keyField: string
): { hasDuplicates: boolean; duplicates: unknown[] } {
  const seen = new Set<unknown>();
  const duplicates: unknown[] = [];

  for (const item of data) {
    const key = item[keyField];
    if (key !== undefined && key !== null) {
      if (seen.has(key)) {
        duplicates.push(key);
      } else {
        seen.add(key);
      }
    }
  }

  return { hasDuplicates: duplicates.length > 0, duplicates };
}

/**
 * 使用 JSON Schema 校验数据（基于 AJV）
 * @param data 待校验的数据
 * @param schema JSON Schema
 * @returns 校验结果
 */
export function validateAgainstSchema<T = Record<string, unknown>[]>(
  data: unknown,
  schema: JsonSchema
): SchemaValidationResult<T> {
  const validate = ajv.compile(schema);
  const valid = validate(data);

  if (valid) {
    return { valid: true, data: data as T, errors: [] };
  }

  // 直接映射 AJV 错误，不做格式化
  const errors: SchemaValidationError[] = (validate.errors || []).map((err: ErrorObject) => ({
    path: err.instancePath,
    message: err.message || 'Validation failed',
    keyword: err.keyword,
    params: err.params as Record<string, unknown>,
    data: err.data
  }));

  return { valid: false, errors };
}

/**
 * 格式化校验错误为可读字符串
 * @param errors 错误列表
 * @returns 格式化后的错误字符串
 */
export function formatValidationErrors(errors: SchemaValidationError[]): string {
  return errors.map(e => {
    const path = e.path || '(root)';
    let msg = `${path}: ${e.message}`;
    if (e.data !== undefined) {
      const dataStr = typeof e.data === 'object'
        ? JSON.stringify(e.data).slice(0, 100)
        : String(e.data).slice(0, 100);
      msg += `, data: ${dataStr}`;
    }
    return msg;
  }).join('\n');
}