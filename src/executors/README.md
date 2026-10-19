# 执行器模块

本模块实现了智能体执行器的抽象和具体实现，支持多种 AI 智能体（Claude、OpenCode、CodeAgent、Pi、mcode 等）。

## 目录结构

```
src/executors/
├── index.ts      # 公共导出
├── types.ts      # 接口定义
├── base.ts       # 抽象基类
├── claude.ts     # Claude 执行器实现（同时作为 CodeAgent 的基类）
├── codeagent.ts  # CodeAgent 执行器实现（继承 ClaudeExecutor）
├── opencode.ts   # OpenCode 执行器实现
├── pi.ts         # Pi 执行器实现（@earendil-works/pi-coding-agent）
└── mcode.ts      # mcode 执行器实现（Minimax Code，@minimax-ai/code）
```

## 架构设计

本模块采用**模板方法模式**（Template Method Pattern）：

- `BaseExecutor`：抽象基类，定义执行流程和公共逻辑
- `ClaudeExecutor` / `OpenCodeExecutor` / `CodeAgentExecutor` / `PiExecutor` / `McodeExecutor`：具体实现类，实现特定智能体的逻辑
- `CodeAgentExecutor` 继承 `ClaudeExecutor`：命令参数与 Claude 基本一致（仅可执行程序名不同，另额外携带 CodeAgent 独有的 `--skip-safe-check`），故复用 `buildArgs()`，仅覆写 `getCommand()` 与 `buildSafetyArgs()`

### 类图

```
              AgentExecutor (interface)
                      │
                      │ implements
                      ▼
                BaseExecutor (abstract)
           ┌─────────┬──────────┬──────────┬──────────┐
           │         │          │          │          │
           ▼         ▼          ▼          ▼          ▼
    ClaudeExecutor  OpenCodeExecutor  CodeAgentExecutor  PiExecutor  McodeExecutor
           ▲                                              │
           │ extends                                       │
           └─────────────────────── (复用 buildArgs，仅覆盖 getCommand/agentType)
```

## 如何添加新的执行器

### 步骤 1：创建执行器类

在 `src/executors/` 目录下创建新文件，例如 `aider.ts`：

```typescript
import { BaseExecutor } from './base';

export class AiderExecutor extends BaseExecutor {
  /** 执行器类型标识 */
  readonly agentType = 'aider';

  /** 返回 CLI 命令名称 */
  protected getCommand(): string {
    return 'aider';
  }

  /** 构建命令行参数 */
  protected buildArgs(
    prompt: string,
    sessionId: string,
    isResume: boolean,
    debugFile?: string
  ): string[] {
    const args: string[] = [];
    // ... 构建参数逻辑
    return args;
  }

  /** 可选：重写环境变量构建 */
  protected buildEnv(extraEnv?: string[]): NodeJS.ProcessEnv {
    const env = super.buildEnv(extraEnv);
    // 添加特定环境变量
    return env;
  }
}
```

### 步骤 2：更新类型定义

在 `src/types.ts` 中更新 `AgentType` 类型：

```typescript
export type AgentType = 'claude' | 'opencode' | 'codeagent' | 'pi' | 'mcode';
```

### 步骤 3：注册到工厂

在 `src/utils/executor.ts` 中注册新执行器：

```typescript
import { AiderExecutor } from '../executors/aider';

const executorFactories: Record<AgentType, () => AgentExecutor> = {
  claude: () => new ClaudeExecutor(),
  opencode: () => new OpenCodeExecutor(),
  codeagent: () => new CodeAgentExecutor(),
  pi: () => new PiExecutor(),
  mcode: () => new McodeExecutor(),
  aider: () => new AiderExecutor(),  // 新增
};
```

### 步骤 4：导出新类

在 `src/executors/index.ts` 中导出新类：

```typescript
export { AiderExecutor } from './aider';
```

## 抽象方法说明

| 方法 | 说明 |
|------|------|
| `agentType` | 返回执行器类型标识 |
| `getCommand()` | 返回 CLI 命令名称 |
| `buildArgs()` | 构建命令行参数 |
| `buildProbeArgs()` | 构建 429 探测命令参数。不适用探测的执行器（如 OpenCode）应抛出含「探测不适用」的错误，`base.ts` 会捕获并跳过探测循环 |

## 可重写方法

| 方法 | 说明 |
|------|------|
| `buildEnv()` | 构建环境变量，默认返回 `process.env` |
| `usesNDJsonOutput()` | 是否输出 NDJSON（stream-json）格式，默认 `false`。Claude、CodeAgent、Pi、mcode 返回 `true`（空行跳过、按 type 格式化）；OpenCode 为 `false`（空行保留） |
| `buildSafetyArgs()` | 构建「安全确认类」参数，追加在 `--dangerously-skip-permissions` 之后，默认返回 `[]`。ClaudeExecutor 保持为空；CodeAgentExecutor 覆写为 `['--skip-safe-check']`，跳过目录首次使用时的安全确认 |
| `execute()` | 执行提示词任务，默认在 `BaseExecutor` 中实现重试、错误处理等逻辑。Pi 执行器重写此方法以在 fork 模式下预生成派生 session ID；mcode 执行器重写此方法以拒绝 fork |
| `getSessionIdAfterExecution()` | 执行完成后获取 sessionId。OpenCode 通过 `session list` 获取；Pi 在 fork 模式下返回预生成的派生 ID |
| `assertForkSupported()` | fork 能力断言，默认不做校验。不支持 fork 的后端（mcode）覆写为抛错，由 `StepWise` 在写入 progress（标记 `in_progress`）之前调用，避免任务卡在 `in_progress` 且续跑必然再次失败 |
| `getRateLimitPatterns()` | 速率限制检测正则表达式 |
| `checkRateLimitError()` | 速率限制错误检测逻辑 |

## isResume 参数说明

不同 CLI 工具对会话恢复的处理方式不同：

| CLI 工具 | 新会话参数 | 恢复会话参数 | 自动检测 |
|---------|-----------|-------------|---------|
| Claude | `--session-id <uuid>` | `--resume <uuid>` | 否 |
| CodeAgent | `--session-id <uuid>` | `--resume <uuid>` | 否 |
| OpenCode | `--session <uuid>` | `--session <uuid>` | 是 |
| Pi | `--session-id <uuid>` | `--session-id <uuid>` | 是（自动判断创建/打开） |
| mcode | 不传（由 mcode 自行分配） | `--session <mvs_id>` | 否 |

在实现 `buildArgs()` 方法时，需要根据具体 CLI 工具的参数设计来处理 `isResume` 参数。

## mcode 后端的特殊约束

mcode（Minimax Code）的会话模型与其它后端不同，接入时需注意：

- **会话 ID 由 mcode 自行分配**（形如 `mvs_<32 位 hex>`），调用方无法指定。其 `createSession()` 内部固定调用 `makeSessionId()`，因此框架预生成的 UUID 对 mcode 无意义，新会话时一律不传 `--session`。
- **真实会话 ID 从输出流解析**：mcode stream-json 事件的公共信封携带 `sessionId`，且该值来自已解析的真实会话，在首个事件 `exec.started` 即可读到。`ndjsonFormatter` 提取该字段后，经 `BaseExecutor` 的 `onDerivedSessionId` 钩子实时回写 `progress.json`，使子进程被 kill 后仍可按真实 ID 续接。
- **不支持 fork**：mcode 无从已有会话派生新会话的能力，且会话的 `workspaceDir` 必须与 `--cwd` 严格一致。fork 请求显式抛错而非静默降级——无人值守场景下静默丢失上下文比早失败更危险。抛错点在 `StepWise` 写入 progress（标记任务 `in_progress`）之前，任务不会卡在 `in_progress`、续跑也不会必然再次失败。
- **重试续接同一会话**：框架预生成的 UUID 对 mcode 无效，但首次执行捕获到的真实 `mvs_*` ID 会被保留，重试时以 `--session <mvs_id>` 续接同一个会话，而不是每次重试都新建会话、丢失失败前的上下文。
- **限额文案口径不同**：mcode 判定 provider 限额错误的正则含空格分隔的 `rate limit`（基类只认 `429` / `rate_limit_error` / `usage limit exceeded`），故 `McodeExecutor` 覆写 `checkRateLimitError()` 补齐该口径，否则限额等待与 429 探测循环不会触发。
- **工具过程可从事件流还原**：`item.completed` 的 `tool_call` 事件带完整 `toolCall`（`{id, name, status, input, output}`），其中 `input` 是工具入参、`output.content` 是工具执行结果，`verbose_output.txt` 中两者都会渲染。
- **不支持跨 cwd 恢复**：会话存于 `$MINIMAX_DATA_DIR/v2/sessions/<日期>/…`（按日期分区，不按 cwd），但 `workspaceDir` 校验是硬性的。因此 `StepWise.getConfigSubdir()` 对 mcode 返回 `null`，跳过 `sessionLinker` 的跨目录软链逻辑。
- **429 探测会产生会话**：mcode 没有「不落盘 session」开关（除非指定 `--session` / `--continue`），每次探测都会新建一个会话目录。这是为了更快恢复限额所做的自觉取舍。

## 测试

运行测试：

```bash
npm test
```

类型检查：

```bash
npx tsc --noEmit
```