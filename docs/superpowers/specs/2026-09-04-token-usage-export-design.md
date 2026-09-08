# 按步导出 token 消耗与 AI 耗时 — 设计文档

> 日期：2026-09-04
> 状态：已获用户批准
> 范围：Claude/CodeAgent 执行器全量支持；Pi/OpenCode 天然降级（不产出字段）

## 背景与现状

用户需求：将每一步的 token 消耗和 AI 耗时导出。

现状排查结论：
- **耗时**：`ExecutionResult.duration`（wall-clock 毫秒）已有；Claude stream-json 的 `result` 块自带 `duration_ms`（总耗时）与 `duration_api_ms`（纯 API 耗时），但 `ndjsonFormatter.ts:363-375` 只将其格式化为文本行，未结构化导出。
- **token**：Claude/CodeAgent 的 `--output-format stream-json` 输出中，`result` 块自带 `usage{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` 与 `total_cost_usd`——当前解析层**整个丢弃**（`ndjsonFormatter.ts` 无任何 usage 提取）。
- **执行器差异**：Claude/CodeAgent 走 NDJSON（数据全）；Pi 走 `--mode json` 事件流（token 字段待确认，本设计不提取）；OpenCode 纯文本输出（token 不可得，明确不支持）。

## 需求决定（用户已确认）

1. **导出位置**：按步文件 `logs/<N_task>/usage.json`（与 prompt.txt/output.txt/verbose_output.txt 同级）
2. **API 返回**：`ExecutionResult` 加可选 `tokenUsage` 字段，用户代码直接可读
3. **执行器范围**：先做 Claude/CodeAgent；Pi/OpenCode 不产出时字段缺省、文件不写
4. **耗时口径**：三种都导——wall-clock `duration`（既有）、`durationMs`（Claude 总耗时）、`durationApiMs`（纯 API 耗时）

## 方案选型

**方案 A（采纳）— 解析层提取 + 沿既有管道落盘**：`ParsedNDJsonResult` 加 usage 字段 → `BaseExecutor.execute()` 透传到 `ExecutionResult.tokenUsage` → StepWise 各 exec 方法写按步 `usage.json`。完全顺现有数据流，CodeAgent 自动同享，Pi/OpenCode 天然降级。

**方案 B（否决）— 事后扫 verbose_output.txt**：verbose 文本已格式化降级（cost 截 4 位小数、无 token 数），数据源头就丢了，扫不出来。

**方案 C（否决）— 二次调用 usage 查询接口**：Claude Code CLI 无此接口；多余开销。

## 设计细节

### 1. 新类型（src/types.ts）

```typescript
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  durationMs: number;      // Claude result.duration_ms（总耗时）
  durationApiMs: number;   // Claude result.duration_api_ms（纯 API 耗时）
}
```

`ExecutionResult` 加可选字段：

```typescript
export interface ExecutionResult {
  // ...既有字段不变...
  /** token 消耗与 AI 耗时（仅 NDJSON 执行器：Claude/CodeAgent；缺失时表示该执行器不支持） */
  tokenUsage?: TokenUsage;
}
```

### 2. 解析层（src/executors/ndjsonFormatter.ts）

- `ParsedNDJsonResult` 加字段 `usage: ClaudeResultUsage | null`（`ClaudeResultUsage` 为内部提取结构，字段同 TokenUsage 原始口径）
- `result` case（约 363 行）在既有 `duration_ms`/`total_cost_usd` 读取处，顺带提取：
  - `parsed.usage.input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`
  - `parsed.duration_api_ms`
- 字段缺失时 `usage` 为 `null`（不抛错，兼容格式变化）

### 3. 执行器层（src/executors/base.ts 约 197 行消费点）

- NDJSON 路径：`parsed.usage` 非空 → 组装 `TokenUsage` 放入返回的 `ExecutionResult.tokenUsage`
- 纯文本路径（Pi/OpenCode）：不设置该字段（undefined）

### 4. StepWise 层（src/StepWise.ts）

- 各 exec 方法（execPrompt/execCollectPrompt/execCheckPrompt/execReport/execPromptSchema）在写 `execution_info.json` 的同一位置，若 `result.tokenUsage` 存在则写：

```
logs/<N_task>/usage.json
```

内容示例：

```json
{
  "taskIndex": 3,
  "sessionId": "<uuid>",
  "duration": 45230,
  "tokenUsage": {
    "inputTokens": 15230,
    "outputTokens": 1204,
    "cacheCreationTokens": 8002,
    "cacheReadTokens": 45210,
    "costUsd": 0.0834,
    "durationMs": 44800,
    "durationApiMs": 41200
  },
  "postCheckUsage": {
    "inputTokens": 820,
    "outputTokens": 95,
    "cacheCreationTokens": 0,
    "cacheReadTokens": 16200,
    "costUsd": 0.0041,
    "durationMs": 3800,
    "durationApiMs": 3100
  }
}
```

- `duration` 为既有 wall-clock（毫秒）；`tokenUsage.durationMs/durationApiMs` 来自 Claude result 块。
- **postCheckPrompt 的 usage**：`runPostCheck`（StepWise.ts:1215）当前丢弃 executor 返回值，改为接收 `ExecutionResult`，若其含 `tokenUsage` 则作为 `postCheckUsage` 字段并入同目录 usage.json（postCheck 与主任务共享 task 目录，不单独建文件）。无 postCheckPrompt 或无 tokenUsage 时该字段缺省。

- 断点恢复跳过的步骤：不重写 usage.json（文件已存在，保持原样）——与 progress.json 跳过逻辑一致。

### 5. 明确不改的

- `performance.json` 管道不动（按调用点聚合 wall-clock，与本功能互补）
- Pi 执行器不做 token 提取（事件流字段待确认，留作后续）
- OpenCode 明确不支持（纯文本输出无 token 数据）
- `verbose_output.txt` 现有格式不动

### 6. 错误处理

- 解析层：`result` 块缺 `usage`/`duration_api_ms` 字段 → `usage: null`，不抛错
- StepWise 层：`tokenUsage` undefined → 不写 usage.json，不告警（合法降级）
- usage.json 写失败 → 沿用现有日志写盘的容错模式（不中断任务）

### 7. 测试

- `ndjsonFormatter` 单测：对含 `result.usage` 的 NDJSON 样例，提取四个 token 数 + duration_api_ms 正确；缺字段的样例 `usage` 为 null
- `base.ts` 单测：mock spawn 返回含 usage 的 NDJSON → `ExecutionResult.tokenUsage` 组装正确；纯文本输出 → 无 tokenUsage 字段
- `StepWise` 单测：mock executor 返回 tokenUsage → usage.json 写入正确位置与结构；无 tokenUsage → 不写文件；带 postCheckPrompt 的执行 → usage.json 含 postCheckUsage 字段
- 既有 250 测试零回归（新字段全部可选，不破坏现有断言）

## 验收标准

1. Claude/CodeAgent 执行任意 exec 方法后，`logs/<N_task>/usage.json` 存在且含完整 token/耗时数据
2. `ExecutionResult.tokenUsage` 可在用户代码直接读取
3. Pi/OpenCode 执行时不产生 usage.json、不抛错
4. `npm run build` 通过、`npm test` 250+ 全过
