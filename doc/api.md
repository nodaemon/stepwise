# API Reference

This document provides detailed API reference for StepWise.

---

## Table of Contents

- [StepWise Class](#stepwise-class)
  - [Global Settings](#global-settings)
  - [Task Execution](#task-execution)
  - [Helper Methods](#helper-methods)
- [Type Definitions](#type-definitions)
- [Constants](#constants)

---

## StepWise Class

The main class providing core task orchestration functionality.

```typescript
import { StepWise } from 'stepwise';

const agent = new StepWise();
```

---

### Global Settings

#### setTaskName(taskName: string): void

Sets the task name used to generate the task directory.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| taskName | string | Task name, recommend using English and underscores |

**Example**

```typescript
agent.setTaskName('AnalyzeCodebase');
// Creates directory: stepwise_exec_infos/AnalyzeCodebase_2026_03_03_10_30_00/
```

---

#### setResumePath(path: string): void

Sets the recovery path to resume execution from a specified task directory.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| path | string | Task directory name (without full path) |

**Behavior**

- After setting, completed tasks will be skipped
- Interrupted tasks will be re-executed
- New tasks will be appended

**Example**

```typescript
// Resume from historical directory
agent.setResumePath('AnalyzeCodebase_2026_03_03_10_30_00');
```

---

#### enableDebugMode(enabled?: boolean): void

Enables or disables debug mode.

**Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| enabled | boolean | true | Whether to enable debug mode |

**Debug Mode Behavior**

- Collection tasks return only the first data item
- Used for quick workflow validation

**Example**

```typescript
agent.enableDebugMode(true);  // Enable
agent.enableDebugMode(false); // Disable
```

---

#### isDebugMode(): boolean

Checks if debug mode is enabled.

**Returns**

| Type | Description |
|------|-------------|
| boolean | Debug mode status |

---

### Task Execution

#### execPrompt(prompt: string, options?: ExecOptions): Promise\<ExecutionResult\>

Executes a normal task.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| prompt | string | Prompt content |
| options | ExecOptions | Execution options (optional) |

**ExecOptions**

```typescript
interface ExecOptions {
  cwd?: string;        // Working directory, defaults to current process directory
  newSession?: boolean; // Whether to use a new session, defaults to false (reuse previous session)
}
```

**Session Behavior**

- `newSession: false` (default): Reuses the previous task's session ID. If no previous session exists, creates a new one.
- `newSession: true`: Creates a new session ID, starting a fresh conversation context.

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
} else {
  console.error('Failed:', result.error);
}
```

---

#### execCollectPrompt(prompt: string, outputFormat: OutputFormat, outputFileName: string, options?: ExecOptions): Promise\<CollectResult\>

Executes a collection task, collecting data and saving as JSON file.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| prompt | string | Prompt content |
| outputFormat | OutputFormat | Output format definition |
| outputFileName | string | Output file name |
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
  },
  'interfaces.json'
);

console.log(`Collected ${result.data.length} interfaces`);
```

---

#### execCheckPrompt(prompt: string, outputFileName: string, options?: ExecOptions): Promise\<CheckResult\>

Executes a check task, returning a boolean result (true/false). The AI is instructed to output the result to a JSON file, which is then read and returned.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| prompt | string | Check question/prompt |
| outputFileName | string | Output file name |
| options | ExecOptions | Execution options (optional) |

**CheckResult**

```typescript
interface CheckResult extends ExecutionResult {
  result: boolean; // Check result: true or false
}
```

**Example**

```typescript
const result = await agent.execCheckPrompt(
  'Check if the project has proper unit tests',
  'check_result.json'
);

if (result.success && result.result) {
  console.log('Check passed');
} else {
  console.log('Check failed');
}
```

---

#### execProcessDataAndCheck(prompt: string, data: Record\<string, any\>, outputFileName: string, options?: ExecOptions): Promise\<CheckResult\>

Executes a processing check task, similar to execCheckPrompt but supports variable substitution in the prompt.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| prompt | string | Prompt template, supports variable substitution |
| data | Record<string, any> | Data object |
| outputFileName | string | Output file name |
| options | ExecOptions | Execution options (optional) |

**Variable Substitution**

Use `$variableName` format in prompts, which will be replaced with corresponding values from data:

```typescript
// Prompt template
const prompt = 'Check if $name function has proper error handling';

// Data
const data = { name: 'getUser' };

// Actual executed prompt
// Check if getUser function has proper error handling
```

**CheckResult**

```typescript
interface CheckResult extends ExecutionResult {
  result: boolean; // Check result: true or false
}
```

**Example**

```typescript
const apis = [
  { name: 'login', path: '/api/login' },
  { name: 'logout', path: '/api/logout' }
];

for (const api of apis) {
  const result = await agent.execProcessDataAndCheck(
    'Check if $name API has proper input validation',
    api,
    `check_${api.name}.json`
  );

  if (result.result) {
    console.log(`${api.name} has proper validation`);
  }
}
```

---

#### execProcessData(prompt: string, data: Record\<string, any\>, options?: ExecOptions): Promise\<ExecutionResult\>

Executes a processing task for a single data item.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| prompt | string | Prompt template, supports variable substitution |
| data | Record<string, any> | Data object |
| options | ExecOptions | Execution options (optional) |

**Variable Substitution**

Use `$variableName` format in prompts, which will be replaced with corresponding values from data:

```typescript
// Prompt template
const prompt = 'Analyze the complexity of this function: $name in $file';

// Data
const data = { name: 'getUser', file: 'src/user.ts' };

// Actual executed prompt
// Analyze the complexity of this function: getUser in src/user.ts
```

**Example**

```typescript
const items = [
  { name: 'login', path: '/api/login' },
  { name: 'logout', path: '/api/logout' }
];

for (const item of items) {
  await agent.execProcessData(
    'Generate documentation for API: $name ($path)',
    item
  );
}
```

---

#### execProcessDataAndCollect(prompt: string, data: Record\<string, any\>, outputFormat: OutputFormat, outputFileName: string, options?: ExecOptions): Promise\<CollectResult\>

Executes a processing task and collects results.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| prompt | string | Prompt template |
| data | Record<string, any> | Data object |
| outputFormat | OutputFormat | Output format definition |
| outputFileName | string | Output file name |
| options | ExecOptions | Execution options (optional) |

**Example**

```typescript
const apis = [
  { name: 'login', method: 'POST', path: '/api/login' },
  { name: 'logout', method: 'POST', path: '/api/logout' }
];

for (const api of apis) {
  await agent.execProcessDataAndCollect(
    'Generate test cases for API $name',
    api,
    {
      primaryKey: 'apiName',
      keys: [
        { name: 'apiName', description: 'API name', type: 'string' },
        { name: 'testCases', description: 'Test cases', type: 'array' }
      ]
    },
    'test_cases.json'
  );
}
```

---

#### execReport(prompt: string, outputFormat: OutputFormat, outputFileName: string, options?: ExecOptions): Promise\<CollectResult\>

Executes a report task to generate summary reports.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| prompt | string | Prompt content |
| outputFormat | OutputFormat | Output format definition |
| outputFileName | string | Output file name |
| options | ExecOptions | Execution options (optional) |

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

#### execProcessDataAndReport(prompt: string, data: Record\<string, any\>, outputFormat: OutputFormat, outputFileName: string, options?: ExecOptions): Promise\<CollectResult\>

Executes a processing report task, similar to execReport but supports variable substitution in the prompt.

**Parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| prompt | string | Prompt template, supports variable substitution |
| data | Record<string, any> | Data object |
| outputFormat | OutputFormat | Output format definition |
| outputFileName | string | Output file name |
| options | ExecOptions | Execution options (optional) |

**Variable Substitution**

Use `$variableName` format in prompts, which will be replaced with corresponding values from data:

```typescript
// Prompt template
const prompt = 'Generate analysis report for $name project';

// Data
const data = { name: 'MyApp' };

// Actual executed prompt
// Generate analysis report for MyApp project
```

**Example**

```typescript
const projects = [
  { name: 'frontend', path: '/src/frontend', type: 'React' },
  { name: 'backend', path: '/src/backend', type: 'Express' }
];

for (const project of projects) {
  const result = await agent.execProcessDataAndReport(
    'Generate code quality report for $name ($type) project located at $path',
    project,
    {
      keys: [
        { name: 'score', description: 'Quality score', type: 'number' },
        { name: 'issues', description: 'Issues found', type: 'array' },
        { name: 'suggestions', description: 'Suggestions', type: 'array' }
      ]
    },
    `report_${project.name}.json`
  );

  console.log(`${project.name} report:`, result.data);
}
```

---

### Helper Methods

#### saveCollectData(data: Record\<string, any\>[], fileName?: string): void

Saves collected data to disk. The data file is stored in the current working directory (cwd), not the task directory.

**Parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| data | Record<string, any>[] | - | Data array |
| fileName | string | 'collect_data.json' | File name |

**Example**

```typescript
agent.saveCollectData(result.data, 'my_data.json');
```

---

#### loadCollectData(fileName?: string): Record\<string, any\>[]

Loads collected data from disk. Reads the file from the current working directory (cwd), not the task directory.

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
const data = agent.loadCollectData('my_data.json');
```

---

#### getTaskDir(): string

Gets the current task directory path.

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

**Example**

```typescript
const sessionId = agent.getCurrentSessionId();
console.log('Current session:', sessionId);
```

---

## Type Definitions

### ExecOptions

Execution options.

```typescript
interface ExecOptions {
  cwd?: string;        // Working directory
  newSession?: boolean; // Whether to use a new session (default: false)
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
type TaskType = 'task' | 'collect' | 'process' | 'process_collect' | 'report';
```

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