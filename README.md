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

StepWise replaces that one long run with a sequence of small steps that each finish reliably:

| Pain Point | StepWise Solution |
|------------|-------------------|
| Long tasks drift, multi-tasks get missed | Break tasks into stable small steps, data validation ensures correct output, condition checks verify execution results |
| Private data handling is difficult | Support Skill-generating Agents, auto-summarize Skills after multiple successful attempts |
| Debugging is hard, progress lost on interruption | Checkpoint recovery, debug mode for quick validation |

Every step also carries the safeguards that make a long run worth trusting — these are not add-ons you opt into:

- **Output is verified, not trusted.** Declare the format you want; StepWise checks that the file exists *and* that its contents validate, then auto-generates a repair prompt and retries (3 times by default). If the agent never wrote the file, it gets told to write it.
- **Spend is visible.** Every step writes a `usage.json` with input/output tokens, cache reads and writes, USD cost, and API-only latency. Performance stats separate *real task time* from *rate-limit wait time*, so a step stalled on quota never masquerades as a slow step — and the slowest step's log directory is named for you.
- **Long runs survive quota limits.** 429 and 503 responses wait and retry automatically without consuming retry budget. After a quota hit, StepWise probes for recovery using a throwaway session first, so 429 errors never accumulate into your real context and blow past the API's context limit.
- **Every step is reproducible.** Each step writes a runnable `command.sh` (exact working directory, environment, and original command) alongside `verbose_output.txt`, which streams the agent's full reasoning and tool calls as it happens.
- **Parallel work cannot collide.** Each worker gets its own git worktree, and items are handed out by a shared queue — whichever worker finishes first picks up the next item. Changes are committed to their own branch and never auto-merged into your main branch.
- **The agent gets better at your repo.** At the end of a session, StepWise reflects and writes what worked to `.claude/skills/SKILL.md`. Your agent CLI loads that natively next session, so the same trap isn't sprung twice.
- **Validate flows in seconds.** `enableDebugMode(true)` runs the entire workflow over a single item, so you can prove the flow works before spending a night on it.

**On file access:** `setAllowRead` / `setAllowWrite` restrict an agent to specific directories by injecting a strict access policy into the prompt. Treat it as a guardrail, not an OS sandbox — use containers or filesystem permissions when you need hard isolation.

StepWise is a **TypeScript SDK** — not a CLI tool, not a dashboard. You write a script, each `exec*` call is one step of your workflow, and the framework drives Claude Code, OpenCode, CodeAgent, or Pi in headless mode while persisting state between runs.

---

## How It Works

1. **You write a script.** Each `exec*` call is one cell of the workflow. No YAML, no daemon, no dashboard.
2. **Every cell checkpoints itself.** When a step completes, its index and state are written to `progress.json`. Kill the process at any point, re-run the script with the printed resume path, and completed steps are skipped.
3. **Every cell runs in a real agent session.** Context is reused across steps by default, and can be forked to try an alternative without touching the original.

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

Each worker runs in its own git worktree, so parallel agents never fight over the same files. Add `{ cwd: '/path/to/other-repo' }` as a fourth argument to run somewhere else:

```typescript
import { forEachParallel, WorkerConfig, loadCollectData } from 'stepwise';

const apis = loadCollectData('api_endpoints.json');
const workerConfigs: WorkerConfig[] = [{ branchName: 'Worker1' }, { branchName: 'Worker2' }];

await forEachParallel(apis, workerConfigs, async (ctx) => {
  await ctx.stepWise.execPrompt('Generate test for API: $name ($method $path)', { data: ctx.item });
});
```

Each worktree's changes are committed to its own branch and **never merged into your main branch** — the console prints the branch names so you decide what to merge. Across worktrees, fork (`sessionId` + `newSession: true`) auto-symlinks the session; a standalone `sessionId` throws rather than risk concurrent writes.

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

```typescript
import { initTask, StepWise, enableDebugMode } from 'stepwise';

enableDebugMode(true);   // collect only 1 item — validates the whole workflow fast

initTask('MyTask', 'MyTask_20260315_143000_123');
const agent = new StepWise('MainAgent');

await agent.execPrompt('Step 1: Analyze project');           // skipped
await agent.execCollectPrompt('Step 2: Collect data', fmt); // skipped
await agent.execPrompt('Step 3: Process item $name', { data: { name: 'item1' } }); // resumes here
```

When a run goes wrong, the task directory keeps every prompt plus the agent's full reasoning and tool calls in `verbose_output.txt` — the first file to read when diagnosing a step.

---

## Documentation

- [API Reference](doc/api.md) — full API documentation
- [Examples](demos.md) — complete runnable examples
- [中文文档](README_CN.md) — Chinese documentation

Found a bug or want to help improve StepWise? Open an Issue or send a Pull Request.

---

## License

MulanPSL2 — Mulan Permissive Software License, Version 2. See [the license](https://license.coscl.org.cn/MulanPSL2).
