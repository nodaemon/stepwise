# Examples

This document provides complete usage examples for StepWise.

---

## Table of Contents

- [Basic Examples](#basic-examples)
- [Data Collection and Processing](#data-collection-and-processing)
- [Task Recovery](#task-recovery)
- [Debug Mode](#debug-mode)
- [Complete Project Examples](#complete-project-examples)

---

## Basic Examples

### Execute a Single Task

```typescript
import { StepWise } from 'stepwise';

async function main() {
  const agent = new StepWise();

  // Set task name
  agent.setTaskName('SimpleTask');

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

### Task with Session Recovery

```typescript
import { StepWise } from 'stepwise';

async function main() {
  const agent = new StepWise();
  agent.setTaskName('SessionExample');

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

---

## Data Collection and Processing

### Collect API Interfaces

```typescript
import { StepWise, OutputFormat } from 'stepwise';

async function collectAPIs() {
  const agent = new StepWise();
  agent.setTaskName('CollectAPIs');

  const outputFormat: OutputFormat = {
    primaryKey: 'name',
    keys: [
      { name: 'name', description: 'API name', type: 'string' },
      { name: 'method', description: 'HTTP method (GET/POST/PUT/DELETE)', type: 'string' },
      { name: 'path', description: 'API path', type: 'string' },
      { name: 'description', description: 'Function description', type: 'string' },
      { name: 'params', description: 'Request parameters', type: 'array' }
    ]
  };

  const result = await agent.execCollectPrompt(
    `Please traverse all source code files in the project and collect all API interface definitions.
    Include Express routes, Fastify routes, or routes from other HTTP frameworks.`,
    outputFormat,
    'apis.json'
  );

  console.log(`Collected ${result.data.length} API interfaces`);

  // Print first 5
  result.data.slice(0, 5).forEach(api => {
    console.log(`- ${api.method} ${api.path}: ${api.name}`);
  });

  return result.data;
}

collectAPIs();
```

### Batch Process Data

```typescript
import { StepWise } from 'stepwise';

async function processAPIs(apis: any[]) {
  const agent = new StepWise();
  agent.setTaskName('ProcessAPIs');

  for (const api of apis) {
    const result = await agent.execProcessData(
      `Generate detailed interface documentation for the following API:

      API Name: $name
      HTTP Method: $method
      Path: $path
      Description: $description

      Please generate Markdown format documentation including:
      1. Interface description
      2. Request parameter description
      3. Response format description
      4. Example request and response`,
      api
    );

    if (result.success) {
      console.log(`Generated documentation for ${api.name}`);
    }
  }
}

// Assuming apis is previously collected data
// processAPIs(apis);
```

### Process and Collect Results

```typescript
import { StepWise, OutputFormat } from 'stepwise';

async function generateTests(apis: any[]) {
  const agent = new StepWise();
  agent.setTaskName('GenerateTests');

  const outputFormat: OutputFormat = {
    primaryKey: 'apiName',
    keys: [
      { name: 'apiName', description: 'API name', type: 'string' },
      { name: 'testFile', description: 'Test file path', type: 'string' },
      { name: 'testCases', description: 'Test case list', type: 'array' }
    ]
  };

  for (const api of apis) {
    await agent.execProcessDataAndCollect(
      `Generate unit test cases for the following API:

      API Name: $name
      HTTP Method: $method
      Path: $path

      Use Jest testing framework and generate at least 3 test cases:
      1. Normal case test
      2. Edge case test
      3. Error case test`,
      api,
      outputFormat,
      'test_cases.json'
    );

    console.log(`Generated test cases for ${api.name}`);
  }

  // Load all test cases
  const allTests = agent.loadCollectData('test_cases.json');
  console.log(`Generated test cases for ${allTests.length} APIs`);
}

// generateTests(apis);
```

---

## Task Recovery

### Resume from Checkpoint

Assume you have a long-running task that was interrupted halfway:

```typescript
import { StepWise } from 'stepwise';

async function analyzeProject() {
  const agent = new StepWise();

  // Recovery mode: set the task directory to recover from
  // agent.setResumePath('AnalyzeProject_2026_03_03_14_30_00');

  // New task mode: set task name
  agent.setTaskName('AnalyzeProject');

  // Step 1: Analyze project structure
  await agent.execPrompt('Analyze project directory structure and identify main modules');

  // Step 2: Collect components
  const components = await agent.execCollectPrompt(
    'Collect all React components in the project',
    {
      primaryKey: 'name',
      keys: [
        { name: 'name', description: 'Component name', type: 'string' },
        { name: 'file', description: 'File location', type: 'string' },
        { name: 'props', description: 'Props type definition', type: 'object' }
      ]
    },
    'components.json'
  );

  // Step 3: Process each component
  for (const comp of components.data) {
    await agent.execProcessData(
      'Generate usage documentation and example code for component $name',
      comp
    );
  }

  // Step 4: Generate report
  await agent.execReport(
    'Based on analysis results, generate project component analysis report',
    {
      keys: [
        { name: 'summary', description: 'Overall summary', type: 'string' },
        { name: 'statistics', description: 'Statistics', type: 'object' },
        { name: 'recommendations', description: 'Optimization suggestions', type: 'array' }
      ]
    },
    'report.json'
  );
}

analyzeProject();
```

**Resume Execution**

If the task was interrupted during step 3:

```typescript
async function resumeProject() {
  const agent = new StepWise();

  // Set recovery path (interrupted task directory)
  agent.setResumePath('AnalyzeProject_2026_03_03_14_30_00');

  // Re-execute the same code
  // Completed tasks will be automatically skipped
  await agent.execPrompt('Analyze project directory structure and identify main modules');  // Skipped

  const components = await agent.execCollectPrompt(
    'Collect all React components in the project',
    { /* ... */ },
    'components.json'
  );  // Skipped, data loaded from disk

  // Continue processing from interrupted component
  for (const comp of components.data) {
    await agent.execProcessData(
      'Generate usage documentation and example code for component $name',
      comp
    );  // Partially skipped, continues from interruption point
  }

  await agent.execReport(
    'Based on analysis results, generate project component analysis report',
    { /* ... */ },
    'report.json'
  );  // New task, executes normally
}

resumeProject();
```

---

## Debug Mode

### Quick Workflow Validation

In debug mode, collection tasks return only the first data item, suitable for validating workflow correctness:

```typescript
import { StepWise } from 'stepwise';

async function debugFlow() {
  const agent = new StepWise();

  // Enable debug mode
  agent.enableDebugMode(true);
  agent.setTaskName('DebugExample');

  // Collection task returns only first item
  const result = await agent.execCollectPrompt(
    'Collect all function definitions',
    {
      keys: [
        { name: 'name', description: 'Function name', type: 'string' },
        { name: 'file', description: 'File path', type: 'string' }
      ]
    },
    'functions.json'
  );

  // Debug mode: only returns first item
  console.log('Debug mode data count:', result.data.length);  // 1

  // Disable debug mode to get full data
  agent.enableDebugMode(false);
  const fullData = agent.loadCollectData('functions.json');
  console.log('Full data count:', fullData.length);
}

debugFlow();
```

---

## Complete Project Examples

### Code Review Tool

```typescript
import { StepWise, OutputFormat } from 'stepwise';

/**
 * Automated Code Review Tool
 * 1. Collect all source files
 * 2. Analyze code quality
 * 3. Generate review report
 */
class CodeReviewer {
  private agent: StepWise;

  constructor() {
    this.agent = new StepWise();
  }

  async review(projectPath: string, resumePath?: string) {
    // Set recovery path or new task
    if (resumePath) {
      this.agent.setResumePath(resumePath);
    } else {
      this.agent.setTaskName('CodeReview');
    }

    // Step 1: Analyze project structure
    console.log('Step 1: Analyzing project structure...');
    await this.agent.execPrompt(
      `Analyze the project structure of ${projectPath} and identify:
      - Project type (frontend/backend/fullstack)
      - Main frameworks and libraries used
      - Directory organization`
    );

    // Step 2: Collect files to review
    console.log('Step 2: Collecting source files...');
    const filesResult = await this.agent.execCollectPrompt(
      `Collect all source files that need review in ${projectPath},
      excluding node_modules, dist, build directories.
      Focus on .ts, .tsx, .js, .jsx files.`,
      {
        primaryKey: 'path',
        keys: [
          { name: 'path', description: 'File path', type: 'string' },
          { name: 'type', description: 'File type', type: 'string' },
          { name: 'lines', description: 'Lines of code', type: 'number' }
        ]
      },
      'source_files.json'
    );

    console.log(`Found ${filesResult.data.length} source files`);

    // Step 3: Review each file
    console.log('Step 3: Reviewing code...');
    const reviewFormat: OutputFormat = {
      primaryKey: 'filePath',
      keys: [
        { name: 'filePath', description: 'File path', type: 'string' },
        { name: 'score', description: 'Code quality score (1-10)', type: 'number' },
        { name: 'issues', description: 'Issues found', type: 'array' },
        { name: 'suggestions', description: 'Improvement suggestions', type: 'array' }
      ]
    };

    // In debug mode, only process first file
    const filesToProcess = this.agent.isDebugMode()
      ? filesResult.data.slice(0, 1)
      : filesResult.data;

    for (const file of filesToProcess) {
      console.log(`  Reviewing: ${file.path}`);
      await this.agent.execProcessDataAndCollect(
        `Review the code quality of file $path, checking:
        - Code style and conventions
        - Potential bugs and security issues
        - Performance issues
        - Maintainability

        File type: $type
        Lines of code: $lines`,
        file,
        reviewFormat,
        'review_results.json'
      );
    }

    // Step 4: Generate report
    console.log('Step 4: Generating report...');
    await this.agent.execReport(
      'Based on code review results, generate project code quality report',
      {
        keys: [
          { name: 'overallScore', description: 'Overall score', type: 'number' },
          { name: 'summary', description: 'Overall evaluation', type: 'string' },
          { name: 'criticalIssues', description: 'Critical issues list', type: 'array' },
          { name: 'recommendations', description: 'Improvement suggestions', type: 'array' }
        ]
      },
      'review_report.json'
    );

    console.log('Review complete!');
    console.log('Results directory:', this.agent.getTaskDir());

    return this.agent.getTaskDir();
  }
}

// Usage example
async function main() {
  const reviewer = new CodeReviewer();

  // New task
  await reviewer.review('/path/to/project');

  // Or resume from checkpoint
  // await reviewer.review('/path/to/project', 'CodeReview_2026_03_03_14_30_00');
}

main();
```

### API Documentation Generator

```typescript
import { StepWise } from 'stepwise';

/**
 * Auto-generate API Documentation
 */
async function generateAPIDocs(projectPath: string) {
  const agent = new StepWise();
  agent.setTaskName('GenerateAPIDocs');

  // 1. Collect API definitions
  const apis = await agent.execCollectPrompt(
    `Traverse ${projectPath} and collect all API interface definitions.
    Support Express, Fastify, Koa and other frameworks.`,
    {
      primaryKey: 'id',
      keys: [
        { name: 'id', description: 'Unique identifier', type: 'string' },
        { name: 'name', description: 'Interface name', type: 'string' },
        { name: 'method', description: 'HTTP method', type: 'string' },
        { name: 'path', description: 'Path', type: 'string' },
        { name: 'handler', description: 'Handler function', type: 'string' },
        { name: 'params', description: 'Parameter definition', type: 'object' },
        { name: 'response', description: 'Response format', type: 'object' }
      ]
    },
    'api_definitions.json'
  );

  console.log(`Found ${apis.data.length} APIs`);

  // 2. Generate documentation for each API
  for (const api of apis.data) {
    await agent.execProcessData(
      `Generate detailed interface documentation for API $name (Markdown format)

      Method: $method
      Path: $path
      Parameters: $params
      Response: $response

      Documentation should include:
      - Interface description
      - Request parameter description
      - Response format description
      - Example request and response
      - Error code description`,
      api
    );
  }

  // 3. Generate summary documentation
  await agent.execReport(
    'Generate API documentation index and summary',
    {
      keys: [
        { name: 'title', description: 'Document title', type: 'string' },
        { name: 'toc', description: 'Table of contents', type: 'array' },
        { name: 'overview', description: 'API overview', type: 'string' }
      ]
    },
    'api_docs_index.json'
  );

  return agent.getTaskDir();
}

// generateAPIDocs('/path/to/project');
```

---

## Best Practices

### 1. Reasonably Split Tasks

```typescript
// Recommended: Split by logical steps
await agent.execPrompt('Analyze project structure');           // Step 1
const data = await agent.execCollectPrompt(...);  // Step 2
for (const item of data) {
  await agent.execProcessData(...);               // Step 3+
}

// Not recommended: One large task for everything
await agent.execPrompt('Analyze project structure, collect data, process data, generate report...');
```

### 2. Use Primary Key for Deduplication

```typescript
// Use primaryKey to avoid duplicate data
const format = {
  primaryKey: 'name',  // Data with same name keeps only the latest
  keys: [/* ... */]
};
```

### 3. Leverage Debug Mode

```typescript
// Enable debug mode during development for quick workflow validation
agent.enableDebugMode(true);

// Disable in production
agent.enableDebugMode(false);
```

### 4. Save Critical Data

```typescript
// Periodically save intermediate results
agent.saveCollectData(processedData, 'checkpoint.json');

// Load when needed
const checkpoint = agent.loadCollectData('checkpoint.json');
```

### 5. Monitor Task Progress

```typescript
console.log('Task directory:', agent.getTaskDir());
console.log('Executed tasks:', agent.getTaskCounter());
```