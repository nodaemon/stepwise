# StepWise

<p align="center">
  <strong>逐步执行的任务编排工具 - 让 AI 编程助手可靠执行复杂任务</strong>
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
| 长任务跑偏、多任务遗漏 | 任务拆分为稳定的小步骤，数据校验确保输出正确，条件检查验证执行结果 |
| 私有数据处理困难 | 支持 Skill 生成 Agent，多次尝试成功后自动总结 Skill |
| 调试困难、中断丢失 | 断点恢复、调试模式快速验证 |

StepWise 是一个基于 Node.js 和 TypeScript 构建的任务编排工具。它允许你将复杂的代码任务拆分为多个步骤，为每个步骤定制提示词，然后调用 AI 编程助手（Claude Code、OpenCode 等）执行。

---

## 快速开始

### 示例 1：任务步骤控制

将复杂任务拆分为稳定的小步骤，每步可靠完成：

```typescript
import { setTaskName, StepWise } from 'stepwise';

setTaskName('RefactorModule');
const agent = new StepWise('MainAgent');

// 复杂任务拆分为多个小步骤，每步稳定完成
await agent.execPrompt('步骤 1: 分析模块依赖关系');
await agent.execPrompt('步骤 2: 提取公共接口定义');
await agent.execPrompt('步骤 3: 重构核心逻辑');

// 已完成的步骤自动跳过，支持断点恢复
```

### 示例 2：使用 checkPrompt 进行数据校验

使用 `checkPrompt` 选项在数据收集后进行额外校验：

```typescript
// 数据收集 + checkPrompt 额外校验
const result = await agent.execCollectPrompt('收集所有 API 接口', {
  keys: [
    { name: 'name', description: 'API 名称', type: 'string' },
    { name: 'method', description: 'HTTP 方法', type: 'string' },
    { name: 'path', description: 'API 路径', type: 'string' }
  ],
  checkPrompt: '验证所有接口路径都以 / 开头'
});
// checkPrompt 在数据收集后运行，进行额外验证
```

### 示例 3：使用 execCheckPrompt 进行分支路由

`execCheckPrompt` 作为路由节点，根据条件判断结果分发到不同的 Agent 分支：

```typescript
// execCheckPrompt 返回 true/false 用于路由决策
const checkResult = await agent.execCheckPrompt('检查测试是否通过');

// 根据结果路由到不同的 Agent
if (!checkResult.result) {
  // 分支到 FixAgent 修复失败的测试
  const fixAgent = new StepWise('FixAgent');
  await fixAgent.execPrompt('修复失败的测试');
} else {
  // 分支到 DeployAgent 进行部署
  const deployAgent = new StepWise('DeployAgent');
  await deployAgent.execPrompt('部署到预发环境');
}
```

### 示例 4：Skill 自动生成

多次尝试成功后，自动总结生成 Skill：

```typescript
// 执行一系列任务
await agent.execPrompt('配置数据库连接');
await agent.execPrompt('创建数据模型');
await agent.execPrompt('实现 CRUD 接口');

// 创建新 session 时自动总结上一个 session
await agent.execPrompt('下一步任务', { newSession: true });
// 自动总结前一个 session，生成 SKILL.md

// 或手动触发总结
const summaryResult = await agent.summarize();
console.log('生成的 Skill 文件:', summaryResult.skillFiles);
```

### 示例 5：断点恢复

从中断点恢复任务，进度不丢失：

```typescript
import { StepWise, setTaskName, setResumePath } from 'stepwise';

setResumePath('MyTask_20260315_143000_123');
setTaskName('MyTask');
const agent = new StepWise('MainAgent');

// 已完成的步骤自动跳过
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
| `execCollectPrompt` | 收集任务 | 收集结构化数据，自动校验 |
| `execCheckPrompt` | 路由节点 | 检查条件并返回 true/false，用于分支路由 |
| `execReport` | 报告任务 | 生成汇总报告 |
| `execShell` | Shell 命令 | 执行 Shell 命令（构建、测试等） |
| `summarize` | Skill 生成 | 总结会话生成 Skill |

### 任务步骤控制

每个步骤有唯一序号，自动递增：

```typescript
import { setTaskName, StepWise } from 'stepwise';

setTaskName('MyTask');
const agent = new StepWise('MainAgent');

// 任务序号自动分配：1, 2, 3...
await agent.execPrompt('第一个任务');   // 任务 #1
await agent.execPrompt('第二个任务');  // 任务 #2
```

### 数据校验

#### execCollectPrompt 内置校验

自动校验，失败时重试：

```typescript
const result = await agent.execCollectPrompt('收集用户数据', {
  keys: [
    { name: 'id', description: '用户 ID', type: 'string' },
    { name: 'name', description: '用户名', type: 'string' },
    { name: 'email', description: '邮箱地址', type: 'string' }
  ],
  maxRetries: 3  // 校验失败时最多重试 3 次
});
```

#### 使用 checkPrompt 进行额外校验

`checkPrompt` 选项在任务完成后运行，进行自定义校验：

```typescript
// checkPrompt 在主任务完成后使用 --resume 模式运行
await agent.execPrompt('创建用户模块', {
  checkPrompt: '验证模块符合项目规范'
});

// 同样适用于 execCollectPrompt
const result = await agent.execCollectPrompt('收集配置数据', {
  keys: [...],
  checkPrompt: '验证所有配置值都有效'
});
```

### 使用 execCheckPrompt 进行分支路由

`execCheckPrompt` 是一个路由节点，返回布尔值用于分支决策：

```typescript
// 检查代码质量
const qualityCheck = await agent.execCheckPrompt('检查代码质量分数是否超过 80');
if (qualityCheck.result) {
  // 高质量 - 进行部署
  const deployAgent = new StepWise('DeployAgent');
  await deployAgent.execPrompt('部署到生产环境');
} else {
  // 低质量 - 路由到改进 Agent
  const improveAgent = new StepWise('ImproveAgent');
  await improveAgent.execPrompt('提升代码质量');
}
```

### Skill 自动生成

多次尝试成功后，总结有价值的经验：

```typescript
// 创建新 session 时触发 - 自动总结上一个 session
await agent.execPrompt('下一步任务', { newSession: true });

// 或手动触发
const result = await agent.summarize();
// Skills 保存到 .claude/skills/[skill_name]/SKILL.md
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

### AI 编程助手支持

切换不同的 AI 编程助手：

```typescript
import { setAgentType } from 'stepwise';

// 使用 Claude Code（默认）
setAgentType('claude');

// 使用 OpenCode
setAgentType('opencode');
```

### 全局设置

```typescript
import {
  setTaskName,
  setResumePath,
  enableDebugMode,
  setAgentType,
  saveCollectData,
  loadCollectData
} from 'stepwise';

// 设置任务名称（必须）
setTaskName('MyTask');

// 设置恢复路径
setResumePath('MyTask_20260315_143000_123');

// 启用调试模式
enableDebugMode(true);

// 切换 AI 编程助手
setAgentType('claude');  // 或 'opencode'

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

### 步骤控制机制

StepWise 通过任务序号和进度持久化实现步骤控制：

1. **任务序号**：每个步骤有唯一序号，自动递增
2. **进度持久化**：执行状态保存到 `progress.json`
3. **Session 复用**：使用 `--resume` 模式保持上下文连续性

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

# OpenCode 示例
opencode --session-id <uuid> -p "你的提示词"
opencode --resume <session-id> -p "你的提示词"
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