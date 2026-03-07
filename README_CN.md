# StepWise

<p align="center">
  <strong>逐步执行的任务编排工具 - 为 Claude Code 构建可靠的 AI 工作流，支持断点恢复</strong>
</p>

<p align="center">
  <a href="#安装">安装</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#核心特性">核心特性</a> •
  <a href="doc/api_cn.md">API 文档</a> •
  <a href="demos_cn.md">示例</a> •
  <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/stepwise" alt="npm version">
  <img src="https://img.shields.io/npm/l/stepwise" alt="license">
  <img src="https://img.shields.io/node/v/stepwise" alt="node version">
</p>

---

## 简介

StepWise 是一个基于 Node.js 和 TypeScript 构建的任务编排工具。它允许你将复杂的代码任务拆分为多个步骤，并为每个步骤定制提示词，然后交由 Claude Code 的 AI 编程智能体执行。

### 为什么需要它？

在实际开发中，我们经常遇到复杂的自动化任务，例如：

- 批量分析代码库中的 API 接口
- 对收集到的数据进行逐项处理
- 生成汇总报告

这些任务通常需要多步骤协作，且执行时间长、容易中断。StepWise 提供了：

- **任务编排**：灵活定义多步骤任务流程
- **多 Agent 支持**：多个 Agent 可在同一任务中并行工作
- **断点恢复**：任务中断后可从断点继续执行
- **数据持久化**：自动保存执行进度和结果
- **调试支持**：调试模式下快速验证流程

---

## 安装

### 前置要求

- Node.js >= 16.0.0
- Claude Code CLI 已安装并配置

### 安装依赖

```bash
npm install stepwise
```

### 构建项目

```bash
npm run build
```

---

## 快速开始

### 基础示例

```typescript
import { StepWise, setTaskName } from 'stepwise';

// 设置任务名称（必须先设置）
setTaskName('AnalyzeAPIs');

// 创建 Agent，指定唯一名称
const agent = new StepWise('MainAgent');

// 执行普通任务
await agent.execPrompt('分析当前项目的目录结构');

// 执行收集任务
const result = await agent.execCollectPrompt(
  '收集项目中所有的 API 接口定义',
  {
    keys: [
      { name: 'name', description: 'API 名称', type: 'string' },
      { name: 'method', description: 'HTTP 方法', type: 'string' },
      { name: 'path', description: 'API 路径', type: 'string' }
    ]
  }
);

console.log(`收集到 ${result.data.length} 个 API`);
```

### 任务恢复示例

当任务执行过程中被中断时，可以从断点恢复：

```typescript
import { StepWise, setTaskName, setResumePath } from 'stepwise';

// 设置要恢复的任务目录
setResumePath('AnalyzeAPIs_20260307_103000_123');

setTaskName('AnalyzeAPIs');

const agent = new StepWise('MainAgent');

// 重新执行相同的代码流程
// 已完成的任务会自动跳过，从中断点继续
await agent.execPrompt('分析当前项目的目录结构');  // 跳过
await agent.execCollectPrompt('收集 API 接口', format);  // 跳过
await agent.execPrompt('处理 API: $name', { data: { name: 'login' } });  // 从这里继续
```

### 变量替换示例

在提示词中使用 `$变量名` 格式，通过 `options.data` 提供变量值：

```typescript
import { StepWise, setTaskName } from 'stepwise';

setTaskName('ProcessAPIs');
const agent = new StepWise('APIProcessor');

const apis = [
  { name: 'login', path: '/api/login' },
  { name: 'logout', path: '/api/logout' }
];

for (const api of apis) {
  await agent.execPrompt(
    '为 API 生成文档: $name ($path)',
    { data: api }
  );
}
```

---

## 核心特性

### 全局设置

StepWise 提供全局函数用于配置：

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
setResumePath('MyTask_20260307_103000_123');

// 启用调试模式（只收集1条数据）
enableDebugMode(true);

// 保存/加载数据到 cwd
saveCollectData(data, 'my_data.json');
const loaded = loadCollectData('my_data.json');
```

### 任务类型

支持多种任务类型，灵活组合：

| 任务类型 | 方法 | 用途 |
|---------|------|------|
| 普通任务 | `execPrompt` | 执行单个提示词任务 |
| 收集任务 | `execCollectPrompt` | 收集数据并保存为 JSON |
| 检查任务 | `execCheckPrompt` | 检查条件并返回 true/false |
| 报告任务 | `execReport` | 生成汇总报告 |

### 多 Agent 支持

多个 Agent 可在同一任务中并行工作：

```typescript
setTaskName('ParallelTask');

const agent1 = new StepWise('Agent1');
const agent2 = new StepWise('Agent2');

// 两个 Agent 共享同一个 TaskName 目录
// 各自有独立的子目录
await agent1.execPrompt('Agent 1 的任务');
await agent2.execPrompt('Agent 2 的任务');
```

### 断点恢复

任务执行过程中自动记录进度，支持从中断点恢复：

```typescript
// 设置恢复路径
setResumePath('TaskName_20260307_103000_123');
```

### 调试模式

调试模式下，收集任务：
- 提示词中添加"只收集1条数据"的说明
- 返回结果只包含第一条数据

```typescript
enableDebugMode(true);
```

### 数据持久化

自动生成任务目录结构：

```
stepwise_exec_infos/
└── TaskName_20260307_103000_123/     # TaskName 目录（时间戳精确到毫秒）
    ├── report/                        # 报告输出（所有 Agent 共享）
    ├── Agent1_20260307_103001_456/    # StepWise Agent 目录
    │   ├── data/                      # 执行状态
    │   │   └── progress.json
    │   ├── logs/                      # 执行日志
    │   │   ├── 1_task/
    │   │   ├── 2_collect/
    │   │   └── execute.log
    │   └── collect/                   # 收集数据
    │       └── 2_collect/
    └── Agent2_20260307_103002_789/    # 另一个 Agent
        └── ...
```

---

## 工作原理

StepWise 基于 Claude Code 的无头模式实现：

```bash
# 新会话执行任务
claude --dangerously-skip-permissions --session-id <uuid> -p "你的提示词"

# 恢复会话继续执行
claude --dangerously-skip-permissions --resume <session-id> -p "你的提示词"
```

每个任务步骤都会生成唯一的 Session ID，执行状态被持久化到本地文件。恢复时通过匹配历史任务序号，跳过已完成的步骤。

---

## 文档

- [API 文档](doc/api_cn.md) - 详细的 API 参考
- [示例](demos_cn.md) - 完整的使用示例
- [English](README.md) - English Documentation

---

## 许可证

[MIT](LICENSE)
