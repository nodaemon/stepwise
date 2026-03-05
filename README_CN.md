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
import { StepWise } from 'stepwise';

const agent = new StepWise();

// 设置任务名称
agent.setTaskName('AnalyzeAPIs');

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
  },
  'apis.json'
);

console.log(`收集到 ${result.data.length} 个 API`);
```

### 任务恢复示例

当任务执行过程中被中断时，可以从断点恢复：

```typescript
const agent = new StepWise();

// 设置要恢复的任务目录
agent.setResumePath('AnalyzeAPIs_2026_03_03_10_30_00');

// 重新执行相同的代码流程
// 已完成的任务会自动跳过，从中断点继续
await agent.execPrompt('分析当前项目的目录结构');  // 跳过
await agent.execCollectPrompt('收集 API 接口', format, 'apis.json');  // 跳过
await agent.execProcessData('处理 API: $name', data[0]);  // 从这里继续
```

---

## 核心特性

### 任务编排

支持多种任务类型，灵活组合：

| 任务类型 | 方法 | 用途 |
|---------|------|------|
| 普通任务 | `execPrompt` | 执行单个提示词任务 |
| 收集任务 | `execCollectPrompt` | 收集数据并保存为 JSON |
| 检查任务 | `execCheckPrompt` | 检查条件并返回 true/false |
| 处理任务 | `execProcessData` | 处理单条数据 |
| 处理收集任务 | `execProcessDataAndCollect` | 处理数据并收集结果 |
| 报告任务 | `execReport` | 生成汇总报告 |

### 断点恢复

任务执行过程中自动记录进度，支持从中断点恢复：

```typescript
// 设置恢复路径
agent.setResumePath('TaskName_2026_03_03_10_30_00');
```

**恢复机制原理**：

1. 每个任务步骤分配一个递增的序号（taskIndex）
2. 任务状态（pending/in_progress/completed）持久化到 `progress.json`
3. 恢复时按调用顺序匹配历史序号，跳过已完成的步骤

### 调试模式

调试模式下，收集任务只返回第一条数据，快速验证流程：

```typescript
agent.enableDebugMode(true);
```

### 数据持久化

自动生成任务目录结构：

```
stepwise_exec_infos/
└── TaskName_2026_03_03_10_30_00/
    ├── data/                    # 执行状态
    │   └── progress.json
    ├── logs/                    # 执行日志
    │   ├── 1_task/
    │   ├── 2_collect/
    │   └── execute.log
    ├── collect/                 # 收集数据
    │   └── 2_collect/
    │       └── output.json
    └── report/                  # 报告数据
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