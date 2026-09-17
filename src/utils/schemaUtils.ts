import Ajv, { ErrorObject } from 'ajv';
import { OutputFormat, PropertyDef, JsonSchemaDef } from '../types';

// 创建 AJV 实例（单例）
const ajv = new Ajv({
  allErrors: true,      // 显示所有错误
  strict: false,        // 允许非标准关键字（如 description）
});

/**
 * JSON Schema 类型定义
 */
export interface JsonSchema {
  /** 字段类型（$ref 节点可省略，结构由所引用的 $defs 组件决定） */
  type?: string;
  properties?: Record<string, JsonSchema | { type: string; description?: string }>;
  required?: string[];
  /** 单值：同构数组元素；数组：draft-07 元组形式（按位置校验） */
  items?: JsonSchema | JsonSchema[];
  /** 元组形式下与 maxItems 一起钉死数组长度 */
  minItems?: number;
  maxItems?: number;
  /** 固定值约束（AJV 原生关键字，透传） */
  const?: string | number | boolean;
  description?: string;
  /** JSON Schema 标准 $defs（AJV 8 原生关键字，透传） */
  $defs?: Record<string, JsonSchema>;
  /** JSON Schema 标准 $ref（AJV 8 原生关键字，透传） */
  $ref?: string;
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
 * @remarks OutputFormat 是扁平的 Record<string, PropertyDef>，没有顶层容器的位置放 $defs。
 * 约定：任一字段携带 defs 时，合并进产物的 $defs（多字段都带 defs 时按序合并，
 * 重名后者优先并 console.warn）。字段携带 ref 时透传为标准 $ref（仅发射 $ref 节点，
 * 不带 type —— AJV 中 type + $ref 是 AND 语义）。因 PropertyDef 无 items 槽位，
 * array 字段收集的 defs 组件按"数组元素"语义包装为 { type: 'array', items: ... }，
 * 使属性层 $ref 解析后可直接校验数组数据。
 */
export function buildJsonSchema(format: OutputFormat): JsonSchema {
  const required: string[] = [];
  const properties: Record<string, JsonSchema | { type: string; description?: string }> = {};
  const collectedDefs: Record<string, JsonSchema> = {};

  for (const [name, def] of Object.entries(format)) {
    // ref 透传为标准 $ref（AJV 8 原生支持）
    if (def.ref !== undefined) {
      properties[name] = { $ref: def.ref };
    } else {
      properties[name] = {
        type: def.type,
        ...(def.description && { description: def.description })
      };
    }

    // 字段携带 defs 时收集合并（仅顶层 OutputFormat 有效）
    if (def.defs) {
      for (const [defName, defSchema] of Object.entries(def.defs)) {
        if (defName in collectedDefs) {
          console.warn(`[StepWise] OutputFormat 多个字段定义了同名 defs "${defName}"，后者覆盖前者`);
        }
        const converted = propertyDefToAjvSchema(defSchema);
        // PropertyDef 无 items 槽位：array 字段的 defs 组件按"数组元素"语义包装，
        // 使属性层 $ref（如 '#/$defs/Dep'）解析后可直接校验数组数据
        collectedDefs[defName] = def.type === 'array'
          ? { type: 'array', items: converted }
          : converted;
      }
    }

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
    },
    ...(Object.keys(collectedDefs).length > 0 && { $defs: collectedDefs })
  };
}

/** PropertyDef → AJV JSON Schema（处理嵌套 ref/defs，供 buildJsonSchema 的 defs 组件转换） */
function propertyDefToAjvSchema(def: PropertyDef): JsonSchema {
  if (def.ref !== undefined) {
    return { $ref: def.ref };
  }
  if (def.type === 'array') {
    // PropertyDef 无 items 概念（扁平结构），array 视为 string[] 兜底
    return { type: 'array', items: { type: 'string' } };
  }
  if (def.type === 'object') {
    // 嵌套 properties 存在时递归转换（与 buildJsonSchema 同样的 ref/defs 约定）；
    // PropertyDef 类型本身无 properties 槽位，调用方以扩展字段传入，此处经局部类型收窄读取
    const nested = (def as PropertyDef & { properties?: Record<string, PropertyDef> }).properties;
    if (nested) {
      const nestedProps: Record<string, JsonSchema> = {};
      const nestedRequired: string[] = [];
      for (const [n, pd] of Object.entries(nested)) {
        nestedProps[n] = propertyDefToAjvSchema(pd);
        if (pd.required !== false) {
          nestedRequired.push(n);
        }
      }
      return {
        type: 'object',
        properties: nestedProps,
        ...(nestedRequired.length > 0 && { required: nestedRequired })
      };
    }
    return { type: 'object' };
  }
  return { type: def.type, ...(def.description && { description: def.description }) };
}

/**
 * 生成 schema 的去重渲染 JSON
 * 含 defs 时：$defs 组件全文渲染一次，引用点保留 $ref 标记（模型按名称回查 $defs）
 * 不含 defs 时：等价 JSON.stringify(schema)
 * 注意：ref 在渲染时保持 '#/$defs/X' 原样（与标准 JSON Schema 一致），
 * 但键名 ref → $ref 以匹配模型熟悉的引用语法
 *
 * @param schema 用户原始 def（含 defs/ref 简写）
 * @returns 去重后的紧凑 JSON 字符串
 */
export function expandRefs(schema: JsonSchemaDef): string {
  if (!schema.defs) {
    return JSON.stringify(schema);
  }

  const { defs, ...rest } = schema;

  const toStandard = (node: JsonSchemaDef): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (node.ref !== undefined) {
      out.$ref = node.ref;
      if (node.description) out.description = node.description;
      return out;
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'type' || k === 'description' || k === 'properties' ||
          k === 'required' || k === 'items' || k === 'prefixItems' ||
          k === 'const' || k === 'recursive' || k === 'recursiveFields' || k === 'maxDepth') {
        if (k === 'properties' && v && typeof v === 'object') {
          const props: Record<string, unknown> = {};
          for (const [pn, pd] of Object.entries(v as Record<string, JsonSchemaDef>)) {
            props[pn] = toStandard(pd);
          }
          out.properties = props;
        } else if (k === 'items' && v && typeof v === 'object') {
          out.items = toStandard(v as JsonSchemaDef);
        } else if (k === 'prefixItems' && Array.isArray(v)) {
          out.prefixItems = v.map(c => toStandard(c));
        } else {
          out[k] = v;
        }
      }
    }
    return out;
  };

  const standardDefs: Record<string, unknown> = {};
  for (const [name, def] of Object.entries(defs)) {
    standardDefs[name] = toStandard(def);
  }

  return JSON.stringify({ ...toStandard(rest), $defs: standardDefs });
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