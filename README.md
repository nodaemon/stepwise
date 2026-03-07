# StepWise

<p align="center">
  <strong>Step-by-step task orchestration for Claude Code - build reliable AI workflows with checkpoint recovery</strong>
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
  <img src="https://img.shields.io/npm/v/stepwise" alt="npm version">
  <img src="https://img.shields.io/npm/l/stepwise" alt="license">
  <img src="https://img.shields.io/node/v/stepwise" alt="node version">
</p>

---

## Introduction

StepWise is an agent orchestration tool built on Node.js and TypeScript. It enables you to break down complex coding tasks into multiple steps, customize prompts for each step, and delegate execution to Claude Code's AI programming agent.

### Why StepWise?

In real-world development, we often encounter complex automation tasks such as:

- Batch analyzing API interfaces in a codebase
- Processing collected data item by item
- Generating summary reports

These tasks typically require multi-step coordination and are prone to interruption due to long execution times. StepWise provides:

- **Task Orchestration**: Flexibly define multi-step task workflows
- **Multi-Agent Support**: Multiple agents can work in parallel within the same task
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
npm install stepwise
```

### Build Project

```bash
npm run build
```

---

## Quick Start

### Basic Example

```typescript
import { StepWise, setTaskName } from 'stepwise';

// Set task name (required before creating StepWise)
setTaskName('AnalyzeAPIs');

// Create agent with a unique name
const agent = new StepWise('MainAgent');

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
  }
);

console.log(`Collected ${result.data.length} APIs`);
```

### Task Recovery Example

When a task is interrupted during execution, you can resume from the checkpoint:

```typescript
import { StepWise, setTaskName, setResumePath } from 'stepwise';

// Set the task directory to recover from
setResumePath('AnalyzeAPIs_20260307_103000_123');

setTaskName('AnalyzeAPIs');

const agent = new StepWise('MainAgent');

// Re-execute the same code flow
// Completed tasks will be skipped automatically
await agent.execPrompt('Analyze the directory structure');  // Skipped
await agent.execCollectPrompt('Collect API interfaces', format);  // Skipped
await agent.execPrompt('Process API: $name', { data: { name: 'login' } });  // Resume from here
```

### Variable Substitution Example

Use `$variableName` in prompts with `options.data`:

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
    'Generate documentation for API: $name ($path)',
    { data: api }
  );
}
```

---

## Core Features

### Global Settings

StepWise provides global functions for configuration:

```typescript
import {
  setTaskName,
  setResumePath,
  enableDebugMode,
  saveCollectData,
  loadCollectData
} from 'stepwise';

// Set task name (required)
setTaskName('MyTask');

// Set resume path for recovery
setResumePath('MyTask_20260307_103000_123');

// Enable debug mode (collects only 1 item)
enableDebugMode(true);

// Save/load data to/from cwd
saveCollectData(data, 'my_data.json');
const loaded = loadCollectData('my_data.json');
```

### Task Types

Support for multiple task types with flexible combinations:

| Task Type | Method | Usage |
|-----------|--------|-------|
| Normal Task | `execPrompt` | Execute a single prompt task |
| Collection Task | `execCollectPrompt` | Collect data and save as JSON |
| Check Task | `execCheckPrompt` | Check condition and return true/false |
| Report Task | `execReport` | Generate summary report |

### Multi-Agent Support

Multiple agents can work in parallel within the same task:

```typescript
setTaskName('ParallelTask');

const agent1 = new StepWise('Agent1');
const agent2 = new StepWise('Agent2');

// Both agents share the same TaskName directory
// Each has its own subdirectory
await agent1.execPrompt('Task for agent 1');
await agent2.execPrompt('Task for agent 2');
```

### Checkpoint Recovery

Task progress is automatically recorded during execution:

```typescript
// Set recovery path
setResumePath('TaskName_20260307_103000_123');
```

### Debug Mode

In debug mode, collection tasks:
- Add "only collect 1 item" to the prompt
- Return only the first data item

```typescript
enableDebugMode(true);
```

### Directory Structure

Automatic task directory structure generation:

```
stepwise_exec_infos/
└── TaskName_20260307_103000_123/     # TaskName directory (timestamp with milliseconds)
    ├── report/                        # Report output (shared by all agents)
    ├── Agent1_20260307_103001_456/    # StepWise Agent directory
    │   ├── data/                      # Execution state
    │   │   └── progress.json
    │   ├── logs/                      # Execution logs
    │   │   ├── 1_task/
    │   │   ├── 2_collect/
    │   │   └── execute.log
    │   └── collect/                   # Collected data
    │       └── 2_collect/
    └── Agent2_20260307_103002_789/    # Another agent
        └── ...
```

---

## How It Works

StepWise is built on Claude Code's headless mode:

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
