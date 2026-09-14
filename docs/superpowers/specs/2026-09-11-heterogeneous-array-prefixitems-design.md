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

`src/types.ts` 的 `JsonSchemaDef` 新增一个可选字段：

```typescript
export interface JsonSchemaDef {
  // ...现有字段不变...
  /**
   * type === 'array' 时的元组定义（与 items 互斥）
   * 按位置定义每个元素的类型，分量可为任意 type
   * 数组长度必须严格等于 prefixItems.length（固定长度元组）
   */
  prefixItems?: JsonSchemaDef[];
}
```

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

已实测验证（ajv 8.18.0，draft-07 模式，项目现有配置 `allErrors: true, strict: false` 无需改动）：

- 超长数组 → `maxItems` 错误（`must NOT have more than 2 items`）
- 缺项数组 → `minItems` 错误
- 位置类型错误 → 按位置精准报错（`/0 must be string`、`/1 must be number`）

`unrollLayer`（递归展开）无需改动：非递归字段走 `convertToAjvSchema(propDef)`，元组自动生效；分量内的独立递归树（R3）由 `convertToAjvSchema` 的 recursive 分支自动展开。

## 提示词生成

### 结构描述（`generateSchemaDescription`，src/utils/promptBuilder.ts）

元组数组显示 `固定长度元组（长度 N）`，按位置列出每个分量：`第 1 个元素: string（姓名描述）`、`第 2 个元素: number（年龄描述）`。

### 示例生成（`generateSchemaExample`，src/utils/validator.ts）

array 分支增加 prefixItems 处理：按位置生成每个分量的示例，如 `["示例字符串", 0, true]`。

### 完整提示词（`buildSchemaPrompt`）

`requirements` 列表追加：`输出固定长度为 N 的数组，第 i 个元素的类型必须符合位置定义`。禁止格式区对元组场景同样适用。

## 错误处理

- **结构校验错误**（用户写错 schema）：抛 `[StepWise.execPromptSchema]` 前缀的描述性错误，消息指明冲突字段与期望写法
- **输出校验失败**（AI 输出不符）：AJV 的 `minItems`/`maxItems`/按位置 `type` 错误 → 现有 `SchemaValidationError` → `buildSchemaFixPrompt` 重试链路，无需改动

## 测试计划

新建 `tests/heterogeneousSchema.test.ts`：

1. **validateSchema**：items+prefixItems 同现抛错；非 array 带 prefixItems 抛错；prefixItems 空抛错；分量类型错误递归抛错且错误消息带位置
2. **validateRecursiveSchema**：递归字段带 items 或 prefixItems 均抛错（R1）
3. **元组分量校验**：分量带 recursive/recursiveFields/maxDepth 抛错（R2）
4. **嵌套递归校验**：分量内嵌套递归树定义非法（如 recursiveFields 为空）抛错（R3 配套校验）
5. **convertToAjvSchema**：元组 → items 数组 + minItems/maxItems 转换正确
6. **validateJsonBySchema**：合法元组通过；长度错误（缺项/超项）失败；位置类型错误失败
7. **generateSchemaExample**：元组按位置生成示例
8. **buildSchemaPrompt**：提示词含元组说明与固定长度要求
9. **递归+元组组合**：树节点带元组属性，展开后合法数据通过、外层树超深拒绝（R4）；元组分量内嵌套递归树，合法数据通过、嵌套树超深拒绝（R3）
10. **回归**：现有测试全绿（同构 schema 行为不变）

## 文档

`docs/api.md` / `docs/api_cn.md` 补充 `prefixItems` 字段说明与元组示例（沿用 tokenUsage 字段的文档更新模式）。

## 示例：完整组合场景

外层递归树 + 树节点带元组属性 + 分量内嵌套独立递归树：

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

## 实现接触点清单

| 文件 | 改动 |
|---|---|
| `src/types.ts` | 新增 `prefixItems?: JsonSchemaDef[]` 字段 |
| `src/utils/schemaUtils.ts` | `JsonSchema` 接口的 `items` 扩展为 `JsonSchema \| JsonSchema[]`，新增 `minItems?`/`maxItems?` 字段（draft-07 元组形式所需） |
| `src/StepWise.ts` `validateSchema` | array 分支二选一校验、互斥校验、分量递归校验（带位置）、R2 检查、嵌套递归节点校验 |
| `src/utils/validator.ts` `validateRecursiveSchema` | R1：递归字段不得定义 items/prefixItems |
| `src/utils/validator.ts` `convertToAjvSchema` | 元组 → draft-07 items 数组 + minItems/maxItems |
| `src/utils/validator.ts` `generateSchemaExample` | array 分支支持 prefixItems 按位置生成 |
| `src/utils/promptBuilder.ts` `generateSchemaDescription` | 元组结构描述 |
| `src/utils/promptBuilder.ts` `buildSchemaPrompt` | requirements 追加固定长度要求 |
| `tests/heterogeneousSchema.test.ts` | 新建测试文件 |
| `docs/api.md` / `docs/api_cn.md` | 文档补充 |
