# StepWise

<p align="center">
  <strong>高效的 AI Agent 团队构建框架 - 让 AI 编程助手可靠执行复杂任务</strong>
</p>

<p align="center">
  <a href="#为什么需要-stepwise">为什么需要</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#核心特性">核心特性</a> •
  <a href="doc/api_cn.md">API 文档</a> •
  <a href="demos_cn.md">示例</a> •
  <a href="README.md">English</a>
</p>

---

## 为什么需要 StepWise？

在使用 AI 编程助手进行复杂开发任务时，我们经常遇到三大痛点：

| 痛点 | StepWise 解决方案 |
|------|------------------|
| 长任务跑偏、多任务遗漏 | 任务拆分为稳定的小步骤，数据校验确保输出正确，条件检查验证执行结果 |
| 私有数据处理困难 | 支持 Skill 生成 Agent，多次尝试成功后自动总结 Skill |
| 调试困难、中断丢失 | 断点恢复、调试模式快速验证 |

StepWise 通过任务步骤控制、数据校验、条件路由和断点恢复等机制，让 AI 编程助手（Claude Code、OpenCode 等）能够稳定可靠地完成复杂任务。

---

## 快速开始

### 示例 0：选择 AI 编程助手

支持 Claude Code、OpenCode 和 CodeAgent，默认使用 Claude Code：

```typescript
import { setAgentType, setTaskName, StepWise } from 'stepwise';

// 设置 AI 编程助手类型（可选，默认 'claude'）
setAgentType('claude');   // 使用 Claude Code（默认）
// setAgentType('opencode');  // 使用 OpenCode
// setAgentType('codeagent'); // 使用 CodeAgent（命令参数与 claude 一致，仅可执行程序名不同）

setTaskName('MyTask');
const agent = new StepWise('MainAgent');
```

### 示例 1：任务步骤控制

将复杂任务拆分为稳定的小步骤，配合 Shell 命令验证：

```typescript
import { setTaskName, StepWise } from 'stepwise';

setTaskName('RefactorModule');
const agent = new StepWise('MainAgent');

// 复杂任务拆分为多个小步骤
await agent.execPrompt('步骤 1: 分析模块依赖关系');
await agent.execPrompt('步骤 2: 提取公共接口定义');
await agent.execPrompt('步骤 3: 重构核心逻辑');

// 运行构建和测试验证修改
const buildResult = await agent.execShell('npm run build');
if (!buildResult.success) {
  await agent.execPrompt('修复构建错误');
}

// 已完成的步骤自动跳过，支持断点恢复
```

### 示例 2：使用 execCollectPrompt 稳定收集数据

内置校验和重试机制，确保数据收集稳定可靠：

```typescript
// 简洁格式 - 第一个必填字段自动用于去重
const result = await agent.execCollectPrompt('收集所有 API 接口', {
  name: { type: 'string', description: 'API 名称' },
  method: { type: 'string', description: 'HTTP 方法' },
  path: { type: 'string', description: 'API 路径' },
  description: { type: 'string', description: 'API 描述', required: false }
});

// 第一个必填字段（此处为 name）自动用于去重
```

### 示例 3：并行处理收集到的数据

使用 `forEachParallel` 并发处理收集的数据：

```typescript
import { setTaskName, forEachParallel, WorkerConfig, loadCollectData } from 'stepwise';

setTaskName('ProcessAPIs');

// 加载之前收集的数据
const apis = loadCollectData('api_endpoints.json');

// 配置并行 Worker，自动管理 git worktree 隔离
const workerConfigs: WorkerConfig[] = [
  { branchName: 'Worker1' },
  { branchName: 'Worker2' },
];

await forEachParallel(apis, workerConfigs, async (ctx) => {
  // 每个 Worker 拥有独立的 git worktree 工作空间
  await ctx.stepWise.execPrompt(
    '为 API 生成测试: $name ($method $path)',
    { data: ctx.item }
  );
});
// 所有分支完成后自动合并
```

```typescript
// 指定不同的 git 仓库作为工作目录
await forEachParallel(apis, workerConfigs, async (ctx) => {
  await ctx.stepWise.execPrompt(
    '为 API 生成测试: $name ($method $path)',
    { data: ctx.item }
  );
}, { cwd: '/path/to/other-repo' });
```

> **并行模式下的 Session 行为**：每个 worker 在独立 git worktree（cwd 与主仓库不同）运行。Claude/CodeAgent 的 session 按 cwd 隔离存储，因此：
> - **默认复用**：worker 不传 `sessionId` 时，session 在 worker 自己的 worktree 内创建+复用，无问题。
> - **fork（`sessionId` + `newSession:true`）**：框架自动软链主仓库的 session 文件到 worktree 目录，使 fork 可跨 worktree 派生（fork 只读原会话，安全）。删除 worktree 时不清除这些软链（残留无害，最坏为 dangling symlink，Claude 自然处理为"找不到会话"）；如需清理可手动调用 `cleanWorktreeSessionLinks`。
> - **纯指定 `sessionId`（非 fork）**：跨目录 resume 会共享写并发风险，框架**报错**。如需跨 worktree 复用上下文，请用 fork，或通过产物文件而非 session 共享。

`execCheckPrompt` 作为路由节点，根据条件判断结果分发到不同的 Agent：

```typescript
const checkResult = await agent.execCheckPrompt('检查测试是否通过');

if (!checkResult.result) {
  const fixAgent = new StepWise('FixAgent');
  await fixAgent.execPrompt('修复失败的测试');
} else {
  const deployAgent = new StepWise('DeployAgent');
  await deployAgent.execPrompt('部署到预发环境');
}
```

### 示例 5：Skill 自动生成

多次尝试成功后，自动总结生成 Skill：

```typescript
await agent.execPrompt('配置数据库连接');
await agent.execPrompt('创建数据模型');
await agent.execPrompt('实现 CRUD 接口');

// 创建新 session 时自动总结上一个 session
await agent.execPrompt('下一步任务', { newSession: true });

// 或手动触发总结
const summaryResult = await agent.summarize();
console.log('生成的 Skill 文件:', summaryResult.skillFiles);
```

### 示例 6：断点恢复与调试模式

从中断点恢复，使用调试模式快速验证流程：

```typescript
import { StepWise, setTaskName, setResumePath, enableDebugMode } from 'stepwise';

// 启用调试模式：只收集 1 条数据，快速验证流程
enableDebugMode(true);

setResumePath('MyTask_20260315_143000_123');
setTaskName('MyTask');
const agent = new StepWise('MainAgent');

// 已完成的步骤自动跳过
await agent.execPrompt('步骤 1: 分析项目');           // 跳过
await agent.execCollectPrompt('步骤 2: 收集数据', fmt);  // 跳过
await agent.execPrompt('步骤 3: 处理项目 $name', { data: { name: 'item1' } }); // 从这里继续
```

### 示例 7：会话管理

StepWise 让你对 AI 会话有显式控制。每次 `exec*` 调用都返回 `ExecutionResult`，其 `sessionId` 字段就是本次执行实际使用的会话 ID。本示例依次说明四种行为：默认复用、单独 `newSession`、指定 `sessionId` 复用、以及 `fork` 分岔。

```typescript
import { StepWise } from 'stepwise';

const agent = new StepWise('SessionAgent');

// 1) 默认行为：首个任务创建新会话，后续任务自动复用（同一会话逐步累积上下文）
//    result.sessionId 始终返回本次执行使用的会话 ID
const r1 = await agent.execPrompt('分析需求并设计数据模型');
const r2 = await agent.execPrompt('基于上一步设计实现 CRUD 接口');
// r2.sessionId === r1.sessionId → 同一会话，上下文连续
const sessionId = r2.sessionId;

// 2) 单独 newSession: true → 创建全新会话；若之前存在会话，会先自动总结（生成 Skill）
//    可用 setSkipSummarize(true) 跳过总结
const r3 = await agent.execPrompt('开始一个独立的新需求', { newSession: true });
// r3.sessionId 是全新 ID，与 r1/r2 不同；前一会话已被自动总结

// 3) 指定 sessionId：恢复某个已知会话继续完善（强制 resume 模式，即 --resume <sessionId>）
await agent.execPrompt('在已有会话基础上继续完善', { sessionId });

// 4) fork：sessionId + newSession: true → 从该 sessionId 派生新分支，原会话保留不变
//    派生出的新 ID 通过 result.sessionId 返回
const r5 = await agent.execPrompt('尝试另一种实现思路', {
  sessionId,          // 从这个已有会话派生
  newSession: true    // ← fork 语义
});
// r5.sessionId 是派生出的全新 ID，原 sessionId 会话不受影响
```

**行为说明**

1. **默认（复用）** —— 不传任何 session 选项时，首个任务创建新会话，之后每步自动复用上一会话（`--resume`），上下文逐步累积。`result.sessionId`（`ExecutionResult` 上）始终返回本次使用的会话 ID。
2. **单独 `newSession`** —— `{ newSession: true }` 创建全新会话；若之前存在会话，会先自动总结（生成 Skill）。可用 `setSkipSummarize(true)` 跳过。
3. **指定 `sessionId`** —— `{ sessionId }` 强制以 resume 模式复用该已知会话，适合从检查点恢复。
4. **fork** —— `{ sessionId, newSession: true }` 同时指定 → 从该 sessionId 派生新会话，原会话保留不变。派生出的新 ID 通过 `result.sessionId` 返回，并记录到 `progress.json` / `currentSessionId`。

**底层命令对照**

| 选项 | Claude / CodeAgent | OpenCode | 语义 |
|---|---|---|---|
| （默认） | `--resume <id>` | `--session <id>` | 复用上一会话 |
| `newSession: true` | `--session-id <new>` | （不传 `--session`） | 全新会话（+总结前一个） |
| `sessionId` | `--resume <id>` | `--session <id>` | 复用指定会话 |
| `sessionId` + `newSession: true` | `--resume <id> --fork-session` | `--session <id> --fork` | 从指定会话派生新分支 |

> 仅当 `sessionId` 与 `newSession: true` **同时**指定时才触发 fork。单独传 `newSession: true` 会创建全新会话（并总结前一会话）；单独传 `sessionId` 会恢复该会话。

> **fork 中断恢复**：fork 执行期间，派生的新 ID 一产生即写入 `progress.json`。即使该步中断，`setResumePath` 恢复时也会用派生 ID 续传，不再重新派生。注:OpenCode 的派生 ID 仅在执行结束后可得，其中断的 fork 步骤恢复时会重新派生。

---

## 核心特性

### API 概览

#### StepWise 类方法

| 方法 | 用途 | 说明 |
|------|------|------|
| `execPrompt` | 普通任务 | 执行单个提示词任务 |
| `execCollectPrompt` | 收集任务 | 收集结构化数据，内置校验和重试 |
| `execCheckPrompt` | 路由节点 | 检查条件返回 true/false，用于分支路由 |
| `execReport` | 报告任务 | 生成汇总报告 |
| `execShell` | Shell 命令 | 执行 Shell 命令（构建、测试等） |
| `summarize` | Skill 生成 | 总结会话生成 Skill |

#### 全局设置函数

| 方法 | 用途 | 说明 |
|------|------|------|
| `setTaskName` | 设置任务名称 | 必须，用于标识任务目录 |
| `setAgentType` | 设置 AI 编程助手 | 可选，默认 `'claude'`，可选 `'opencode'`、`'codeagent'` |
| `setResumePath` | 设置恢复路径 | 从中断点恢复任务 |
| `enableDebugMode` | 启用调试模式 | 快速验证流程，只收集 1 条数据 |
| `setSkipSummarize` | 跳过自动总结 | 禁用创建新 session 时的自动总结 |
| `saveCollectData` | 保存收集数据 | 保存数据到 JSON 文件 |
| `loadCollectData` | 加载收集数据 | 从 JSON 文件加载数据 |

#### 并行处理

| 方法 | 用途 | 说明 |
|------|------|------|
| `forEachParallel` | 并行处理 | 自动管理 git worktree，实现真正的并行执行 |

详细 API 文档请参阅 [API 文档](doc/api_cn.md)。

### 目录结构

自动生成任务目录：

```
stepwise_exec_infos/
└── TaskName_20260315_143000_123/     # TaskName 目录（时间戳精确到毫秒）
    ├── report/                        # 报告输出（所有 Agent 共享）
    ├── Agent1_20260315_143001_456/    # StepWise Agent 目录
    │   ├── data/                      # 执行状态
    │   │   └── progress.json
    │   ├── logs/                      # 执行日志
    │   │   ├── 1_task/
    │   │   │   ├── prompt.txt         # 任务提示词
    │   │   │   ├── output.txt         # 标准输出摘要
    │   │   │   ├── verbose_output.txt # 详细输出（AI思考过程、工具调用等）★关键调试文件
    │   │   │   └── ...
    │   │   ├── 2_collect/
    │   │   │   ├── ...（同上）
    │   │   └── execute.log            # 执行汇总日志
    │   └── collect/                   # 收集数据
    │       └── 2_collect/
    └── Agent2_20260315_143002_789/    # 另一个 Agent
        └── ...
```

**关键文件**：`verbose_output.txt` 记录 AI 完整思考过程和工具调用，是分析问题的最关键文件。详细说明请参阅 [API 文档](doc/api_cn.md)。

---

## 工作原理

### 步骤控制机制

StepWise 通过任务序号和进度持久化实现步骤控制：

1. **任务序号**：每个步骤有唯一序号，自动递增
2. **进度持久化**：执行状态保存到 `progress.json`
3. **Session 复用**：使用 `--resume` 模式保持上下文连续性
4. **Session 分岔**：同时指定 `sessionId` 与 `newSession: true` 时，从指定会话派生新分支（`--fork-session` / `--fork`），原会话保留

### 数据校验机制

- JSON 格式校验
- 字段完整性校验
- 类型匹配校验
- 校验失败自动生成修复提示词
- `checkPrompt` 选项支持自定义校验

### 分支路由机制

- `execCheckPrompt` 输出 `{ result: true/false }` 到 `check_result.json`
- 根据结果路由到不同的 Agent
- 实现条件分支工作流

### Skill 生成机制

- **触发时机**：创建新 session 或手动调用
- **生成条件**：多次尝试成功的任务、有价值的经验
- **存储位置**：项目级 `.claude/skills/` 目录

### AI 编程助手集成

StepWise 通过 AI 编程助手的 headless 模式工作，支持 Session 复用：

```bash
# Claude Code 示例
claude --dangerously-skip-permissions --session-id <uuid> -p "你的提示词"
claude --dangerously-skip-permissions --resume <session-id> -p "你的提示词"
# 分岔：从 <session-id> 恢复但派生新会话（原会话保留）
claude --dangerously-skip-permissions --resume <session-id> --fork-session -p "你的提示词"

# CodeAgent 示例（命令行参数与 Claude Code 完全一致，仅可执行程序名不同）
codeagent --dangerously-skip-permissions --session-id <uuid> -p "你的提示词"
codeagent --dangerously-skip-permissions --resume <session-id> -p "你的提示词"
codeagent --dangerously-skip-permissions --resume <session-id> --fork-session -p "你的提示词"

# OpenCode 示例
opencode run --thinking --session <uuid> "你的提示词"
# OpenCode 自动判断新会话还是恢复会话
# 分岔：从 <uuid> 派生新会话分支（原会话保留）
opencode run --thinking --session <uuid> --fork "你的提示词"
```

> **OpenCode 权限配置**：使用 OpenCode 时，需要在项目根目录的 `opencode.json` 配置文件中添加 `"permission": "allow"`，以跳过交互式权限确认。详情参见 [OpenCode 权限文档](https://opencode.ai/docs/zh-cn/permissions/)。
>
> ```json
> {
>   "$schema": "https://opencode.ai/config.json",
>   "permission": "allow"
> }
> ```

核心机制：

1. **Session 复用**：每个任务步骤复用上一个 Session，保持上下文
2. **进度持久化**：执行状态持久化到本地 JSON 文件
3. **序号匹配**：恢复时通过序号匹配，跳过已完成的步骤
4. **Worktree 隔离**：`forEachParallel` 创建 git worktree 实现真正的并行执行

---

## 文档

- [API 文档](doc/api_cn.md) - 详细的 API 参考
- [示例](demos_cn.md) - 完整的使用示例
- [English](README.md) - English Documentation

---

## 开源协议

本项目采用 [MulanPSL2](https://license.coscl.org.cn/MulanPSL2)（木兰宽松许可证，第2版）开源协议。

[![License: MulanPSL2](https://img.shields.io/badge/License-MulanPSL2-blue.svg)](https://license.coscl.org.cn/MulanPSL2)