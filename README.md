# Search Light Agent Team

<p align="center">
  <strong>A powerful tool for building AI agents that reliably complete complex coding tasks</strong>
</p>

<p align="center">
  <a href="#installation">Installation</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#core-features">Core Features</a> •
  <a href="doc/api.md">API Reference</a> •
  <a href="demos.md">Examples</a> •
  <a href="README_CN.md">中文文档</a>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/search-light-agent-team" alt="npm version">
  <img src="https://img.shields.io/npm/l/search-light-agent-team" alt="license">
  <img src="https://img.shields.io/node/v/search-light-agent-team" alt="node version">
</p>

---

## Introduction

Search Light Agent Team is an agent orchestration tool built on Node.js and TypeScript. It enables you to break down complex coding tasks into multiple steps, customize prompts for each step, and delegate execution to Claude Code's AI programming agent.

### Why Search Light Agent Team?

In real-world development, we often encounter complex automation tasks such as:

- Batch analyzing API interfaces in a codebase
- Processing collected data item by item
- Generating summary reports

These tasks typically require multi-step coordination and are prone to interruption due to long execution times. Search Light Agent Team provides:

- **Task Orchestration**: Flexibly define multi-step task workflows
- **Checkpoint Recovery**: Resume execution from interruption points
- **Data Persistence**: Automatically save execution progress and results
- **Debug Support**: Quickly validate workflows in debug mode

---

## Installation

### Prerequisites

- Node.js >= 16.0.0
- Claude Code CLI installed and configured

### Install Dependencies

```bash
npm install search-light-agent-team
```

### Build Project

```bash
npm run build
```

---

## Quick Start

### Basic Example

```typescript
import { AgentTeam } from 'search-light-agent-team';

const agent = new AgentTeam();

// Set task name
agent.setTaskName('AnalyzeAPIs');

// Execute a normal task
await agent.execPrompt('Analyze the directory structure of the current project');

// Execute a collection task
const result = await agent.execCollectPrompt(
  'Collect all API interface definitions in the project',
  {
    keys: [
      { name: 'name', description: 'API name', type: 'string' },
      { name: 'method', description: 'HTTP method', type: 'string' },
      { name: 'path', description: 'API path', type: 'string' }
    ]
  },
  'apis.json'
);

console.log(`Collected ${result.data.length} APIs`);
```

### Task Recovery Example

When a task is interrupted during execution, you can resume from the checkpoint:

```typescript
const agent = new AgentTeam();

// Set the task directory to recover from
agent.setResumePath('AnalyzeAPIs_2026_03_03_10_30_00');

// Re-execute the same code flow
// Completed tasks will be skipped automatically
await agent.execPrompt('Analyze the directory structure');  // Skipped
await agent.execCollectPrompt('Collect API interfaces', format, 'apis.json');  // Skipped
await agent.execProcessData('Process API: $name', data[0]);  // Resume from here
```

---

## Core Features

### 🔄 Task Orchestration

Support for multiple task types with flexible combinations:

| Task Type | Method | Usage |
|-----------|--------|-------|
| Normal Task | `execPrompt` | Execute a single prompt task |
| Collection Task | `execCollectPrompt` | Collect data and save as JSON |
| Processing Task | `execProcessData` | Process single data item |
| Process & Collect | `execProcessDataAndCollect` | Process data and collect results |
| Report Task | `execReport` | Generate summary report |

### 🔁 Checkpoint Recovery

Task progress is automatically recorded during execution, supporting recovery from interruption points:

```typescript
// Set recovery path
agent.setResumePath('TaskName_2026_03_03_10_30_00');
```

### 🐛 Debug Mode

In debug mode, collection tasks return only the first data item for quick workflow validation:

```typescript
agent.enableDebugMode(true);
```

### 📁 Data Persistence

Automatic task directory structure generation:

```
agent_team_exec_infos/
└── TaskName_2026_03_03_10_30_00/
    ├── data/                    # Execution state
    │   └── progress.json
    ├── logs/                    # Execution logs
    │   ├── 1_task/
    │   ├── 2_collect/
    │   └── execute.log
    ├── collect/                 # Collected data
    │   └── 2_collect/
    │       └── output.json
    └── report/                  # Report data
```

---

## How It Works

Search Light Agent Team is built on Claude Code's headless mode:

```bash
# Execute task in new session
claude --dangerously-skip-permissions --session-id <uuid> -p "your prompt"

# Resume session and continue execution
claude --dangerously-skip-permissions --resume <session-id> -p "your prompt"
```

Each task step generates a unique Session ID, and execution state is persisted to local files. During recovery, completed steps are skipped by matching historical task indices.

---

## Documentation

- [API Reference](doc/api.md) - Detailed API documentation
- [Examples](demos.md) - Complete usage examples
- [中文文档](README_CN.md) - Chinese documentation

---

## License

[MIT](LICENSE)