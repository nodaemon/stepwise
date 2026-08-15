# StepWise

<p align="center">
  <strong>Efficient AI Agent Team Building Framework - Make AI coding assistants reliably execute complex tasks</strong>
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

When working with AI coding assistants on complex development tasks, we often face three major pain points:

| Pain Point | StepWise Solution |
|------------|-------------------|
| Long tasks drift, multi-tasks get missed | Break tasks into stable small steps, data validation ensures correct output, condition checks verify execution results |
| Private data handling is difficult | Support Skill-generating Agents, auto-summarize Skills after multiple successful attempts |
| Debugging is hard, progress lost on interruption | Checkpoint recovery, debug mode for quick validation |

StepWise enables AI coding assistants (Claude Code, OpenCode, etc.) to complete complex tasks reliably through task step control, data validation, conditional routing, and checkpoint recovery.

---

## Quick Start

### Example 0: Choose AI Coding Assistant

Supports Claude Code, OpenCode, and CodeAgent, defaults to Claude Code:

```typescript
import { setAgentType, setTaskName, StepWise } from 'stepwise';

// Set AI coding assistant type (optional, default: 'claude')
setAgentType('claude');   // Use Claude Code (default)
// setAgentType('opencode');  // Use OpenCode
// setAgentType('codeagent'); // Use CodeAgent (same args as claude, different executable)
// setAgentType('pi');        // Use Pi (@earendil-works/pi-coding-agent)

setTaskName('MyTask');
const agent = new StepWise('MainAgent');
```

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
// Simple format - first required field is automatically used for deduplication
const result = await agent.execCollectPrompt('Collect all API endpoints', {
  name: { type: 'string', description: 'API name' },
  method: { type: 'string', description: 'HTTP method' },
  path: { type: 'string', description: 'API path' },
  description: { type: 'string', description: 'API description', required: false }
});

// The first required field ('name' in this case) is automatically used for deduplication
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
// Finalize: deterministic script commits each worktree's changes to its own branch
// and keeps the branches (no AI-driven merge)
```

```typescript
// Specify a different git repo as working directory
await forEachParallel(apis, workerConfigs, async (ctx) => {
  await ctx.stepWise.execPrompt(
    'Generate test for API: $name ($method $path)',
    { data: ctx.item }
  );
}, { cwd: '/path/to/other-repo' });
```

> **Parallel finalization & branch preservation**: After parallel tasks finish, the framework runs a **deterministic script** (no AI) to commit each worktree's changes to its own branch and keep the branch, then removes the worktree. Code is not auto-merged into the main branch (avoiding AI-merge-induced code loss); the main branch stays clean. The console prints the list of preserved branch names; integrate manually as needed (e.g. `git merge <branch>`). Set `skipBranchMerge: true` to skip this finalization script (worktree changes won't be committed).

> **Session behavior in parallel mode**: Each worker runs in its own git worktree (a different cwd from the main repo). Claude/CodeAgent/Pi sessions are stored per-cwd (Claude Code under `~/.claude/projects/`, CodeAgent under `~/.cac/projects/`, Pi under `~/.pi/agent/sessions/`), so:
> - **Default reuse**: when the worker omits `sessionId`, the session is created and reused within the worker's own worktree — no problem.
> - **Fork (`sessionId` + `newSession:true`)**: the framework auto-symlinks the main repo's session file into the worktree's projects dir so fork can branch across worktrees (fork only reads the original session, so it's safe). Symlinks are not removed when the worktree is deleted — leftover links are harmless (worst case a dangling symlink that Claude treats as "conversation not found"); call `cleanWorktreeSessionLinks` manually to clean up.
> - **Standalone `sessionId` (no fork)**: resuming across cwds risks concurrent writes to a shared session, so the framework **throws an error**. To share context across worktrees, use fork, or pass context via artifact files rather than sessions.

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
import { StepWise, initTask, enableDebugMode } from 'stepwise';

// Enable debug mode: collect only 1 item for quick workflow validation
enableDebugMode(true);

// initTask: optional second arg is the resume path (task directory name)
initTask('MyTask', 'MyTask_20260315_143000_123');
const agent = new StepWise('MainAgent');

// Completed steps are automatically skipped
await agent.execPrompt('Step 1: Analyze project');           // Skipped
await agent.execCollectPrompt('Step 2: Collect data', fmt);  // Skipped
await agent.execPrompt('Step 3: Process item $name', { data: { name: 'item1' } }); // Resume here
```

### Example 7: Session Management

StepWise gives you explicit control over AI sessions. Every `exec*` call returns an `ExecutionResult` whose `sessionId` field is the session ID actually used for that run. This example walks through the four behaviors: default reuse, standalone `newSession`, reusing a specific `sessionId`, and `fork`.

```typescript
import { StepWise } from 'stepwise';

const agent = new StepWise('SessionAgent');

// 1) Default behavior: the first task creates a new session; subsequent
//    tasks automatically reuse it (context accumulates across steps).
//    result.sessionId always reports the ID used for that run.
const r1 = await agent.execPrompt('Analyze requirements and design the data model');
const r2 = await agent.execPrompt('Implement CRUD APIs based on the previous design');
// r2.sessionId === r1.sessionId  → same session, continuous context
const sessionId = r2.sessionId;

// 2) Standalone newSession: true → create a brand-new session. If a previous
//    session exists, it is auto-summarized first (Skill generation).
//    Use setSkipSummarize(true) to skip the summary.
const r3 = await agent.execPrompt('Start an independent new requirement', { newSession: true });
// r3.sessionId is a fresh ID, different from r1/r2; the prior session was summarized

// 3) Specify sessionId: resume a known session to keep working in it
//    (forces resume mode, i.e. --resume <sessionId>).
await agent.execPrompt('Continue refining on top of an existing session', { sessionId });

// 4) Fork: sessionId + newSession: true → branch a new session off the given
//    sessionId. The original session is preserved; the derived session runs
//    independently. The new ID is returned via result.sessionId.
const r5 = await agent.execPrompt('Try an alternative implementation approach', {
  sessionId,          // branch off from this existing session
  newSession: true    // ← fork semantics
});
// r5.sessionId is a brand-new derived ID; the original session is untouched
```

**Behavior summary**

1. **Default (reuse)** — passing no session option: the first task creates a new session, and every subsequent step reuses the previous one (`--resume`), so context accumulates. `result.sessionId` (on `ExecutionResult`) always reports the ID used for that run.
2. **Standalone `newSession`** — `{ newSession: true }` creates a fresh session; if a prior session exists, it is auto-summarized first (Skill generation). Disable with `setSkipSummarize(true)`.
3. **Specify `sessionId`** — `{ sessionId }` forces resume mode to reuse that specific known session — ideal for resuming from a checkpoint.
4. **Fork** — `{ sessionId, newSession: true }` derives a new session from the given one, leaving the original intact. The derived new ID is returned via `result.sessionId` and recorded in `progress.json` / `currentSessionId`.

**Underlying commands**

| Options | Claude / CodeAgent | OpenCode | Semantics |
|---|---|---|---|
| (default) | `--resume <id>` | `--session <id>` | Reuse previous session |
| `newSession: true` | `--session-id <new>` | (no `--session`) | Fresh session (+summarize prior) |
| `sessionId` | `--resume <id>` | `--session <id>` | Reuse the specified session |
| `sessionId` + `newSession: true` | `--resume <id> --fork-session` | `--session <id> --fork` | Branch off the specified session |

> Fork only takes effect when **both** `sessionId` and `newSession: true` are set. Passing `newSession: true` alone creates a fresh new session (and summarizes the previous one); passing `sessionId` alone resumes that session.

> **Resuming a fork**: while a fork runs, the derived new ID is written to `progress.json` as soon as it's produced. So even if the fork step is interrupted, `setResumePath` resumes with the derived ID instead of deriving again. Note: OpenCode's derived ID is only available after execution ends, so an interrupted OpenCode fork will re-derive on resume.

---

## Core Features

### API Overview

#### StepWise Class Methods

| Method | Usage | Description |
|--------|-------|-------------|
| `execPrompt` | Normal task | Execute a single prompt task |
| `execCollectPrompt` | Collection task | Collect structured data with built-in validation and retry |
| `execCheckPrompt` | Routing node | Check condition and return true/false for branch routing |
| `execReport` | Report task | Generate summary report |
| `execShell` | Shell command | Execute Shell commands (build, test, etc.) |
| `summarize` | Skill generation | Summarize session and generate Skill |

#### Global Settings Functions

| Method | Usage | Description |
|--------|-------|-------------|
| `initTask` | Initialize task | Set task name; optional resume path as 2nd arg (replaces `setTaskName`+`setResumePath`) |
| `setAgentType` | Set AI coding assistant | Optional, default `'claude'`, options: `'opencode'`, `'codeagent'`, `'pi'` |
| `enableDebugMode` | Enable debug mode | Quick validation, collect only 1 item |
| `setSkipSummarize` | Skip auto-summarize | Disable auto-summarize when creating new session |
| `saveCollectData` | Save collected data | Save data to JSON file |
| `loadCollectData` | Load collected data | Load data from JSON file |

> `setTaskName` and `setResumePath` are deprecated; prefer `initTask`, which takes an optional resume path and avoids the call-order dependency.

#### Parallel Processing

| Method | Usage | Description |
|--------|-------|-------------|
| `forEachParallel` | Parallel processing | Auto-manage git worktree for true parallel execution |

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
    │   │   │   ├── prompt.txt         # Task prompt
    │   │   │   ├── output.txt         # Standard output summary
    │   │   │   ├── verbose_output.txt # Detailed output (AI thinking, tool calls, etc.) ★Key debug file
    │   │   │   └── ...
    │   │   ├── 2_collect/
    │   │   │   ├── ... (same as above)
    │   │   └── execute.log            # Execution summary log
    │   └── collect/                   # Collected data
    │       └── 2_collect/
    └── Agent2_20260315_143002_789/    # Another agent
        └── ...
```

**Key File**: `verbose_output.txt` records AI's complete thinking process and tool calls - the most critical file for analyzing issues. See [API Documentation](doc/api.md) for details.

---

## How It Works

### Step Control Mechanism

StepWise implements step control through task sequence numbers and progress persistence:

1. **Task Sequence Number**: Each step has a unique number, auto-incremented
2. **Progress Persistence**: Execution state saved to `progress.json`
3. **Session Reuse**: Uses `--resume` mode to maintain context continuity
4. **Session Fork**: Specifying both `sessionId` and `newSession: true` branches off a new session from the given one (`--fork-session` / `--fork`), preserving the original

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
# Fork: resume from <session-id> but create a new branch session (original preserved)
claude --dangerously-skip-permissions --resume <session-id> --fork-session -p "your prompt"

# CodeAgent example (command-line args identical to Claude Code, only the executable name differs)
codeagent --dangerously-skip-permissions --session-id <uuid> -p "your prompt"
codeagent --dangerously-skip-permissions --resume <session-id> -p "your prompt"
codeagent --dangerously-skip-permissions --resume <session-id> --fork-session -p "your prompt"

# OpenCode example
opencode run --thinking --session <uuid> "your prompt"
# OpenCode auto-detects new vs resume session
# Fork: branch off from <uuid> into a new session (original preserved)
opencode run --thinking --session <uuid> --fork "your prompt"

# Pi example (@earendil-works/pi-coding-agent)
# --session-id auto-detects: creates if missing, opens (resumes) if exists
pi --session-id <uuid> -p "your prompt"
# Fork: branch off from <uuid> into a new session with specified new ID (original preserved)
pi --fork <session-id> --session-id <new-uuid> -p "your prompt"
```

> **Pi**: No permission flags needed — Pi has no permission popups by design. Session ID is specified via `--session-id` (auto-detects create vs resume). Fork uses `--fork <id> --session-id <new-id>` to pre-assign the derived session ID, avoiding the need to parse JSON output.

> **OpenCode Permission Configuration**: When using OpenCode, you need to add `"permission": "allow"` to the `opencode.json` config file in the project root directory to skip interactive permission confirmations. For more details, see [OpenCode Permissions](https://opencode.ai/docs/permissions/).
>
> ```json
> {
>   "$schema": "https://opencode.ai/config.json",
>   "permission": "allow"
> }
> ```

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

This project is licensed under the [MulanPSL2](https://license.coscl.org.cn/MulanPSL2) - Mulan Permissive Software License, Version 2.

[![License: MulanPSL2](https://img.shields.io/badge/License-MulanPSL2-blue.svg)](https://license.coscl.org.cn/MulanPSL2)