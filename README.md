# StepWise

<p align="center">
  <strong>Let AI complete unattended long tasks accurately, reliably, and on its own</strong>
</p>

<p align="center">
  StepWise is a TypeScript SDK that drives Claude Code / OpenCode / CodeAgent / Pi / mcode headlessly.<br>
  Write the goal and walk away; what you come back to is a verifiable, traceable, reproducible result — not a claim that it finished.
</p>

<p align="center">
  <a href="#why-stepwise">Why StepWise</a> • <a href="#how-it-works">How It Works</a> • <a href="#quick-start">Quick Start</a> • <a href="#examples">Examples</a> • <a href="#execution-output-layout">Layout</a> • <a href="#documentation">Documentation</a> • <a href="#contributing">Contributing</a> • <a href="README_CN.md">中文文档</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License">
</p>

---

## Why StepWise?

### Long tasks need trust, not intelligence

You hand an AI a long task and walk away. Hours later it may have drifted, quietly dropped half the requirements, or failed partway through — and you have no way to tell how much of what came back actually got done.

Better models do not solve this. A long task spans hours, sometimes overnight, and nobody is there to watch it, stop it, or take over when it goes wrong. What is missing is a **trustworthy executor**: one that knows how far it got, picks up where it left off after an interruption, and confirms the work before calling it done.

StepWise does not replace your agent. It is what makes an agent dependable on a long task — progress you can check, interruptions you can survive, results you can verify.

### Why not just use Claude Code

Claude Code is built for the terminal, where you watch it work, correct it when it goes wrong, and stop it when it drifts. A long task is a different relationship: nobody is there, so it does not know which step it is on, where it stopped last time, or whether what it hands back counts as finished.

StepWise covers exactly those gaps, turning "the agent does its best" into "the process is accountable":

- **It knows how far it got.** Every step writes its index, status, and session ID to disk, so re-running the same script after an interruption skips completed work instead of recomputing it — whether or not the original session is still around.
- **It survives an overnight run.** On 429 / 503 it does not simply fail; recovery is probed with a throwaway session, so waiting never burns retry budget and rate-limit errors never enter your real context.
- **It checks its own work before reporting.** The artifact is confirmed to exist and its contents are validated, with an auto-generated repair prompt and retry when they fail; in debug mode an independent reviewer also re-reads every step afterwards.

The second one matters most: on non-interactive `claude -p` and SDK runs the platform fails outright when the quota runs out instead of waiting, and rate limiting is exactly the failure mode long tasks hit most often.

### What you get back after a full night

| What goes wrong | How StepWise handles it |
|---|---|
| The process is killed or the machine restarts, and the work is lost | Completed steps are skipped on resume — re-run the same script with the resume path printed at startup |
| Overnight jobs get cut off by quota | 429 and 503 wait and retry without burning retry budget; recovery is probed with a throwaway session, so 429 errors never poison your real context |
| It drifts silently in the middle, and nobody notices | In debug mode every step gets an automatic review: an independent reviewer checks goal clarity, missing or redundant input, and detours, and must quote source text verbatim to back each finding |
| "Done" is only a claim | Declare the output format; StepWise checks the file exists *and* validates, then auto-generates a repair prompt and retries |
| Hard to tell why a long run failed, or to analyze where its time and tokens went | Every step is observable — duration and token spend itemized, the agent's reasoning and tool calls captured as they happen, task time counted separately from quota wait, and any step re-runnable exactly as it ran |
| Parallel agents trample each other | Each worker gets its own git worktree and items come off a shared queue; branches are committed but never auto-merged into your main branch |
| Locked into a single agent CLI | Claude Code (default), OpenCode, CodeAgent, Pi, and mcode share one workflow script, so switching backends does not mean rewriting |
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

Requires **Node.js 16+** (the build target is `moduleResolution: Node16`) and at least one coding agent CLI on your `PATH` — Claude Code (default), OpenCode, CodeAgent, Pi, or mcode. With OpenCode, set `"permission": "allow"` in `opencode.json` so it stops asking for confirmations.

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

After every AI step succeeds in debug mode, the framework opens a new session and hands that step's **inputs** to an independent reviewer: the step prompt, the final output, the step's post-check prompt and verdict (when `postCheckPrompt` is set), and any Skill file the prompt explicitly requires loading. What gets reviewed is the **input's own workflow and reasoning** — whether the goal and approach are clear, whether something needs to be added, whether anything is redundant, and whether there are logic errors. The model's own behaviour (malformed tool calls, failed-and-retried commands, repeated thinking, backtracking) is out of scope.

The reviewer must quote source text verbatim to back each finding — anything it cannot quote is dropped. The report lands in `self_check.md` next to `output.txt` and is **always created**: with no findings it says so explicitly. See [Execution Output Layout](#execution-output-layout).

In debug mode `postCheckPrompt` now **really runs** (as it does in production), so both the clarity of the post-check requirements and whether the step's output satisfies them are within the review's reach. A failing post-check never aborts the step in debug mode.

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
        │   │   ├── prompt.txt                   ←   the task prompt (what was actually sent)
        │   │   ├── output.txt                   ←   final output
        │   │   ├── verbose_output.txt           ←   full reasoning and tool-call trace
        │   │   ├── command.sh                   ←   re-runnable as-is with ./command.sh (prompt piped in)
        │   │   ├── execution_info.json          ←   argv, session id, environment
        │   │   ├── usage.json                   ←   token usage (NDJSON executors)
        │   │   ├── schema.json                  ←   schema definition for execPromptSchema
        │   │   ├── post_check_prompt.txt        ←   the postCheckPrompt text
        │   │   ├── post_check_output.txt        ←   the post-check verdict
        │   │   ├── post_check_command.sh        ←   re-runnable script of the post-check run
        │   │   ├── file_missing_prompt.txt      ←   prompt of the "output missing" retry
        │   │   ├── file_missing_command.sh      ←   re-runnable script of that retry
        │   │   ├── validation_fix_prompt.txt    ←   prompt of the "validation failed" repair
        │   │   ├── validation_fix_command.sh    ←   re-runnable script of that repair
        │   │   ├── self_check_prompt.txt        ←   the reviewer's prompt (debug mode only)
        │   │   ├── self_check.md                ←   self-check report (debug mode only)
        │   │   ├── self_check_verbose_output.txt←   the reviewer's own execution trace
        │   │   ├── self_check_command.sh        ←   the reviewer's re-runnable script
        │   │   ├── error.txt                    ←   failure reason (only on failure)
        │   │   └── ...
        │   └── 2_task/                          ← 2nd step, and so on
        └── collect/
            └── 1_collect/
                └── collect_1.json               ← output of collection steps
```

Step folders are named `{index}_{type}`, where the type comes from the `exec*` call (`task` / `collect` / `check` / `report` / `schema` / `shell`). Files that only appear conditionally:

| File | Appears when |
|---|---|
| `error.txt` | That step failed |
| `usage.json` | Using Claude Code / CodeAgent / mcode (NDJSON executors) |
| `schema.json` | `execPromptSchema` |
| `post_check_prompt.txt` | That step set `postCheckPrompt` |
| `post_check_output.txt` | That step set `postCheckPrompt` (the post-check verdict) |
| `post_check_command.sh` | Same (re-runnable script of the post-check run) |
| `file_missing_prompt.txt` / `file_missing_command.sh` | An "output file missing" retry happened |
| `validation_fix_prompt.txt` / `validation_fix_command.sh` | A "validation failed" repair happened |
| `summarize_prompt.txt` / `summarize_command.sh` | The end-of-session summary landed in that step's directory |
| `self_check.md` | Self-check review in debug mode |
| `self_check_prompt.txt` / `self_check_verbose_output.txt` / `self_check_command.sh` | The reviewer's own artifacts in debug mode (`self_check_` prefix keeps them from overwriting the step's files of the same name) |

A step folder runs several executions in sequence (the step body, the post-check, the
output-missing retry, the validation-failed repair, the end-of-session summary, the
self-check). The **step body owns the unprefixed `command.sh`** — it always is that
step's re-runnable script. Every other execution carries its own prefix
(`post_check_command.sh`, `file_missing_command.sh`, …) matching its prompt log
(`post_check_prompt.txt` ↔ `post_check_command.sh`), so they never overwrite each other.

Nothing here is write-only: `progress.json` decides where a resume picks up, `command.sh` lets any single step be re-run outside the framework, and `verbose_output.txt` preserves exactly what the agent saw, did, and where it wandered.

---

## Documentation

- [API Reference](doc/api.md) — full API documentation
- [Examples](demos.md) — complete runnable examples
- [中文文档](README_CN.md) — Chinese documentation

---

## Contributing

The codebase is bounded and the edge cases are covered by tests, so it is straightforward to contribute.

**Local development**

```bash
git clone https://gitee.com/nodaemon/stepwise.git
cd stepwise
npm install
npm run build            # produces dist/
npm test                 # Jest, 28 test files
npm run test:coverage
```

**Code map**

| Path | Responsibility |
|---|---|
| `src/executors/` | Adapter layer per CLI backend. `base.ts` defines the `BaseExecutor` abstract class (`agentType` / `buildArgs` / `getCommand` / `buildProbeArgs`); `claude.ts`, `opencode.ts`, `pi.ts`, `codeagent.ts`, and `mcode.ts` are the implementations; `ndjsonFormatter.ts` parses streamed output |
| `src/utils/` | `validator.ts` output validation and repair retries, `sessionLinker.ts` cross-worktree session handling, `performanceTracker.ts` duration and token accounting, `reproScript.ts` emits `command.sh`, `promptBuilder.ts` prompts and self-check reviews, `skillResolver.ts` locates the Skills a prompt requires loading |
| `src/StepWise.ts` | Core class: step scheduling, checkpoint recovery, restore, quota waiting |
| `src/forEachParallel.ts` | Parallel worker pool, shared queue, worktree isolation |
| `src/types.ts` | Every public type — check compatibility before changing it |

**Good places to start**

- **Add a CLI backend**: create `src/executors/xxx.ts` extending `BaseExecutor` and implement the four abstract members; everything else is inherited
- **Add tests**: `tests/` is split by feature, and edge cases such as `probeRateLimit`, `selfCheck`, and `sessionLinkLog` still have room
- **Improve docs**: see `doc/api.md` for the API and `demos.md` for runnable examples
- **Read the code**: start from the code map above; `tests/` is split by feature and is the most accurate description of behavior

Found a bug or want to help improve StepWise? Open an Issue or send a Pull Request.

---

## License

Apache-2.0 — Apache License, Version 2.0. See [the license](https://www.apache.org/licenses/LICENSE-2.0).
