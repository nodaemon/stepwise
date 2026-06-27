import { OutputFormat, JsonSchemaDef } from '../types';
import {
  buildJsonSchema,
  validateAgainstSchema,
  checkDuplicateKeys,
  getFirstRequiredField,
  SchemaValidationError,
  SchemaValidationResult,
  JsonSchema
} from './schemaUtils';

/** 校验结果 - 直接复用 SchemaValidationResult */
export type ValidationResult<T = unknown> = SchemaValidationResult<T>;

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
      path: '',
      message: 'JSON parse error',
      keyword: 'parse_error',
      params: {},
      data: error
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
          path: '',
          message: 'Expected array, got object with nested array',
          keyword: 'not_array',
          params: { nestedPath },
          data: null
        }]
      };
    }
    return {
      valid: false,
      errors: [{
        path: '',
        message: 'Expected array',
        keyword: 'not_array',
        params: { actualType: typeof parseResult.data },
        data: null
      }]
    };
  }

  const data = parseResult.data;
  const errors: SchemaValidationError[] = [];

  // 3. 使用 JSON Schema 校验（如果提供了 format）
  if (options.validateFields !== false && options.format && data.length > 0) {
    const schema = buildJsonSchema(options.format);
    const schemaResult = validateAgainstSchema<Record<string, any>[]>(data, schema);

    if (!schemaResult.valid) {
      // 直接使用 SchemaValidationError，不再转换
      errors.push(...schemaResult.errors);
    }

    // 4. 检查去重字段是否有重复
    if (errors.length === 0) {
      const dedupeKey = getFirstRequiredField(options.format);
      if (dedupeKey) {
        const dupCheck = checkDuplicateKeys(data, dedupeKey);
        if (dupCheck.hasDuplicates) {
          errors.push({
            path: '',
            message: `Duplicate values found in field "${dedupeKey}"`,
            keyword: 'duplicate_key',
            params: { field: dedupeKey },
            data: dupCheck.duplicates.slice(0, 5)
          });
        }
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
        path: '',
        message: 'Expected object',
        keyword: 'not_object',
        params: { actualType: Array.isArray(parseResult.data) ? 'array' : typeof parseResult.data },
        data: null
      }]
    };
  }

  const data = parseResult.data;
  const errors: SchemaValidationError[] = [];

  // 3. 必填字段校验（包括类型检查）
  for (const field of options.requiredFields) {
    if (!(field.name in data)) {
      errors.push({
        path: `/${field.name}`,
        message: 'missing required property',
        keyword: 'required',
        params: { missingProperty: field.name },
        data: undefined
      });
      continue;
    }

    const value = (data as Record<string, unknown>)[field.name];
    let typeValid = true;

    switch (field.type) {
      case 'string':
        typeValid = typeof value === 'string';
        break;
      case 'number':
        typeValid = typeof value === 'number' && !isNaN(value);
        break;
      case 'boolean':
        typeValid = typeof value === 'boolean';
        break;
      case 'object':
        typeValid = typeof value === 'object' && value !== null && !Array.isArray(value);
        break;
      case 'array':
        typeValid = Array.isArray(value);
        break;
    }

    if (!typeValid) {
      const actualType = Array.isArray(value) ? 'array' : (value === null ? 'null' : typeof value);
      errors.push({
        path: `/${field.name}`,
        message: `expected ${field.type}, got ${actualType}`,
        keyword: 'type',
        params: { expected: field.type, actual: actualType },
        data: value
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
  errors: SchemaValidationError[],
  outputPath: string,
  expectedFormat: 'array' | 'object'
): string {
  const errorDescriptions = errors.map(e => {
    let line = `- path: "${e.path}"`;
    line += `\n  message: ${e.message}`;
    line += `\n  keyword: ${e.keyword}`;
    if (e.data !== undefined) {
      line += `\n  data: ${JSON.stringify(e.data)}`;
    }
    return line;
  }).join('\n\n');

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

// ============ Schema 校验相关函数 ============

/**
 * 将 JsonSchemaDef 递归转换为 AJV 可用的 JsonSchema 格式
 * 如果 schema 包含 recursive: true，使用有限深度展开方式处理递归
 * @param schema JsonSchemaDef 定义
 * @returns AJV 兼容的 JsonSchema 对象
 */
export function convertToAjvSchema(schema: JsonSchemaDef): JsonSchema {
  // 递归树形结构：使用有限深度展开
  if (schema.recursive) {
    return unrollRecursiveSchema(schema);
  }

  const result: JsonSchema = {
    type: schema.type,
    ...(schema.description && { description: schema.description })
  };

  if (schema.type === 'object' && schema.properties) {
    result.properties = {};
    for (const [name, propDef] of Object.entries(schema.properties)) {
      result.properties[name] = convertToAjvSchema(propDef);
    }

    // 处理 required：如果 schema.required 指定，使用它；否则所有字段默认必填
    if (schema.required) {
      result.required = schema.required;
    } else {
      // 默认所有字段为必填（与现有 OutputFormat 行为一致）
      result.required = Object.keys(schema.properties);
    }
  }

  if (schema.type === 'array' && schema.items) {
    result.items = convertToAjvSchema(schema.items);
  }

  return result;
}

/**
 * 将递归树形 JsonSchemaDef 展开为有限深度的 AJV JsonSchema
 *
 * 展开策略：
 * - 第 1 层到第 (maxDepth-1) 层：节点完全展开，递归字段的 items 为下一层节点
 * - 第 maxDepth 层（叶子层）：递归字段的 items 放宽为 { type: 'object' }，允许叶子节点 children: []
 *
 * @param schema 递归 JsonSchemaDef（必须包含 recursive: true）
 * @returns 展开后的 AJV JsonSchema
 */
export function unrollRecursiveSchema(schema: JsonSchemaDef): JsonSchema {
  const maxDepth = schema.maxDepth ?? 3;
  return unrollLayer(schema, maxDepth, 1);
}

/**
 * 展开递归 schema 的单层
 *
 * @param nodeSchema 当前层节点 schema（包含递归标记）
 * @param maxDepth 最大递归深度
 * @param currentDepth 当前深度（从 1 开始）
 * @returns 展开后的 JsonSchema
 */
function unrollLayer(nodeSchema: JsonSchemaDef, maxDepth: number, currentDepth: number): JsonSchema {
  const result: JsonSchema = {
    type: 'object',
    ...(nodeSchema.description && { description: nodeSchema.description })
  };

  if (!nodeSchema.properties) {
    return result;
  }

  const recursiveFields = nodeSchema.recursiveFields || [];
  const isLeafLayer = currentDepth >= maxDepth;

  result.properties = {};
  for (const [name, propDef] of Object.entries(nodeSchema.properties)) {
    if (recursiveFields.includes(name)) {
      // 递归字段：根据当前深度决定 items
      if (isLeafLayer) {
        // 叶子层：items 放宽为 { type: 'object' }
        result.properties[name] = {
          type: 'array',
          items: { type: 'object' }
        };
      } else {
        // 中间层：items 为下一层节点展开
        result.properties[name] = {
          type: 'array',
          items: unrollLayer(nodeSchema, maxDepth, currentDepth + 1)
        };
      }
    } else {
      // 非递归字段：正常转换（可能自身也是嵌套结构）
      result.properties[name] = convertToAjvSchema(propDef);
    }
  }

  // 处理 required
  if (nodeSchema.required) {
    result.required = nodeSchema.required;
  } else if (nodeSchema.properties) {
    result.required = Object.keys(nodeSchema.properties);
  }

  return result;
}

/**
 * 校验递归 schema 的合法性约束
 *
 * 6 条规则：
 * 1. recursive 仅在 type === 'object' 时有效
 * 2. recursiveFields 需要 recursive === true
 * 3. maxDepth 需要 recursive === true
 * 4. recursiveFields 中每个字段必须在 properties 中且为 type === 'array'
 * 5. recursiveFields 中每个字段不应定义 items
 * 6. maxDepth 必须在 1~10 范围内
 *
 * @param schema 待校验的 JsonSchemaDef
 * @throws Error 校验失败时抛出描述性错误
 */
export function validateRecursiveSchema(schema: JsonSchemaDef): void {
  const prefix = '[StepWise.execPromptSchema]';

  // 规则 1：recursive 仅在 type === 'object' 时有效
  if (schema.recursive && schema.type !== 'object') {
    throw new Error(`${prefix} recursive 仅在 type="object" 时有效，当前 type="${schema.type}"`);
  }

  // 规则 2：recursiveFields 需要 recursive === true
  if (schema.recursiveFields && schema.recursiveFields.length > 0 && !schema.recursive) {
    throw new Error(`${prefix} recursiveFields 需要 recursive=true`);
  }

  // 规则 3：maxDepth 需要 recursive === true
  if (schema.maxDepth !== undefined && !schema.recursive) {
    throw new Error(`${prefix} maxDepth 需要 recursive=true`);
  }

  // 以下规则仅在 recursive === true 时校验
  if (schema.recursive) {
    const recursiveFields = schema.recursiveFields || [];

    if (recursiveFields.length === 0) {
      throw new Error(`${prefix} recursive=true 时必须指定至少一个 recursiveFields`);
    }

    if (!schema.properties) {
      throw new Error(`${prefix} recursive=true 时必须定义 properties`);
    }

    // 规则 4：recursiveFields 中每个字段必须是 type === 'array'
    for (const fieldName of recursiveFields) {
      const propDef = schema.properties[fieldName];
      if (!propDef) {
        throw new Error(`${prefix} recursiveFields 中的 "${fieldName}" 不在 properties 中`);
      }
      if (propDef.type !== 'array') {
        throw new Error(`${prefix} recursiveFields 中的 "${fieldName}" 必须是 type="array"，当前 type="${propDef.type}"`);
      }

      // 规则 5：recursiveFields 中每个字段不应定义 items
      if (propDef.items !== undefined) {
        throw new Error(`${prefix} recursiveFields 中的 "${fieldName}" 不应定义 items，框架在展开时自动填充`);
      }
    }

    // 规则 6：maxDepth 必须在 1~10 范围内
    if (schema.maxDepth !== undefined) {
      if (schema.maxDepth < 1 || schema.maxDepth > 10) {
        throw new Error(`${prefix} maxDepth 必须在 1~10 范围内，当前值为 ${schema.maxDepth}`);
      }
    }
  }
}

/**
 * 校验 JSON 内容是否符合 JsonSchemaDef 定义
 * @param content JSON 文件内容字符串
 * @param schema JsonSchemaDef 定义
 * @returns 校验结果
 */
export function validateJsonBySchema(
  content: string,
  schema: JsonSchemaDef
): ValidationResult<unknown> {
  // 1. JSON 解析
  const parseResult = tryParseJson(content);
  if (!parseResult.success) {
    return createParseErrorResult(parseResult.error);
  }

  // 2. 使用 AJV 校验
  const ajvSchema = convertToAjvSchema(schema);
  return validateAgainstSchema(parseResult.data, ajvSchema);
}

/**
 * 生成 Schema 校验失败的修复提示词
 *
 * 当 execPromptSchema 输出的 JSON 不符合 Schema 时，
 * 生成包含完整 Schema 结构和正确格式示例的修复提示词
 *
 * @param errors 校验错误列表
 * @param outputPath 需要修复的 JSON 文件路径
 * @param schema 期望的 JsonSchemaDef 结构定义
 * @returns 修复提示词字符串
 */
export function buildSchemaFixPrompt(
  errors: SchemaValidationError[],
  outputPath: string,
  schema: JsonSchemaDef
): string {
  const errorDescriptions = errors.map(e => {
    let line = `- 路径: "${e.path}"`;
    line += `\n  错误: ${e.message}`;
    line += `\n  类型: ${e.keyword}`;
    if (e.data !== undefined) {
      line += `\n  实际值: ${JSON.stringify(e.data)}`;
    }
    return line;
  }).join('\n\n');

  // 生成正确格式示例
  const formatExample = generateSchemaExample(schema);

  // 递归树形结构特定说明
  let recursiveNote = '';
  if (schema.recursive) {
    const maxDepth = schema.maxDepth ?? 3;
    const recursiveFields = schema.recursiveFields || [];
    recursiveNote = `
## 递归结构说明

这是一个递归树形结构，最大深度为 ${maxDepth} 层。
- 递归字段（${recursiveFields.join(', ')}）在中间层包含下一层节点数组
- 叶子节点（最深层）的递归字段必须为空数组，如 ${recursiveFields[0] || 'children'}: []
`;
  }

  return `输出数据校验失败，请根据以下错误信息修复 JSON 文件：

## 错误信息
${errorDescriptions}
${recursiveNote}
## 期望的 Schema 结构
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

## 正确格式示例
\`\`\`json
${JSON.stringify(formatExample, null, 2)}
\`\`\`

## 修复要求
1. 读取文件 ${outputPath} 查看当前内容
2. 根据错误信息修复 JSON 格式
3. 确保输出直接符合 Schema 结构（不要额外包裹）
4. 修复后重新写入文件
5. 使用 Read 工具验证修复结果`;
}

/**
 * 生成 Schema 示例数据
 * 用于 buildSchemaFixPrompt 和 buildSchemaPrompt 中的示例展示
 * 支持递归树形结构：按最大深度展开，叶子节点递归字段为空数组
 */
export function generateSchemaExample(schema: JsonSchemaDef, currentDepth?: number): unknown {
  // 递归树形结构处理
  if (schema.recursive && currentDepth === undefined) {
    return generateRecursiveExample(schema, schema.maxDepth ?? 3, 1);
  }

  if (schema.type === 'string') {
    return schema.description || '示例字符串';
  }

  if (schema.type === 'number') {
    return 0;
  }

  if (schema.type === 'boolean') {
    return true;
  }

  if (schema.type === 'object') {
    const obj: Record<string, unknown> = {};
    if (schema.properties) {
      for (const [name, propDef] of Object.entries(schema.properties)) {
        obj[name] = generateSchemaExample(propDef);
      }
    }
    return obj;
  }

  if (schema.type === 'array') {
    if (schema.items) {
      return [generateSchemaExample(schema.items)];
    }
    return [];
  }

  return null;
}

/**
 * 生成递归树形结构的示例数据
 *
 * @param nodeSchema 递归节点 schema
 * @param maxDepth 最大递归深度
 * @param currentDepth 当前深度（从 1 开始）
 * @returns 示例数据对象
 */
function generateRecursiveExample(nodeSchema: JsonSchemaDef, maxDepth: number, currentDepth: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const recursiveFields = nodeSchema.recursiveFields || [];
  const isLeafLayer = currentDepth >= maxDepth;

  if (nodeSchema.properties) {
    for (const [name, propDef] of Object.entries(nodeSchema.properties)) {
      if (recursiveFields.includes(name)) {
        // 递归字段
        if (isLeafLayer) {
          // 叶子节点：递归字段为空数组
          obj[name] = [];
        } else {
          // 中间节点：递归字段包含下一层节点
          obj[name] = [generateRecursiveExample(nodeSchema, maxDepth, currentDepth + 1)];
        }
      } else {
        // 非递归字段：正常生成
        obj[name] = generateSchemaExample(propDef);
      }
    }
  }

  return obj;
}