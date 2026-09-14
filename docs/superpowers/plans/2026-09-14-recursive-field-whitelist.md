# 递归字段白名单校验（修复 const 逃逸家族）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `validateRecursiveSchema` 规则 5 从黑名单（items/prefixItems）升级为白名单（递归字段仅允许 `type`/`description`），一次拦截 const、recursive、maxDepth、properties 等所有会被框架静默丢弃或语义不成立的字段，消除"提示词承诺约束但 AJV 不校验"的逃逸家族。

**Architecture:** 单点修复。`validateRecursiveSchema` 是所有递归 object 节点（顶层 + 嵌套，经 `StepWise.validateSchema` 规则 8）的唯一校验入口，规则 5 白名单化后整个家族在结构校验层拦截，下游提示词/AJV 层不可达。配套：`schemaHasConst` 补跳过递归字段（消除与 `schemaHasTuple` 的语义不对称，防御公共 API 直调路径）；`types.ts` 与双语文档的 `recursiveFields` 注释同步。

**Tech Stack:** TypeScript strict、Jest + ts-jest。无新依赖。

**Spec 背景:** 合并后审查（Minor-1）发现：递归字段 `children: { type:'array', const:'x' }` 被三层不一致对待——validateSchema 跳过、schemaHasConst 承诺 `[固定值: "x"]` 标注、unrollLayer 丢弃 const → AJV 不校验。且 const 在 array 上语义不成立（整个数组等于字符串），正确修法是结构校验拦截。用户已确认方案 B（白名单）。

## Global Constraints

- TypeScript strict 模式，禁止 `any`（测试断言处 `as any` 例外）
- 测试框架 Jest：`npx jest <file>` 单文件运行；每任务结束 `npm test` 全绿
- 错误消息前缀 `[StepWise.execPromptSchema]`（validateRecursiveSchema 现有惯例，`prefix` 常量）
- **不得破坏合法组合**：递归对象的**非递归字段**带 const（如每层节点 `kind: { type:'string', const:'node' }`）是 spec 明确支持的能力，必须有回归用例
- 白名单语义：递归字段定义中仅 `type` 与 `description` 两个 key 合法，其余一律报错（含 items/prefixItems/const/recursive/recursiveFields/maxDepth/properties/required 及未来 anyOf）
- 错误消息必须给出替代方案指引（约束请定义在节点的非递归字段上）
- 提交信息中文，末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## 文件结构总览

| 文件 | 改动 |
|---|---|
| `src/utils/validator.ts` | 规则 5 白名单化（约 456 行处）；函数 doc 的规则描述同步 |
| `src/utils/promptBuilder.ts` | `schemaHasConst` 补跳过递归字段（约 414-432 行） |
| `src/types.ts:140-144` | `recursiveFields` 注释更新为白名单描述 |
| `tests/heterogeneousSchema.test.ts` | R1 describe 改名 + 2 处断言更新 + 新增 const/白名单/回归用例 |
| `tests/recursiveSchema.test.ts:116-131` | 规则 5 describe 改名 + 断言更新 + 新增用例 |
| `tests/StepWise.execPromptSchema.test.ts:265-278` | 断言更新 |
| `doc/api_cn.md:694` / `doc/api.md:694` | `recursiveFields` 注释同步 |

---

### Task 1: 规则 5 白名单化 + 测试更新

**Files:**
- Modify: `src/utils/validator.ts:400-467`（规则 5 及函数 doc）
- Modify: `tests/recursiveSchema.test.ts:116-131`
- Modify: `tests/StepWise.execPromptSchema.test.ts:265-278`
- Modify: `tests/heterogeneousSchema.test.ts:199-231`

**Interfaces:**
- Consumes: `validateRecursiveSchema(schema: JsonSchemaDef): void`（现有签名不变）
- Produces: 规则 5 对递归字段定义中 type/description 之外的任何 key 抛错，消息格式 `recursiveFields 中的 "<字段名>" 仅允许 type/description，发现多余字段: <keys>（递归字段的结构由框架自动填充；固定值等约束请定义在节点的非递归字段上）`。下游（提示词/AJV）无需改动即可受益——白名单拦截后递归字段上的 const 不可达。

- [ ] **Step 1: 写失败测试**

**1a.** `tests/recursiveSchema.test.ts` 的 `describe('规则 5: recursiveFields 不应定义 items', ...)`（116-131 行）整体替换为：

```typescript
    describe('规则 5: recursiveFields 白名单（仅允许 type/description）', () => {
      it('recursiveFields 字段定义了 items 应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          properties: {
            name: { type: 'string' },
            children: {
              type: 'array',
              items: { type: 'string' }  // 不应定义 items
            }
          }
        };
        expect(() => validateRecursiveSchema(schema)).toThrow('仅允许 type/description');
      });

      it('recursiveFields 字段定义了 const 应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          properties: {
            name: { type: 'string' },
            children: {
              type: 'array',
              const: 'x'
            } as any
          }
        };
        expect(() => validateRecursiveSchema(schema)).toThrow('仅允许 type/description');
      });

      it('recursiveFields 字段带多余 keys 的错误消息应列出 keys', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          properties: {
            name: { type: 'string' },
            children: {
              type: 'array',
              const: 'x',
              maxDepth: 3
            } as any
          }
        };
        expect(() => validateRecursiveSchema(schema)).toThrow(/发现多余字段: const\/maxDepth/);
      });

      it('recursiveFields 字段仅带 description 不应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          properties: {
            name: { type: 'string' },
            children: {
              type: 'array',
              description: '子节点列表（递归定义）'
            }
          }
        };
        expect(() => validateRecursiveSchema(schema)).not.toThrow();
      });
    });
```

**1b.** `tests/StepWise.execPromptSchema.test.ts:277` 的断言 `.rejects.toThrow('不应定义 items')` 改为 `.rejects.toThrow('仅允许 type/description')`（schema 本身不变——children 带 items 仍应被拦）。

**1c.** `tests/heterogeneousSchema.test.ts` 的 `describe('R1: 递归字段不得定义 items/prefixItems', ...)`（约 199-231 行）整体替换为：

```typescript
  describe('R1: 递归字段白名单（仅允许 type/description）', () => {
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
      expect(() => validateRecursiveSchema(schema)).toThrow('仅允许 type/description');
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
      expect(() => validateRecursiveSchema(schema)).toThrow('仅允许 type/description');
    });

    test('递归字段带 const 应抛错（const 逃逸修复）', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        properties: {
          name: { type: 'string' },
          children: { type: 'array', const: 'x' } as any
        }
      };
      expect(() => validateRecursiveSchema(schema)).toThrow('仅允许 type/description');
    });

    test('递归字段带 const 经 execPromptSchema 入口端到端拒绝', async () => {
      const agent = new StepWise('R1ConstE2E');
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        properties: {
          name: { type: 'string' },
          children: { type: 'array', const: 'x' } as any
        }
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('仅允许 type/description');
    });

    test('回归：递归对象的非递归字段带 const 仍合法（spec 支持的组合）', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        properties: {
          kind: { type: 'string', const: 'node' },
          name: { type: 'string' },
          children: { type: 'array' }
        }
      };
      expect(() => validateRecursiveSchema(schema)).not.toThrow();
    });
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/recursiveSchema.test.ts tests/heterogeneousSchema.test.ts`
Expected: FAIL —— const 用例当前不抛错（`.not.toThrow` 不成立即 "Received function did not throw"）；items 用例因消息文案变化断言失败。`StepWise.execPromptSchema.test.ts` 同理。

- [ ] **Step 3: 实现规则 5 白名单**

`src/utils/validator.ts` 规则 5（454-457 行）：

```typescript
      // 规则 5：recursiveFields 中每个字段不应定义 items/prefixItems（R1）
      if (propDef.items !== undefined || propDef.prefixItems !== undefined) {
        throw new Error(`${prefix} recursiveFields 中的 "${fieldName}" 不应定义 items/prefixItems，框架在展开时自动填充`);
      }
```

替换为：

```typescript
      // 规则 5：递归字段白名单——仅允许 type/description（R1）
      // 递归字段的结构由框架展开时自动填充（items 自引用），其余字段要么被静默丢弃
      // （prefixItems/const/recursive 等），要么语义不成立（递归字段必为 array，const 仅适用基础类型）。
      // 白名单一次拦截整个家族，避免逐字段打补丁。
      const extraKeys = Object.keys(propDef).filter(k => k !== 'type' && k !== 'description');
      if (extraKeys.length > 0) {
        throw new Error(`${prefix} recursiveFields 中的 "${fieldName}" 仅允许 type/description，发现多余字段: ${extraKeys.join('/')}（递归字段的结构由框架自动填充；固定值等约束请定义在节点的非递归字段上）`);
      }
```

同时更新函数 doc（400-413 行）规则清单第 5 条：

```typescript
 * 5. recursiveFields 中每个字段仅允许 type/description（白名单）
```

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/recursiveSchema.test.ts tests/heterogeneousSchema.test.ts tests/StepWise.execPromptSchema.test.ts`
Expected: 三个文件全绿

- [ ] **Step 5: 全量回归**

Run: `npm test && npm run build`
Expected: 全部通过（现有 schema 的递归字段均只带 type/description，白名单不影响）

- [ ] **Step 6: Commit**

```bash
git add src/utils/validator.ts tests/recursiveSchema.test.ts tests/heterogeneousSchema.test.ts tests/StepWise.execPromptSchema.test.ts
git commit -m "fix: 递归字段白名单校验，拦截 const/items/prefixItems 等静默逃逸字段

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `schemaHasConst` 对称性 + 类型/文档注释同步

**Files:**
- Modify: `src/utils/promptBuilder.ts:414-432`（`schemaHasConst`）
- Modify: `src/types.ts:140-144`（`recursiveFields` 注释）
- Modify: `doc/api_cn.md:694` / `doc/api.md:694`
- Test: `tests/heterogeneousSchema.test.ts`（追加 1 个用例）

**Interfaces:**
- Consumes: Task 1 的白名单校验（主路径上递归字段带 const 已被拦截，本任务是防御 + 一致性）
- Produces: `schemaHasConst` 跳过递归字段——递归树根的 const 检测只看非递归字段；`recursiveFields` 注释与实现一致

- [ ] **Step 1: 写失败测试**

`tests/heterogeneousSchema.test.ts` 的 `describe('buildSchemaPrompt 元组与 const 提示词', ...)` 内追加：

```typescript
  test('递归字段上的 const 不应触发固定值要求（结构非法，主路径已被白名单拦截）', () => {
    // 模拟公共 API 直调（绕过 execPromptSchema 的 validateSchema）：
    // schemaHasConst 不应把递归字段上的 const 算进去
    const schema: JsonSchemaDef = {
      type: 'object',
      recursive: true,
      recursiveFields: ['children'],
      properties: {
        name: { type: 'string' },
        children: { type: 'array', const: 'x' } as any
      }
    };
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    expect(prompt).not.toContain('[固定值: "x"]');
    expect(prompt).not.toContain('标注了固定值的字段');
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/heterogeneousSchema.test.ts -t "递归字段上的 const"`
Expected: FAIL —— 当前 `schemaHasConst` 会命中 children 的 const，提示词含 `[固定值: "x"]` 与固定值要求

- [ ] **Step 3: 实现 `schemaHasConst` 跳过递归字段**

`src/utils/promptBuilder.ts` 的 `schemaHasConst`（414-432 行）替换为：

```typescript
/**
 * 递归检测 schema 树中是否存在 const 固定值定义
 * 跳过递归字段（与 schemaHasTuple 对称）：递归字段的结构由框架填充，
 * 其上的 const 会被白名单校验拦截（validateRecursiveSchema 规则 5），不产生运行时约束
 */
function schemaHasConst(schema: JsonSchemaDef): boolean {
  if (schema.const !== undefined) {
    return true;
  }
  if (schema.type === 'object' && schema.properties) {
    const recursiveFields = schema.recursive ? (schema.recursiveFields || []) : [];
    for (const [name, propDef] of Object.entries(schema.properties)) {
      if (recursiveFields.includes(name)) {
        continue;
      }
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

- [ ] **Step 4: 运行确认通过**

Run: `npx jest tests/heterogeneousSchema.test.ts`
Expected: 全绿

- [ ] **Step 5: 同步类型与文档注释**

`src/types.ts:139-142` 的 `recursiveFields` 注释：

```typescript
  /**
   * 递归字段名称列表（仅 recursive === true 时有效）
   * 列出的字段必须是 type === 'array' 的属性，且仅允许 type/description（白名单）
   * 框架在 schema 展开时自动填充 items 为自引用结构
   */
```

`doc/api_cn.md:694`：

```
  /** 仅 recursive === true 时有效：自引用的数组字段名列表（必须为 array 类型，仅允许 type/description） */
```

`doc/api.md:694`：

```
  /** recursive === true only: names of self-referencing array fields (must be array-typed, only type/description allowed) */
```

- [ ] **Step 6: 全量回归 + Commit**

Run: `npm test && npm run build`
Expected: 全部通过

```bash
git add src/utils/promptBuilder.ts src/types.ts doc/api_cn.md doc/api.md tests/heterogeneousSchema.test.ts
git commit -m "fix: schemaHasConst 跳过递归字段，同步 recursiveFields 白名单注释

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review 记录

- **逃逸家族覆盖**：const（本修复主目标）、items/prefixItems（原有）、recursive/recursiveFields/maxDepth/properties/required（顺带覆盖）——白名单一次拦截全部；未来 anyOf 亦覆盖
- **合法组合不破坏**：Task 1 Step 1c 末尾用例锁定"递归对象非递归字段带 const 合法"；`description` 白名单放行有专测（Task 1 Step 1a 第 4 例）
- **下游一致性**：`schemaHasConst` 与 `schemaHasTuple` 对称（均跳过递归字段）；`unrollLayer`/`generateRecursiveExample` 无需改动——白名单拦截后递归字段上不存在会被丢弃的字段
- **既有断言更新清单**（3 处，均已核实原文）：recursiveSchema.test.ts:130、StepWise.execPromptSchema.test.ts:277、heterogeneousSchema.test.ts:213/229（后两者在 R1 describe 重写中一并处理）
- **无占位符**；错误消息与断言文案一致（`仅允许 type/description` / `发现多余字段: const/maxDepth`）
