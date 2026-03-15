# StepWise

<p align="center">
  <strong>Step-by-step task orchestration - Make AI coding assistants reliably execute complex tasks</strong>
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
| Long tasks drift, multi-tasks get missed | Break tasks into stable small steps, data validation ensures correct output, condition checks verify execution results |
| Private data handling is difficult | Support Skill-generating Agents, auto-summarize Skills after multiple successful attempts |
| Debugging is hard, progress lost on interruption | Checkpoint recovery, debug mode for quick validation |

StepWise is a task orchestration tool built on Node.js and TypeScript. It enables you to break down complex coding tasks into multiple steps, customize prompts for each step, and call AI coding assistants (Claude Code, OpenCode, etc.) to execute them.

---

## Quick Start

### Example 1: Task Step Control

Break complex tasks into stable small steps, with Shell command verification:

```typescript
import { setTaskName, StepWise } from 'stepwise';

setTaskName('RefactorModule');
const agent = new StepWise('MainAgent');

// Break complex tasks into multiple small steps
await agent.execPrompt('Step 1: Analyze module dependencies');
await agent.execPrompt('Step 2: Extract common interface definitions');
await agent.execPrompt('Step 3: Refactor core logic');

// Run build and tests to verify changes
const buildResult = await agent.execShell('npm run build');
if (!buildResult.success) {
  await agent.execPrompt('Fix build errors');
}

// Completed steps are automatically skipped, supports checkpoint recovery
```

### Example 2: Stable Data Collection with execCollectPrompt

Collect structured data reliably with built-in validation and retry mechanisms:

```typescript
const result = await agent.execCollectPrompt('Collect all API endpoints', {
  keys: [
    { name: 'name', description: 'API name', type: 'string' },
    { name: 'method', description: 'HTTP method', type: 'string' },
    { name: 'path', description: 'API path', type: 'string' }
  ]
});

// Internal mechanisms ensure stable collection:
// 1. JSON format validation
// 2. Field completeness check
// 3. Type matching verification
// 4. Auto-retry with fix prompts on validation failure

// Optionally, add custom validation with checkPrompt
const result = await agent.execCollectPrompt('Collect user data', {
  keys: [...],
  checkPrompt: 'Verify all email addresses are valid'
});
```

### Example 3: Parallel Processing of Collected Data

Use `forEachParallel` to process collected data concurrently:

```typescript
import { setTaskName, forEachParallel, WorkerConfig, loadCollectData } from 'stepwise';

setTaskName('ProcessAPIs');

// Load previously collected data
const apis = loadCollectData('api_endpoints.json');

// Configure parallel workers with git worktree isolation
const workerConfigs: WorkerConfig[] = [
  { branchName: 'Worker1' },
  { branchName: 'Worker2' },
];

await forEachParallel(apis, workerConfigs, async (ctx) => {
  // Each worker has isolated workspace via git worktree
  await ctx.stepWise.execPrompt(
    'Generate test for API: $name ($method $path)',
    { data: ctx.item }
  );
});
// All branches merged automatically after completion
```

### Example 4: Branch Routing with execCheckPrompt

Use `execCheckPrompt` as a routing node to branch to different agents:

```typescript
const checkResult = await agent.execCheckPrompt('Check if tests pass');

if (!checkResult.result) {
  const fixAgent = new StepWise('FixAgent');
  await fixAgent.execPrompt('Fix failing tests');
} else {
  const deployAgent = new StepWise('DeployAgent');
  await deployAgent.execPrompt('Deploy to staging');
}
```

### Example 5: Skill Auto-Generation

After multiple successful attempts, auto-summarize Skills:

```typescript
await agent.execPrompt('Configure database connection');
await agent.execPrompt('Create data model');
await agent.execPrompt('Implement CRUD interfaces');

// Auto-summarize on new session
await agent.execPrompt('Next task', { newSession: true });

// Or manually trigger
const summaryResult = await agent.summarize();
console.log('Generated Skill files:', summaryResult.skillFiles);
```

### Example 6: Checkpoint Recovery & Debug Mode

Resume from interruption and use debug mode for quick validation:

```typescript
import { StepWise, setTaskName, setResumePath, enableDebugMode } from 'stepwise';

// Enable debug mode: collect only 1 item for quick workflow validation
enableDebugMode(true);

setResumePath('MyTask_20260315_143000_123');
setTaskName('MyTask');
const agent = new StepWise('MainAgent');

// Completed steps are automatically skipped
await agent.execPrompt('Step 1: Analyze project');           // Skipped
await agent.execCollectPrompt('Step 2: Collect data', fmt);  // Skipped
await agent.execPrompt('Step 3: Process item $name', { data: { name: 'item1' } }); // Resume here
```

---

## Core Features

### Task Types

| Method | Usage | Description |
|--------|-------|-------------|
| `execPrompt` | Normal task | Execute a single prompt task |
| `execCollectPrompt` | Collection task | Collect structured data with auto validation |
| `execCheckPrompt` | Routing node | Check condition and return true/false for branch routing |
| `execReport` | Report task | Generate summary report |
| `execShell` | Shell command | Execute Shell commands (build, test, etc.) |
| `summarize` | Skill generation | Summarize session and generate Skill |

For detailed API documentation, see [API Reference](doc/api.md).

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

### Step Control Mechanism

StepWise implements step control through task sequence numbers and progress persistence:

1. **Task Sequence Number**: Each step has a unique number, auto-incremented
2. **Progress Persistence**: Execution state saved to `progress.json`
3. **Session Reuse**: Uses `--resume` mode to maintain context continuity

### Data Validation Mechanism

- JSON format validation
- Field completeness validation
- Type matching validation
- Auto-generate fix prompts on validation failure
- `checkPrompt` option for custom validation

### Branch Routing Mechanism

- `execCheckPrompt` outputs `{ result: true/false }` to `check_result.json`
- Use result to route to different agents
- Enables conditional workflow branching

### Skill Generation Mechanism

- **Trigger timing**: Creating new session or manual call
- **Generation conditions**: Tasks with multiple successful attempts, valuable experience
- **Storage location**: Project-level `.claude/skills/` directory

### AI Coding Assistant Integration

StepWise works with AI coding assistants through their headless mode with session reuse:

```bash
# Claude Code example
claude --dangerously-skip-permissions --session-id <uuid> -p "your prompt"
claude --dangerously-skip-permissions --resume <session-id> -p "your prompt"

# OpenCode example
opencode run --session <uuid> "your prompt"
# OpenCode auto-detects new vs resume session
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