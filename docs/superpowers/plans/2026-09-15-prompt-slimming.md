# 提示词膨胀优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过删冗余（结构说明/递归示例展开/缩进）与标准 `$defs`/`$ref` 子结构复用，将 schema 类 prompt 体积降低 60%~93%。

**Architecture:** 四项优化作用在两条管线：① 删「结构说明」小节；② 递归示例单节点化；③ schema JSON 紧凑化——都改 promptBuilder/validator 的渲染输出；④ `$defs`/`$ref`——类型加 `defs`/`ref` 字段，校验走 `convertToAjvSchema` 扩展（映射为标准 `$defs`/`$ref`，AJV 8.18 原生支持），prompt 渲染走 `expandRefs` 去重视图。useSkill 已完成设计评审但本次不实现（见 spec 附录）。

**Tech Stack:** TypeScript / Jest / AJV 8.18（已验证原生 `$defs`+`$ref`+自引用递归）

**Spec:** `docs/superpowers/specs/2026-09-15-prompt-slimming-design.md`

## Global Constraints

- 不加向后兼容开关，直接替换新格式，存量测试同步修正
- `generateSchemaDescription` 函数保留（测试引用），只从 prompt 输出移除
- `recursive`/`recursiveFields` 现有机制完整保留，向后兼容
- 同一字段/schema 上 recursive 机制与 ref/defs 混用抛异常
- ref 字段白名单：仅允许 `ref` + `description`，其它字段出现即抛异常
- $defs 内自引用递归合法（AJV 惰性解引用），组件间循环引用（非自引用链）抛异常
- 所有 ref/defs 校验发生在构建期（prompt 发出前）
- 测试命令：`npx jest tests/<file>.test.ts`；全量 `npm test`
- 提交信息格式沿用 `feat:/test:/fix:/refactor:` 前缀，结尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- `JsonSchema` 接口（schemaUtils.ts）需加 `$defs`/`$ref` 透传字段（AJV 关键字）

---

### Task 1: JsonSchemaDef/PropertyDef/JsonSchema 类型扩展

**Files:**
- Modify: `src/types.ts`（JsonSchemaDef 约 90-160 行区间、PropertyDef 约 75-86 行）
- Modify: `src/utils/schemaUtils.ts:11-25`（JsonSchema 接口）
- Test: `tests/defsRef.test.ts`（新建）

**Interfaces:**
- Produces: `JsonSchemaDef.defs?: Record<string, JsonSchemaDef>`、`JsonSchemaDef.ref?: string`、`PropertyDef.defs?/ref?`（同型）、`JsonSchema.$defs?: Record<string, JsonSchema>`、`JsonSchema.$ref?: string`。后续所有任务依赖这些字段名。

- [ ] **Step 1: 写失败测试**

新建 `tests/defsRef.test.ts`：

```typescript
import { JsonSchemaDef } from '../src/types';
import { buildJsonSchema, convertToAjvSchema } from '../src/utils/schemaUtils';
import { validateJsonBySchema } from '../src/utils/validator';
import { OutputFormat } from '../src/types';

describe('defs/ref 类型扩展', () => {
  test('JsonSchemaDef 接受 defs 和 ref 字段（编译期）', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: {
        Dependency: { type: 'object', properties: { module: { type: 'string' } } }
      },
      properties: {
        deps: { type: 'array', items: { ref: '#/$defs/Dependency' } }
      }
    };
    expect(schema.defs).toBeDefined();
    expect(schema.properties?.deps.items?.ref).toBe('#/$defs/Dependency');
  });

  test('PropertyDef 接受 defs 和 ref 字段（编译期）', () => {
    const format: OutputFormat = {
      deps: { type: 'array', ref: '#/$defs/Dependency' }
    };
    expect(format.deps.ref).toBe('#/$defs/Dependency');
  });

  test('convertToAjvSchema 将 ref/defs 映射为标准 $ref/$defs 且 AJV 可编译校验', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: {
        Dependency: {
          type: 'object',
          properties: { module: { type: 'string' }, circular: { type: 'boolean' } }
        }
      },
      properties: {
        deps: { type: 'array', items: { ref: '#/$defs/Dependency' } }
      }
    };
    const ajvSchema = convertToAjvSchema(schema) as any;
    expect(ajvSchema.$defs).toBeDefined();
    expect(ajvSchema.$defs.Dependency).toBeDefined();
    expect(ajvSchema.properties.deps.items.$ref).toBe('#/$defs/Dependency');

    // AJV 端到端
    const ok = { deps: [{ module: 'a', circular: false }] };
    const bad = { deps: [{ module: 'a', circular: 'no' }] };
    const good = validateJsonBySchema(JSON.stringify(ok), schema);
    const badResult = validateJsonBySchema(JSON.stringify(bad), schema);
    expect(good.valid).toBe(true);
    expect(badResult.valid).toBe(false);
  });

  test('$defs 内自引用递归被 AJV 惰性支持', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: {
        TreeNode: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            children: { type: 'array', items: { ref: '#/$defs/TreeNode' } }
          }
        }
      },
      properties: {
        wbs: { type: 'array', items: { ref: '#/$defs/TreeNode' } }
      }
    };
    const deep = { wbs: [{ id: '1', children: [{ id: '1.1', children: [{ id: '1.1.1', children: [] }] }] }] };
    const result = validateJsonBySchema(JSON.stringify(deep), schema);
    expect(result.valid).toBe(true);
  });

  test('buildJsonSchema 支持 PropertyDef 的 ref/defs', () => {
    const format: OutputFormat = {
      deps: { type: 'array', ref: '#/$defs/Dep' },
      name: { type: 'string' }
    };
    // buildJsonSchema 的 ref 支持在 Task 3 实现；本测试先锁定类型层不报错
    const schema = buildJsonSchema(format);
    expect(schema).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/defsRef.test.ts`
Expected: FAIL（`ref`/`defs` 不是合法字段——TS 类型报错或断言 `$defs` undefined）

- [ ] **Step 3: 实现类型扩展**

`src/types.ts` JsonSchemaDef 接口（在 `maxDepth` 字段后追加）：

```typescript
  /**
   * 可复用子结构定义（仅顶层 schema 有效，嵌套层的 defs 被忽略 + console.warn）
   * 对应 JSON Schema 标准的 $defs；组件可互相 ref（含自引用递归），禁止循环引用（构建期检测）
   */
  defs?: Record<string, JsonSchemaDef>;

  /**
   * JSON Pointer 引用（如 '#/$defs/Dependency'）
   * 含 ref 的字段上仅允许 ref + description，其它字段出现即抛异常（白名单校验）
   */
  ref?: string;
```

PropertyDef 接口追加同样两个字段（注释相同，类型为 `PropertyDef`）：

```typescript
  /** 可复用子结构定义，语义同 JsonSchemaDef.defs（仅顶层 OutputFormat 有效） */
  defs?: Record<string, PropertyDef>;
  /** JSON Pointer 引用（如 '#/$defs/Dependency'），语义同 JsonSchemaDef.ref */
  ref?: string;
```

`src/utils/schemaUtils.ts` JsonSchema 接口追加：

```typescript
  /** JSON Schema 标准 $defs（AJV 8 原生关键字，透传） */
  $defs?: Record<string, JsonSchema>;
  /** JSON Schema 标准 $ref（AJV 8 原生关键字，透传） */
  $ref?: string;
```

- [ ] **Step 4: convertToAjvSchema 支持 ref/defs 映射**

`src/utils/schemaUtils.ts` 的 `convertToAjvSchema`——注意该函数实际在 `src/utils/validator.ts:288`，此处改 validator.ts：

```typescript
export function convertToAjvSchema(schema: JsonSchemaDef): JsonSchema {
  const result: JsonSchema = {
    type: schema.type,
    ...(schema.description && { description: schema.description }),
    ...(schema.const !== undefined && { const: schema.const }),
    // ref → 标准 $ref 透传（AJV 惰性解引用，支持自引用递归）
    ...(schema.ref !== undefined && { $ref: schema.ref })
  };

  // defs → 标准 $defs（仅顶层有效；嵌套层的 defs 在 Task 4 白名单校验中拦截，此处仅映射）
  if (schema.defs) {
    result.$defs = {};
    for (const [name, defSchema] of Object.entries(schema.defs)) {
      result.$defs[name] = convertToAjvSchema(defSchema);
    }
  }

  // ……后续 object/array 分支保持不变
```

- [ ] **Step 5: 运行测试通过**

Run: `npx jest tests/defsRef.test.ts`
Expected: PASS（5 个测试全绿）

- [ ] **Step 6: 全量回归**

Run: `npm test`
Expected: 全部 PASS（存量行为不变）

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/utils/schemaUtils.ts src/utils/validator.ts tests/defsRef.test.ts
git commit -m "feat: JsonSchemaDef/PropertyDef 支持 defs/ref 类型扩展，convertToAjvSchema 映射标准 \$defs/\$ref

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: ref/defs 构建期校验（白名单 + 互斥 + 循环引用 + 嵌套 defs 警告）

**Files:**
- Modify: `src/utils/validator.ts`（validateRecursiveSchema 附近新增函数）
- Modify: `src/StepWise.ts:1872-1876`（execPromptSchema 入口挂校验）与 `validateSchema`（约 2044-2140，嵌套 ref 透传）
- Test: `tests/defsRef.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 1 的 `JsonSchemaDef.ref/defs` 字段
- Produces: `validateRefsAndDefs(schema: JsonSchemaDef): void`（导出函数，抛异常报构建期错误）；`validateSchema` 对含 `ref` 的嵌套字段跳过常规校验并透传

- [ ] **Step 1: 写失败测试**

`tests/defsRef.test.ts` 追加：

```typescript
import { validateRefsAndDefs } from '../src/utils/validator';

describe('validateRefsAndDefs 构建期校验', () => {
  test('ref 字段带白名单外字段应抛异常', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: { Dep: { type: 'object', properties: { m: { type: 'string' } } } },
      properties: {
        deps: { type: 'array', ref: '#/$defs/Dep', items: { type: 'string' } } as any
      }
    };
    expect(() => validateRefsAndDefs(schema)).toThrow('仅允许 ref + description');
  });

  test('ref 指向不存在的 defs 应抛异常', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: { deps: { type: 'array', items: { ref: '#/$defs/NoExist' } } }
    };
    expect(() => validateRefsAndDefs(schema)).toThrow('NoExist');
  });

  test('组件间循环引用应抛异常并附引用链', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: {
        A: { type: 'object', properties: { b: { ref: '#/$defs/B' } } },
        B: { type: 'object', properties: { a: { ref: '#/$defs/A' } } }
      },
      properties: { x: { ref: '#/$defs/A' } }
    };
    expect(() => validateRefsAndDefs(schema)).toThrow('A -> B -> A');
  });

  test('$defs 内自引用递归合法（不抛异常）', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: {
        TreeNode: {
          type: 'object',
          properties: { children: { type: 'array', items: { ref: '#/$defs/TreeNode' } } }
        }
      },
      properties: { wbs: { type: 'array', items: { ref: '#/$defs/TreeNode' } } }
    };
    expect(() => validateRefsAndDefs(schema)).not.toThrow();
  });

  test('recursive 机制与 ref 在同一字段混用应抛异常', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      recursive: true,
      recursiveFields: ['children'],
      properties: {
        name: { type: 'string' },
        children: { type: 'array', ref: '#/$defs/X' } as any
      },
      defs: { X: { type: 'object', properties: { a: { type: 'string' } } } }
    };
    expect(() => validateRefsAndDefs(schema)).toThrow('recursive');
  });

  test('嵌套层 defs 被忽略并 console.warn', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        inner: {
          type: 'object',
          defs: { X: { type: 'object', properties: { a: { type: 'string' } } } },
          properties: { a: { type: 'string' } }
        }
      }
    };
    expect(() => validateRefsAndDefs(schema)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('defs'));
    warnSpy.mockRestore();
  });

  test('execPromptSchema 入口触发 validateRefsAndDefs（混用抛错端到端）', () => {
    // 挂到 StepWise.execPromptSchema 入口后验证
    const { StepWise } = require('../src/StepWise');
    const { setTaskName, _resetState } = require('../src/globalState');
    _resetState();
    setTaskName('DefsRefGateTest');
    const agent = new StepWise('DefsRefGateAgent');
    const schema: JsonSchemaDef = {
      type: 'object',
      recursive: true,
      recursiveFields: ['children'],
      properties: {
        name: { type: 'string' },
        children: { type: 'array', ref: '#/$defs/X' } as any
      },
      defs: { X: { type: 'object', properties: { a: { type: 'string' } } } }
    };
    expect(agent.execPromptSchema('test', schema, 'out.json')).rejects.toThrow('recursive');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/defsRef.test.ts`
Expected: 新增 7 个测试 FAIL（validateRefsAndDefs 未导出）

- [ ] **Step 3: 实现 validateRefsAndDefs**

`src/utils/validator.ts` 新增（validateRecursiveSchema 之后）：

```typescript
/** ref 字段白名单：仅允许 ref + description */
const REF_ALLOWED_KEYS = new Set(['ref', 'description']);

/**
 * 校验 ref/defs 的构建期合法性
 * 规则：
 * 1. ref 字段白名单：仅允许 ref + description
 * 2. ref 必须指向顶层 defs 中存在的组件（'#/$defs/<name>'）
 * 3. 组件间循环引用（非自引用）抛异常，附引用链
 * 4. recursive 机制与 ref/defs 同一 schema 混用抛异常
 * 5. 嵌套层 defs 忽略 + console.warn
 * 自引用递归（TreeNode.children -> TreeNode）合法：追踪引用链时
 * 同一组件引用自身视为自引用而非循环。
 *
 * @param schema 用户原始 def
 * @throws Error 构建期错误
 */
export function validateRefsAndDefs(schema: JsonSchemaDef): void {
  const prefix = '[StepWise.execPromptSchema]';
  const seen: string[] = [];

  const walk = (node: JsonSchemaDef, topDefs: Record<string, JsonSchemaDef> | undefined, inRecursive: boolean): void => {
    // 规则 4：recursive 与 ref/defs 混用（同一 schema 节点上）
    if (inRecursive && (node.ref !== undefined || node.defs !== undefined)) {
      throw new Error(`${prefix} recursive 机制与 ref/defs 不能在同一 schema 上混用，请改用 defs + $ref 自引用（标准、无限深度）`);
    }

    // 规则 1：ref 白名单
    if (node.ref !== undefined) {
      const extraKeys = Object.keys(node).filter(k => !REF_ALLOWED_KEYS.has(k));
      if (extraKeys.length > 0) {
        throw new Error(`${prefix} ref 字段仅允许 ref + description，发现多余字段: ${extraKeys.join('/')}`);
      }
      // 规则 2：引用存在性
      const refName = node.ref.startsWith('#/$defs/') ? node.ref.slice('#/$defs/'.length) : null;
      if (!refName || !topDefs || !(refName in topDefs)) {
        throw new Error(`${prefix} ref "${node.ref}" 指向的组件不存在（顶层 defs 中未定义）`);
      }
      // 规则 3：循环引用（自引用除外）
      if (seen.includes(refName)) {
        throw new Error(`${prefix} $defs 循环引用: ${[...seen, refName].join(' -> ')}`);
      }
      seen.push(refName);
      walk(topDefs[refName], topDefs, false);
      seen.pop();
      return;
    }

    // 规则 5：嵌套层 defs 忽略 + 警告
    if (node.defs !== undefined && topDefs !== undefined && node !== (schema as JsonSchemaDef)) {
      console.warn(`[StepWise] 嵌套层的 defs 被忽略（仅顶层 schema 的 defs 有效）: ${Object.keys(node.defs).join(', ')}`);
    }

    if (node.type === 'object' && node.properties) {
      const recursiveFields = node.recursive ? (node.recursiveFields || []) : [];
      for (const propDef of Object.values(node.properties)) {
        if (recursiveFields.includes('') ) { /* unreachable, keep shape */ }
        walk(propDef, topDefs, node.recursive === true);
      }
    }
    if (node.type === 'array' && node.items) {
      walk(node.items, topDefs, node.recursive === true);
    }
    if (node.type === 'array' && node.prefixItems) {
      for (const c of node.prefixItems) {
        walk(c, topDefs, node.recursive === true);
      }
    }
  };

  // 先校验 defs 内每个组件自身结构（组件内不允许再嵌套 defs）
  if (schema.defs) {
    for (const [name, def] of Object.entries(schema.defs)) {
      if (def.defs !== undefined) {
        throw new Error(`${prefix} 组件 "${name}" 内不允许嵌套 defs（组件仅可引用顶层 defs）`);
      }
    }
  }

  walk(schema, schema.defs, false);
}
```

注意：walk 内 `recursiveFields.includes('')` 一行是错误骨架残留，实现时直接删掉——递归字段的 propDef 不需要特判，因为规则 5 的白名单已在 validateRecursiveSchema 中拦截递归字段上的多余字段（含 ref），混用场景由规则 4 在 schema 节点层拦截。

- [ ] **Step 4: execPromptSchema 入口挂校验**

`src/StepWise.ts` execPromptSchema（约 1873 行 `validateRecursiveSchema(schema);` 之后）：

```typescript
    validateRefsAndDefs(schema);
```

import 区（约 39 行）加 `validateRefsAndDefs`。

同时 `validateSchema`（约 2088 行 properties 循环）对含 ref 的嵌套字段跳过常规校验：

```typescript
      for (const [name, propDef] of Object.entries(schema.properties)) {
        if (recursiveFields.includes(name)) {
          continue;
        }
        // ref 字段仅允许 ref + description（validateRefsAndDefs 已校验），跳过常规结构校验
        if (propDef.ref !== undefined) {
          continue;
        }
        // ……原有 try { this.validateSchema(propDef) } 保持
```

`schema.items` 分支（约 2112 行）同样加：

```typescript
      if (schema.items) {
        if (schema.items.ref !== undefined) {
          // ref 字段跳过常规校验（validateRefsAndDefs 已覆盖存在性与白名单）
        } else {
          try {
            this.validateSchema(schema.items);
          } catch (error) { /* 原有逻辑不变 */ }
        }
      }
```

- [ ] **Step 5: 运行测试通过 + 全量回归**

Run: `npx jest tests/defsRef.test.ts && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/validator.ts src/StepWise.ts tests/defsRef.test.ts
git commit -m "feat: ref/defs 构建期校验（白名单/存在性/循环引用/recursive 互斥/嵌套 defs 警告）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: buildJsonSchema 支持 PropertyDef 的 ref/defs（OutputFormat 路径）

**Files:**
- Modify: `src/utils/schemaUtils.ts:58-81`（buildJsonSchema）
- Test: `tests/defsRef.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `PropertyDef.ref/defs`
- Produces: `buildJsonSchema(format)` 产物含标准 `$defs`/`$ref`（供 AJV 校验 execCollectPrompt/execReport 数据用）

- [ ] **Step 1: 写失败测试**

`tests/defsRef.test.ts` 追加：

```typescript
describe('buildJsonSchema 支持 PropertyDef ref/defs', () => {
  test('ref 映射为 $ref，defs 映射为 $defs', () => {
    const format: OutputFormat = {
      deps: { type: 'array', ref: '#/$defs/Dep' },
      name: { type: 'string' }
    };
    const schema: any = buildJsonSchema(format as any);
    // buildJsonSchema 本身不做 defs 承载——defs 挂在 OutputFormat 顶层无法表达，
    // 约定：OutputFormat 路径的 defs 定义在首个字段的 defs 上（或直接使用 JsonSchemaDef 路径）
    // 此处只断言 ref 透传
    expect(schema.items.properties.deps.$ref).toBe('#/$defs/Dep');
  });
});
```

实现约定说明（写进 buildJsonSchema 的 JSDoc）：OutputFormat 是扁平的 `Record<string, PropertyDef>`，没有顶层容器的位置放 `$defs`。约定：**任一字段携带 `defs` 时，合并进 `buildJsonSchema` 产物的 `$defs`**（多字段都带 defs 时按序合并，重名后者优先并 console.warn）。

测试补充 defs 合并用例：

```typescript
  test('字段携带 defs 时合并进产物 $defs，AJV 可校验', () => {
    const format: OutputFormat = {
      deps: {
        type: 'array',
        ref: '#/$defs/Dep',
        defs: { Dep: { type: 'object', properties: { module: { type: 'string' } } } }
      } as any,
      name: { type: 'string' }
    };
    const schema: any = buildJsonSchema(format as any);
    expect(schema.$defs.Dep).toBeDefined();
    expect(schema.items.properties.deps.$ref).toBe('#/$defs/Dep');

    const ok = [{ deps: [{ module: 'a' }], name: 'x' }];
    expect(validateAgainstSchema(ok, schema).valid).toBe(true);
    const bad = [{ deps: [{ module: 1 }], name: 'x' }];
    expect(validateAgainstSchema(bad, schema).valid).toBe(false);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/defsRef.test.ts`
Expected: 新增 2 个测试 FAIL（$ref/$defs undefined）

- [ ] **Step 3: 实现 buildJsonSchema 扩展**

```typescript
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
        collectedDefs[defName] = propertyDefToAjvSchema(defSchema);
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
    return { type: 'object' };
  }
  return { type: def.type, ...(def.description && { description: def.description }) };
}
```

（`import { PropertyDef } from '../types'` 需加入 schemaUtils.ts 头部。）

- [ ] **Step 4: 运行测试通过 + 回归**

Run: `npx jest tests/defsRef.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/schemaUtils.ts tests/defsRef.test.ts
git commit -m "feat: buildJsonSchema 支持 PropertyDef 的 ref 透传与 defs 收集合并

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 瘦身——删结构说明 + schema JSON 紧凑化

**Files:**
- Modify: `src/utils/promptBuilder.ts`（buildSchemaPrompt 约 448-534、buildArrayOutputPrompt 约 35-89）
- Test: 修正 `tests/recursiveSchema.test.ts`、`tests/heterogeneousSchema.test.ts`、`tests/StepWise.execPromptSchema.test.ts` 中受影响断言；`tests/defsRef.test.ts` 加断言

**Interfaces:**
- Consumes: 无（纯渲染层）
- Produces: buildSchemaPrompt 输出不含「结构说明」小节；schema JSON 为紧凑格式；`buildArrayOutputPrompt` 同步紧凑化

- [ ] **Step 1: 写失败测试（先改断言再实现，红色先行）**

`tests/defsRef.test.ts` 追加：

```typescript
import { buildSchemaPrompt } from '../src/utils/promptBuilder';

describe('buildSchemaPrompt 瘦身', () => {
  const schema: JsonSchemaDef = {
    type: 'object',
    description: '模块分析',
    properties: {
      name: { type: 'string', description: '模块名' },
      count: { type: 'number', description: '数量' }
    }
  };

  test('不再包含「结构说明」小节', () => {
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    expect(prompt).not.toContain('## 结构说明');
    expect(prompt).not.toContain('类型: object');
  });

  test('schema JSON 为紧凑格式（无缩进换行）', () => {
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    expect(prompt).toContain(JSON.stringify(schema));
    expect(prompt).not.toContain(JSON.stringify(schema, null, 2));
  });

  test('体积显著下降（同 schema 紧凑+删说明 < 原实现的 60%）', () => {
    // 经验断言：防回归阈值，非精确值
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    expect(prompt.length).toBeLessThan(1200);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/defsRef.test.ts`
Expected: 瘦身 3 个测试 FAIL（当前实现含结构说明和缩进 JSON）

- [ ] **Step 3: 实现 buildSchemaPrompt 瘦身**

`src/utils/promptBuilder.ts` buildSchemaPrompt 改动点：

1. 删除 `const schemaDescription = generateSchemaDescription(schema);`（453 行）及模板中 `${schemaDescription}` 小节（510-512 行的 `## 结构说明` 块整体删除）
2. 507 行 `JSON.stringify(schema, null, 2)` → `JSON.stringify(schema)`
3. 517 行示例 `JSON.stringify(formatExample, null, 2)` → `JSON.stringify(formatExample)`（同步紧凑化）
4. 模板中 `## 输出 Schema` 与 `## 正确格式示例` 小节标题保留

buildArrayOutputPrompt 中 70 行 `JSON.stringify(schema, null, 2)` → `JSON.stringify(schema)`。

- [ ] **Step 4: 修正存量测试断言**

Run: `npx jest tests/recursiveSchema.test.ts tests/heterogeneousSchema.test.ts tests/StepWise.execPromptSchema.test.ts 2>&1 | grep -E "✕|FAIL" | head -30`

逐个修正预期失败的断言：

- `tests/heterogeneousSchema.test.ts:410-424` 元组测试：删除 `expect(prompt).toContain('固定长度元组（长度 2）')`、`第 1 个元素: string（姓名）`、`第 2 个元素: number（年龄）` 三行（这三行是结构说明小节内容）；保留 `长度固定`、`第 i 个元素的类型必须符合位置定义`（要求清单仍在）
- `tests/heterogeneousSchema.test.ts:426-436` const 测试：删除 `expect(prompt).toContain('[固定值: "1"]')`（结构说明内容）；保留 `固定值`（要求条目仍在）
- `tests/heterogeneousSchema.test.ts:451-466` 递归字段 const 测试：断言 `not.toContain('[固定值: "x"]')` 保持通过，无需改
- `tests/recursiveSchema.test.ts:685-737` buildSchemaPrompt (递归) describe：
  - 685 测试保留 `递归树形结构`、`最大深度为 3 层`、`叶子节点`、`空数组`（要求清单内容，不变）
  - 705 测试 `expect(prompt).toContain('递归字段（树形结构）')` 删除（结构说明内容）；`toContain('children')` 保留（schema JSON 中有）
- `tests/StepWise.execPromptSchema.test.ts:161-182`：无内容断言，不需改

- [ ] **Step 5: 运行全部受影响测试通过**

Run: `npx jest tests/defsRef.test.ts tests/recursiveSchema.test.ts tests/heterogeneousSchema.test.ts tests/StepWise.execPromptSchema.test.ts`
Expected: PASS

- [ ] **Step 6: 全量回归**

Run: `npm test`
Expected: PASS（若 promptBuilder 还有其它断言失败，按同原则修正：删结构说明断言、适配紧凑 JSON）

- [ ] **Step 7: Commit**

```bash
git add src/utils/promptBuilder.ts tests/
git commit -m "feat: buildSchemaPrompt 删结构说明小节，schema JSON 紧凑化（-40% 体积）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 递归示例单节点化

**Files:**
- Modify: `src/utils/validator.ts`（generateRecursiveExample 约 620-645）
- Test: 修正 `tests/recursiveSchema.test.ts:447-539`；`tests/defsRef.test.ts` 加断言

**Interfaces:**
- Consumes: 无
- Produces: `generateSchemaExample` 对 recursive schema 返回单节点（递归字段为占位数组）；buildSchemaPrompt/buildSchemaFixPrompt 示例同步变化

- [ ] **Step 1: 写失败测试**

`tests/defsRef.test.ts` 追加：

```typescript
import { generateSchemaExample } from '../src/utils/validator';

describe('递归示例单节点化', () => {
  const schema: JsonSchemaDef = {
    type: 'object',
    recursive: true,
    recursiveFields: ['children'],
    maxDepth: 8,
    properties: {
      id: { type: 'string', description: '节点编号' },
      detail: { type: 'string', description: '工作内容' },
      children: { type: 'array' }
    }
  };

  test('单节点：递归字段为占位数组而非按 maxDepth 展开', () => {
    const example = generateSchemaExample(schema) as any;
    expect(example.id).toBe('节点编号');
    // 占位：空数组（单节点形态）
    expect(example.children).toEqual([]);
  });

  test('示例体积不随 maxDepth 增长', () => {
    const s1 = { ...schema, maxDepth: 2 };
    const s2 = { ...schema, maxDepth: 8 };
    const len1 = JSON.stringify(generateSchemaExample(s1)).length;
    const len2 = JSON.stringify(generateSchemaExample(s2)).length;
    expect(len1).toBe(len2);
  });

  test('多个递归字段都是占位数组', () => {
    const multi: JsonSchemaDef = {
      type: 'object',
      recursive: true,
      recursiveFields: ['children', 'subItems'],
      maxDepth: 5,
      properties: {
        name: { type: 'string' },
        children: { type: 'array' },
        subItems: { type: 'array' }
      }
    };
    const example = generateSchemaExample(multi) as any;
    expect(example.children).toEqual([]);
    expect(example.subItems).toEqual([]);
  });

  test('buildSchemaFixPrompt 的示例同样单节点化', () => {
    const { buildSchemaFixPrompt } = require('../src/utils/validator');
    const errors = [{ path: '/children/0', message: 'should be object', keyword: 'type', params: {}, data: 'x' }];
    const prompt = buildSchemaFixPrompt(errors, '/f.json', schema);
    // 不含多层嵌套示例（maxDepth=8 若展开会非常长）
    expect(prompt.length).toBeLessThan(2500);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/defsRef.test.ts`
Expected: 新增 4 个测试中「单节点」「体积不随 maxDepth」「fixPrompt 长度」FAIL（当前按 maxDepth 展开多层）

- [ ] **Step 3: 实现 generateRecursiveExample 单节点化**

`src/utils/validator.ts` generateRecursiveExample 改为：

```typescript
function generateRecursiveExample(nodeSchema: JsonSchemaDef, maxDepth: number, currentDepth: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const recursiveFields = nodeSchema.recursiveFields || [];

  if (nodeSchema.properties) {
    for (const [name, propDef] of Object.entries(nodeSchema.properties)) {
      if (recursiveFields.includes(name)) {
        // 单节点形态：递归字段为空数组占位（不再按 maxDepth 展开整棵树，避免示例体积爆炸）
        obj[name] = [];
      } else {
        obj[name] = generateSchemaExample(propDef);
      }
    }
  }
  return obj;
}
```

同时 `buildSchemaPrompt`/`buildSchemaFixPrompt` 中递归 schema 的 prompt 已有「叶子节点（最深层）的递归字段必须为空数组」要求条目，单节点示例与之自洽，无需额外文案。

- [ ] **Step 4: 修正存量测试**

`tests/recursiveSchema.test.ts:447-539` generateSchemaExample (递归) describe 重写为单节点断言（替换原多层展开断言）：

```typescript
  describe('generateSchemaExample (递归)', () => {
    it('单节点：递归字段为空数组占位', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        maxDepth: 2,
        properties: {
          name: { type: 'string' },
          children: { type: 'array' }
        }
      };

      const example = generateSchemaExample(schema) as Record<string, unknown>;

      expect(example.name).toBe('示例字符串');
      expect(example.children).toEqual([]);
    });

    it('多个递归字段都是空数组占位', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children', 'subItems'],
        maxDepth: 2,
        properties: {
          name: { type: 'string' },
          children: { type: 'array' },
          subItems: { type: 'array' }
        }
      };

      const example = generateSchemaExample(schema) as Record<string, unknown>;

      expect(example.children).toEqual([]);
      expect(example.subItems).toEqual([]);
    });

    it('非递归 schema 示例不变', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'number' }
        }
      };

      const example = generateSchemaExample(schema);

      expect(example).toEqual({
        name: '示例字符串',
        count: 0
      });
    });
  });
```

- [ ] **Step 5: 运行测试通过 + 全量回归**

Run: `npx jest tests/defsRef.test.ts tests/recursiveSchema.test.ts && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/validator.ts tests/recursiveSchema.test.ts tests/defsRef.test.ts
git commit -m "feat: 递归示例单节点化，不再按 maxDepth 展开整棵树

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: expandRefs 去重视图 + buildSchemaPrompt 渲染 $defs/$ref

**Files:**
- Modify: `src/utils/promptBuilder.ts`（buildSchemaPrompt 及新增 expandRefs）
- Test: `tests/defsRef.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `JsonSchemaDef.defs/ref`
- Produces: `expandRefs(def: JsonSchemaDef): string`——返回去重后的 schema 渲染 JSON（`$defs` 一次 + 引用点 `$ref` 标记）；buildSchemaPrompt 对含 defs 的 schema 走此渲染

- [ ] **Step 1: 写失败测试**

`tests/defsRef.test.ts` 追加：

```typescript
import { expandRefs } from '../src/utils/promptBuilder';

describe('expandRefs 去重视图', () => {
  test('$defs 组件只渲染一次，引用点为 $ref 标记', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      description: '模块全景',
      defs: {
        Dependency: {
          type: 'object',
          properties: { module: { type: 'string' }, kind: { type: 'string' } }
        }
      },
      properties: {
        deps: { type: 'array', items: { ref: '#/$defs/Dependency' } },
        devDeps: { type: 'array', items: { ref: '#/$defs/Dependency' } },
        peerDeps: { type: 'array', items: { ref: '#/$defs/Dependency' } }
      }
    };
    const rendered = expandRefs(schema);
    const parsed = JSON.parse(rendered);
    // $defs 出现且仅一次
    expect(parsed.$defs.Dependency).toBeDefined();
    // 引用点为 $ref
    expect(parsed.properties.deps.items.$ref).toBe('#/$defs/Dependency');
    // 组件全文只出现一次（去重生效）
    const occurrences = (rendered.match(/"Dependency":/g) || []).length;
    expect(occurrences).toBe(1);
  });

  test('不含 defs 的 schema 渲染为紧凑 JSON（与原行为一致）', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: { name: { type: 'string' } }
    };
    expect(expandRefs(schema)).toBe(JSON.stringify(schema));
  });

  test('buildSchemaPrompt 对含 defs 的 schema 渲染 $defs 引导语', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: {
        Dep: { type: 'object', properties: { module: { type: 'string' } } }
      },
      properties: {
        deps: { type: 'array', items: { ref: '#/$defs/Dep' } }
      }
    };
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    expect(prompt).toContain('$defs');
    expect(prompt).toContain('$ref');
    expect(prompt).toContain('按名称回查');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/defsRef.test.ts`
Expected: expandRefs 3 个测试 FAIL（未导出）

- [ ] **Step 3: 实现 expandRefs**

`src/utils/promptBuilder.ts` 新增：

```typescript
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
```

然后 buildSchemaPrompt 中 507 行（Task 4 已改为 `JSON.stringify(schema)`）改为：

```typescript
  // defs 存在时走去重渲染（$defs 一次 + 引用点 $ref 标记）
  const schemaJson = expandRefs(schema);
```

模板中 `${JSON.stringify(schema)}` → `${schemaJson}`，并在 `## 要求` 清单末尾（紧凑化后序号顺延）追加一条（仅当 `schema.defs` 存在时）：

```typescript
  if (schema.defs) {
    requirements.push(`${nextReqIndex}. "$ref" 引用按名称回查上方 $defs 中的公共子结构定义，输出时按其结构展开，不要在输出中重复定义这些结构`);
    nextReqIndex++;
  }
```

- [ ] **Step 4: 运行测试通过 + 全量回归**

Run: `npx jest tests/defsRef.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/promptBuilder.ts tests/defsRef.test.ts
git commit -m "feat: expandRefs 去重视图，buildSchemaPrompt 渲染 \$defs/\$ref 引导

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: 端到端集成验证（execPromptSchema defs/ref 全链路）

**Files:**
- Test: `tests/defsRef.test.ts`（追加端到端 describe）
- Modify: 无（纯验证；若发现链路断裂，修复点回写对应 Task 文件）

**Interfaces:**
- Consumes: Task 1-6 全部产物
- Produces: 用户场景（defs 定义递归 TreeNode + 多处 ref 引用）端到端可用的验证

- [ ] **Step 1: 写端到端测试**

`tests/defsRef.test.ts` 追加：

```typescript
import { StepWise } from '../src/StepWise';
import { setTaskName, _resetState } from '../src/globalState';

describe('端到端：defs 定义递归节点 + 多处 ref 引用', () => {
  beforeEach(() => {
    _resetState();
    setTaskName('DefsRefE2E');
  });

  test('用户场景：wbs/riskTree 引用同一递归 TreeNode，构建期不抛错且 prompt 含 $defs', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = new StepWise('DefsRefE2EAgent');

    const schema: JsonSchemaDef = {
      type: 'object',
      description: 'WBS 分析',
      defs: {
        TreeNode: {
          type: 'object',
          description: '树节点',
          properties: {
            id: { type: 'string', description: '节点编号' },
            detail: { type: 'string', description: '工作内容' },
            children: { type: 'array', description: '子节点', items: { ref: '#/$defs/TreeNode' } }
          }
        }
      },
      properties: {
        wbs: { type: 'array', description: '工作树', items: { ref: '#/$defs/TreeNode' } },
        riskTree: { ref: '#/$defs/TreeNode', description: '风险树' }
      }
    };

    // 构建期校验通过（执行被 mock，不真正跑 agent）
    const prompt = buildSchemaPrompt(schema, '/tmp/e2e.json');
    expect(prompt).toContain('$defs');
    expect(prompt).toContain('TreeNode');

    // 去重生效：TreeNode 组件全文只出现一次
    const rendered = expandRefs(schema);
    expect((rendered.match(/"TreeNode":/g) || []).length).toBe(1);

    warnSpy.mockRestore();
  });

  test('AJV 校验该 schema 的真实数据（合法/违规路径）', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: {
        TreeNode: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            children: { type: 'array', items: { ref: '#/$defs/TreeNode' } }
          }
        }
      },
      properties: {
        wbs: { type: 'array', items: { ref: '#/$defs/TreeNode' } }
      }
    };

    const ok = { wbs: [{ id: '1', children: [{ id: '1.1', children: [] }] }] };
    expect(validateJsonBySchema(JSON.stringify(ok), schema).valid).toBe(true);

    const bad = { wbs: [{ id: 1, children: [] }] };
    const badResult = validateJsonBySchema(JSON.stringify(bad), schema);
    expect(badResult.valid).toBe(false);
    // 错误路径指向引用展开位置
    expect(badResult.errors[0].path).toBe('/wbs/0/id');
  });
});
```

注意：`test('构建期不抛错...')` 中 StepWise 实例化需要 mock executor 环境——参照 `tests/StepWise.execPromptSchema.test.ts` 头部已有的 mock 模式（jest.mock executor）。若该文件使用 `jest.mock('../src/executors/...', ...)`，复制同样的 mock 声明到 defsRef.test.ts 头部。

- [ ] **Step 2: 运行确认通过或定位断裂**

Run: `npx jest tests/defsRef.test.ts`
Expected: PASS。若 FAIL：按错误定位到对应 Task 的实现文件修复（类型→Task 1，校验→Task 2，渲染→Task 6），重跑该 Task 的测试后再回来。

- [ ] **Step 3: 体积验收**

Run:

```bash
npx tsx -e "
import { buildSchemaPrompt } from './src/utils/promptBuilder';
const treeNode = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '节点唯一编号，格式 WBS-XXX' },
    detail: { type: 'string', description: '工作内容详细描述，至少 100 字' },
    children: { type: 'array', items: { ref: '#/$defs/TreeNode' } }
  }
};
const props: any = { root: { type: 'array', description: '根层节点', items: { ref: '#/$defs/TreeNode' } } };
for (let i = 1; i <= 9; i++) props[\`section\${i}\`] = { type: 'array', description: \`第 \${i} 类节点\`, items: { ref: '#/\$defs/TreeNode' } };
const p = buildSchemaPrompt({ type: 'object', defs: { TreeNode: treeNode }, properties: props } as any, '/tmp/o.json');
console.log('10 处引用 defs 版 prompt:', p.length, 'chars ≈', Math.round(p.length/2.5), 'tokens（基线 24966 chars / ~10000 tokens）');
"
```

Expected: `≈ 1500-2500 chars`（较基线 24966 降 ~90%）。若显著超出，检查 $defs 是否被重复渲染。

- [ ] **Step 4: 全量回归 + Commit**

Run: `npm test`
Expected: PASS

```bash
git add tests/defsRef.test.ts
git commit -m "test: defs/ref 端到端集成验证（递归节点复用 + AJV 校验路径 + 体积验收）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: 文档同步（CLAUDE.md execPromptSchema 条目）

**Files:**
- Modify: `CLAUDE.md`（execPromptSchema 描述行，约 22 行区间）

**Interfaces:**
- Consumes: Task 1-7 完成的事实
- Produces: 文档反映新能力

- [ ] **Step 1: 更新 CLAUDE.md**

`- \`execPromptSchema(prompt, schema: JsonSchemaDef, outputFile, options?)\` 行追加说明：

```
- `execPromptSchema(prompt, schema: JsonSchemaDef, outputFile, options?)`: Schema-driven output (arbitrary nesting + recursive trees + `$defs`/`$ref` shared subschemas); returns `SchemaResult`. Types `JsonSchemaDef`/`SchemaResult` in `src/types.ts`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: CLAUDE.md 补充 execPromptSchema \$defs/\$ref 能力说明

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
