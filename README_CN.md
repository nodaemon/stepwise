# StepWise

<p align="center">
  <strong>逐步执行的任务编排工具 - 为 Claude Code 构建可靠的 AI 工作流，支持断点恢复</strong>
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

在使用 AI Agent 进行复杂开发任务时，我们经常遇到三大痛点：

| 痛点 | StepWise 解决方案 |
|------|------------------|
| 长任务跑偏、多任务遗漏 | 多 Agent 并发处理，任务进度自动追踪 |
| 私有数据处理困难 | Agent 自主学习，自动生成 Skill |
| 调试困难、中断丢失 | 断点恢复、调试模式快速验证 |

StepWise 是一个基于 Node.js 和 TypeScript 构建的任务编排工具。它允许你将复杂的代码任务拆分为多个步骤，为每个步骤定制提示词，然后交由 Claude Code 的 AI 编程智能体执行。

---

## 快速开始

### 示例 1：多 Agent 并发处理

多个 Agent 并发处理多条数据，不再跑偏或遗漏：

```typescript
import { setTaskName, forEachParallel, WorkerConfig } from 'stepwise';

setTaskName('ProcessItems');

const items = ['item1', 'item2', 'item3', 'item4'];

const workerConfigs: WorkerConfig[] = [
  { branchName: 'Agent1' },
  { branchName: 'Agent2' },
];

await forEachParallel(items, workerConfigs, async (ctx) => {
  // 每个 Worker 拥有独立的 git worktree，实现真正的并行执行
  await ctx.stepWise.execPrompt('处理项目: $item', { data: { item: ctx.item } });
});

// 所有分支完成后自动合并
```

### 示例 2：Skill 自动生成

Agent 分析领域知识，自动生成 Skill 处理私有数据：

```typescript
import { StepWise, setTaskName } from 'stepwise';

setTaskName('GenerateSkills');
const agent = new StepWise('SkillGenerator');

// 步骤 1：分析需要创建哪些 skills
const result = await agent.execCollectPrompt(
  '分析代码库，确定需要创建哪些 skills',
  {
    keys: [
      { name: 'skillName', description: 'Skill 名称', type: 'string' },
      { name: 'description', description: 'Skill 描述', type: 'string' },
      { name: 'filePath', description: '文件创建路径', type: 'string' }
    ]
  }
);

// 步骤 2：根据分析结果创建 skill 文件
for (const skill of result.data) {
  await agent.execPrompt(
    '在 $filePath 创建 skill 文件，描述: $description',
    { data: skill }
  );
}
```

### 示例 3：断点恢复

从中断点恢复任务，进度不丢失：

```typescript
import { StepWise, setTaskName, setResumePath } from 'stepwise';

// 设置要恢复的任务目录
setResumePath('MyTask_20260315_143000_123');

setTaskName('MyTask');
const agent = new StepWise('MainAgent');

// 重新执行相同的代码流程
// 已完成的任务会自动跳过
await agent.execPrompt('步骤 1: 分析项目');           // 跳过
await agent.execCollectPrompt('步骤 2: 收集数据', fmt);  // 跳过
await agent.execPrompt('步骤 3: 处理项目 $name', { data: { name: 'item1' } }); // 从这里继续
```

---

## 核心特性

### 任务类型

| 方法 | 用途 | 说明 |
|------|------|------|
| `execPrompt` | 普通任务 | 执行单个提示词任务 |
| `execCollectPrompt` | 收集任务 | 收集结构化数据并保存为 JSON |
| `execCheckPrompt` | 检查任务 | 检查条件并返回 true/false |
| `execReport` | 报告任务 | 生成汇总报告 |
| `execShell` | Shell 命令 | 执行 Shell 命令（构建、测试等） |

### 多 Agent 并发处理

使用 `forEachParallel` 实现并发处理，自动管理 worktree：

```typescript
import { setTaskName, forEachParallel, WorkerConfig } from 'stepwise';

setTaskName('ParallelTask');

const workerConfigs: WorkerConfig[] = [
  { branchName: 'Worker1', env: ['API_KEY=xxx'] },
  { branchName: 'Worker2', env: ['API_KEY=yyy'] },
];

await forEachParallel(items, workerConfigs, async (ctx) => {
  // ctx.stepWise 已预配置：
  // - workspacePath: git worktree 目录
  // - workerConfig: 分支名和环境变量
  await ctx.stepWise.execPrompt('处理 $name', { data: ctx.item });
});
```

### 断点恢复

任务执行过程中自动记录进度，支持从中断点恢复：

```typescript
setResumePath('TaskName_20260315_143000_123');
```

### 调试模式

快速验证流程，限制数据收集量：

```typescript
enableDebugMode(true);  // 只收集 1 条数据
```

### Shell 命令执行

执行 Shell 命令，支持重试和超时：

```typescript
// 基本用法
const result = await agent.execShell('npm run build');
console.log('成功:', result.success);

// 带选项
const result = await agent.execShell('npm test', {
  timeout: 60000,   // 超时 60 秒
  cwd: './project', // 工作目录
  retry: true       // 失败时重试
});
```

### 全局设置

```typescript
import {
  setTaskName,
  setResumePath,
  enableDebugMode,
  saveCollectData,
  loadCollectData
} from 'stepwise';

// 设置任务名称（必须）
setTaskName('MyTask');

// 设置恢复路径
setResumePath('MyTask_20260315_143000_123');

// 启用调试模式
enableDebugMode(true);

// 保存/加载数据
saveCollectData(data, 'my_data.json');
const loaded = loadCollectData('my_data.json');
```

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
    │   │   ├── 2_collect/
    │   │   └── execute.log
    │   └── collect/                   # 收集数据
    │       └── 2_collect/
    └── Agent2_20260315_143002_789/    # 另一个 Agent
        └── ...
```

---

## 工作原理

StepWise 基于 Claude Code 的 headless 模式实现，支持 Session 复用：

```bash
# 新会话执行任务
claude --dangerously-skip-permissions --session-id <uuid> -p "你的提示词"

# 恢复会话继续执行
claude --dangerously-skip-permissions --resume <session-id> -p "你的提示词"
```

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

## 许可证

[MIT](LICENSE)