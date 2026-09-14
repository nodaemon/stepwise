# JsonSchemaDef 异构数组（元组）支持设计

- 日期：2026-09-11
- 状态：已确认（待实现）
- 范围：`execPromptSchema` 的 schema 定义与校验链路

## 背景与目标

`JsonSchemaDef` 当前的数组能力只有 `items?: JsonSchemaDef`，即所有元素必须符合同一个 schema（同构数组）。本设计为 `JsonSchemaDef` 新增**元组（tuple）语义的异构数组**支持：

- 按位置定义每个元素的类型（分量可为任意 type：string/number/boolean/object/array）
- 固定长度严格匹配：数组长度必须等于 `prefixItems.length`
- 可在 schema 任意嵌套层级使用
- 与递归树形结构（`recursive`）可组合

明确不做（本期范围外）：

- `anyOf` 联合数组（元素匹配多分支之一）——用户确认后续再实现
- 变长元组（尾部额外元素）——固定长度语义已覆盖目标场景

## 类型定义

`src/types.ts` 的 `JsonSchemaDef` 新增两个可选字段：

```typescript
export interface JsonSchemaDef {
  // ...现有字段不变...
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
}
```

### const 校验规则

- `type` 为 `object`/`array` 时出现 `const` 抛错（结构类型无固定值语义）
- `const` 的值必须与 `type` 匹配：`type: 'string'` 时 const 必须是 string，`type: 'number'` 时必须是 number，`type: 'boolean'` 时必须是 boolean，不匹配抛错
- const 可出现在任意层级：对象属性、数组 items、元组分量、递归树节点（含递归字段所在对象）


## 校验规则

### 结构校验（`StepWise.validateSchema`，src/StepWise.ts）

1. `type === 'array'` 时必须提供 `items` 或 `prefixItems` **之一**（放宽现有"必须 items"的检查）
2. 互斥：`items` 与 `prefixItems` 同现抛错
3. `type !== 'array'` 时出现 `prefixItems` 抛错
4. `prefixItems` 为空数组抛错（空元组无意义）
5. 每个分量递归走 `validateSchema`，错误消息带分量位置：`schema.prefixItems[0]: ...`

### 元组 × 递归组合规则

| 规则 | 内容 | 实现位置 |
|---|---|---|
| R1 | 递归字段（recursiveFields 成员）不得定义 `items` 或 `prefixItems`（现有"不应定义 items"规则扩展） | `validateRecursiveSchema` |
| R2 | 元组分量（prefixItems 直接成员）不得带 `recursive`/`recursiveFields`/`maxDepth`——分量本身是普通数据结构 | `validateSchema`（分量校验时新增检查） |
| R3 | 分量内部的嵌套节点可以声明**独立递归树**（`recursive: true` + 自己的 recursiveFields/maxDepth） | 已有机制自动支持（`convertToAjvSchema` 在任意层级展开 recursive 节点），零新增机制 |
| R4 | 外层树的递归不"流经"元组分量（分量不是外层树节点） | 机制天然如此，无需额外限制 |

### const 约束 × 其他能力的组合

- const 与 prefixItems 组合：元组分量可带 const（如固定第 0 个元素的值）
- const 与 recursive 组合：递归树节点的非递归字段可带 const（如每层节点的 `kind: "node"` 固定标签）；递归字段本身是 array，不受 const 影响
- const 与 items 组合：同构数组的 items 可带 const（全等值数组，场景较少但语义自洽）

### 嵌套递归校验增强

目前 `validateRecursiveSchema` 只校验顶层 schema，嵌套的 `recursive: true` 节点（R3 场景）无人校验。`validateSchema` 递归到任何带 `recursive: true` 的节点时，同步执行 `validateRecursiveSchema` 检查，保证嵌套递归树定义合法（recursiveFields 非空、递归字段是 array 且无 items/prefixItems 等）。

## AJV 转换

`convertToAjvSchema`（src/utils/validator.ts）的 array 分支扩展：

```typescript
if (schema.type === 'array') {
  if (schema.items) {
    result.items = convertToAjvSchema(schema.items);
  } else if (schema.prefixItems) {
    // draft-07 元组形式：items 为数组 + minItems/maxItems 钉死长度
    result.items = schema.prefixItems.map(c => convertToAjvSchema(c));
    result.minItems = schema.prefixItems.length;
    result.maxItems = schema.prefixItems.length;
  }
}
```

const 约束的转换：透传即可（AJV 原生支持 `const` 关键字）。`convertToAjvSchema` 的 result 构造中追加 `...(schema.const !== undefined && { const: schema.const })`。const 校验失败时 AJV 报 `const` keyword 错误（`must be equal to constant`），信息完整，走现有修复提示词链路。

已实测验证（ajv 8.18.0，draft-07 模式，项目现有配置 `allErrors: true, strict: false` 无需改动）：

- 超长数组 → `maxItems` 错误（`must NOT have more than 2 items`）
- 缺项数组 → `minItems` 错误
- 位置类型错误 → 按位置精准报错（`/0 must be string`、`/1 must be number`）

`unrollLayer`（递归展开）无需改动：非递归字段走 `convertToAjvSchema(propDef)`，元组自动生效；分量内的独立递归树（R3）由 `convertToAjvSchema` 的 recursive 分支自动展开。

## 提示词生成

### 结构描述（`generateSchemaDescription`，src/utils/promptBuilder.ts）

元组数组显示 `固定长度元组（长度 N）`，按位置列出每个分量：`第 1 个元素: string（姓名描述）`、`第 2 个元素: number（年龄描述）`。

const 字段在描述行尾标注固定值：`name (string) [必填] [固定值: "1"]`；元组分量描述同样标注。

### 示例生成（`generateSchemaExample`，src/utils/validator.ts）

array 分支增加 prefixItems 处理：按位置生成每个分量的示例，如 `["示例字符串", 0, true]`。

const 字段直接用 const 值作为示例值（如 `name: '1'` 的示例就是 `"1"`），AI 一眼可见期望值。

### 完整提示词（`buildSchemaPrompt`）

`requirements` 列表追加：`输出固定长度为 N 的数组，第 i 个元素的类型必须符合位置定义`。禁止格式区对元组场景同样适用。const 场景追加：`标注了固定值的字段，输出必须严格等于该固定值`。

## 错误处理

- **结构校验错误**（用户写错 schema）：抛 `[StepWise.execPromptSchema]` 前缀的描述性错误，消息指明冲突字段与期望写法
- **输出校验失败**（AI 输出不符）：AJV 的 `minItems`/`maxItems`/按位置 `type` 错误 → 现有 `SchemaValidationError` → `buildSchemaFixPrompt` 重试链路，无需改动

## 测试计划

新建 `tests/heterogeneousSchema.test.ts`：

1. **validateSchema**：items+prefixItems 同现抛错；非 array 带 prefixItems 抛错；prefixItems 空抛错；分量类型错误递归抛错且错误消息带位置
2. **const 校验**：object/array 带 const 抛错；const 值与 type 不匹配抛错（string 字段给 number const 等）；string+const 合法通过
3. **validateRecursiveSchema**：递归字段带 items 或 prefixItems 均抛错（R1）
4. **元组分量校验**：分量带 recursive/recursiveFields/maxDepth 抛错（R2）
5. **嵌套递归校验**：分量内嵌套递归树定义非法（如 recursiveFields 为空）抛错（R3 配套校验）
6. **convertToAjvSchema**：元组 → items 数组 + minItems/maxItems 转换正确；const 透传
7. **validateJsonBySchema**：合法元组通过；长度错误（缺项/超项）失败；位置类型错误失败；const 字段值不符失败、const 值相符通过
8. **generateSchemaExample**：元组按位置生成示例；const 字段示例值为 const 值
9. **buildSchemaPrompt**：提示词含元组说明、固定长度要求、固定值要求
10. **递归+元组+const 组合**：固定节点名树（根 "1"、两子节点 "2"/"3"、子节点下递归）——合法数据通过（含**多叉树**合法数据，防止示例单路径误导）；节点名错误拒绝；外层结构不符拒绝
11. **回归**：现有测试全绿（同构 schema 行为不变）

### 已知风险（不阻塞，记录待观察）

`generateSchemaExample` 对递归子树只展示单条路径（每层 1 个子节点），而合法输出可为多叉树。若实测发现 AI 因示例误导只输出单叉，后续迭代把递归示例改为同层 2 个子节点。

## 文档

`docs/api.md` / `docs/api_cn.md` 补充 `prefixItems` 字段说明与元组示例（沿用 tokenUsage 字段的文档更新模式）。

## 示例：完整组合场景

### 场景一：递归树 + 元组属性 + 嵌套独立递归树

```typescript
const schema: JsonSchemaDef = {
  type: 'object',
  recursive: true,
  recursiveFields: ['children'],
  maxDepth: 3,
  properties: {
    name: { type: 'string' },
    children: { type: 'array' },                  // 外层递归字段（R1：不得有 items/prefixItems）
    entry: {                                      // 树节点上的元组属性
      type: 'array',
      prefixItems: [
        { type: 'string', description: '标签' },   // 分量 0：基础类型
        {                                             // 分量 1：普通 object（R2：自身不得 recursive）
          type: 'object',
          properties: {
            value: { type: 'number' },
            subtree: {                               // R3：分量内嵌套节点，独立递归树
              type: 'object',
              recursive: true,
              recursiveFields: ['kids'],
              maxDepth: 2,
              properties: {
                id: { type: 'string' },
                kids: { type: 'array' }
              }
            }
          }
        }
      ]
    }
  }
};
```

### 场景二：固定节点名的树（根 "1"，两个子节点 "2"/"3"，其下递归）

```typescript
// 2/3 之下的递归树节点（独立递归树）
const treeNode: JsonSchemaDef = {
  type: 'object',
  recursive: true,
  recursiveFields: ['children'],
  maxDepth: 3,
  properties: {
    name: { type: 'string' },
    children: { type: 'array' }                    // R1：不定义 items，框架展开时填充自引用
  }
};

const schema: JsonSchemaDef = {
  type: 'object',                                  // 根节点：普通 object（非递归）
  properties: {
    name: { type: 'string', const: '1' },          // 固定值 "1"
    children: {
      type: 'array',
      prefixItems: [                               // 固定长度 2：恰好两个子节点
        {                                          // 子节点 "2"（R2：分量本身不得 recursive）
          type: 'object',
          properties: {
            name: { type: 'string', const: '2' },
            children: {
              type: 'array',
              items: treeNode                      // R3：分量内嵌套独立递归树
            }
          }
        },
        {                                          // 子节点 "3"
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
```

产出数据形状：

```json
{
  "name": "1",
  "children": [
    { "name": "2", "children": [
        { "name": "x", "children": [
            { "name": "y", "children": [] }
        ]}
    ]},
    { "name": "3", "children": [ "…同上递归…" ]}
  ]
}
```

## 实现接触点清单

| 文件 | 改动 |
|---|---|
| `src/types.ts` | 新增 `prefixItems?: JsonSchemaDef[]`、`const?: string \| number \| boolean` 字段 |
| `src/utils/schemaUtils.ts` | `JsonSchema` 接口的 `items` 扩展为 `JsonSchema \| JsonSchema[]`，新增 `minItems?`/`maxItems?`/`const?` 字段（draft-07 元组形式所需） |
| `src/StepWise.ts` `validateSchema` | array 分支二选一校验、互斥校验、分量递归校验（带位置）、R2 检查、嵌套递归节点校验、const 类型匹配校验 |
| `src/utils/validator.ts` `validateRecursiveSchema` | R1：递归字段不得定义 items/prefixItems |
| `src/utils/validator.ts` `convertToAjvSchema` | 元组 → draft-07 items 数组 + minItems/maxItems；const 透传 |
| `src/utils/validator.ts` `generateSchemaExample` | array 分支支持 prefixItems 按位置生成；const 字段示例值取 const 值 |
| `src/utils/promptBuilder.ts` `generateSchemaDescription` | 元组结构描述；const 固定值标注 |
| `src/utils/promptBuilder.ts` `buildSchemaPrompt` | requirements 追加固定长度要求与固定值要求 |
| `tests/heterogeneousSchema.test.ts` | 新建测试文件（含场景二"固定节点名树"端到端用例） |
| `docs/api.md` / `docs/api_cn.md` | 文档补充 prefixItems 与 const |
