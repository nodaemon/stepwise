# API Reference

This document provides detailed API reference for StepWise.

---

## Table of Contents

- [Global Functions](#global-functions)
  - [setTaskName](#settasknametaskname-string-void)
  - [setResumePath](#setresumepathpath-string-void)
  - [enableDebugMode](#enabledebugmodeenabled-boolean-void)
  - [setSkipSummarize](#setskipsummarizeskip-boolean-void)
  - [saveCollectData](#savecollectdatadata-recordstring-any-filename-string-void)
  - [loadCollectData](#loadcollectdatafilename-string-recordstring-any)
  - [setAgentType](#setagenttypetype-agenttype-void)
  - [getTaskDir](#gettaskdir-string)
  - [getReportPath](#getreportpathfilename-string-string)
- [StepWise Class](#stepwise-class)
  - [Constructor](#constructor)
  - [Task Execution Methods](#task-execution-methods)
  - [Summary Methods](#summary-methods)
  - [Helper Methods](#helper-methods)
- [Parallel Processing](#parallel-processing)
  - [forEachParallel](#foreachparallelt-items-t-workerconfigs-workerconfig-handler-promisevoid-options-foreachparalleloptions-promisevoid)
  - [WorkerConfig](#workerconfig)
  - [WorkerContext](#workercontextt)
- [Type Definitions](#type-definitions)

---

## Global Functions

Global functions for configuration and data management.

### setTaskName(taskName: string): void

Sets the task name used to generate the task directory.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| taskName | string | Task name, recommend using English and underscores |

**Behavior**

- Must be called before creating any StepWise instance
- TaskName is registered globally and cannot be duplicated with StepWise names
- Empty taskName will cause an error and exit

**Example**

```typescript
import { setTaskName } from 'stepwise';

setTaskName('AnalyzeCodebase');
// Creates directory: stepwise_exec_infos/AnalyzeCodebase_20260307_103000_123/
```

---

### setResumePath(path: string): void

Sets the recovery path to resume execution from a specified task directory.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| path | string | Task directory name (without full path) |

**Behavior**

- After setting, completed tasks will be skipped
- Interrupted tasks will be re-executed
- If Agent directory not found, will error and exit

**Example**

```typescript
import { setResumePath } from 'stepwise';

// Resume from historical directory
setResumePath('AnalyzeCodebase_20260307_103000_123');
```

---

### enableDebugMode(enabled?: boolean): void

Enables or disables debug mode.

**Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| enabled | boolean | true | Whether to enable debug mode |

**Debug Mode Behavior**

- Collection prompts add "only collect 1 item" instruction
- Return only the first data item
- Used for quick workflow validation

**Example**

```typescript
import { enableDebugMode } from 'stepwise';

enableDebugMode(true);  // Enable
enableDebugMode(false); // Disable
enableDebugMode();      // Enable (default)
```

---

### setSkipSummarize(skip?: boolean): void

Sets whether to skip summarize (reflection and skill generation).

**Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| skip | boolean | true | Whether to skip summarize |

**Behavior**

- After setting, no automatic summarize will be executed when sessions end
- Suitable for scenarios where skill files are not needed
- Can be called at any time during task execution

**Example**

```typescript
import { setSkipSummarize } from 'stepwise';

setSkipSummarize(true);  // Skip summarize
setSkipSummarize(false); // Don't skip (default behavior)
setSkipSummarize();      // Skip (default)
```

---

### saveCollectData(data: Record<string, any>[], fileName?: string): void

Saves collected data to disk (stored in current working directory).

**Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| data | Record<string, any>[] | - | Data array to save |
| fileName | string | 'collect_data.json' | File name |

**Example**

```typescript
import { saveCollectData } from 'stepwise';

saveCollectData(result.data, 'my_data.json');
```

---

### loadCollectData(fileName?: string): Record<string, any>[]

Loads collected data from disk (reads from current working directory).

**Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| fileName | string | 'collect_data.json' | File name |

**Returns**

| Type | Description |
|------|-------------|
| Record<string, any>[] | Data array, returns empty array if not exists |

**Example**

```typescript
import { loadCollectData } from 'stepwise';

const data = loadCollectData('my_data.json');
```

---

### setAgentType(type: AgentType): void

Sets the agent type, determining which agent will execute tasks.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| type | AgentType | Agent type: `'claude'` or `'opencode'` |

**Behavior**

- Should be called before `setTaskName()`
- All agents within a task use the same agent type
- Defaults to `'claude'` (Claude Code agent)

**Example**

```typescript
import { setTaskName, setAgentType } from 'stepwise';

// Use OpenCode agent
setAgentType('opencode');
setTaskName('MyTask');

// Or use the default Claude Code agent
setAgentType('claude'); // Optional, claude is the default
setTaskName('MyTask');
```

---

### getTaskDir(): string

Gets the task directory path (Task level).

**Returns**

| Type | Description |
|------|-------------|
| string | Absolute path of task directory |

**Example**

```typescript
import { getTaskDir } from 'stepwise';

const taskDir = getTaskDir();
console.log('Task directory:', taskDir);
// Output: /path/to/stepwise_exec_infos/MyTask_20260324_120000_123
```

---

### getReportPath(fileName: string): string

Gets the absolute path of a task-level report file.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| fileName | string | Report file name (e.g., `"api_report.json"`) |

**Returns**

| Type | Description |
|------|-------------|
| string | Absolute path of the report file (file may not exist) |

**Behavior**

- Used to get the Task-level report directory path after `forEachParallel` parallel execution, containing merged reports from all agents
- Functionally identical to StepWise instance's `getReportPath` method, but can be used without creating an instance

**Example**

```typescript
import { getReportPath } from 'stepwise';

// Get report file path
const reportPath = getReportPath('api_report.json');
console.log('Report path:', reportPath);
// Output: /path/to/stepwise_exec_infos/MyTask_xxx/report/api_report.json

// Read report content
if (fs.existsSync(reportPath)) {
  const content = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  console.log('Report data:', content);
}
```

---

## StepWise Class

The main class providing core task orchestration functionality.

### Constructor

```typescript
new StepWise(name: string, defaultCwd?: string, defaultEnv?: string[], workerId?: string)
```

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| name | string | Unique agent name |
| defaultCwd | string | Default working directory (optional), uses process.cwd() if not specified |
| defaultEnv | string[] | Default environment variable array (optional), format: `["KEY=VALUE"]` |
| workerId | string | Worker identifier (optional), used for forEachParallel parallel processing |

**Behavior**

- TaskName must be set before creating StepWise
- Name cannot be duplicated with TaskName or other StepWise names
- Prints startup information on first creation

**Example**

```typescript
import { StepWise, setTaskName } from 'stepwise';

setTaskName('MyTask');

// Basic usage
const agent = new StepWise('MainAgent');

// Specify default working directory
const agent2 = new StepWise('SubAgent', '/path/to/project');

// Specify default working directory and environment variables
const agent3 = new StepWise(
  'DataAgent',
  '/path/to/project',
  ['NODE_ENV=production', 'DEBUG=true']
);

// Full parameters (typically used internally by forEachParallel)
const agent4 = new StepWise(
  'WorkerAgent',
  '/path/to/workspace',
  ['API_KEY=xxx'],
  'worker_1'
);
```

---

### Task Execution Methods

#### execPrompt(prompt: string, options?: ExecOptions): Promise\<ExecutionResult\>

Executes a normal task.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| prompt | string | Prompt content, supports `$variableName` substitution |
| options | ExecOptions | Execution options (optional) |

**ExecOptions**

```typescript
interface ExecOptions {
  cwd?: string;              // Working directory, defaults to current process directory
  newSession?: boolean;      // Whether to use a new session, defaults to false
  data?: Record<string, any>; // Data for variable substitution
  checkPrompt?: string;      // Check prompt to execute after main task completes
  env?: string[];            // Additional environment variables, format: "KEY=VALUE"
  validateOptions?: ValidateOptions; // JSON output validation options
}
```

**Variable Substitution**

Use `$variableName` format in prompts, which will be replaced with corresponding values from `options.data`:

```typescript
const prompt = 'Analyze the complexity of this function: $name in $file';
const options = { data: { name: 'getUser', file: 'src/user.ts' } };
// Actual executed prompt:
// Analyze the complexity of this function: getUser in src/user.ts
```

**ExecutionResult**

```typescript
interface ExecutionResult {
  sessionId: string;    // Session ID
  output: string;       // Execution output
  success: boolean;     // Whether successful
  error?: string;       // Error message
  timestamp: number;    // Execution timestamp
  duration: number;     // Execution duration (milliseconds)
}
```

**Example**

```typescript
const result = await agent.execPrompt('Analyze project structure');

if (result.success) {
  console.log('Success:', result.output);
}
```

---

#### execCollectPrompt(prompt: string, outputFormat: OutputFormat, options?: ExecOptions): Promise\<CollectResult\>

Executes a collection task, collecting data and saving as JSON file.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| prompt | string | Prompt content, supports variable substitution |
| outputFormat | OutputFormat | Output format definition |
| options | ExecOptions | Execution options (optional) |

**OutputFormat**

```typescript
interface PropertyDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;  // Field description
  required?: boolean;    // Whether required, defaults to true
}

// OutputFormat is a direct mapping of field name to PropertyDef
type OutputFormat = Record<string, PropertyDef>;
```

**Automatic Deduplication**

The first field with `required: true` (or the first field if `required` is not specified) is automatically used for deduplication.

**Output Location**

Output file is automatically generated as `collect_{taskIndex}.json` in the Agent's collect directory.

**CollectResult**

```typescript
interface CollectResult extends ExecutionResult {
  data: Record<string, any>[]; // Collected data
}
```

**Example**

```typescript
// First required field is auto-used for deduplication
const result = await agent.execCollectPrompt(
  'Collect all TypeScript interface definitions in the project',
  {
    name: { type: 'string', description: 'Interface name' },
    file: { type: 'string', description: 'File location' },
    properties: { type: 'array', description: 'Property list' },
    description: { type: 'string', description: 'Interface description', required: false }
  }
);

// 'name' is automatically used as the deduplication key (first required field)

console.log(`Collected ${result.data.length} items`);
```

---

#### execCheckPrompt(prompt: string, options?: ExecOptions): Promise\<CheckResult\>

Executes a check task, returning a boolean result (true/false).

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| prompt | string | Check question/prompt, supports variable substitution |
| options | ExecOptions | Execution options (optional) |

**Output Location**

Output file is automatically saved as `check_result.json` in the Agent's check directory.

**CheckResult**

```typescript
interface CheckResult extends ExecutionResult {
  result: boolean; // Check result: true or false
}
```

**Example**

```typescript
const result = await agent.execCheckPrompt(
  'Check if the project has proper unit tests'
);

if (result.success && result.result) {
  console.log('Check passed');
}
```

---

#### execReport(prompt: string, outputFormat: OutputFormat, outputFileName: string, options?: ExecOptions): Promise\<CollectResult\>

Executes a report task to generate summary reports.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| prompt | string | Prompt content, supports variable substitution |
| outputFormat | OutputFormat | Output format definition |
| outputFileName | string | Output file name |
| options | ExecOptions | Execution options (optional) |

**Output Location**

Output is saved to TaskName directory's `report/` subdirectory (shared by all agents).

**Example**

```typescript
await agent.execReport(
  'Generate project API analysis report based on collected data',
  {
    title: { type: 'string', description: 'Report title' },
    summary: { type: 'string', description: 'Summary' },
    recommendations: { type: 'array', description: 'Recommendations' }
  },
  'api_report.json'
);
```

---

#### execShell(command: string, options?: ShellOptions): Promise\<ShellResult\>

Executes a Shell command for running system commands or scripts.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| command | string | Shell command content |
| options | ShellOptions | Shell execution options (optional) |

**ShellOptions**

```typescript
interface ShellOptions {
  cwd?: string;        // Working directory, uses process.cwd() if not specified
  timeout?: number;    // Timeout in milliseconds, default 5 minutes (300000ms)
  env?: Record<string, string>; // Environment variables, merged with process.env
}
```

**ShellResult**

```typescript
interface ShellResult {
  stdout: string;    // Standard output
  stderr: string;    // Standard error output
  exitCode: number;  // Exit code, 0 means success
  success: boolean;  // Whether successful (exitCode === 0)
  duration: number;  // Execution duration (milliseconds)
  taskIndex: number; // Task index
}
```

**Behavior**

- Command execution process is logged
- Supports resume: already executed commands will be skipped
- Command will be forcefully terminated after timeout

**Example**

```typescript
// Basic usage
const result = await agent.execShell('npm run build');
console.log('Success:', result.success);
console.log('Output:', result.stdout);

// With options
const result = await agent.execShell('npm test', {
  timeout: 60000,     // Timeout 60 seconds
  cwd: './project'    // Specify working directory
});

// Using environment variables
const result = await agent.execShell('npm run deploy', {
  env: { NODE_ENV: 'production' }
});
```

---

### Summary Methods

#### summarize(options?: SummarizeOptions): Promise\<SummarizeResult\>

Summarizes the current session's experience and generates skill files.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| options | SummarizeOptions | Summary options (optional) |

**SummarizeOptions**

```typescript
interface SummarizeOptions {
  cwd?: string;          // Working directory, defaults to current process directory
  customPrompt?: string; // Custom prompt to override default summary prompt
  env?: string[];        // Additional environment variables, format: "KEY=VALUE"
}
```

**Behavior**

- Uses the current session ID to review all work done
- Only creates SKILL.md files when truly valuable experience is found
- **Quality over quantity**: If nothing worth summarizing, simply completes without creating files
- Generates SKILL.md files in `.claude/skills/` directory
- Logs are written to the last task's directory of the session (for auto-summary) or a separate directory (for manual summary)
- Does not increment task index

**Auto-Summary**

When `newSession: true` is passed to any execution method, the previous session is automatically summarized before creating the new session.

**Output Location**

Skill files are saved to: `{cwd}/.claude/skills/{skill_name}/SKILL.md`

**SKILL.md File Format**

```markdown
# [Skill Name]

## Description
[One-line description of the problem this skill solves]

## Use Cases
- Case 1: [Description]
- Case 2: [Description]

## Steps
1. [First step]
2. [Second step]
3. ...
```

**SummarizeResult**

```typescript
interface SummarizeResult extends ExecutionResult {
  skillFiles: string[]; // List of generated SKILL.md file paths
}
```

**Example**

```typescript
// Manual summary at the end
const result = await agent.summarize();
console.log('Generated skill files:', result.skillFiles);

// With custom prompt
const result = await agent.summarize({
  customPrompt: 'Focus on error handling patterns only'
});
```

**Auto-Summary Example**

```typescript
const agent = new StepWise('MainAgent');

await agent.execPrompt('Task 1');                    // Session A
await agent.execPrompt('Task 2');                    // Reuse Session A
await agent.execPrompt('Task 3', {newSession: true}); // Summarize A → Create Session B
await agent.execPrompt('Task 4');                    // Reuse Session B

// Final summary for Session B
await agent.summarize();
```

---

### Helper Methods

#### getAgentDir(): string

Gets the current agent directory path.

**Returns**

| Type | Description |
|------|-------------|
| string | Absolute path of agent directory |

---

#### getTaskDir(): string

Gets the current task directory path (TaskName directory).

**Returns**

| Type | Description |
|------|-------------|
| string | Absolute path of task directory |

---

#### getReportPath(fileName: string): string

Gets the absolute path of a report file.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| fileName | string | Report file name (e.g., `"api_report.json"`) |

**Returns**

| Type | Description |
|------|-------------|
| string | Absolute path of the report file (file may not exist) |

**Example**

```typescript
// Generate report
await agent.execReport(
  'Analyze all API endpoints in the project',
  format,
  'api_report.json'
);

// Get report file path
const reportPath = agent.getReportPath('api_report.json');
console.log('Report path:', reportPath);
// Output: /path/to/stepwise_exec_infos/TaskName_xxx/report/api_report.json

// Read report content
if (fs.existsSync(reportPath)) {
  const content = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  console.log('Data:', content);
}
```

---

#### getTaskCounter(): number

Gets the current task count.

**Returns**

| Type | Description |
|------|-------------|
| number | Number of executed tasks |

---

#### getCurrentSessionId(): string

Gets the current session ID being used for task execution.

**Returns**

| Type | Description |
|------|-------------|
| string | Current session ID, empty string if not yet initialized |

---

## Parallel Processing

Interfaces for parallel processing of multiple tasks.

### forEachParallel\<T\>(items: T[], workerConfigs: WorkerConfig[], handler: (ctx: WorkerContext\<T\>) => Promise\<void\>, options?: ForEachParallelOptions): Promise\<void\>

Processes array elements in parallel, automatically creating git worktrees for isolation.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| items | T[] | Array to process |
| workerConfigs | WorkerConfig[] | Worker configuration array |
| handler | (ctx: WorkerContext\<T\>) => Promise\<void\> | Handler function |
| options | ForEachParallelOptions | Options (reserved for extension) |

**Behavior**

- Automatically creates git worktree for each Worker
- Automatically binds worker identifier
- Automatically handles Resume logic
- Automatically merges branches after task completion

**Example**

```typescript
import { setTaskName, forEachParallel, WorkerConfig } from 'stepwise';

setTaskName("my_task");

const workerConfigs: WorkerConfig[] = [
  { branchName: "Agent1" },
  { branchName: "Agent2" },
];

await forEachParallel(items, workerConfigs, async (ctx) => {
  // ctx.stepWise executes tasks in ctx.workspacePath by default
  // To use a different directory, manually specify cwd
  await ctx.stepWise.execPrompt("Process task", {
    data: ctx.item,
  });
});
```

**Using Environment Variable Configuration**

```typescript
const workerConfigs: WorkerConfig[] = [
  { branchName: "Agent1", env: ["API_KEY=xxx", "NODE_ENV=test"] },
  { branchName: "Agent2", env: ["API_KEY=yyy", "NODE_ENV=production"] },
];

await forEachParallel(items, workerConfigs, async (ctx) => {
  // Each Worker executes tasks with their configured environment variables
  await ctx.stepWise.execPrompt("Call API to process task", {
    data: ctx.item,
  });
});
```

---

### WorkerConfig

Worker configuration, defining branch name and environment variables for each worker.

```typescript
interface WorkerConfig {
  /** Branch name, used to create git worktree and as worker identifier */
  branchName: string;
  /** Environment variable array, format: "KEY=VALUE" */
  env?: string[];
}
```

---

### WorkerContext\<T\>

Worker context, all information provided by the framework to the handler function.

```typescript
interface WorkerContext<T> {
  /** Current element being processed */
  item: T;
  /** Index of element in array */
  index: number;
  /** Current worker configuration */
  workerConfig: WorkerConfig;
  /** Workspace path (git worktree directory) */
  workspacePath: string;
  /** Created StepWise instance, name is index, automatically bound to workerId */
  stepWise: StepWise;
}
```

---

## Type Definitions

### AgentType

Agent type.

```typescript
type AgentType = 'claude' | 'opencode';
```

- `'claude'`: Use Claude Code agent (default)
- `'opencode'`: Use OpenCode agent

---

### ExecOptions

Execution options.

```typescript
interface ExecOptions {
  cwd?: string;              // Working directory
  newSession?: boolean;      // Whether to use a new session (default: false)
  data?: Record<string, any>; // Data for variable substitution
  checkPrompt?: string;      // Check prompt to execute after main task completes
  env?: string[];            // Additional environment variables, format: "KEY=VALUE"
  validateOptions?: ValidateOptions; // JSON output validation options
}
```

---

### ValidateOptions

JSON output validation options.

```typescript
interface ValidateOptions {
  enabled?: boolean;   // Whether to enable validation, default true
  maxRetries?: number; // Maximum retry count, default 3
}
```

---

### OutputFormat

Output format definition.

```typescript
// OutputFormat is a direct mapping of field name to PropertyDef
type OutputFormat = Record<string, PropertyDef>;
```

---

### PropertyDef

Property definition for output fields.

```typescript
interface PropertyDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;  // Field description (optional)
  required?: boolean;    // Whether required, defaults to true
}
```

**Key Features:**

- `required` defaults to `true` if not specified
- The first required field is automatically used for deduplication
- JSON Schema is automatically generated for AI guidance

---

### ExecutionResult

Execution result.

```typescript
interface ExecutionResult {
  sessionId: string;    // Session ID
  output: string;       // Execution output
  success: boolean;     // Whether successful
  error?: string;       // Error message
  timestamp: number;    // Execution timestamp
  duration: number;     // Execution duration (milliseconds)
}
```

---

### CollectResult

Collection task result.

```typescript
interface CollectResult extends ExecutionResult {
  data: Record<string, any>[]; // Collected data
}
```

---

### CheckResult

Check task result.

```typescript
interface CheckResult extends ExecutionResult {
  result: boolean; // Check result: true or false
}
```

---

### ShellOptions

Shell execution options.

```typescript
interface ShellOptions {
  cwd?: string;        // Working directory
  timeout?: number;    // Timeout (milliseconds), default 300000
  env?: Record<string, string>; // Environment variables
}
```

---

### ShellResult

Shell execution result.

```typescript
interface ShellResult {
  stdout: string;    // Standard output
  stderr: string;    // Standard error output
  exitCode: number;  // Exit code, 0 means success
  success: boolean;  // Whether successful
  duration: number;  // Execution duration (milliseconds)
  taskIndex: number; // Task index
}
```

---

### TaskStatus

Task status.

```typescript
interface TaskStatus {
  taskIndex: number;       // Task index
  taskName: string;        // Task name
  sessionId: string;       // Session ID
  status: TaskStatusType;  // Status
  timestamp: number;       // Timestamp
  taskType: TaskType;      // Task type
  outputFileName?: string; // Output file name (collection tasks only)
  checkResult?: boolean;   // Check task result (check tasks only)
  command?: string;        // Shell command content (shell tasks only)
}
```

---

### TaskStatusType

Task status type.

```typescript
type TaskStatusType = 'pending' | 'in_progress' | 'completed';
```

---

### TaskType

Task type.

```typescript
type TaskType = 'task' | 'collect' | 'process' | 'process_collect' | 'report' | 'check' | 'summarize' | 'shell';
```

---

### SummarizeOptions

Summary options.

```typescript
interface SummarizeOptions {
  cwd?: string;          // Working directory
  customPrompt?: string; // Custom prompt
  env?: string[];        // Additional environment variables, format: "KEY=VALUE"
}
```

---

### SummarizeResult

Summary result.

```typescript
interface SummarizeResult extends ExecutionResult {
  skillFiles: string[]; // List of generated SKILL.md file paths
}
```

---

### ValidationResult

Validation result. This is now an alias for `SchemaValidationResult`.

```typescript
type ValidationResult<T = unknown> = SchemaValidationResult<T>;
```

See `SchemaValidationResult` for details.

---

### SchemaValidationError

Schema validation error details, directly mapping AJV ErrorObject to preserve complete original information.

```typescript
interface SchemaValidationError {
  /** AJV instance path, e.g. "/0/name" */
  path: string;
  /** AJV original error message (English) */
  message: string;
  /** AJV error keyword, e.g. 'required', 'type', 'additionalProperties' */
  keyword: string;
  /** AJV error parameters */
  params: Record<string, unknown>;
  /** Actual data value */
  data: unknown;
}
```

**Key Features:**

- `path`: AJV instance path format (e.g. `/0/name`), preserving original structure
- `message`: Original AJV error message in English, more precise for AI understanding
- `keyword`: Identifies the error type (useful for programmatic handling)
- `params`: AJV error parameters containing additional context
- `data`: The actual invalid value at the error location

---

### SchemaValidationResult

Schema validation result.

```typescript
interface SchemaValidationResult<T> {
  valid: boolean;                  // Whether valid
  errors: SchemaValidationError[]; // Error list
  data?: T;                        // Parsed data (when validation succeeds)
}
```

---

## Directory Structure

```
stepwise_exec_infos/
└── {task-name}_{timestamp1}/              # TaskName directory
    ├── report/                             # Report output (execReport)
    ├── {agent-name}_{timestamp2}/          # StepWise Agent directory
    │   ├── data/                           # Execution state
    │   │   └── progress.json
    │   ├── logs/                           # Execution logs
    │   │   ├── 1_task/
    │   │   ├── 2_collect/
    │   │   └── execute.log
    │   └── collect/                        # Collected data
    │       ├── 2_collect/
    │       └── 3_check/
    └── ...
```

**Directory Naming Rules**:
- TaskName directory: `{taskName}_{YYYYMMDD}_{HHmmss}_{milliseconds}`
- StepWise Agent directory: `{agentName}_{YYYYMMDD}_{HHmmss}_{milliseconds}`

**Timestamp Format**:
- Format: `20260307_103000_123` (YYYYMMDD_HHmmss_milliseconds)
- Precision to milliseconds to reduce naming conflicts

---

## Constants

```typescript
// Directory name constants
const EXEC_INFO_DIR = 'stepwise_exec_infos';  // Execution info root directory
const DATA_DIR = 'data';        // Data directory
const LOGS_DIR = 'logs';        // Logs directory
const COLLECT_DIR = 'collect';  // Collected data directory
const REPORT_DIR = 'report';    // Report data directory

// File name constants
const PROGRESS_FILE = 'progress.json'; // Progress file
const EXECUTE_LOG = 'execute.log';     // Summary log file

// Other constants
const MAX_RETRIES = 3; // Maximum retry count
```