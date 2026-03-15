# StepWise

<p align="center">
  <strong>Step-by-step task orchestration for Claude Code - build reliable AI workflows with checkpoint recovery</strong>
</p>

<p align="center">
  <a href="#why-stepwise">Why StepWise</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#core-features">Core Features</a> •
  <a href="doc/api.md">API Reference</a> •
  <a href="demos.md">Examples</a> •
  <a href="README_CN.md">中文文档</a>
</p>

---

## Why StepWise?

When working with AI Agents on complex development tasks, we often face three major pain points:

| Pain Point | StepWise Solution |
|------------|-------------------|
| Long tasks drift, multi-tasks get missed | Multi-Agent parallel processing with automatic progress tracking |
| Private data handling is difficult | Agent self-learning, automatic Skill generation |
| Debugging is hard, progress lost on interruption | Checkpoint recovery, debug mode for quick validation |

StepWise is a task orchestration tool built on Node.js and TypeScript. It enables you to break down complex coding tasks into multiple steps, customize prompts for each step, and delegate execution to Claude Code's AI programming agent.

---

## Quick Start

### Example 1: Multi-Agent Parallel Processing

Handle multiple items concurrently with multiple Agents - no more drifting or missed tasks:

```typescript
import { setTaskName, forEachParallel, WorkerConfig } from 'stepwise';

setTaskName('ProcessItems');

const items = ['item1', 'item2', 'item3', 'item4'];

const workerConfigs: WorkerConfig[] = [
  { branchName: 'Agent1' },
  { branchName: 'Agent2' },
];

await forEachParallel(items, workerConfigs, async (ctx) => {
  // Each worker has its own git worktree, enabling true parallel execution
  await ctx.stepWise.execPrompt('Process item: $item', { data: { item: ctx.item } });
});

// All branches are automatically merged after completion
```

### Example 2: Skill Auto-Generation

Agent analyzes domain knowledge and automatically generates Skills for private data handling:

```typescript
import { StepWise, setTaskName } from 'stepwise';

setTaskName('GenerateSkills');
const agent = new StepWise('SkillGenerator');

// Step 1: Analyze what skills are needed
const result = await agent.execCollectPrompt(
  'Analyze the codebase and identify what skills should be created',
  {
    keys: [
      { name: 'skillName', description: 'Skill name', type: 'string' },
      { name: 'description', description: 'Skill description', type: 'string' },
      { name: 'filePath', description: 'File path to create', type: 'string' }
    ]
  }
);

// Step 2: Create skill files based on analysis
for (const skill of result.data) {
  await agent.execPrompt(
    'Create skill file at $filePath with description: $description',
    { data: skill }
  );
}
```

### Example 3: Checkpoint Recovery

Resume from interruption point - no progress lost:

```typescript
import { StepWise, setTaskName, setResumePath } from 'stepwise';

// Set the task directory to recover from
setResumePath('MyTask_20260315_143000_123');

setTaskName('MyTask');
const agent = new StepWise('MainAgent');

// Re-execute the same code flow
// Completed tasks are automatically skipped
await agent.execPrompt('Step 1: Analyze project');           // Skipped
await agent.execCollectPrompt('Step 2: Collect data', fmt);  // Skipped
await agent.execPrompt('Step 3: Process item $name', { data: { name: 'item1' } }); // Resume from here
```

---

## Core Features

### Task Types

| Method | Usage | Description |
|--------|-------|-------------|
| `execPrompt` | Normal task | Execute a single prompt task |
| `execCollectPrompt` | Collection task | Collect structured data and save as JSON |
| `execCheckPrompt` | Check task | Check condition and return true/false |
| `execReport` | Report task | Generate summary report |
| `execShell` | Shell command | Execute Shell commands (build, test, etc.) |

### Multi-Agent Parallel Processing

Use `forEachParallel` for concurrent processing with automatic worktree management:

```typescript
import { setTaskName, forEachParallel, WorkerConfig } from 'stepwise';

setTaskName('ParallelTask');

const workerConfigs: WorkerConfig[] = [
  { branchName: 'Worker1', env: ['API_KEY=xxx'] },
  { branchName: 'Worker2', env: ['API_KEY=yyy'] },
];

await forEachParallel(items, workerConfigs, async (ctx) => {
  // ctx.stepWise is pre-configured with:
  // - workspacePath: git worktree directory
  // - workerConfig: branch name and env vars
  await ctx.stepWise.execPrompt('Process $name', { data: ctx.item });
});
```

### Checkpoint Recovery

Task progress is automatically recorded. Resume from interruption:

```typescript
setResumePath('TaskName_20260315_143000_123');
```

### Debug Mode

Quickly validate workflows with limited data collection:

```typescript
enableDebugMode(true);  // Collect only 1 item
```

### Shell Command Execution

Execute Shell commands with retry and timeout support:

```typescript
// Basic usage
const result = await agent.execShell('npm run build');
console.log('Success:', result.success);

// With options
const result = await agent.execShell('npm test', {
  timeout: 60000,   // 60 second timeout
  cwd: './project', // Working directory
  retry: true       // Retry on failure
});
```

### Global Settings

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
setResumePath('MyTask_20260315_143000_123');

// Enable debug mode
enableDebugMode(true);

// Save/load data
saveCollectData(data, 'my_data.json');
const loaded = loadCollectData('my_data.json');
```

### Directory Structure

Automatic task directory generation:

```
stepwise_exec_infos/
└── TaskName_20260315_143000_123/     # TaskName directory (timestamp with ms)
    ├── report/                        # Report output (shared by all agents)
    ├── Agent1_20260315_143001_456/    # StepWise Agent directory
    │   ├── data/                      # Execution state
    │   │   └── progress.json
    │   ├── logs/                      # Execution logs
    │   │   ├── 1_task/
    │   │   ├── 2_collect/
    │   │   └── execute.log
    │   └── collect/                   # Collected data
    │       └── 2_collect/
    └── Agent2_20260315_143002_789/    # Another agent
        └── ...
```

---

## How It Works

StepWise is built on Claude Code's headless mode with session reuse:

```bash
# New session for task
claude --dangerously-skip-permissions --session-id <uuid> -p "your prompt"

# Resume session to continue
claude --dangerously-skip-permissions --resume <session-id> -p "your prompt"
```

Key mechanisms:

1. **Session Reuse**: Each task step reuses the previous session, maintaining context
2. **Progress Persistence**: Execution state is persisted to local JSON files
3. **Index Matching**: During recovery, completed steps are matched and skipped by index
4. **Worktree Isolation**: `forEachParallel` creates git worktrees for true parallel execution

---

## Documentation

- [API Reference](doc/api.md) - Detailed API documentation
- [Examples](demos.md) - Complete usage examples
- [中文文档](README_CN.md) - Chinese documentation

---

## License

[MIT](LICENSE)