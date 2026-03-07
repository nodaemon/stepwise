# API Reference

This document provides detailed API reference for StepWise.

---

## Table of Contents

- [Global Functions](#global-functions)
  - [setTaskName](#settasknametaskname-string-void)
  - [setResumePath](#setresumepathpath-string-void)
  - [enableDebugMode](#enabledebugmodeenabled-boolean-void)
  - [saveCollectData](#savecollectdatadata-recordstring-any-filename-string-void)
  - [loadCollectData](#loadcollectdatafilename-string-recordstring-any)
- [StepWise Class](#stepwise-class)
  - [Constructor](#constructor)
  - [Task Execution Methods](#task-execution-methods)
  - [Summary Methods](#summary-methods)
  - [Helper Methods](#helper-methods)
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

## StepWise Class

The main class providing core task orchestration functionality.

### Constructor

```typescript
new StepWise(name: string)
```

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| name | string | Unique agent name |

**Behavior**

- TaskName must be set before creating StepWise
- Name cannot be duplicated with TaskName or other StepWise names
- Prints startup information on first creation

**Example**

```typescript
import { StepWise, setTaskName } from 'stepwise';

setTaskName('MyTask');
const agent = new StepWise('MainAgent');
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
  cwd?: string;           // Working directory, defaults to current process directory
  newSession?: boolean;   // Whether to use a new session, defaults to false
  data?: Record<string, any>; // Data for variable substitution
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
interface OutputFormat {
  primaryKey?: string;  // Primary key for deduplication
  keys: OutputKey[];    // Output key list
}

interface OutputKey {
  name: string;        // Key name
  description: string; // Key description
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
}
```

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
const result = await agent.execCollectPrompt(
  'Collect all TypeScript interface definitions in the project',
  {
    primaryKey: 'name',
    keys: [
      { name: 'name', description: 'Interface name', type: 'string' },
      { name: 'file', description: 'File location', type: 'string' },
      { name: 'properties', description: 'Property list', type: 'array' }
    ]
  }
);

console.log(`Collected ${result.data.length} interfaces`);
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
    keys: [
      { name: 'title', description: 'Report title', type: 'string' },
      { name: 'summary', description: 'Summary', type: 'string' },
      { name: 'recommendations', description: 'Recommendations', type: 'array' }
    ]
  },
  'api_report.json'
);
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
}
```

**Behavior**

- Uses the current session ID to review all work done
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

## Type Definitions

### ExecOptions

Execution options.

```typescript
interface ExecOptions {
  cwd?: string;                    // Working directory
  newSession?: boolean;            // Whether to use a new session (default: false)
  data?: Record<string, any>;      // Data for variable substitution
  checkPrompt?: string;            // Check prompt to execute after main task completes
}
```

### OutputFormat

Output format definition.

```typescript
interface OutputFormat {
  primaryKey?: string;  // Primary key (optional)
  keys: OutputKey[];    // Output key list
}
```

### OutputKey

Output key definition.

```typescript
interface OutputKey {
  name: string;        // Key name
  description: string; // Key description
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
}
```

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

### CollectResult

Collection task result.

```typescript
interface CollectResult extends ExecutionResult {
  data: Record<string, any>[]; // Collected data
}
```

### CheckResult

Check task result.

```typescript
interface CheckResult extends ExecutionResult {
  result: boolean; // Check result: true or false
}
```

### TaskStatus

Task status.

```typescript
interface TaskStatus {
  taskIndex: number;    // Task index
  taskName: string;     // Task name
  sessionId: string;    // Session ID
  status: TaskStatusType; // Status
  timestamp: number;    // Timestamp
  taskType: TaskType;   // Task type
  outputFileName?: string; // Output file name
}
```

### TaskStatusType

Task status type.

```typescript
type TaskStatusType = 'pending' | 'in_progress' | 'completed';
```

### TaskType

Task type.

```typescript
type TaskType = 'task' | 'collect' | 'check' | 'report' | 'summarize';
```

### SummarizeOptions

Summary options.

```typescript
interface SummarizeOptions {
  cwd?: string;          // Working directory
  customPrompt?: string; // Custom prompt to override default summary prompt
}
```

### SummarizeResult

Summary result.

```typescript
interface SummarizeResult extends ExecutionResult {
  skillFiles: string[]; // List of generated SKILL.md file paths
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
