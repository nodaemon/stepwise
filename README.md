# StepWise

<p align="center">
  <strong>A TypeScript SDK that turns AI coding agents into reliable, resumable workflows</strong>
</p>

<p align="center">
  <a href="#why-stepwise">Why StepWise</a> • <a href="#how-it-works">How It Works</a> • <a href="#quick-start">Quick Start</a> • <a href="#examples">Examples</a> • <a href="#execution-output-layout">Layout</a> • <a href="#documentation">Documentation</a> • <a href="README_CN.md">中文文档</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MulanPSL2-blue.svg" alt="License">
</p>

---

## Why StepWise?

StepWise is built for one class of task: you write the script and walk away, and it runs for hours, across a full overnight window — refactoring a module and fixing every caller, backfilling tests across a batch of files, migrating a repository by rule. Somewhere in the middle the machine restarts, a quota resets, a process gets killed. What you come back to has to be a result you can trust, not a claim that it finished.

The difference from interactive coding work is not agent capability. It is that nobody is watching. No one can stop it at minute twenty, no one can notice it has drifted, and no one is there to take over when it fails. Failure therefore stops being a single event and starts being a full night of compute, burned repeatedly.

### Why not just use Claude Code

Claude Code is already strong on its own: single-session resume and file checkpointing, JSON Schema structured outputs with automatic re-prompting, `--worktree` isolation, and an OS-level sandbox. StepWise mostly stops rebuilding those. What remains is a difference in the **granularity of recovery** and the **boundary it runs across**:

| Already native in the platform | What StepWise adds |
|---|---|
| File checkpointing: roll back edited code | Task-level resume: remembers "step N is done", so re-running the script skips completed steps instead of recomputing them |
| Single-session resume: pick up the previous conversation | Cross-process, cross-session resume: the resume path is printed at startup, and re-running the same script is enough, whether or not the original session is still around |
| Quota exhaustion waits for the reset inside an interactive session | Quota resilience on the non-interactive path: 429 / 503 probe recovery with a throwaway session, so waiting never burns retry budget and rate-limit errors never enter your real context |
| JSON Schema structured outputs: format conformance is enough | Content-level validation: first confirm the artifact actually exists, then validate its contents, then auto-generate a repair prompt and retry if it fails |

Quota resilience carries the most value here: on non-interactive `claude -p` and SDK runs the platform fails outright when the quota runs out instead of waiting, and rate limiting is exactly the failure mode batch jobs hit most often.

### What you get back after a full night

| What goes wrong | How StepWise handles it |
|---|---|
| The process is killed or the machine restarts, and the work is lost | Completed steps are skipped on resume — re-run the same script with the resume path printed at startup |
| Overnight jobs get cut off by quota | 429 and 503 wait and retry without burning retry budget; recovery is probed with a throwaway session, so 429 errors never poison your real context |
| It drifts silently in the middle, and nobody notices | In debug mode every step gets an automatic review: an independent reviewer checks goal clarity, missing or redundant input, and detours, and must quote source text verbatim to back each finding |
| "Done" is only a claim | Declare the output format; StepWise checks the file exists *and* validates, then auto-generates a repair prompt and retries |
| Hard to tell why a long run failed, or to analyze where its time and tokens went | Every step is observable — duration and token spend itemized, the agent's reasoning and tool calls captured as they happen, task time counted separately from quota wait, and any step re-runnable exactly as it ran |
| Parallel agents trample each other | Each worker gets its own git worktree and items come off a shared queue; branches are committed but never auto-merged into your main branch |
| Locked into a single agent CLI | Claude Code (default), OpenCode, CodeAgent, and Pi share one workflow script, so switching backends does not mean rewriting |
| The same trap springs every week | What worked is distilled into a Skill, which your agent CLI loads natively next session |
| The blast radius is too large | `setAllowRead` / `setAllowWrite` scope a step to specific directories — a prompt-level guardrail, not an OS sandbox |

### When you do not need it

StepWise only solves the class of problem described above. Interactive work where you chat and edit as you go, a two- or three-step task that does not justify a framework, or simply wanting one agent's stronger single-shot ability — all of these are easier with Claude Code's native features.

For cross-machine, distributed, auditable long-running recovery, StepWise is the wrong tool too: that layer belongs to durable execution infrastructure like Temporal or Restate, which pay for it by introducing external services and state stores. StepWise's trade-off is the opposite — single process, no external dependencies, state entirely on disk, and one run is one inspectable, archivable folder.

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

**Self-check review in debug mode**

After every AI step succeeds in debug mode, the framework opens a new session and hands that step's prompt, output, and execution trace to an independent reviewer, which checks whether the goal is clear, whether input is missing or redundant, and whether tool calls went down detours. The reviewer must quote source text verbatim to back each finding — anything it cannot quote is dropped. The report lands in `self_check.md` next to `output.txt`; see [Execution Output Layout](#execution-output-layout).

---

## Execution Output Layout

One run is one folder, created under `stepwise_exec_infos/` in your working directory. The resume path printed at startup is that folder's name:

```
stepwise_exec_infos/
└── <TaskName>_<YYYYMMDD>_<HHmmss>_<ms>/          ← one run = one folder
    ├── logs/
    │   ├── performance.json                     ← cumulative duration / token stats (machine-readable)
    │   └── performance.txt                      ← same, readable
    ├── report/                                  ← reports produced by execReport
    │
    └── <AgentName>_<timestamp>/                 ← one per agent / worker
        ├── data/
        │   └── progress.json                    ← checkpoint state (index, status, session id)
        ├── logs/
        │   ├── execute.log                      ← per-step start / end / retry / skip
        │   ├── 1_collect/                       ← the 1st collect step
        │   │   ├── prompt.txt                   ←   the prompt actually sent
        │   │   ├── output.txt                   ←   final output
        │   │   ├── verbose_output.txt           ←   full reasoning and tool-call trace
        │   │   ├── command.sh                   ←   re-runnable as-is with ./command.sh
        │   │   ├── execution_info.json          ←   argv, session id, environment
        │   │   ├── usage.json                   ←   token usage (NDJSON executors)
        │   │   ├── schema.json                  ←   schema definition for execPromptSchema
        │   │   ├── post_check_prompt.txt        ←   the postCheckPrompt text
        │   │   ├── error.txt                    ←   failure reason (only on failure)
        │   │   └── self_check.md                ←   self-check report (debug mode only)
        │   ├── 2_task/                          ← 2nd step, and so on
        │   └── 1_self_check/                    ← reviewer's own logs (debug mode only)
        └── collect/
            └── 1_collect/
                └── collect_1.json               ← output of collection steps
```

Step folders are named `{index}_{type}`, where the type comes from the `exec*` call (`task` / `collect` / `check` / `report` / `schema` / `shell`). Files that only appear conditionally:

| File | Appears when |
|---|---|
| `error.txt` | That step failed |
| `usage.json` | Using Claude Code / CodeAgent (NDJSON executors) |
| `schema.json` | `execPromptSchema` |
| `post_check_prompt.txt` | That step set `postCheckPrompt` |
| `self_check.md` | Self-check review in debug mode |

Nothing here is write-only: `progress.json` decides where a resume picks up, `command.sh` lets any single step be re-run outside the framework, and `verbose_output.txt` preserves exactly what the agent saw, did, and where it wandered.

---

## Documentation

- [API Reference](doc/api.md) — full API documentation
- [Examples](demos.md) — complete runnable examples
- [中文文档](README_CN.md) — Chinese documentation

Found a bug or want to help improve StepWise? Open an Issue or send a Pull Request.

---

## License

MulanPSL2 — Mulan Permissive Software License, Version 2. See [the license](https://license.coscl.org.cn/MulanPSL2).
