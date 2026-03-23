# StepWise Agent 架构文档

## 项目概述

StepWise 是一个高效构建具备稳定完成复杂代码任务智能体的工具。它提供多个 Claude Code 工具协作完成任务的能力，通过将复杂任务拆分为一个个可稳定完成的小任务，从而实现复杂任务的 AI 自主稳定处理。

## 核心架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      StepWise Framework                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Global State (全局状态)                  │   │
│  │  - setTaskName    - setResumePath                   │   │
│  │  - enableDebugMode - setSkipSummarize               │   │
│  │  - saveCollectData - loadCollectData                │   │
│  │  - setAgentType                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              StepWise Class (核心类)                  │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │   │
│  │  │ execPrompt  │ │execCollect  │ │ execCheck   │   │   │
│  │  │  (串行任务)  │ │ (收集任务)   │ │  (检查任务)  │   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘   │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐   │   │
│  │  │ execReport  │ │ execShell   │ │  summarize  │   │   │
│  │  │  (报告任务)  │ │ (Shell任务) │ │  (总结)     │   │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           forEachParallel (并发处理)                  │   │
│  │  - 自动创建 git worktree                             │   │
│  │  - 自动绑定 worker 标识                              │   │
│  │  - 自动处理 Resume 逻辑                              │   │
│  │  - 自动合并分支和报告                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │               Executors (执行器)                      │   │
│  │  ┌──────────────────┐ ┌──────────────────┐         │   │
│  │  │ Claude Executor  │ │ OpenCode Executor │         │   │
│  │  └──────────────────┘ └──────────────────┘         │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 目录结构

```
src/
├── index.ts           # 入口文件，导出所有公共 API
├── StepWise.ts        # StepWise 核心类实现
├── forEachParallel.ts # 并发处理实现
├── globalState.ts     # 全局状态管理
├── types.ts           # 类型定义
├── constants.ts       # 常量定义
├── executors/         # 执行器目录
│   ├── base.ts        # 基础执行器
│   ├── claude.ts      # Claude Code 执行器
│   ├── opencode.ts    # OpenCode 执行器
│   └── types.ts       # 执行器类型定义
└── utils/             # 工具函数目录
    ├── executor.ts    # 执行器工厂
    ├── fileHelper.ts  # 文件操作辅助
    ├── logger.ts      # 日志记录
    ├── promptBuilder.ts # 提示词构建
    ├── shellExecutor.ts # Shell 命令执行
    ├── uuid.ts        # UUID 生成
    └── validator.ts   # JSON 校验
```

## 功能模块详解

### 功能1: 全局设置接口

提供全局配置和数据管理功能。

```typescript
// 设置任务名称，基于任务名称加时间生成任务目录
setTaskName(taskName: string): void

// 设置恢复路径，从指定任务目录恢复执行
setResumePath(path: string): void

// 启用/禁用调试模式
enableDebugMode(enabled?: boolean): void

// 设置是否跳过 summarize（反思生成 skill）
setSkipSummarize(skip?: boolean): void

// 保存收集的数据到磁盘
saveCollectData(data: Record<string, any>[], fileName?: string): void

// 从磁盘加载收集的数据
loadCollectData(fileName?: string): Record<string, any>[]

// 设置智能体类型
setAgentType(type: AgentType): void
```

### 功能2: 任务创建

StepWise 类的构造函数，创建指定名字的任务实例。

```typescript
new StepWise(name: string, defaultCwd?: string, defaultEnv?: string[], workerId?: string)
```

**特性**:
- TaskName 必须设置，未设置直接新建 StepWise 会报错
- 名称全局唯一，不能与 TaskName 或其他 StepWise 名称重复
- 首次创建时打印启动信息

### 功能3: 启动打印

任务启动时打印关键信息，方便用户追踪。

```
================================================================================
StepWise 任务启动
任务名称: {taskName}
任务目录: {taskName}_{timestamp}
恢复命令: setResumePath("{taskName}_{timestamp}")
================================================================================
```

### 功能4: 错误提示

提供清晰的错误提示信息。

**名字重复错误**:
```
[错误] StepWise 名字重复: "{name}"
已存在重复的 StepWise 名字，请使用不同的名字区分
```

**未设置 TaskName 错误**:
```
[错误] TaskName 未设置
请先调用 setTaskName("your_task_name") 设置任务名称
```

**恢复失败错误**:
```
[错误] 无法恢复任务
找不到Agent 目录: {name}
恢复路径: {resumePath}
建议: 去掉 setResumePath() 调用，从头开始执行
```

### 功能5: 串行任务 (execPrompt)

执行普通任务，支持变量替换和检查提示词。

```typescript
StepWise.execPrompt(prompt: string, options?: ExecOptions): Promise<ExecutionResult>
```

**特性**:
- 支持 `$变量名` 格式的变量替换
- 支持 `newSession` 控制会话复用
- 支持 `checkPrompt` 进行结果验证

### 功能6: 收集任务 (execCollectPrompt)

收集数据并保存为 JSON 文件。

```typescript
StepWise.execCollectPrompt(
  prompt: string,
  outputFormat: OutputFormat,
  options?: ExecOptions
): Promise<CollectResult>
```

**特性**:
- 使用 `outputFormat` 定义输出格式
- 第一个必填字段自动用于数据去重
- 自动追加到已存在的文件

### 功能7: 检查任务 (execCheckPrompt)

执行检查任务，返回布尔结果。

```typescript
StepWise.execCheckPrompt(prompt: string, options?: ExecOptions): Promise<CheckResult>
```

**特性**:
- 输出只有 `true` 或 `false`
- 自动处理 JSON 输出和解析

### 功能8: 报告任务 (execReport)

生成汇总报告文件。

```typescript
StepWise.execReport(
  prompt: string,
  outputFormat: OutputFormat,
  outputFileName: string,
  options?: ExecOptions
): Promise<CollectResult>
```

**特性**:
- 输出到 TaskName 目录的 `report/` 子目录
- 所有 Agent 共享报告目录

### 功能9: Shell 任务 (execShell)

执行 Shell 命令。

```typescript
StepWise.execShell(command: string, options?: ShellOptions): Promise<ShellResult>
```

**特性**:
- 支持超时控制（默认 5 分钟）
- 支持重试机制
- 支持断点恢复

### 功能10: 并发处理 (forEachParallel)

**这是本项目的核心并发处理功能，用于并行处理多个任务。**

```typescript
forEachParallel<T>(
  items: T[],
  workerConfigs: WorkerConfig[],
  handler: (ctx: WorkerContext<T>) => Promise<void>,
  options?: ForEachParallelOptions
): Promise<void>
```

#### 核心特性

1. **自动创建 git worktree**
   - 每个 Worker 在独立的 git worktree 中工作
   - 自动检查分支是否存在
   - 支持已存在分支和新建分支两种场景

2. **自动绑定 worker 标识**
   - 每个 StepWise 实例自动绑定 workerId
   - 方便追踪和调试

3. **自动处理 Resume 逻辑**
   - 扫描已有任务目录，构建恢复状态表
   - 已完成的任务自动跳过
   - 进行中的任务优先恢复
   - 清理之前注册的名字，避免名字重复错误

4. **并发执行任务**
   - 使用 Promise.all 实现真正的并发
   - 支持 debug 模式（只处理第一个元素）

5. **整合所有 worker 的报告**
   - 自动合并各个 Worker 的报告文件
   - 输出到统一的 report 目录

6. **将所有 worktree 的分支合并到当前目录**
   - 任务完成后串行执行合并
   - 支持冲突解决

#### 数据结构

**WorkerConfig**:
```typescript
interface WorkerConfig {
  /** 分支名，用于创建 git worktree 和作为 worker 标识 */
  branchName: string;
  /** 环境变量数组，格式为 "KEY=VALUE" */
  env?: string[];
}
```

**WorkerContext**:
```typescript
interface WorkerContext<T> {
  /** 当前处理的元素 */
  item: T;
  /** 元素在数组中的索引 */
  index: number;
  /** 当前 worker 配置 */
  workerConfig: WorkerConfig;
  /** 工作空间路径（git worktree 目录） */
  workspacePath: string;
  /** 已创建好的 StepWise 实例，名称为 index，自动绑定 workerId */
  stepWise: StepWise;
}
```

#### 使用示例

**基础用法**:
```typescript
import { setTaskName, forEachParallel, WorkerConfig } from 'stepwise';

async function main() {
  setTaskName('ParallelTask');

  const items = [
    { name: 'Item1', value: 100 },
    { name: 'Item2', value: 200 },
    { name: 'Item3', value: 300 }
  ];

  const workerConfigs: WorkerConfig[] = [
    { branchName: 'Agent1' },
    { branchName: 'Agent2' },
    { branchName: 'Agent3' }
  ];

  await forEachParallel(items, workerConfigs, async (ctx) => {
    await ctx.stepWise.execPrompt(
      '处理任务 $name，值为 $value',
      { data: ctx.item }
    );
  });
}

main();
```

**带环境变量的配置**:
```typescript
const workerConfigs: WorkerConfig[] = [
  {
    branchName: 'Worker1',
    env: ['API_PORT=3001', 'DB_NAME=test1']
  },
  {
    branchName: 'Worker2',
    env: ['API_PORT=3002', 'DB_NAME=test2']
  }
];

await forEachParallel(items, workerConfigs, async (ctx) => {
  await ctx.stepWise.execPrompt('调用 API 处理任务', {
    data: ctx.item
  });
});
```

**从中断恢复**:
```typescript
// 第一次执行，处理到一半中断
setTaskName('ResumeTask');
await forEachParallel(items, workerConfigs, handler);

// 恢复执行，跳过已完成的任务
setResumePath('ResumeTask_20260315_143000_123');
setTaskName('ResumeTask');
await forEachParallel(items, workerConfigs, handler);
```

#### 执行流程图

```
开始
  │
  ▼
前置检查（TaskName、workerConfigs、items）
  │
  ▼
确保所有 worktree 已创建
  │
  ▼
恢复模式：扫描已有任务状态
  │
  ▼
并发执行 Workers
  │
  ├── Worker 1 ──► 处理 in_progress 任务 ──► 处理新任务
  │
  ├── Worker 2 ──► 处理 in_progress 任务 ──► 处理新任务
  │
  └── Worker N ──► 处理 in_progress 任务 ──► 处理新任务
  │
  ▼
整合所有 worker 的报告
  │
  ▼
串行合并所有分支
  │
  ▼
结束
```

### 功能11: 类型定义

提供完整的 TypeScript 类型定义，参见 `types.ts`。

### 功能12: 重要辅助功能

1. **日志记录**
   - 详细记录所有任务的完整提示词、执行过程、执行结果、执行时间
   - 日志放在 `[StepWise子Agent目录]/logs` 下
   - 生成汇总的 `execute.log`

2. **重试机制**
   - Claude 执行失败自动重试 3 次
   - 支持资源耗尽时的等待恢复

3. **任务恢复**
   - 执行到一半停止的任务可从停止位置继续执行
   - 根据 progress.json 判断任务状态

4. **调试模式**
   - 收集任务的提示词修改为只收集一个数据
   - 返回结果只包含第一条数据

### 功能13: 任务执行信息目录结构

```
stepwise_exec_infos/
└── {task-name}_{timestamp1}/              # TaskName 目录
    ├── report/                             # 报告输出
    ├── {agent-name}_{timestamp2}/          # StepWise Agent 目录
    │   ├── data/                           # 执行状态
    │   │   └── progress.json
    │   ├── logs/                           # 执行日志
    │   │   ├── 1_task/
    │   │   ├── 2_collect/
    │   │   └── execute.log
    │   ├── collect/                        # 收集数据
    │   │   └── 2_collect/
    │   └── check/                          # 检查结果
    │       └── 3_check/
    └── ...
```

### 功能14: 自学习能力

在每次 new session 时，自动总结前一个 session 的经验：

1. 经过多次尝试最终成功的技能
2. 当前项目公共的动作模式

生成的 Skill 文件保存在 `.claude/skills/[skill_name]/SKILL.md` 中。

## 执行器架构

### 执行器接口

```typescript
interface AgentExecutor {
  execute(
    prompt: string,
    sessionId: string,
    options: ExecutorOptions
  ): Promise<ExecutionResult>;
}
```

### Claude 执行器

使用 Claude Code CLI 执行任务：

```bash
claude --dangerously-skip-permissions --session-id <uuid> -p "prompt"
```

### OpenCode 执行器

使用 OpenCode CLI 执行任务（备选方案）。

## 最佳实践

1. **合理拆分任务**：按逻辑步骤拆分，避免一个任务完成所有工作

2. **自动去重**：在 `execCollectPrompt` 中第一个必填字段自动用于去重

3. **善用调试模式**：开发阶段启用调试模式，快速验证流程

4. **监控任务进度**：通过 `getTaskDir()` 和 `getTaskCounter()` 监控执行状态

5. **使用 checkPrompt 验证结果**：确保收集的数据符合预期

6. **并发任务隔离**：使用 `forEachParallel` 时确保每个 Worker 有独立的分支名

## 错误处理

StepWise 提供多层次的错误处理：

1. **前置验证错误**：参数不合法时立即报错退出
2. **执行错误**：自动重试，重试失败后抛出详细错误信息
3. **断点恢复**：支持从任意中断点恢复执行

## 版本历史

- v1.0.0: 基础功能实现
- v1.1.0: 添加 Shell 任务支持
- v1.2.0: 添加并发处理功能
- v1.3.0: 添加自学习能力
- v1.4.0: 优化错误处理和调试模式