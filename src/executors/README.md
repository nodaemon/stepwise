# 执行器模块

本模块实现了智能体执行器的抽象和具体实现，支持多种 AI 智能体（Claude、OpenCode、CodeAgent 等）。

## 目录结构

```
src/executors/
├── index.ts      # 公共导出
├── types.ts      # 接口定义
├── base.ts       # 抽象基类
├── claude.ts     # Claude 执行器实现（同时作为 CodeAgent 的基类）
├── codeagent.ts  # CodeAgent 执行器实现（继承 ClaudeExecutor）
├── opencode.ts   # OpenCode 执行器实现
└── pi.ts         # Pi 执行器实现（@earendil-works/pi-coding-agent）
```

## 架构设计

本模块采用**模板方法模式**（Template Method Pattern）：

- `BaseExecutor`：抽象基类，定义执行流程和公共逻辑
- `ClaudeExecutor` / `OpenCodeExecutor` / `CodeAgentExecutor`：具体实现类，实现特定智能体的逻辑
- `CodeAgentExecutor` 继承 `ClaudeExecutor`：命令参数与 Claude 完全一致，仅可执行程序名不同，故直接复用 `buildArgs()`

### 类图

```
              AgentExecutor (interface)
                      │
                      │ implements
                      ▼
                BaseExecutor (abstract)
           ┌─────────┬──────────┬──────────┐
           │         │          │          │
           ▼         ▼          ▼          ▼
    ClaudeExecutor  OpenCodeExecutor  CodeAgentExecutor  PiExecutor
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
export type AgentType = 'claude' | 'opencode' | 'codeagent' | 'aider';
```

### 步骤 3：注册到工厂

在 `src/utils/executor.ts` 中注册新执行器：

```typescript
import { AiderExecutor } from '../executors/aider';

const executorFactories: Record<AgentType, () => AgentExecutor> = {
  claude: () => new ClaudeExecutor(),
  opencode: () => new OpenCodeExecutor(),
  codeagent: () => new CodeAgentExecutor(),
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

## 可重写方法

| 方法 | 说明 |
|------|------|
| `buildEnv()` | 构建环境变量，默认返回 `process.env` |
| `usesNDJsonOutput()` | 是否输出 NDJSON（stream-json）格式，默认 `false`。Claude、CodeAgent 返回 `true`（空行跳过、按 type 格式化）；OpenCode、Pi 等纯文本执行器为 `false`（空行保留） |
| `execute()` | 执行提示词任务，默认在 `BaseExecutor` 中实现重试、错误处理等逻辑。Pi 执行器重写此方法以在 fork 模式下预生成派生 session ID |
| `getSessionIdAfterExecution()` | 执行完成后获取 sessionId。OpenCode 通过 `session list` 获取；Pi 在 fork 模式下返回预生成的派生 ID |
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

在实现 `buildArgs()` 方法时，需要根据具体 CLI 工具的参数设计来处理 `isResume` 参数。

## 测试

运行测试：

```bash
npm test
```

类型检查：

```bash
npx tsc --noEmit
```