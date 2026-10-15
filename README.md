# StepWise

<p align="center">
  <strong>A TypeScript SDK that turns AI coding agents into reliable, resumable workflows</strong>
</p>

<p align="center">
  <a href="#why-stepwise">Why StepWise</a> • <a href="#how-it-works">How It Works</a> • <a href="#quick-start">Quick Start</a> • <a href="#examples">Examples</a> • <a href="#documentation">Documentation</a> • <a href="README_CN.md">中文文档</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MulanPSL2-blue.svg" alt="License">
</p>

---

## Why StepWise?

You hand a coding agent one big prompt: *"refactor the auth module, update every caller, and run the tests."* Twenty minutes later it has drifted, quietly skipped half the requirements, and you have no way to tell which parts actually landed.

The problem is rarely model intelligence. It is that a single long run has no checkpoints: nothing observes progress, nothing survives an interruption, and nothing verifies the output before you build on top of it.

StepWise answers that by making every step a checkpoint. It is a **TypeScript SDK**, not a CLI tool or a dashboard: you write a script, and the framework drives Claude Code, OpenCode, CodeAgent, or Pi in headless mode while persisting state between runs.

Each of those worries is handled inside the step itself rather than bolted on afterwards:

| What goes wrong | How StepWise handles it |
|---|---|
| Long runs drift, or lose work when interrupted | Completed steps are skipped on resume — re-run the same script with the resume path printed at startup |
| "Done" is only a claim | Declare the output format; StepWise checks the file exists *and* validates, then auto-generates a repair prompt and retries |
| Overnight jobs die on quota | 429 and 503 wait and retry without burning retry budget; recovery is probed with a throwaway session, so 429 errors never poison your real context |
| You can't see what a step did, or what it cost | Every step is observable — `performance.txt` breaks time down by call site, counting task time and quota wait separately; `usage.json` records tokens and USD cost; `verbose_output.txt` streams the agent's reasoning and tool calls; `command.sh` re-runs that exact step |
| Parallel agents trample each other | Each worker gets its own git worktree and items come off a shared queue; branches are committed but never auto-merged into your main branch |
| The same trap springs every week | What worked is distilled into `.claude/skills/SKILL.md`, which your agent CLI loads natively next session |
| The blast radius is too large | `setAllowRead` / `setAllowWrite` scope a step to specific directories — a prompt-level guardrail, not an OS sandbox |

---

## How It Works

1. **You write a script.** Each `exec*` call is one cell of the workflow. No YAML, no daemon, no dashboard.
2. **State lives on disk.** Every step writes its index, status, and session ID as it completes, so a run is a folder you can inspect, archive, or resume.
3. **Context is a session you control.** Steps reuse one session by default; start a new one or fork a branch to try an alternative without losing the original.

---

## Quick Start

Requires **Node.js 16+** (the build target is `moduleResolution: Node16`) and at least one coding agent CLI on your `PATH` — Claude Code (default), OpenCode, CodeAgent, or Pi. With OpenCode, set `"permission": "allow"` in `opencode.json` so it stops asking for confirmations.

StepWise is not published to npm yet, so build it from source:

```bash
git clone https://gitee.com/nodaemon/stepwise.git
cd stepwise && npm install && npm run build
```

Then write your workflow. Startup prints the task directory and a resume command — pass it back as the second argument of `initTask` and every completed step is skipped:

```typescript
import { initTask, StepWise } from './stepwise/dist';

initTask('RefactorAuth');   // resume with: initTask('RefactorAuth', 'RefactorAuth_20260315_143000_123')
const agent = new StepWise('MainAgent');

await agent.execPrompt('Analyze module dependencies');
await agent.execPrompt('Extract common interface definitions');
await agent.execPrompt('Refactor core logic');
```

---

## Examples

### 1. Step Control

Verify each step with a real command instead of trusting the agent's word:

```typescript
const build = await agent.execShell('npm run build');
if (!build.success) {
  await agent.execPrompt('Fix build errors');
}
```

### 2. Structured Data Collection

Declare the format; the first required field is used for deduplication. Validation and repair retries are on by default — tune them per step if you need to:

```typescript
const result = await agent.execCollectPrompt('Collect all API endpoints', {
  name: { type: 'string', description: 'API name' },
  method: { type: 'string', description: 'HTTP method' },
  path: { type: 'string', description: 'API path' },
  description: { type: 'string', description: 'API description', required: false }
}, {
  validateOptions: { maxRetries: 3, retryOnFileMissing: true }
});
```

### 3. Conditional Branching

Route to different agents based on a condition:

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

### 4. Parallel Processing

Run one handler over many items across isolated workers. Add `{ cwd: '/path/to/other-repo' }` as a fourth argument to work in a different repository:

```typescript
import { forEachParallel, WorkerConfig, loadCollectData } from 'stepwise';

const apis = loadCollectData('api_endpoints.json');
const workerConfigs: WorkerConfig[] = [{ branchName: 'Worker1' }, { branchName: 'Worker2' }];

await forEachParallel(apis, workerConfigs, async (ctx) => {
  await ctx.stepWise.execPrompt('Generate test for API: $name ($method $path)', { data: ctx.item });
});
```

Each worker runs in its own worktree, so sessions are stored per directory. Forking across worktrees (`sessionId` + `newSession: true`) auto-symlinks the session into place; passing a standalone `sessionId` across worktrees throws rather than risk concurrent writes.

### 5. Schema-Driven Output

Output JSON conforming to a schema you define — arbitrary nesting and recursive trees:

```typescript
const tree = await agent.execPromptSchema(
  'Generate the directory tree of this project',
  {
    type: 'object',
    recursive: true,
    recursiveFields: ['children'],
    maxDepth: 5,
    properties: {
      name: { type: 'string', description: 'File or directory name' },
      type: { type: 'string', description: "'file' or 'directory'" },
      children: { type: 'array', description: 'Sub-entries (recursively defined)' }
    }
  },
  'dir_tree.json'
);
```

### 6. Session Management

```typescript
const r2 = await agent.execPrompt('Implement CRUD APIs');   // session reused automatically
const sessionId = r2.sessionId;

await agent.execPrompt('Start an independent requirement', { newSession: true });
await agent.execPrompt('Continue refining', { sessionId });         // resume that session

const forked = await agent.execPrompt('Try an alternative approach', {
  sessionId,                                        // fork: derive a new session
  newSession: true                                  // original stays untouched
});
```

### 7. Checkpoint Recovery & Debug Mode

Enable debug mode to run the whole workflow over a single item, then resume an interrupted run by passing its path:

```typescript
import { initTask, StepWise, enableDebugMode } from 'stepwise';

enableDebugMode(true);   // collect only 1 item — validates the whole workflow fast

initTask('MyTask', 'MyTask_20260315_143000_123');
const agent = new StepWise('MainAgent');

await agent.execPrompt('Step 1: Analyze project');           // skipped
await agent.execCollectPrompt('Step 2: Collect data', fmt); // skipped
await agent.execPrompt('Step 3: Process item $name', { data: { name: 'item1' } }); // resumes here
```

---

## Documentation

- [API Reference](doc/api.md) — full API documentation
- [Examples](demos.md) — complete runnable examples
- [中文文档](README_CN.md) — Chinese documentation

Found a bug or want to help improve StepWise? Open an Issue or send a Pull Request.

---

## License

MulanPSL2 — Mulan Permissive Software License, Version 2. See [the license](https://license.coscl.org.cn/MulanPSL2).
