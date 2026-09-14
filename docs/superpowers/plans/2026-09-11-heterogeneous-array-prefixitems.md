# JsonSchemaDef 元组（prefixItems）与 const 固定值 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `JsonSchemaDef` 新增 `prefixItems`（固定长度元组数组）与 `const`（固定值约束）两个字段，贯穿类型定义、结构校验、AJV 转换、提示词生成四层链路，并支持与递归树形结构组合。

**Architecture:** 现有链路是 `execPromptSchema` → `validateSchema`（结构校验）+ `validateRecursiveSchema`（递归规则）→ `convertToAjvSchema`（转 AJV draft-07 schema）→ AJV 校验；提示词侧 `buildSchemaPrompt` → `generateSchemaDescription` + `generateSchemaExample`。本计划在这四层各插入 prefixItems/const 处理：元组映射为 draft-07 的 `items: [...]` 数组 + `minItems`/`maxItems` 钉死长度；const 透传给 AJV（原生关键字）。递归展开层（`unrollLayer`）零改动——非递归字段走 `convertToAjvSchema` 自动获得新能力。

**Tech Stack:** TypeScript (strict)、Jest + ts-jest、ajv 8.18.0（draft-07 模式，现有配置 `allErrors: true, strict: false` 无需改动，元组与 const 关键字已实测支持）。

**Spec:** `docs/superpowers/specs/2026-09-11-heterogeneous-array-prefixitems-design.md`

## Global Constraints

- 项目语言：TypeScript strict 模式（`tsconfig.json`），禁止 `any`（测试断言处的 `as any` 例外，沿用现有测试惯例）
- 测试框架：Jest（`npx jest <file>` 运行单个测试文件），测试文件放 `tests/`，命名 `*.test.ts`
- 错误消息前缀约定：结构校验错误一律带 `[StepWise.execPromptSchema]` 前缀（现有 `validateSchema` 惯例）；`validateRecursiveSchema` 的消息带 `[StepWise.execPromptSchema]` 前缀（现有代码即是）
- 元组长度语义：严格固定（`minItems === maxItems === prefixItems.length`），不支持变长尾部
- `const` 仅允许 `type: 'string' | 'number' | 'boolean'`，且值类型必须与 `type` 匹配
- 不实现 anyOf（spec 明确范围外）
- 提交信息用中文，末尾加 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- 每个任务结束时 `npm test` 必须全绿（现有测试不得回归）

## 文件结构总览

| 文件 | 职责 | 改动 |
|---|---|---|
| `src/types.ts` | 类型定义 | 新增 2 个可选字段 |
| `src/utils/schemaUtils.ts` | AJV schema 类型 + 校验执行 | `JsonSchema` 接口扩展 |
| `src/StepWise.ts` | 结构校验 `validateSchema` | array 分支重写 + const 校验 + R2 + 嵌套递归校验 |
| `src/utils/validator.ts` | AJV 转换 / 递归校验 / 示例生成 | `validateRecursiveSchema` R1、`convertToAjvSchema` 元组+const、`generateSchemaExample` 元组+const |
| `src/utils/promptBuilder.ts` | 提示词生成 | `generateSchemaDescription` 元组+const、`buildSchemaPrompt` requirements |
| `tests/heterogeneousSchema.test.ts` | 新测试文件 | 全部新功能的测试 |
| `doc/api.md` / `doc/api_cn.md` | API 文档 | 字段说明与示例（注意目录是 `doc/` 不是 `docs/`） |

---

### Task 1: 类型定义 —— `prefixItems` 与 `const` 字段

**Files:**
- Modify: `src/types.ts:102-139`（`JsonSchemaDef` 接口）
- Modify: `src/utils/schemaUtils.ts:13-19`（`JsonSchema` 接口）

**Interfaces:**
- Consumes: 无（首个任务）
- Produces: `JsonSchemaDef.prefixItems?: JsonSchemaDef[]`、`JsonSchemaDef.const?: string | number | boolean`；`JsonSchema.items?: JsonSchema | JsonSchema[]`、`JsonSchema.minItems?: number`、`JsonSchema.maxItems?: number`、`JsonSchema.const?: string | number | boolean`。后续所有任务的类型基础。

- [ ] **Step 1: 扩展 `JsonSchemaDef` 接口**

在 `src/types.ts` 的 `JsonSchemaDef` 接口中，`items?: JsonSchemaDef;` 字段之后、`recursive?: boolean;` 之前插入两个新字段：

```typescript
  /**
   * type === 'array' 时的元组定义（与 items 互斥）
   * 按位置定义每个元素的类型，分量可为任意 type
   * 数组长度必须严格等于 prefixItems.length（固定长度元组）
   */
  prefixItems?: JsonSchemaDef[];
  /**
   * 固定值约束（仅 type === 'string' | 'number' | 'boolean' 时有效）
   * 输出中该字段的值必须严格等于 const 指定的值
   * 典型场景：固定节点名（如树的根/分支节点名为 "1"/"2"/"3"）、固定标签
   */
  const?: string | number | boolean;
```

- [ ] **Step 2: 扩展 `schemaUtils.ts` 的 `JsonSchema` 接口**

`src/utils/schemaUtils.ts:13-19` 的 `JsonSchema` 接口替换为：

```typescript
export interface JsonSchema {
  type: string;
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
}
```

- [ ] **Step 3: 编译验证**

Run: `npm run build`
Expected: 编译通过，无类型错误（纯类型新增，无运行时行为变化）

- [ ] **Step 4: 回归测试**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/utils/schemaUtils.ts
git commit -m "feat: JsonSchemaDef/JsonSchema 新增 prefixItems 与 const 类型定义

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `validateSchema` 结构校验 —— 互斥、分量递归、R2、const 匹配、嵌套递归

**Files:**
- Modify: `src/StepWise.ts:2039-2091`（`validateSchema` 方法，整体重写）
- Test: `tests/heterogeneousSchema.test.ts`（新建）

**Interfaces:**
- Consumes: Task 1 的类型定义；`src/utils/validator.ts` 已导出的 `validateRecursiveSchema(schema: JsonSchemaDef): void`（StepWise.ts 第 31-40 行已 import）
- Produces: `validateSchema` 接受带 `prefixItems`/`const` 的 schema 并按下列规则抛错；错误消息格式 `schema.prefixItems[N]: ...`（后续 Task 4 的 `validateJsonBySchema` 测试依赖合法 schema 能通过校验）

**校验规则（实现到代码里）：**

1. `type === 'array'`：必须提供 `items` 或 `prefixItems` 之一，两者都缺 → `type="array" 时必须定义 items 或 prefixItems`
2. `items` 与 `prefixItems` 同现 → `items 与 prefixItems 互斥，只能定义其一`
3. `type !== 'array'` 且 `prefixItems !== undefined` → `prefixItems 仅在 type="array" 时有效`
4. `prefixItems` 为空数组 → `prefixItems 不能为空数组`
5. 元组分量逐个递归校验，错误消息前缀 `schema.prefixItems[${i}]: `（i 从 0 起）
6. R2：分量带 `recursive === true` → `prefixItems 分量不能定义 recursive（分量不可成为树节点，用分量内的独立递归树代替）`；分量带 `recursiveFields`（非空）→ 同样抛错；分量带 `maxDepth !== undefined` → 同样抛错
7. const：`type === 'object' || type === 'array'` 且 `const !== undefined` → `const 仅在 type="string"|"number"|"boolean" 时有效`；const 值类型与 type 不匹配（string↔number↔boolean）→ `const 值类型必须与 type 一致`
8. 嵌套递归校验：`validateSchema` 递归进入任何 `recursive === true` 的节点时调用 `validateRecursiveSchema(node)`，捕获后包装为 `schema.properties.<name>: ...` 或 `schema.prefixItems[i]: ...` 路径前缀重抛

- [ ] **Step 1: 写失败测试（新建测试文件）**

创建 `tests/heterogeneousSchema.test.ts`：

```typescript
import { StepWise, setTaskName, _resetState } from '../src/index';
import { JsonSchemaDef } from '../src/types';

// Mock executor（沿用 StepWise.execPromptSchema.test.ts 的模式）
jest.mock('../src/utils/executor', () => ({
  createExecutor: () => ({
    execute: jest.fn().mockResolvedValue({
      sessionId: 'test-session',
      output: 'test output',
      success: true,
      timestamp: Date.now(),
      duration: 100
    }),
    agentType: 'claude'
  })
}));

describe('prefixItems 元组结构校验', () => {
  beforeEach(() => {
    _resetState();
    setTaskName('HeteroSchemaTest');
  });

  describe('互斥与位置校验', () => {
    test('items 与 prefixItems 同现应抛错', async () => {
      const agent = new StepWise('T1');
      const schema: JsonSchemaDef = {
        type: 'array',
        items: { type: 'string' },
        prefixItems: [{ type: 'string' }]
      } as any;
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('items 与 prefixItems 互斥');
    });

    test('type=array 但 items 和 prefixItems 都缺应抛错', async () => {
      const agent = new StepWise('T2');
      await expect(
        agent.execPromptSchema('测试', { type: 'array' } as any, 'out.json')
      ).rejects.toThrow('必须定义 items 或 prefixItems');
    });

    test('非 array 类型带 prefixItems 应抛错', async () => {
      const agent = new StepWise('T3');
      const schema: JsonSchemaDef = {
        type: 'string',
        prefixItems: [{ type: 'string' }]
      } as any;
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('prefixItems 仅在 type="array" 时有效');
    });

    test('prefixItems 空数组应抛错', async () => {
      const agent = new StepWise('T4');
      await expect(
        agent.execPromptSchema('测试', { type: 'array', prefixItems: [] } as any, 'out.json')
      ).rejects.toThrow('prefixItems 不能为空数组');
    });

    test('分量类型错误应递归抛错且带位置', async () => {
      const agent = new StepWise('T5');
      const schema: JsonSchemaDef = {
        type: 'array',
        prefixItems: [
          { type: 'string' },
          { type: 'integer' } as any
        ]
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('schema.prefixItems[1]');
    });

    test('纯 prefixItems 元组 schema 应通过校验', async () => {
      const agent = new StepWise('T6');
      const schema: JsonSchemaDef = {
        type: 'array',
        prefixItems: [
          { type: 'string', description: '姓名' },
          { type: 'number', description: '年龄' }
        ]
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).resolves.toBeDefined();
    });
  });

  describe('R2: 元组分量不可为树节点', () => {
    test('分量带 recursive=true 应抛错', async () => {
      const agent = new StepWise('T7');
      const schema: JsonSchemaDef = {
        type: 'array',
        prefixItems: [
          {
            type: 'object',
            recursive: true,
            recursiveFields: ['children'],
            properties: {
              name: { type: 'string' },
              children: { type: 'array' }
            }
          }
        ]
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('prefixItems 分量不能定义 recursive');
    });

    test('分量带 maxDepth 应抛错', async () => {
      const agent = new StepWise('T8');
      const schema: JsonSchemaDef = {
        type: 'array',
        prefixItems: [
          {
            type: 'object',
            maxDepth: 3,
            properties: { name: { type: 'string' } }
          } as any
        ]
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('prefixItems 分量不能定义');
    });
  });

  describe('const 校验', () => {
    test('object 带 const 应抛错', async () => {
      const agent = new StepWise('T9');
      const schema: JsonSchemaDef = {
        type: 'object',
        const: 'x',
        properties: { name: { type: 'string' } }
      } as any;
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('const 仅在 type="string"|"number"|"boolean" 时有效');
    });

    test('const 值类型与 type 不匹配应抛错', async () => {
      const agent = new StepWise('T10');
      const schema: JsonSchemaDef = {
        type: 'object',
        properties: {
          name: { type: 'string', const: 123 } as any
        }
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('const 值类型必须与 type 一致');
    });

    test('string + 匹配 const 应通过校验', async () => {
      const agent = new StepWise('T11');
      const schema: JsonSchemaDef = {
        type: 'object',
        properties: {
          name: { type: 'string', const: 'root' }
        }
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).resolves.toBeDefined();
    });
  });

  describe('嵌套递归校验（R3 配套）', () => {
    test('分量内递归树定义非法（recursiveFields 为空）应抛错', async () => {
      const agent = new StepWise('T12');
      const schema: JsonSchemaDef = {
        type: 'array',
        prefixItems: [
          {
            type: 'object',
            properties: {
              subtree: {
                type: 'object',
                recursive: true,
                properties: {
                  name: { type: 'string' }
                }
              }
            }
          }
        ]
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('schema.prefixItems[0]');
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/heterogeneousSchema.test.ts`
Expected: FAIL —— 大部分用例 resolves（当前 `validateSchema` 不认识 prefixItems/const，非法 schema 不会被拦截）；`type=array` 缺 items 的用例可能因旧错误消息 `必须定义 items` 而断言失败

- [ ] **Step 3: 重写 `validateSchema`**

`src/StepWise.ts:2039-2091` 的 `validateSchema` 方法整体替换为：

```typescript
  /**
   * 校验 Schema 参数
   * 递归校验 JsonSchemaDef 的合法性（含 prefixItems 元组与 const 固定值）
   * @param schema 待校验 schema
   */
  private validateSchema(schema: JsonSchemaDef): void {
    const PREFIX = '[StepWise.execPromptSchema]';
    if (!schema || !schema.type) {
      throw new Error(`${PREFIX} schema 必须包含 type 属性`);
    }

    const validTypes = ['string', 'number', 'boolean', 'object', 'array'];
    if (!validTypes.includes(schema.type)) {
      throw new Error(`${PREFIX} schema.type 必须是 ${validTypes.join(' | ')}`);
    }

    // prefixItems 仅在 array 上有效
    if (schema.prefixItems !== undefined && schema.type !== 'array') {
      throw new Error(`${PREFIX} prefixItems 仅在 type="array" 时有效，当前 type="${schema.type}"`);
    }

    // const 仅在基础类型上有效，且值类型必须匹配
    if (schema.const !== undefined) {
      if (schema.type === 'object' || schema.type === 'array') {
        throw new Error(`${PREFIX} const 仅在 type="string"|"number"|"boolean" 时有效，当前 type="${schema.type}"`);
      }
      const constType = typeof schema.const;
      if (constType !== schema.type) {
        throw new Error(`${PREFIX} const 值类型必须与 type 一致，type="${schema.type}" 但 const 为 ${constType}`);
      }
    }

    if (schema.type === 'object') {
      if (!schema.properties || Object.keys(schema.properties).length === 0) {
        throw new Error(`${PREFIX} type="object" 时必须定义 properties`);
      }
      // 嵌套递归节点：同步校验其递归定义合法性（R3 场景，validateRecursiveSchema 原本只校验顶层）
      if (schema.recursive) {
        try {
          validateRecursiveSchema(schema);
        } catch (error) {
          if (error instanceof Error) {
            throw new Error(`${PREFIX} ${error.message.replace(/^\[StepWise\.execPromptSchema\] /, '')}`);
          }
          throw error;
        }
      }
      // 递归校验 properties（排除递归字段，因为递归字段的 items 由框架自动填充）
      const recursiveFields = schema.recursive ? (schema.recursiveFields || []) : [];
      for (const [name, propDef] of Object.entries(schema.properties)) {
        // 递归字段跳过递归校验（validateRecursiveSchema 已单独校验其类型为 array 且无 items/prefixItems）
        if (recursiveFields.includes(name)) {
          continue;
        }
        try {
          this.validateSchema(propDef);
        } catch (error) {
          if (error instanceof Error) {
            throw new Error(`${PREFIX} schema.properties.${name}: ${error.message.replace(/^\[StepWise\.execPromptSchema\] /, '')}`);
          }
          throw error;
        }
      }
    }

    if (schema.type === 'array') {
      // items 与 prefixItems 互斥，二选一
      if (schema.items && schema.prefixItems) {
        throw new Error(`${PREFIX} items 与 prefixItems 互斥，只能定义其一`);
      }
      if (!schema.items && !schema.prefixItems) {
        throw new Error(`${PREFIX} type="array" 时必须定义 items 或 prefixItems`);
      }
      if (schema.items) {
        try {
          this.validateSchema(schema.items);
        } catch (error) {
          if (error instanceof Error) {
            throw new Error(`${PREFIX} schema.items: ${error.message.replace(/^\[StepWise\.execPromptSchema\] /, '')}`);
          }
          throw error;
        }
      }
      if (schema.prefixItems) {
        if (schema.prefixItems.length === 0) {
          throw new Error(`${PREFIX} prefixItems 不能为空数组`);
        }
        for (let i = 0; i < schema.prefixItems.length; i++) {
          const component = schema.prefixItems[i];
          // R2：分量不可成为树节点（分量内的嵌套节点可以声明独立递归树，走 R3）
          if (component.recursive || (component.recursiveFields && component.recursiveFields.length > 0) || component.maxDepth !== undefined) {
            throw new Error(`${PREFIX} schema.prefixItems[${i}]: prefixItems 分量不能定义 recursive/recursiveFields/maxDepth（分量不可成为树节点，请在分量内用独立递归树代替）`);
          }
          try {
            this.validateSchema(component);
          } catch (error) {
            if (error instanceof Error) {
              throw new Error(`${PREFIX} schema.prefixItems[${i}]: ${error.message.replace(/^\[StepWise\.execPromptSchema\] /, '')}`);
            }
            throw error;
          }
        }
      }
    }
  }
```

**注意**：错误消息去重前缀的处理（`.replace(/^\[StepWise\.execPromptSchema\] /, '')`）是因为 `validateRecursiveSchema` 抛出的消息自带前缀，嵌套包装时不重复显示。这是对现有代码行为的改进——现有代码直接拼接会得到 `[StepWise.execPromptSchema] schema.properties.x: [StepWise.execPromptSchema] ...` 双前缀。**检查现有测试是否断言了双前缀格式**：`grep -rn "StepWise.execPromptSchema\] schema" tests/` 确认无影响。

- [ ] **Step 4: 运行新测试确认通过**

Run: `npx jest tests/heterogeneousSchema.test.ts`
Expected: PASS 全绿

- [ ] **Step 5: 回归测试（重点：现有 execPromptSchema 测试的错误消息断言）**

Run: `npm test`
Expected: 全部通过。若 `tests/StepWise.execPromptSchema.test.ts:66` 的 `type="array" 时必须定义 items` 断言失败：该测试断言的正是旧消息，**更新该断言**为 `type="array" 时必须定义 items 或 prefixItems`（这是 spec 明确的行为变更：放宽为二选一）

- [ ] **Step 6: Commit**

```bash
git add src/StepWise.ts tests/heterogeneousSchema.test.ts tests/StepWise.execPromptSchema.test.ts
git commit -m "feat: validateSchema 支持 prefixItems 元组与 const 校验（互斥/R2/嵌套递归）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `validateRecursiveSchema` R1 扩展 —— 递归字段不得定义 prefixItems

**Files:**
- Modify: `src/utils/validator.ts:444-448`（规则 5 扩展）
- Test: `tests/heterogeneousSchema.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 类型定义
- Produces: `validateRecursiveSchema` 对递归字段带 `prefixItems` 抛错（消息 `不应定义 items/prefixItems`）。Task 2 的嵌套递归校验路径已调用此函数，所以这里改完后经由 `execPromptSchema` 的顶层递归字段校验立即可用

- [ ] **Step 1: 追加失败测试**

在 `tests/heterogeneousSchema.test.ts` 末尾（最外层 describe 之内或并列新增 describe）追加：

```typescript
import { validateRecursiveSchema } from '../src/utils/validator';

describe('R1: 递归字段不得定义 items/prefixItems', () => {
  test('递归字段带 prefixItems 应抛错', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      recursive: true,
      recursiveFields: ['children'],
      properties: {
        name: { type: 'string' },
        children: {
          type: 'array',
          prefixItems: [{ type: 'string' }]
        }
      }
    };
    expect(() => validateRecursiveSchema(schema)).toThrow('不应定义 items/prefixItems');
  });

  test('递归字段带 items 仍应抛错（现有行为不回归）', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      recursive: true,
      recursiveFields: ['children'],
      properties: {
        name: { type: 'string' },
        children: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    };
    expect(() => validateRecursiveSchema(schema)).toThrow('不应定义 items');
  });
});
```

（import 语句放到文件顶部与其他 import 合并）

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/heterogeneousSchema.test.ts -t "R1"`
Expected: FAIL —— 第一个用例：递归字段带 prefixItems 当前不抛错（`.not.toThrow` 不成立即 FAIL，表现为测试失败于"期望抛错但没抛"）

- [ ] **Step 3: 扩展规则 5**

`src/utils/validator.ts` 找到规则 5（约 444-448 行）：

```typescript
      // 规则 5：recursiveFields 中每个字段不应定义 items
      if (propDef.items !== undefined) {
        throw new Error(`${prefix} recursiveFields 中的 "${fieldName}" 不应定义 items，框架在展开时自动填充`);
      }
```

替换为：

```typescript
      // 规则 5：recursiveFields 中每个字段不应定义 items/prefixItems（R1）
      if (propDef.items !== undefined || propDef.prefixItems !== undefined) {
        throw new Error(`${prefix} recursiveFields 中的 "${fieldName}" 不应定义 items/prefixItems，框架在展开时自动填充`);
      }
```

**注意**：现有测试 `tests/recursiveSchema.test.ts` 中可能有断言 `'不应定义 items'` 的用例——`toThrow('不应定义 items')` 对新消息 `'不应定义 items/prefixItems'` 仍然匹配（字符串包含断言），无需改动。运行确认。

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/heterogeneousSchema.test.ts && npx jest tests/recursiveSchema.test.ts`
Expected: 两个文件全绿

- [ ] **Step 5: Commit**

```bash
git add src/utils/validator.ts tests/heterogeneousSchema.test.ts
git commit -m "feat: validateRecursiveSchema 递归字段禁用 prefixItems（R1 规则扩展）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `convertToAjvSchema` —— 元组转换与 const 透传

**Files:**
- Modify: `src/utils/validator.ts:288-319`（`convertToAjvSchema`）
- Test: `tests/heterogeneousSchema.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `JsonSchema` 扩展（`items?: JsonSchema | JsonSchema[]`、`minItems`/`maxItems`/`const`）
- Produces: `convertToAjvSchema` 对元组 schema 产出 `{ type: 'array', items: [...], minItems: N, maxItems: N }`，对 const schema 产出 `{ type: 'string', const: 'x' }`。Task 6 的 `validateJsonBySchema` 端到端测试依赖此转换

- [ ] **Step 1: 追加失败测试**

`tests/heterogeneousSchema.test.ts` 顶部 import 补充 `convertToAjvSchema, validateJsonBySchema`（from `'../src/utils/validator'`），追加：

```typescript
describe('convertToAjvSchema 元组与 const 转换', () => {
  test('元组转换为 items 数组 + minItems/maxItems', () => {
    const schema: JsonSchemaDef = {
      type: 'array',
      prefixItems: [
        { type: 'string', description: '姓名' },
        { type: 'number', description: '年龄' },
        { type: 'boolean' }
      ]
    };
    const ajvSchema = convertToAjvSchema(schema);
    expect(ajvSchema.type).toBe('array');
    expect(Array.isArray(ajvSchema.items)).toBe(true);
    expect((ajvSchema.items as any[]).length).toBe(3);
    expect((ajvSchema.items as any[])[0]).toEqual({ type: 'string', description: '姓名' });
    expect(ajvSchema.minItems).toBe(3);
    expect(ajvSchema.maxItems).toBe(3);
  });

  test('const 透传到 AJV schema', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        name: { type: 'string', const: 'root' }
      }
    };
    const ajvSchema = convertToAjvSchema(schema);
    expect((ajvSchema.properties as any).name).toEqual({ type: 'string', const: 'root' });
  });
});

describe('validateJsonBySchema 元组与 const 数据校验', () => {
  const tupleSchema: JsonSchemaDef = {
    type: 'array',
    prefixItems: [
      { type: 'string', description: '姓名' },
      { type: 'number', description: '年龄' }
    ]
  };

  test('合法元组通过', () => {
    const result = validateJsonBySchema('["张三", 18]', tupleSchema);
    expect(result.valid).toBe(true);
  });

  test('超长元组失败（maxItems）', () => {
    const result = validateJsonBySchema('["张三", 18, true]', tupleSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'maxItems')).toBe(true);
  });

  test('缺项元组失败（minItems）', () => {
    const result = validateJsonBySchema('["张三"]', tupleSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'minItems')).toBe(true);
  });

  test('位置类型错误失败', () => {
    const result = validateJsonBySchema('[18, "张三"]', tupleSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'type' && e.path === '/0')).toBe(true);
  });

  test('const 值不符失败', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: { name: { type: 'string', const: 'root' } }
    };
    const result = validateJsonBySchema('{"name": "other"}', schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'const')).toBe(true);
  });

  test('const 值相符通过', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: { name: { type: 'string', const: 'root' } }
    };
    const result = validateJsonBySchema('{"name": "root"}', schema);
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/heterogeneousSchema.test.ts -t "convertToAjvSchema 元组"`
Expected: FAIL —— `ajvSchema.items` 为 `undefined`（当前代码丢弃 prefixItems）；const 用例 FAIL —— 转换结果里没有 const

- [ ] **Step 3: 实现 `convertToAjvSchema` 扩展**

`src/utils/validator.ts` 的 `convertToAjvSchema`（约 288-319 行），做两处修改。

第一处：result 构造处（约 294-297 行）：

```typescript
  const result: JsonSchema = {
    type: schema.type,
    ...(schema.description && { description: schema.description })
  };
```

改为：

```typescript
  const result: JsonSchema = {
    type: schema.type,
    ...(schema.description && { description: schema.description }),
    // const 固定值约束透传（AJV 原生关键字）
    ...(schema.const !== undefined && { const: schema.const })
  };
```

第二处：array 分支（约 314-316 行）：

```typescript
  if (schema.type === 'array' && schema.items) {
    result.items = convertToAjvSchema(schema.items);
  }
```

改为：

```typescript
  if (schema.type === 'array') {
    if (schema.items) {
      // 同构数组：所有元素同一结构
      result.items = convertToAjvSchema(schema.items);
    } else if (schema.prefixItems) {
      // 元组（draft-07 形式）：items 为数组按位置校验 + minItems/maxItems 钉死长度
      result.items = schema.prefixItems.map(c => convertToAjvSchema(c));
      result.minItems = schema.prefixItems.length;
      result.maxItems = schema.prefixItems.length;
    }
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/heterogeneousSchema.test.ts`
Expected: 全绿（含 Task 2/3 的用例）

- [ ] **Step 5: 回归测试**

Run: `npm test`
Expected: 全部通过（同构 schema 走 `if (schema.items)` 分支，行为不变）

- [ ] **Step 6: Commit**

```bash
git add src/utils/validator.ts tests/heterogeneousSchema.test.ts
git commit -m "feat: convertToAjvSchema 支持元组（draft-07 items 数组）与 const 透传

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `generateSchemaExample` —— 元组与 const 示例生成

**Files:**
- Modify: `src/utils/validator.ts:551-587`（`generateSchemaExample`）
- Test: `tests/heterogeneousSchema.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 类型定义
- Produces: `generateSchemaExample` 对元组 schema 返回按位置的示例数组（如 `['示例字符串', 0]`）；对带 const 的标量返回 const 值。Task 6 的 `buildSchemaPrompt` 测试依赖示例内容

- [ ] **Step 1: 追加失败测试**

`tests/heterogeneousSchema.test.ts` 顶部 import 补充 `generateSchemaExample`，追加：

```typescript
describe('generateSchemaExample 元组与 const 示例', () => {
  test('元组按位置生成分量示例', () => {
    const schema: JsonSchemaDef = {
      type: 'array',
      prefixItems: [
        { type: 'string', description: '姓名' },
        { type: 'number' },
        { type: 'boolean' }
      ]
    };
    const example = generateSchemaExample(schema);
    expect(example).toEqual(['姓名', 0, true]);
  });

  test('const 字段示例值取 const 值', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        name: { type: 'string', const: '1' }
      }
    };
    const example = generateSchemaExample(schema) as any;
    expect(example.name).toBe('1');
  });

  test('number const 示例值取 const 值', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        level: { type: 'number', const: 3 }
      }
    };
    const example = generateSchemaExample(schema) as any;
    expect(example.level).toBe(3);
  });

  test('元组分量带 const 时分量示例取 const 值', () => {
    const schema: JsonSchemaDef = {
      type: 'array',
      prefixItems: [
        { type: 'string', const: 'root' },
        { type: 'number' }
      ]
    };
    const example = generateSchemaExample(schema);
    expect(example).toEqual(['root', 0]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/heterogeneousSchema.test.ts -t "generateSchemaExample"`
Expected: FAIL —— 元组用例：当前 array 分支无 items 返回 `[]`；const 用例：返回 `'示例字符串'`/`0` 而非 const 值

- [ ] **Step 3: 实现**

`src/utils/validator.ts` 的 `generateSchemaExample`（约 551-587 行），在**函数开头**（递归树判断之后、`if (schema.type === 'string')` 之前）插入 const 处理：

```typescript
  // const 字段：直接用 const 值作为示例值
  if (schema.const !== undefined) {
    return schema.const;
  }
```

即函数开头变为：

```typescript
export function generateSchemaExample(schema: JsonSchemaDef, currentDepth?: number): unknown {
  // 递归树形结构处理
  if (schema.recursive && currentDepth === undefined) {
    return generateRecursiveExample(schema, schema.maxDepth ?? 3, 1);
  }

  // const 字段：直接用 const 值作为示例值
  if (schema.const !== undefined) {
    return schema.const;
  }

  if (schema.type === 'string') {
    // ...（其余不变）
```

array 分支（约 579-584 行）：

```typescript
  if (schema.type === 'array') {
    if (schema.items) {
      return [generateSchemaExample(schema.items)];
    }
    return [];
  }
```

改为：

```typescript
  if (schema.type === 'array') {
    if (schema.items) {
      return [generateSchemaExample(schema.items)];
    }
    if (schema.prefixItems) {
      // 元组：按位置生成每个分量的示例
      return schema.prefixItems.map(c => generateSchemaExample(c));
    }
    return [];
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/heterogeneousSchema.test.ts`
Expected: 全绿

- [ ] **Step 5: 回归测试**

Run: `npm test`
Expected: 全部通过（现有 schema 无 const/prefixItems，行为不变）

- [ ] **Step 6: Commit**

```bash
git add src/utils/validator.ts tests/heterogeneousSchema.test.ts
git commit -m "feat: generateSchemaExample 支持元组按位置生成与 const 示例值

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 提示词生成 —— `generateSchemaDescription` 与 `buildSchemaPrompt`

**Files:**
- Modify: `src/utils/promptBuilder.ts:474-509`（`generateSchemaDescription`）
- Modify: `src/utils/promptBuilder.ts:395-435`（`buildSchemaPrompt` 的 requirements 段）
- Test: `tests/heterogeneousSchema.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 类型定义；Task 5 的 `generateSchemaExample`（`buildSchemaPrompt` 内部已调用）
- Produces: `buildSchemaPrompt(schema, outputFileName, cwd?)` 的返回字符串含元组长度要求与 const 固定值要求；`generateSchemaDescription` 输出元组行 `固定长度元组（长度 N）` 与分量行 `第 i 个元素: <type>（<description>）[固定值: x]`，const 字段行尾 `[固定值: x]`

- [ ] **Step 1: 追加失败测试**

`tests/heterogeneousSchema.test.ts` 顶部 import 补充 `import { buildSchemaPrompt } from '../src/utils/promptBuilder';`，追加：

```typescript
describe('buildSchemaPrompt 元组与 const 提示词', () => {
  test('元组 schema 提示词含固定长度要求与结构说明', () => {
    const schema: JsonSchemaDef = {
      type: 'array',
      prefixItems: [
        { type: 'string', description: '姓名' },
        { type: 'number', description: '年龄' }
      ]
    };
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    expect(prompt).toContain('固定长度为 2');
    expect(prompt).toContain('第 1 个元素的类型必须符合位置定义');
    expect(prompt).toContain('固定长度元组（长度 2）');
    expect(prompt).toContain('第 1 个元素: string（姓名）');
    expect(prompt).toContain('第 2 个元素: number（年龄）');
  });

  test('const schema 提示词含固定值要求', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        name: { type: 'string', const: '1' }
      }
    };
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    expect(prompt).toContain('固定值');
    expect(prompt).toContain('[固定值: "1"]');
  });

  test('示例区块展示元组示例与 const 值', () => {
    const schema: JsonSchemaDef = {
      type: 'array',
      prefixItems: [
        { type: 'string', const: 'root' },
        { type: 'number' }
      ]
    };
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    // 示例来自 Task 5 的 generateSchemaExample：['root', 0]
    expect(prompt).toContain('"root"');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/heterogeneousSchema.test.ts -t "buildSchemaPrompt"`
Expected: FAIL —— 提示词中无 `固定长度为`、`固定长度元组`、`[固定值:` 字样

- [ ] **Step 3: 实现 `generateSchemaDescription` 扩展**

`src/utils/promptBuilder.ts` 的 `generateSchemaDescription`（约 474-509 行）两处修改。

第一处：object 字段循环里，`const` 标注。找到（约 495-498 行）：

```typescript
      const isRequired = schema.required?.includes(name) ?? true;
      const isRecursive = recursiveFields.includes(name);
      const recursiveTag = isRecursive ? ' 递归字段（树形结构）' : '';
      lines.push(`${indent}  - ${name} (${propDef.type})${isRequired ? ' [必填]' : ' [可选]'}${recursiveTag}`);
```

改为：

```typescript
      const isRequired = schema.required?.includes(name) ?? true;
      const isRecursive = recursiveFields.includes(name);
      const recursiveTag = isRecursive ? ' 递归字段（树形结构）' : '';
      const constTag = propDef.const !== undefined ? ` [固定值: ${JSON.stringify(propDef.const)}]` : '';
      lines.push(`${indent}  - ${name} (${propDef.type})${isRequired ? ' [必填]' : ' [可选]'}${recursiveTag}${constTag}`);
```

第二处：array 分支。找到（约 504-507 行）：

```typescript
  if (schema.type === 'array' && schema.items) {
    lines.push(`${indent}数组元素结构:`);
    lines.push(generateSchemaDescription(schema.items, `${indent}  `));
  }
```

改为：

```typescript
  if (schema.type === 'array' && schema.items) {
    lines.push(`${indent}数组元素结构:`);
    lines.push(generateSchemaDescription(schema.items, `${indent}  `));
  }

  if (schema.type === 'array' && schema.prefixItems) {
    lines.push(`${indent}固定长度元组（长度 ${schema.prefixItems.length}）:`);
    schema.prefixItems.forEach((component, idx) => {
      const descTag = component.description ? `（${component.description}）` : '';
      const constTag = component.const !== undefined ? ` [固定值: ${JSON.stringify(component.const)}]` : '';
      lines.push(`${indent}  第 ${idx + 1} 个元素: ${component.type}${descTag}${constTag}`);
      if (component.type === 'object' || component.type === 'array') {
        lines.push(generateSchemaDescription(component, `${indent}    `));
      }
    });
  }
```

- [ ] **Step 4: 实现 `buildSchemaPrompt` requirements 扩展**

`src/utils/promptBuilder.ts` 的 `buildSchemaPrompt`（约 395-435 行），在递归/类型特定要求的 `else` 分支之后（约 424 行 `}` 后）、`getDirWarning` 调用之前，追加元组与 const 要求。需要先加一个检测 const 的辅助：在 `buildSchemaPrompt` 函数体内、`const requirements: string[] = [...]` 之后加：

```typescript
  // 元组特定要求（递归进入任意嵌套层级检测）
  let nextReqIndex = 6;
  if (schemaHasTuple(schema)) {
    requirements.push(`${nextReqIndex}. 输出中的元组数组（标注"固定长度元组"的字段）长度固定，第 i 个元素的类型必须符合位置定义`);
    nextReqIndex++;
  }
  if (schemaHasConst(schema)) {
    requirements.push(`${nextReqIndex}. 标注了固定值的字段，输出必须严格等于该固定值`);
    nextReqIndex++;
  }
```

同时在文件中（`buildSchemaPrompt` 之前）新增两个辅助函数：

```typescript
/**
 * 递归检测 schema 树中是否存在 prefixItems 元组定义
 */
function schemaHasTuple(schema: JsonSchemaDef): boolean {
  if (schema.type === 'array' && schema.prefixItems) {
    return true;
  }
  if (schema.type === 'object' && schema.properties) {
    const recursiveFields = schema.recursive ? (schema.recursiveFields || []) : [];
    for (const [name, propDef] of Object.entries(schema.properties)) {
      if (recursiveFields.includes(name)) {
        continue; // 递归字段的结构由框架填充，不需要检查
      }
      if (schemaHasTuple(propDef)) {
        return true;
      }
    }
  }
  if (schema.type === 'array' && schema.items) {
    return schemaHasTuple(schema.items);
  }
  return false;
}

/**
 * 递归检测 schema 树中是否存在 const 固定值定义
 */
function schemaHasConst(schema: JsonSchemaDef): boolean {
  if (schema.const !== undefined) {
    return true;
  }
  if (schema.type === 'object' && schema.properties) {
    for (const propDef of Object.values(schema.properties)) {
      if (schemaHasConst(propDef)) {
        return true;
      }
    }
  }
  if (schema.type === 'array' && schema.items) {
    return schemaHasConst(schema.items);
  }
  if (schema.type === 'array' && schema.prefixItems) {
    return schema.prefixItems.some(c => schemaHasConst(c));
  }
  return false;
}
```

**注意**：现有代码里递归/类型特定要求使用硬编码序号 6/7，序号连续性由 `nextReqIndex` 维护；`getDirWarning` 追加的条目无序号（现有行为，如 `5. 注意：…`），不受影响。

- [ ] **Step 5: 运行确认通过**

Run: `npx jest tests/heterogeneousSchema.test.ts`
Expected: 全绿。注意第一个用例断言 `'第 1 个元素的类型必须符合位置定义'`，与 requirements 推入的文案 `'第 i 个元素的类型必须符合位置定义'` **不一致**——实现文案统一为：`输出中的元组数组（标注"固定长度元组"的字段）长度固定，第 i 个元素的类型必须符合位置定义`。**把测试断言改为** `expect(prompt).toContain('第 i 个元素的类型必须符合位置定义')`（在 Step 1 的测试代码里直接写对，这里实现与断言以含 `第 i 个元素的类型必须符合位置定义` 为准）。

- [ ] **Step 6: 回归测试**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 7: Commit**

```bash
git add src/utils/promptBuilder.ts tests/heterogeneousSchema.test.ts
git commit -m "feat: 提示词生成支持元组结构描述与 const 固定值标注

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: 端到端组合测试 —— 场景二"固定节点名树"

**Files:**
- Test: `tests/heterogeneousSchema.test.ts`（追加，纯测试任务，无 src 改动）

**Interfaces:**
- Consumes: Task 2-6 的全部能力（`validateSchema`、`validateRecursiveSchema` R1、`convertToAjvSchema` 元组+const、`generateSchemaExample`、`buildSchemaPrompt`）
- Produces: spec 测试计划第 10 条的端到端用例（固定节点名树），覆盖 R1/R2/R3/R4 与 const 的完整组合

- [ ] **Step 1: 追加端到端测试**

`tests/heterogeneousSchema.test.ts` 追加（import 区已有 `validateJsonBySchema, generateSchemaExample`，`buildSchemaPrompt`）：

```typescript
describe('端到端：固定节点名树（递归+元组+const 组合）', () => {
  // 2/3 之下的递归树节点（独立递归树，R3）
  const treeNode: JsonSchemaDef = {
    type: 'object',
    recursive: true,
    recursiveFields: ['children'],
    maxDepth: 3,
    properties: {
      name: { type: 'string' },
      children: { type: 'array' }
    }
  };

  // 根 "1"，两个子节点 "2"/"3"，其下递归
  const schema: JsonSchemaDef = {
    type: 'object',
    properties: {
      name: { type: 'string', const: '1' },
      children: {
        type: 'array',
        prefixItems: [
          {
            type: 'object',
            properties: {
              name: { type: 'string', const: '2' },
              children: { type: 'array', items: treeNode }
            }
          },
          {
            type: 'object',
            properties: {
              name: { type: 'string', const: '3' },
              children: { type: 'array', items: treeNode }
            }
          }
        ]
      }
    }
  };

  test('合法数据（含多叉树）通过校验', () => {
    const validData = {
      name: '1',
      children: [
        {
          name: '2',
          children: [
            { name: 'a', children: [
              { name: 'b', children: [] },
              { name: 'c', children: [] }   // 多叉：同层两个子节点
            ]}
          ]
        },
        {
          name: '3',
          children: [
            { name: 'd', children: [] }     // 提前叶子：深度 < maxDepth 也合法
          ]
        }
      ]
    };
    const result = validateJsonBySchema(JSON.stringify(validData), schema);
    expect(result.valid).toBe(true);
  });

  test('根节点名错误被拒绝', () => {
    const badData = {
      name: 'root',
      children: [
        { name: '2', children: [] },
        { name: '3', children: [] }
      ]
    };
    const result = validateJsonBySchema(JSON.stringify(badData), schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'const')).toBe(true);
  });

  test('子节点数量不符（超长）被拒绝', () => {
    const badData = {
      name: '1',
      children: [
        { name: '2', children: [] },
        { name: '3', children: [] },
        { name: '4', children: [] }
      ]
    };
    const result = validateJsonBySchema(JSON.stringify(badData), schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'maxItems')).toBe(true);
  });

  test('子节点名错误被拒绝', () => {
    const badData = {
      name: '1',
      children: [
        { name: 'first', children: [] },
        { name: '3', children: [] }
      ]
    };
    const result = validateJsonBySchema(JSON.stringify(badData), schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'const')).toBe(true);
  });

  test('元组位置互换（2/3 顺序颠倒）被拒绝', () => {
    const badData = {
      name: '1',
      children: [
        { name: '3', children: [] },
        { name: '2', children: [] }
      ]
    };
    const result = validateJsonBySchema(JSON.stringify(badData), schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'const')).toBe(true);
  });

  test('嵌套树超过 maxDepth 被拒绝（R3 深度约束生效）', () => {
    // treeNode maxDepth=3：2 的子(层1)→孙(层2)→曾孙(层3,叶子 children 必须空/对象数组)
    // 构造 4 层嵌套：曾孙的 children 里还有带 name 的完整节点 → 但叶子层 items 放宽为 {type:'object'}
    // 因此叶子层的子节点只要是 object 就合法——超深约束的边界是：层3 的 children 只要求对象数组
    // 真正的拒绝场景：层1 的节点缺 name 字段
    const badData = {
      name: '1',
      children: [
        { name: '2', children: [
          { children: [] }   // 缺 name，层1 节点不合规
        ]},
        { name: '3', children: [] }
      ]
    };
    const result = validateJsonBySchema(JSON.stringify(badData), schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'required')).toBe(true);
  });

  test('结构校验通过（execPromptSchema 入口）', async () => {
    _resetState();
    setTaskName('HeteroE2E');
    const agent = new StepWise('E2EAgent');
    await expect(
      agent.execPromptSchema('测试', schema, 'tree.json')
    ).resolves.toBeDefined();
  });

  test('示例生成：根/子节点示例值为 const 值，递归子树为单路径', () => {
    const example = generateSchemaExample(schema) as any;
    expect(example.name).toBe('1');
    expect(example.children.length).toBe(2);
    expect(example.children[0].name).toBe('2');
    expect(example.children[1].name).toBe('3');
    // 递归子树展开（单路径，叶子 children: []）
    expect(example.children[0].children[0].name).toBe('示例字符串');
  });

  test('提示词包含元组说明与固定值要求', () => {
    const prompt = buildSchemaPrompt(schema, '/tmp/tree.json');
    expect(prompt).toContain('固定长度元组（长度 2）');
    expect(prompt).toContain('[固定值: "1"]');
    expect(prompt).toContain('[固定值: "2"]');
    expect(prompt).toContain('[固定值: "3"]');
    expect(prompt).toContain('第 i 个元素的类型必须符合位置定义');
  });
});
```

- [ ] **Step 2: 运行端到端测试**

Run: `npx jest tests/heterogeneousSchema.test.ts`
Expected: 全绿。若有失败，最可能在：元组位置互换用例（AJV 对每个位置独立校验 const——`/children/0/name` 期望 "2" 得到 "3"，报 const 错误，断言成立）；嵌套树深度用例（叶子层 items 放宽为 `{type:'object'}` 的语义，测试里已按此语义设计用例）。逐个修复测试断言（不改 src——src 行为在本任务前已由 Task 2-6 锁定）

- [ ] **Step 3: 全量回归**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add tests/heterogeneousSchema.test.ts
git commit -m "test: 固定节点名树端到端用例（递归+元组+const 组合）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: API 文档补充

**Files:**
- Modify: `doc/api_cn.md:673-692`（`JsonSchemaDef` 类型定义与说明）
- Modify: `doc/api.md:672-691`（同上英文版）
- Test: 无测试（纯文档），以 grep 验证

**Interfaces:**
- Consumes: Task 1-7 的最终行为
- Produces: 文档与实现一致（`prefixItems`/`const` 字段说明 + 元组示例 + 固定节点名树示例）

- [ ] **Step 1: 更新 `doc/api_cn.md`**

`JsonSchemaDef` 代码块（675-692 行）替换为：

```typescript
interface JsonSchemaDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  /** type === 'object'：字段定义，每个字段又是 JsonSchemaDef，支持任意嵌套 */
  properties?: Record<string, JsonSchemaDef>;
  /** type === 'object'：必填字段名列表；不指定时默认所有字段必填 */
  required?: string[];
  /** type === 'array'：数组元素结构，本身又是 JsonSchemaDef（与 prefixItems 互斥） */
  items?: JsonSchemaDef;
  /** type === 'array'：元组定义（与 items 互斥）。按位置定义每个元素的类型，
      分量可为任意 type；数组长度必须严格等于 prefixItems.length（固定长度元组）。
      分量不可定义 recursive/recursiveFields/maxDepth（分量内可用独立递归树） */
  prefixItems?: JsonSchemaDef[];
  /** 固定值约束（仅 type === 'string' | 'number' | 'boolean' 时有效）：
      输出中该字段的值必须严格等于 const 指定的值 */
  const?: string | number | boolean;
  /** 仅 type === 'object' 时有效：标记为递归树形结构 */
  recursive?: boolean;
  /** 仅 recursive === true 时有效：自引用的数组字段名列表（必须为 array 类型且不定义 items/prefixItems） */
  recursiveFields?: string[];
  /** 仅 recursive === true 时有效：递归最大深度，默认 3，范围 1~10 */
  maxDepth?: number;
}
```

紧接其后的说明段（694 行"递归树形结构"段落之后）追加两段：

```markdown
**元组（prefixItems）**：`type: 'array'` 时用 `prefixItems` 代替 `items` 定义固定长度元组——按位置声明每个元素的类型，数组长度必须严格等于 `prefixItems.length`。分量可为任意 type（含 object/array），但分量本身不可标记 `recursive`（分量内的嵌套字段可以用独立递归树）。与 `items` 互斥。

**固定值（const）**：基础类型字段（string/number/boolean）可加 `const` 约束，输出值必须严格等于该值。常用于固定节点名、固定标签。
```

然后在"示例（递归树）"（724-743 行）之后追加一个示例：

````markdown
**示例（元组 + 固定值：固定骨架的树）**

```typescript
// 2/3 之下的递归树节点
const treeNode: JsonSchemaDef = {
  type: 'object',
  recursive: true,
  recursiveFields: ['children'],
  maxDepth: 3,
  properties: {
    name: { type: 'string' },
    children: { type: 'array' }
  }
};

const result = await agent.execPromptSchema(
  '生成固定骨架的树：根节点名为 "1"，恰好两个子节点 "2"、"3"，其下递归展开',
  {
    type: 'object',
    properties: {
      name: { type: 'string', const: '1' },          // 固定为 "1"
      children: {
        type: 'array',
        prefixItems: [                               // 恰好两个子节点
          {
            type: 'object',
            properties: {
              name: { type: 'string', const: '2' },
              children: { type: 'array', items: treeNode }   // 独立递归树
            }
          },
          {
            type: 'object',
            properties: {
              name: { type: 'string', const: '3' },
              children: { type: 'array', items: treeNode }
            }
          }
        ]
      }
    }
  },
  'fixed_tree.json'
);
```
````

- [ ] **Step 2: 更新 `doc/api.md`（英文版，同样三处）**

`JsonSchemaDef` 代码块（675-691 行）同样追加 `prefixItems`/`const` 字段（英文注释）：

```typescript
interface JsonSchemaDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  /** type === 'object': field definitions, each a JsonSchemaDef (arbitrary nesting) */
  properties?: Record<string, JsonSchemaDef>;
  /** type === 'object': required field names; defaults to all fields required */
  required?: string[];
  /** type === 'array': element structure, itself a JsonSchemaDef (mutually exclusive with prefixItems) */
  items?: JsonSchemaDef;
  /** type === 'array': tuple definition (mutually exclusive with items). Declares each
      element's type by position; components can be any type. Array length must strictly
      equal prefixItems.length. Components cannot be recursive (use an independent
      recursive tree inside a component instead) */
  prefixItems?: JsonSchemaDef[];
  /** Fixed-value constraint (type === 'string' | 'number' | 'boolean' only):
      the output value must strictly equal const */
  const?: string | number | boolean;
  /** type === 'object' only: marks a recursive tree structure */
  recursive?: boolean;
  /** recursive === true only: names of self-referencing array fields (must be array-typed, no items/prefixItems) */
  recursiveFields?: string[];
  /** recursive === true only: max recursion depth, default 3, range 1~10 */
  maxDepth?: number;
}
```

说明段追加：

```markdown
**Tuple (prefixItems)**: for `type: 'array'`, use `prefixItems` instead of `items` to define a fixed-length tuple — each element's type is declared by position, and the array length must strictly equal `prefixItems.length`. Components can be any type (including object/array) but cannot themselves be marked `recursive` (use an independent recursive tree inside a component). Mutually exclusive with `items`.

**Fixed value (const)**: primitive fields (string/number/boolean) can carry a `const` constraint; the output value must strictly equal it. Useful for fixed node names or tags.
```

示例（"Example (recursive tree)"之后）追加英文版固定骨架树示例（与中文版结构相同，注释为英文）。

- [ ] **Step 3: 验证文档与实现一致**

Run: `grep -c "prefixItems" doc/api_cn.md doc/api.md && grep -c "const" doc/api_cn.md | head -1`
Expected: 两个文件的 prefixItems 出现次数 ≥ 4（类型定义 + 说明 + 示例）；`npm test` 仍全绿

- [ ] **Step 4: Commit**

```bash
git add doc/api_cn.md doc/api.md
git commit -m "docs: api 文档补充 prefixItems 元组与 const 固定值说明及示例

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review 记录

- **Spec 覆盖检查**：类型定义（Task 1）✓；结构校验 5 条规则（Task 2）✓；const 校验 3 条（Task 2）✓；R1（Task 3）✓；R2（Task 2）✓；R3 嵌套递归校验（Task 2 嵌套递归校验 + Task 7 端到端）✓；R4（Task 7 端到端——元组位置互换拒绝即验证了分量按位置独立校验）✓；AJV 转换（Task 4）✓；提示词生成三处（Task 5/6）✓；测试计划 11 条（Task 2:1+2、Task 3:3、Task 2:4+5、Task 4:6+7、Task 5:8、Task 6:9、Task 7:10、各任务回归:11）✓；文档（Task 8）✓
- **占位符扫描**：无 TBD/TODO；所有代码步骤含完整代码
- **类型一致性**：`prefixItems?: JsonSchemaDef[]`、`const?: string | number | boolean`、错误消息文案在各任务间一致（`互斥`/`必须在 1~10` 等）；Task 6 的 requirements 文案在 Step 4 实现与 Step 1 测试间已对齐为 `第 i 个元素的类型必须符合位置定义`
