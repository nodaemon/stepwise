# 429 探测恢复机制设计

## 问题

CodeAgent/Claude 有每日 token 限额，超过限额返回 429 错误。StepWise 的 429 重试机制使用 `--resume` 继续同一 session，导致 429 错误响应持续追加到上下文中。多次 429 重试后上下文累积超过 API 的 20MB 限制，请求被拒绝，任务彻底失败。并行操作的子任务同样受此影响。

## 方案

429 重试时，先用**无持久化 session** 探测 API 限额是否恢复，确认恢复后才 `--resume` 正式 session。正式 session 上下文始终不含 429 错误输出。

### 执行流程

```
正常执行:
  --session-id <id> -p "任务prompt"
  → 成功，返回结果

429 发生:
  1. checkRateLimitError() 检测到 429
  2. waitUntilReset() — 等待重置时间
  3. 探测循环:
     spawn: <command> <probeArgs>
     → 成功（非 429）→ 退出探测循环
     → 又 429 → 继续等待，重新探测
  4. 探测成功，--resume <正式sessionId> -p "prompt" 继续
     → 正式 session 上下文不含任何 429 垃圾 ✅
```

### 探测命令

各执行器的无持久化参数不同：

| 执行器 | 探测命令 |
|--------|---------|
| Claude | `claude --no-session-persistence -p "reply ok"` |
| CodeAgent | `codeagent --no-session-persistence -p "reply ok"` |
| Pi | `pi --no-session --mode json -p "reply ok"` |
| OpenCode | 不适用（全局 DB session，无 429 检测） |

探测 session 不落盘，无需清理。

### 新增方法

**`BaseExecutor`**:
- `protected buildProbeArgs(): string[]` — 构建探测命令参数，默认抛错（子类必须实现）
- `protected async probeRateLimit(options: AgentExecutorOptions): Promise<boolean>` — 执行探测，返回限额是否已恢复
- `execute()` 中 429 处理流程增加探测步骤

**`ClaudeExecutor`**:
- `buildProbeArgs()` → `['--no-session-persistence', '-p', 'reply ok']`

**`CodeAgentExecutor`**:
- 继承 ClaudeExecutor 的 `buildProbeArgs()`，无需覆盖

**`PiExecutor`**:
- `buildProbeArgs()` → `['--no-session', '--mode', 'json', '-p', 'reply ok']`

**`OpenCodeExecutor`**:
- `buildProbeArgs()` → 抛错或返回空（OpenCode 不走此路径）

### 429 重试流程变更

当前代码（`BaseExecutor.execute()`）:
```
429 → waitUntilReset() → attempts-- → continue（直接 --resume 重试）
```

修改后:
```
429 → waitUntilReset() → probeRateLimit()
  → 恢复 → attempts-- → continue（--resume 重试，上下文干净）
  → 未恢复 → 继续等待+探测循环
```

### 探测循环保护

- 探测超时：30 秒（`spawnSync` timeout）
- 探测次数上限：10 次探测失败后放弃，抛出错误
- 等待间隔：使用 `waitUntilReset()` 的默认等待时间（5 分钟）

### 对现有重试逻辑的影响

- 非 429 错误（普通错误）→ 不变，走原有 `attempts++` 逻辑，最多 3 次
- 429 错误 → 不变，不计 attempts；新增探测步骤在 `waitUntilReset` 之后
- `readJsonWithValidation()` 校验重试 → 不受影响（429 发生在 executor 层，校验重试层不会遇到 429）

### 测试要点

- 429 首次探测成功 → 正式 session 干净地 resume
- 429 探测多次失败 → 最终放弃，抛出错误
- 非 429 错误 → 走原有重试逻辑，不触发探测
- 各执行器的 `buildProbeArgs()` 返回正确参数
- `probeRateLimit()` 的 spawn 超时处理
