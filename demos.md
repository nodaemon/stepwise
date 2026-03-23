# Examples

This document provides complete usage examples for StepWise.

---

## Table of Contents

- [Basic Examples](#basic-examples)
  - [Execute a Task](#execute-a-task)
  - [Session Reuse](#session-reuse)
  - [Variable Substitution](#variable-substitution)
- [Data Collection](#data-collection)
  - [Collect Task](#collect-task)
  - [Check Task](#check-task)
  - [Report Task](#report-task)
- [Shell Commands](#shell-commands)
- [Parallel Processing](#parallel-processing)
- [Task Recovery](#task-recovery)
- [Debug Mode](#debug-mode)
- [Configuration Options](#configuration-options)
- [Best Practices](#best-practices)

---

## Basic Examples

### Execute a Task

```typescript
import { setTaskName, StepWise } from 'stepwise';

async function main() {
  // Set task name (global function)
  setTaskName('SimpleTask');

  // Create StepWise instance (name is required)
  const agent = new StepWise('myAgent');

  // Execute prompt
  const result = await agent.execPrompt(
    'Analyze the package.json file in the current project and list all dependencies'
  );

  if (result.success) {
    console.log('Output:', result.output);
    console.log('Duration:', result.duration / 1000, 'seconds');
  } else {
    console.error('Error:', result.error);
  }
}

main();
```

### Session Reuse

```typescript
import { setTaskName, StepWise } from 'stepwise';

async function main() {
  setTaskName('SessionExample');
  const agent = new StepWise('myAgent');

  // First execution, creates a new session automatically
  const result1 = await agent.execPrompt('List all files in the src directory');
  console.log('Session ID:', result1.sessionId);

  // Continue execution, automatically reuses the previous session, maintaining context
  const result2 = await agent.execPrompt(
    'Count how many TypeScript files are among these files'
  );

  console.log('Result:', result2.output);

  // If you need a new session, explicitly specify newSession: true
  const result3 = await agent.execPrompt(
    'Start a new independent task',
    { newSession: true }
  );
}

main();
```

### Variable Substitution

```typescript
import { setTaskName, StepWise } from 'stepwise';

async function main() {
  setTaskName('VariableExample');
  const agent = new StepWise('myAgent');

  const data = { name: 'UserService', path: '/src/services/user.ts' };

  // Use $variableName syntax for variable substitution
  await agent.execPrompt(
    'Analyze the $name module located at $path, list its main features',
    { data }
  );
}

main();
```

---

## Data Collection

### Collect Task

```typescript
import { setTaskName, StepWise, OutputFormat } from 'stepwise';

async function collectAPIs() {
  setTaskName('CollectAPIs');
  const agent = new StepWise('collector');

  const outputFormat: OutputFormat = {
    name: { type: 'string', description: 'API name' },
    method: { type: 'string', description: 'HTTP method (GET/POST/PUT/DELETE)' },
    path: { type: 'string', description: 'API path' },
    description: { type: 'string', description: 'Function description' }
  };

  // Collect data, output file is auto-generated
  const result = await agent.execCollectPrompt(
    `Traverse all source code files in the project and collect all API interface definitions`,
    outputFormat
  );

  console.log(`Collected ${result.data.length} API interfaces`);

  // Optional: add check prompt to validate collection results
  const resultWithCheck = await agent.execCollectPrompt(
    `Collect all database model definitions in the project`,
    outputFormat,
    {
      checkPrompt: 'Check if collection results are complete, add missing models'
    }
  );

  return result.data;
}

collectAPIs();
```

### Check Task

```typescript
import { setTaskName, StepWise } from 'stepwise';

async function checkProject() {
  setTaskName('CheckProject');
  const agent = new StepWise('checker');

  // Check if project has proper unit tests
  const testCheck = await agent.execCheckPrompt(
    'Check if the project has proper unit tests (at least 5 test files)'
  );

  console.log(`Has unit tests: ${testCheck.result}`);

  // Check with variable substitution
  const moduleCheck = await agent.execCheckPrompt(
    'Check if the $name module has complete documentation',
    { data: { name: 'UserService' } }
  );

  console.log(`Has documentation: ${moduleCheck.result}`);
}

checkProject();
```

### Report Task

```typescript
import { setTaskName, StepWise } from 'stepwise';

async function generateReport() {
  setTaskName('GenerateReport');
  const agent = new StepWise('reporter');

  // Generate report, output filename is required
  const result = await agent.execReport(
    'Based on project analysis results, generate quality report',
    {
      projectName: { type: 'string', description: 'Project name' },
      qualityScore: { type: 'number', description: 'Quality score (0-100)' },
      issues: { type: 'array', description: 'List of issues' },
      recommendations: { type: 'array', description: 'Recommendations' }
    },
    'quality_report.json'
  );

  console.log('Report generated:', result.data);
}

generateReport();
```

---

## Shell Commands

StepWise provides the `execShell` method to execute shell commands:

```typescript
import { setTaskName, StepWise } from 'stepwise';

async function runBuild() {
  setTaskName('BuildTask');
  const agent = new StepWise('builder');

  // Execute build command
  const result = await agent.execShell('npm run build');

  if (result.success) {
    console.log('Build succeeded');
    console.log('Output:', result.output);
  } else {
    console.error('Build failed:', result.error);
  }

  // Execute with options
  const testResult = await agent.execShell('npm test', {
    timeout: 60000,      // Timeout in milliseconds
    cwd: './project'     // Working directory
  });

  console.log('Test result:', testResult.output);
}

runBuild();
```

---

## Parallel Processing

Use `forEachParallel` for concurrent task processing:

```typescript
import { setTaskName, StepWise, forEachParallel, WorkerConfig } from 'stepwise';

async function processItems() {
  setTaskName('ParallelTask');

  // Define items to process
  const items = [
    { name: 'UserAPI', path: '/api/user' },
    { name: 'OrderAPI', path: '/api/order' },
    { name: 'ProductAPI', path: '/api/product' }
  ];

  // Define worker configurations
  const workerConfigs: WorkerConfig[] = [
    { branchName: 'Agent1' },
    { branchName: 'Agent2' },
    { branchName: 'Agent3' }
  ];

  // Process in parallel
  await forEachParallel(items, workerConfigs, async (ctx) => {
    // ctx.stepWise - pre-created instance with workerId bound
    // ctx.item - current item being processed
    // ctx.workerConfig - current worker configuration
    // ctx.workspacePath - workspace path

    await ctx.stepWise.execPrompt(
      'Generate test cases for $name at $path',
      { data: ctx.item }
    );
  });
}

processItems();
```

**Parallel processing with environment variables:**

```typescript
import { setTaskName, forEachParallel, WorkerConfig } from 'stepwise';

async function processWithEnv() {
  setTaskName('EnvParallelTask');

  const items = [/* ... */];

  // Each worker uses different environment variables
  const workerConfigs: WorkerConfig[] = [
    { branchName: 'Worker1', env: ['API_PORT=3001', 'DB_NAME=test1'] },
    { branchName: 'Worker2', env: ['API_PORT=3002', 'DB_NAME=test2'] }
  ];

  await forEachParallel(items, workerConfigs, async (ctx) => {
    await ctx.stepWise.execPrompt('Process task', { data: ctx.item });
  });
}

processWithEnv();
```

---

## Task Recovery

### Resume from Checkpoint

```typescript
import { setTaskName, setResumePath, StepWise } from 'stepwise';

async function analyzeProject() {
  // Recovery mode: set the task directory to recover from
  setResumePath('AnalyzeProject_20260315_143000_123');

  // New task mode: only set task name
  // setTaskName('AnalyzeProject');
  setTaskName('AnalyzeProject');

  const agent = new StepWise('analyzer');

  // Step 1: Analyze project structure
  await agent.execPrompt('Analyze project directory structure and identify main modules');

  // Step 2: Collect components
  const components = await agent.execCollectPrompt(
    'Collect all React components in the project',
    {
      name: { type: 'string', description: 'Component name' },
      file: { type: 'string', description: 'File location' }
    }
  );

  // Step 3: Process each component
  for (const comp of components.data) {
    await agent.execPrompt(
      'Generate usage documentation for component $name',
      { data: comp }
    );
  }

  // Step 4: Generate report
  await agent.execReport(
    'Based on analysis results, generate project component analysis report',
    {
      summary: { type: 'string', description: 'Overall summary' },
      statistics: { type: 'object', description: 'Statistics' }
    },
    'report.json'
  );
}

analyzeProject();
```

---

## Debug Mode

In debug mode, collection tasks return only the first data item, suitable for validating workflow:

```typescript
import { setTaskName, enableDebugMode, StepWise } from 'stepwise';

async function debugFlow() {
  // Enable debug mode (global function)
  enableDebugMode(true);
  setTaskName('DebugExample');

  const agent = new StepWise('debugger');

  // Collection task returns only first item
  const result = await agent.execCollectPrompt(
    'Collect all function definitions',
    {
      name: { type: 'string', description: 'Function name' },
      file: { type: 'string', description: 'File path' }
    }
  );

  console.log('Debug mode data count:', result.data.length);  // 1

  // Disable debug mode
  enableDebugMode(false);
}

debugFlow();
```

---

## Configuration Options

### Skip Summarize

```typescript
import { setTaskName, setSkipSummarize, StepWise } from 'stepwise';

async function main() {
  setTaskName('SkipSummarizeTask');
  // Skip summarize phase for faster execution
  setSkipSummarize(true);

  const agent = new StepWise('myAgent');
  await agent.execPrompt('Execute task');
}

main();
```

### Set Agent Type

```typescript
import { setTaskName, setAgentType, StepWise } from 'stepwise';

async function main() {
  setTaskName('AgentTypeTask');
  // Set agent type
  setAgentType('claude');

  const agent = new StepWise('myAgent');
  await agent.execPrompt('Execute task');
}

main();
```

### Save and Load Collection Data

```typescript
import { setTaskName, saveCollectData, loadCollectData, StepWise } from 'stepwise';

async function manageData() {
  setTaskName('DataManagement');

  // Save collection data (global function)
  const data = [{ name: 'item1' }, { name: 'item2' }];
  saveCollectData(data, 'my_data.json');

  // Load collection data (global function)
  const loaded = loadCollectData('my_data.json');
  console.log('Loaded data:', loaded);
}

manageData();
```

---

## Best Practices

### 1. Reasonably Split Tasks

```typescript
// Recommended: Split by logical steps
await agent.execPrompt('Analyze project structure');           // Step 1
const data = await agent.execCollectPrompt(...);  // Step 2
for (const item of data.data) {
  await agent.execPrompt('Process $name', { data: item });  // Step 3+
}

// Not recommended: One large task for everything
await agent.execPrompt('Analyze project structure, collect data, process data, generate report...');
```

### 2. Automatic Deduplication

```typescript
// First required field is automatically used for deduplication
const format: OutputFormat = {
  name: { type: 'string', description: 'Item name' },  // Auto-used for deduplication
  value: { type: 'number', description: 'Item value' }
};
```

### 3. Leverage Debug Mode

```typescript
// Enable debug mode during development for quick workflow validation
enableDebugMode(true);

// Disable in production
enableDebugMode(false);
```

### 4. Monitor Task Progress

```typescript
setTaskName('MyTask');
const agent = new StepWise('myAgent');

console.log('Task directory:', agent.getTaskDir());
console.log('Executed tasks:', agent.getTaskCounter());
```

### 5. Use checkPrompt to Validate Results

```typescript
const result = await agent.execCollectPrompt(
  'Collect API definitions',
  format,
  {
    checkPrompt: 'Check if collection results are complete, add missing APIs'
  }
);
```