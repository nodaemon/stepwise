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

Break complex tasks into stable small steps, each step completes reliably:

```typescript
import { setTaskName, StepWise } from 'stepwise';

setTaskName('RefactorModule');
const agent = new StepWise('MainAgent');

// Break complex tasks into multiple small steps, each stable
await agent.execPrompt('Step 1: Analyze module dependencies');
await agent.execPrompt('Step 2: Extract common interface definitions');
await agent.execPrompt('Step 3: Refactor core logic');

// Completed steps are automatically skipped, supports checkpoint recovery
```

### Example 2: Data Validation with checkPrompt

Collect structured data with additional validation using `checkPrompt` option:

```typescript
// Data collection with checkPrompt for extra validation
const result = await agent.execCollectPrompt('Collect all API endpoints', {
  keys: [
    { name: 'name', description: 'API name', type: 'string' },
    { name: 'method', description: 'HTTP method', type: 'string' },
    { name: 'path', description: 'API path', type: 'string' }
  ],
  checkPrompt: 'Verify all endpoints have valid paths starting with /'
});
// checkPrompt runs after data collection for additional verification
```

### Example 3: Branch Routing with execCheckPrompt

Use `execCheckPrompt` as a routing node to branch to different agents based on conditions:

```typescript
// execCheckPrompt returns true/false for routing decisions
const checkResult = await agent.execCheckPrompt('Check if tests pass');

// Route to different agents based on result
if (!checkResult.result) {
  // Branch to FixAgent for fixing failing tests
  const fixAgent = new StepWise('FixAgent');
  await fixAgent.execPrompt('Fix failing tests');
} else {
  // Branch to DeployAgent for deployment
  const deployAgent = new StepWise('DeployAgent');
  await deployAgent.execPrompt('Deploy to staging');
}
```

### Example 4: Skill Auto-Generation

After multiple successful attempts, auto-summarize Skills:

```typescript
// Execute a series of tasks
await agent.execPrompt('Configure database connection');
await agent.execPrompt('Create data model');
await agent.execPrompt('Implement CRUD interfaces');

// Summarize and generate Skill (triggered on new session)
await agent.execPrompt('Next task', { newSession: true });
// Auto-summarize previous session, generate SKILL.md

// Or manually trigger summarization
const summaryResult = await agent.summarize();
console.log('Generated Skill files:', summaryResult.skillFiles);
```

### Example 5: Checkpoint Recovery

Resume from interruption point - no progress lost:

```typescript
import { StepWise, setTaskName, setResumePath } from 'stepwise';

setResumePath('MyTask_20260315_143000_123');
setTaskName('MyTask');
const agent = new StepWise('MainAgent');

// Completed steps are automatically skipped
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
| `execCollectPrompt` | Collection task | Collect structured data with auto validation |
| `execCheckPrompt` | Routing node | Check condition and return true/false for branch routing |
| `execReport` | Report task | Generate summary report |
| `execShell` | Shell command | Execute Shell commands (build, test, etc.) |
| `summarize` | Skill generation | Summarize session and generate Skill |

### Task Step Control

Each step has a unique sequence number, auto-incremented:

```typescript
import { setTaskName, StepWise } from 'stepwise';

setTaskName('MyTask');
const agent = new StepWise('MainAgent');

// Step numbers are auto-assigned: 1, 2, 3...
await agent.execPrompt('First task');   // Task #1
await agent.execPrompt('Second task');  // Task #2
```

### Data Validation

#### Built-in Validation with execCollectPrompt

Automatic validation with retry on failure:

```typescript
const result = await agent.execCollectPrompt('Collect user data', {
  keys: [
    { name: 'id', description: 'User ID', type: 'string' },
    { name: 'name', description: 'User name', type: 'string' },
    { name: 'email', description: 'Email address', type: 'string' }
  ],
  maxRetries: 3  // Auto retry up to 3 times on validation failure
});
```

#### Additional Validation with checkPrompt

Use `checkPrompt` option for custom validation after task completion:

```typescript
// checkPrompt runs after main task with --resume mode
await agent.execPrompt('Create user module', {
  checkPrompt: 'Verify the module follows project conventions'
});

// Works with execCollectPrompt too
const result = await agent.execCollectPrompt('Collect config data', {
  keys: [...],
  checkPrompt: 'Verify all config values are valid'
});
```

### Branch Routing with execCheckPrompt

`execCheckPrompt` is a routing node that returns boolean for branch decisions:

```typescript
// Check code quality
const qualityCheck = await agent.execCheckPrompt('Check code quality score above 80');
if (qualityCheck.result) {
  // High quality - proceed with deployment
  const deployAgent = new StepWise('DeployAgent');
  await deployAgent.execPrompt('Deploy to production');
} else {
  // Low quality - route to improvement agent
  const improveAgent = new StepWise('ImproveAgent');
  await improveAgent.execPrompt('Improve code quality');
}
```

### Skill Auto-Generation

Summarize valuable experience after multiple successful attempts:

```typescript
// Trigger on new session - auto-summarize previous session
await agent.execPrompt('Next task', { newSession: true });

// Or manually trigger
const result = await agent.summarize();
// Skills saved to .claude/skills/[skill_name]/SKILL.md
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

### CLI Agent Support

Switch between different AI coding assistants:

```typescript
import { setAgentType } from 'stepwise';

// Use Claude Code (default)
setAgentType('claude');

// Use OpenCode
setAgentType('opencode');
```

### Global Settings

```typescript
import {
  setTaskName,
  setResumePath,
  enableDebugMode,
  setAgentType,
  saveCollectData,
  loadCollectData
} from 'stepwise';

// Set task name (required)
setTaskName('MyTask');

// Set resume path for recovery
setResumePath('MyTask_20260315_143000_123');

// Enable debug mode
enableDebugMode(true);

// Switch AI coding assistant
setAgentType('claude');  // or 'opencode'

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

### CLI Agent Integration

StepWise works with AI coding assistants through their headless mode with session reuse:

```bash
# Claude Code example
claude --dangerously-skip-permissions --session-id <uuid> -p "your prompt"
claude --dangerously-skip-permissions --resume <session-id> -p "your prompt"

# OpenCode example
opencode --session-id <uuid> -p "your prompt"
opencode --resume <session-id> -p "your prompt"
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