# useSkill 强制生效 + 提示词膨胀优化 设计文档

日期：2026-09-15
状态：已评审通过

## 背景与目标

两个相关联的问题：

1. **useSkill 功能**：调用 `exec*` 函数时，需要保证某个 skill 的指令 100% 出现在 agent 上下文中。当前没有任何 exec 链路能主动触发 skill（summarize 只负责生成 skill 文件）。
2. **提示词膨胀**：schema 约束和输出样例使 prompt 严重膨胀。最痛的场景是用户定义子节点 schema 后在大 schema 上大量引用，导致同一段子结构全文重复 N 遍（实测：10 字段子结构 × 10 处引用 ≈ 10000 tokens）。

## 用户确认的关键决策

| 决策点 | 结论 |
|---|---|
| 触发语义 | **Skill 内容生效**：框架直接读 SKILL.md 内容注入 prompt，不依赖模型主动调用 Skill 工具，对四种执行器（Claude/CodeAgent/OpenCode/Pi）都有效 |
| skill 指定方式 | 按名称自动解析（项目 `.claude/skills/` → 用户 `~/.claude/skills/`） |
| API 形式 | `ExecOptions` 加 `useSkill?: string`，所有 exec* 函数自动获得能力 |
| skill 找不到 | **抛异常**，任务不执行（strict 语义） |
| 作用范围 | execPrompt / execCollectPrompt / execCheckPrompt / execReport / execPromptSchema；execShell 不支持（不经 agent，类型层不含该字段） |
| 注入位置 | prompt 最前（最高优先级指令） |
| 多 skill | 单个 string（YAGNI，未来 string → string[] 向后兼容容易） |
| resume 跳过时 | 不校验、不注入 |
| 膨胀优化深度 | 删冗余（删结构说明/递归示例单节点化/紧凑化）+ 标准 `$defs`/`$ref` 去重 |
| 兼容性 | 直接替换新格式，不加开关；存量测试同步修正 |
| 子结构复用语义 | **JSON Schema 标准行为**（`$defs` + `$ref`），不自造语法 |

---

## Part 1：useSkill 功能

### API

`src/types.ts` 的 `ExecOptions` 新增：

```typescript
/**
 * 需要强制生效的 skill 名称（单个）。
 * 框架按约定路径解析 SKILL.md 内容注入到 prompt 最前面，
 * 保证 skill 指令 100% 出现在 agent 上下文中。
 * 解析失败直接抛异常，任务不执行。
 */
useSkill?: string;
```

### 解析规则

新函数 `resolveSkillPrompt(skillName, cwd)`，放 `src/utils/promptBuilder.ts`：

1. **名称合法性校验**：`/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`，防止 `../` 路径穿越；不合法抛异常
2. **查找顺序**：
   - `{cwd}/.claude/skills/{name}/SKILL.md`（cwd 为该次调用的 effectiveCwd）
   - `~/.claude/skills/{name}/SKILL.md`
3. 两处都没有 → 抛异常，异常信息列出已尝试的路径
4. 内容仅去首尾空白后使用；**空文件抛异常**
5. 包一层固定头尾模板：

```
[必须遵守的 Skill 指令：{skillName}]
（以下内容来自 {skillPath}，优先级高于本任务中的其它指令）

{SKILL.md 原文}
```

### 注入点

在 `injectFileAccessPrompt` 同一构建期层扩展（实现时选：内部扩展该函数，或并列新增 `injectSkillPrompt`，以改动更顺者为准）。五个 exec 方法各加 validate + 注入共约 3 行。

### 边界语义

- **resume 跳过已完成任务**：不校验、不注入（与现有 skip 逻辑一致）
- **postCheckPrompt 派生任务**：继承主任务的 useSkill（检查 agent 同样受 skill 约束）
- **多执行器**：Claude / CodeAgent / OpenCode / Pi 同样生效（内容注入不依赖执行器特性）

---

## Part 2：提示词膨胀优化

### 实测膨胀构成

| 组成部分 | 占比（典型 schema） | 问题 |
|---|---|---|
| ① JSON Schema 全文（`null,2` 缩进） | ~40% | 缩进比紧凑多 ~60%；required 数组重复罗列字段名 |
| ② 结构说明 `generateSchemaDescription` | ~25% | 与 ① 信息 100% 重合 |
| ③ 正确格式示例（递归按 maxDepth 全展开） | ~30% | 每深一层整个对象重复一遍（maxDepth=8 时 490 tokens） |
| ④ 固定样板（禁止格式/要求清单） | ~5% | 防嵌套/防 markdown 包裹护栏，保留不动 |
| ⑤ 子结构重复内联（用户主痛点） | 压倒性 | N 处引用 = N 遍全文（10 字段 × 10 处 ≈ 10000 tokens） |

### 优化 1：删结构说明（②）

`buildSchemaPrompt` 输出中移除「结构说明」小节。字段含义/必填/递归标注只保留在 JSON Schema 一处。

`generateSchemaDescription` 函数本身保留（测试引用、schema.json 日志可用），只从 prompt 输出移除。

### 优化 2：递归示例单节点化（③）

`generateRecursiveExample` 不再按 maxDepth 展开整棵树，改为**单节点示例**：递归字段值固定为 `[ ...同层结构的子节点，最深层 children 必须为 [] ... ]` 占位说明。

非递归字段行为不变。`buildSchemaFixPrompt`（校验失败修复提示词）同步使用单节点版本。

效果：递归示例 490 tokens（maxDepth=8）→ ~100 tokens。

### 优化 3：Schema JSON 紧凑化（①）

`buildSchemaPrompt` 与 `buildArrayOutputPrompt` 中 schema JSON 从 `JSON.stringify(schema, null, 2)` 改为紧凑 `JSON.stringify(schema)`。required 数组保留（JSON Schema 语义需要）。

### 优化 4：标准 `$defs`/`$ref` 子结构复用（⑤，核心）

**已验证**：项目 AJV 8.18.0 原生支持 `$defs` + `$ref`（校验、错误路径均正常）。

#### 类型扩展（`src/types.ts`）

```typescript
export interface JsonSchemaDef {
  // ...现有字段不动

  /**
   * 可复用子结构定义（仅顶层 schema 有效，嵌套层的 defs 被忽略 + console.warn）
   * 对应 JSON Schema 标准的 $defs；组件可互相 ref，禁止循环（构建期检测）
   */
  defs?: Record<string, JsonSchemaDef>;

  /**
   * JSON Pointer 引用（如 '#/$defs/Dependency'）
   * 含 ref 的字段上仅允许 ref + description，其它字段出现即抛异常（白名单校验风格）
   */
  ref?: string;
}
```

`PropertyDef`（OutputFormat 路径）同样加 `ref`/`defs` 支持。

用户写法（数组字段包一层）：

```typescript
{
  type: 'object',
  description: '模块全景分析',
  defs: {
    Dependency: {
      type: 'object',
      properties: {
        module: { type: 'string', description: '被依赖的模块名' },
        kind: { type: 'string', description: 'runtime / dev / peer 三选一' },
        circular: { type: 'boolean', description: '是否存在循环依赖' }
      }
    }
  },
  properties: {
    deps:    { type: 'array', description: '运行时依赖', items: { ref: '#/$defs/Dependency' } },
    devDeps: { type: 'array', description: '开发时依赖', items: { ref: '#/$defs/Dependency' } }
  }
}
```

#### 处理管线（两套表示，各干各的）

1. **`defToStandardSchema(def)`**（新函数，schemaUtils.ts）：`JsonSchemaDef` → 标准 JSON Schema。`ref: '#/$defs/X'` → `$ref: '#/$defs/X'`，`defs` → `$defs`，其余字段（const/prefixItems/recursive 等）按现有 buildJsonSchema 映射逻辑透传。产物交给 AJV compile。
2. **`expandRefs(def)`**（新函数，promptBuilder.ts）：为 **prompt 渲染**生成去重视图——`$defs` 全文渲染一次 + 引用点渲染为 `$ref` 标记。不改变校验数据流。
3. **执行入口**：
   - **execPromptSchema 路径**（JsonSchemaDef）：入口做 `defToStandardSchema` 转换；validateRecursiveSchema / validateSchema 在转换前校验（白名单/互斥规则针对用户原始 def），buildSchemaPrompt 用原始 def 走 expandRefs 渲染，validateSchemaOutput 用标准 schema compile AJV
   - **OutputFormat 路径**（execCollectPrompt/execReport，PropertyDef）：`buildJsonSchema` 扩展支持 PropertyDef 上的 ref/defs，在 buildJsonSchema 内完成 ref → $ref 映射，buildArrayOutputPrompt 渲染时用 expandRefs 去重视图
4. **校验时机约定**：所有白名单/互斥/循环引用校验发生在构建期（prompt 发出之前），保证配置错误立即暴露

#### Prompt 渲染（去重视图）

```
## 输出 Schema

公共子结构定义（$defs，被多处引用，勿在输出中重复）：

"Dependency": { ...仅出现一次（紧凑 JSON）... }

## Schema 结构

{"properties":{"deps":{"type":"array","items":{"$ref":"#/$defs/Dependency"}},...}}
```

附加要求一条：*「$ref 引用按名称回查 $defs 定义，输出时按其结构展开，不要重复定义」*。

#### 校验

`validateSchemaOutput` 用 `defToStandardSchema` 产物 compile AJV。**校验器零改动**，错误路径照常（`/deps/0 must have required property 'kind'`）。

#### 模型不遵守 $ref 标记的兜底

prompt 中 `$ref` 是给模型看的标记。模型输出不符合展开结构时，校验失败 → 走已有 `buildSchemaFixPrompt` 修复重试链路。

#### 效果

10 字段子结构 × 10 处引用：~10000 tokens → 组件定义 ~400 + 引用点 ~300 ≈ **700 tokens（-93%）**。

#### 边界规则

- ref 字段白名单：仅 `ref` + `description`，其它字段出现即抛异常（构建期）
- 循环引用检测：构建期抛异常，附引用链（如 `A → B → A`）
- **recursive 机制与 ref/defs 互斥**：同一 schema 混用两套机制抛异常（validateRecursiveSchema 新规则）
- 嵌套层 `defs`：忽略 + console.warn
- prefixItems / items / properties / recursive 白名单字段内都可用 ref

### 优化项 ④ 不动

禁止格式/要求清单是防真实失败模式的护栏，保留。

---

## Part 3：注入顺序、日志与错误处理

### Prompt 最终组装顺序（5 个 exec 方法统一）

```
[skill 指令块（如有）]
---
[文件访问策略（如有）]
---
[原始 prompt]
---
[extraPrompt（collect/report/schema 的输出格式要求，仅对应方法有）]
```

### 日志

| 文件 | 内容 |
|---|---|
| `prompt.txt` | 最终完整 prompt（含 skill 块）——反映 agent 实际收到的东西 |
| `skill.txt`（新增） | useSkill 指定时写入 skill 原文 + 解析路径 |
| `schema.json` | 用户原始 def（含 defs/ref 简写），不写展开后版本 |
| progress.json | 不新增字段（重跑会重新解析，非断点恢复关注点） |

### 错误处理汇总

| 场景 | 行为 |
|---|---|
| skill 名称不合法（含 `../`） | 抛异常，任务不执行 |
| 两个查找路径都无 SKILL.md | 抛异常，列出已尝试路径 |
| SKILL.md 为空文件 | 抛异常 |
| ref 字段带白名单外字段 | 抛异常（构建期） |
| `$defs` 循环引用 | 抛异常，附引用链 |
| recursive 与 ref/defs 混用 | 抛异常（validateRecursiveSchema 新规则） |
| 嵌套层出现 defs | 忽略 + console.warn |
| 模型不遵守 $ref 标记 | 校验失败 → buildSchemaFixPrompt 修复重试链路 |
| execShell 传 useSkill | ShellOptions 类型不含该字段，编译期报错 |

---

## Part 4：测试设计

### 单元测试

- `resolveSkillPrompt`：名称校验（穿越/非法字符）/ 查找顺序（项目优先于用户目录）/ 找不到时异常信息含已尝试路径 / 空文件异常 / 头尾模板格式
- `expandRefs`：循环引用检测及引用链 / ref 白名单拦截 / 嵌套 defs 警告 / 去重视图渲染（$defs 一次 + 引用点标记）
- `defToStandardSchema`：ref → $ref 映射 / defs → $defs / 与 const/prefixItems/recursive 字段共存
- 瘦身后 `buildSchemaPrompt`：无「结构说明」小节 / 递归示例单节点 / 紧凑 JSON / $defs 渲染一次
- `generateRecursiveExample`：单节点 + 占位说明，不再按 maxDepth 展开

### 集成测试

- execPrompt 带 useSkill 端到端（mock executor）：断言收到 prompt 含 skill 内容且在最前
- execPromptSchema 带 defs/ref：AJV 校验通过 / 失败路径（错误路径正确指向引用展开位置）
- postCheckPrompt 继承 useSkill

### 存量测试修正

- 断言 prompt 内容的用例：删结构说明小节断言、紧凑 JSON、示例变化
- `generateSchemaDescription` 直接测试保留（函数不删）

---

## 未来方向（本次不做）

- prompt 预处理管道重构：把 `processPrompt` → `injectFileAccessPrompt` → skill 注入 → `buildFullPrompt` 统一为一个 `buildAgentPrompt(prompt, options)` 管道，消除 5 处注入重复
- `useSkill` 支持数组
- 固定样板（④）五类任务合并为一份共享模板
