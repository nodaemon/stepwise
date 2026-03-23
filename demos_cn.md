# 使用示例

本文档提供 StepWise 的完整使用示例。

---

## 目录

- [基础示例](#基础示例)
  - [执行普通任务](#执行普通任务)
  - [会话复用](#会话复用)
  - [变量替换](#变量替换)
- [数据收集](#数据收集)
  - [收集任务](#收集任务)
  - [检查任务](#检查任务)
  - [报告任务](#报告任务)
- [Shell 命令](#shell-命令)
- [并发处理](#并发处理)
- [任务恢复](#任务恢复)
- [调试模式](#调试模式)
- [配置选项](#配置选项)
- [最佳实践](#最佳实践)

---

## 基础示例

### 执行普通任务

```typescript
import { setTaskName, StepWise } from 'stepwise';

async function main() {
  // 设置任务名称（全局函数）
  setTaskName('SimpleTask');

  // 创建 StepWise 实例（必须提供名称）
  const agent = new StepWise('myAgent');

  // 执行提示词
  const result = await agent.execPrompt(
    '分析当前项目的 package.json 文件，列出所有依赖项'
  );

  if (result.success) {
    console.log('输出:', result.output);
    console.log('耗时:', result.duration / 1000, '秒');
  } else {
    console.error('错误:', result.error);
  }
}

main();
```

### 会话复用

```typescript
import { setTaskName, StepWise } from 'stepwise';

async function main() {
  setTaskName('SessionExample');
  const agent = new StepWise('myAgent');

  // 第一次执行，自动创建新 session
  const result1 = await agent.execPrompt('列出 src 目录下的所有文件');
  console.log('Session ID:', result1.sessionId);

  // 继续执行，自动复用上一个 session，保持上下文
  const result2 = await agent.execPrompt(
    '统计这些文件中有多少个 TypeScript 文件'
  );

  console.log('结果:', result2.output);

  // 如果需要新 session，显式指定 newSession: true
  const result3 = await agent.execPrompt(
    '开始一个新的独立任务',
    { newSession: true }
  );
}

main();
```

### 变量替换

```typescript
import { setTaskName, StepWise } from 'stepwise';

async function main() {
  setTaskName('VariableExample');
  const agent = new StepWise('myAgent');

  const data = { name: 'UserService', path: '/src/services/user.ts' };

  // 使用 $变量名 语法进行变量替换
  await agent.execPrompt(
    '分析 $name 模块，位于 $path，列出其主要功能',
    { data }
  );
}

main();
```

---

## 数据收集

### 收集任务

```typescript
import { setTaskName, StepWise, OutputFormat } from 'stepwise';

async function collectAPIs() {
  setTaskName('CollectAPIs');
  const agent = new StepWise('collector');

  const outputFormat: OutputFormat = {
    name: { type: 'string', description: 'API 名称' },
    method: { type: 'string', description: 'HTTP 方法 (GET/POST/PUT/DELETE)' },
    path: { type: 'string', description: 'API 路径' },
    description: { type: 'string', description: '功能描述' }
  };

  // 收集数据，输出文件自动生成
  const result = await agent.execCollectPrompt(
    `遍历项目中的所有源代码文件，收集所有的 API 接口定义`,
    outputFormat
  );

  console.log(`收集到 ${result.data.length} 个 API 接口`);

  // 可选：添加检查提示词验证收集结果
  const resultWithCheck = await agent.execCollectPrompt(
    `收集项目中的所有数据库模型定义`,
    outputFormat,
    {
      checkPrompt: '检查收集结果是否完整，补充遗漏的模型定义'
    }
  );

  return result.data;
}

collectAPIs();
```

### 检查任务

```typescript
import { setTaskName, StepWise } from 'stepwise';

async function checkProject() {
  setTaskName('CheckProject');
  const agent = new StepWise('checker');

  // 检查项目是否有合适的单元测试
  const testCheck = await agent.execCheckPrompt(
    '检查项目是否有合适的单元测试（至少 5 个测试文件）'
  );

  console.log(`有单元测试: ${testCheck.result}`);

  // 带变量替换的检查
  const moduleCheck = await agent.execCheckPrompt(
    '检查 $name 模块是否有完整的文档',
    { data: { name: 'UserService' } }
  );

  console.log(`有文档: ${moduleCheck.result}`);
}

checkProject();
```

### 报告任务

```typescript
import { setTaskName, StepWise } from 'stepwise';

async function generateReport() {
  setTaskName('GenerateReport');
  const agent = new StepWise('reporter');

  // 生成报告，需要指定输出文件名
  const result = await agent.execReport(
    '基于项目分析结果，生成质量报告',
    {
      projectName: { type: 'string', description: '项目名称' },
      qualityScore: { type: 'number', description: '质量分数 (0-100)' },
      issues: { type: 'array', description: '问题列表' },
      recommendations: { type: 'array', description: '改进建议' }
    },
    'quality_report.json'
  );

  console.log('报告已生成:', result.data);
}

generateReport();
```

---

## Shell 命令

StepWise 提供了 `execShell` 方法执行 Shell 命令：

```typescript
import { setTaskName, StepWise } from 'stepwise';

async function runBuild() {
  setTaskName('BuildTask');
  const agent = new StepWise('builder');

  // 执行构建命令
  const result = await agent.execShell('npm run build');

  if (result.success) {
    console.log('构建成功');
    console.log('输出:', result.output);
  } else {
    console.error('构建失败:', result.error);
  }

  // 带选项执行
  const testResult = await agent.execShell('npm test', {
    timeout: 60000,      // 超时时间（毫秒）
    cwd: './project'     // 工作目录
  });

  console.log('测试结果:', testResult.output);
}

runBuild();
```

---

## 并发处理

使用 `forEachParallel` 实现并发任务处理：

```typescript
import { setTaskName, StepWise, forEachParallel, WorkerConfig } from 'stepwise';

async function processItems() {
  setTaskName('ParallelTask');

  // 定义要处理的数据
  const items = [
    { name: 'UserAPI', path: '/api/user' },
    { name: 'OrderAPI', path: '/api/order' },
    { name: 'ProductAPI', path: '/api/product' }
  ];

  // 定义 Worker 配置
  const workerConfigs: WorkerConfig[] = [
    { branchName: 'Agent1' },
    { branchName: 'Agent2' },
    { branchName: 'Agent3' }
  ];

  // 并发处理
  await forEachParallel(items, workerConfigs, async (ctx) => {
    // ctx.stepWise - 已创建好的实例，自动绑定 workerId
    // ctx.item - 当前处理的数据
    // ctx.workerConfig - 当前 worker 配置
    // ctx.workspacePath - 工作空间路径

    await ctx.stepWise.execPrompt(
      '为 $name 生成测试用例，位于 $path',
      { data: ctx.item }
    );
  });
}

processItems();
```

**带环境变量的并发处理：**

```typescript
import { setTaskName, forEachParallel, WorkerConfig } from 'stepwise';

async function processWithEnv() {
  setTaskName('EnvParallelTask');

  const items = [/* ... */];

  // 每个 Worker 使用不同的环境变量
  const workerConfigs: WorkerConfig[] = [
    { branchName: 'Worker1', env: ['API_PORT=3001', 'DB_NAME=test1'] },
    { branchName: 'Worker2', env: ['API_PORT=3002', 'DB_NAME=test2'] }
  ];

  await forEachParallel(items, workerConfigs, async (ctx) => {
    await ctx.stepWise.execPrompt('处理任务', { data: ctx.item });
  });
}

processWithEnv();
```

---

## 任务恢复

### 从中断点恢复

```typescript
import { setTaskName, setResumePath, StepWise } from 'stepwise';

async function analyzeProject() {
  // 恢复模式：设置要恢复的任务目录
  setResumePath('AnalyzeProject_20260315_143000_123');

  // 新任务模式：只设置任务名称
  // setTaskName('AnalyzeProject');
  setTaskName('AnalyzeProject');

  const agent = new StepWise('analyzer');

  // 步骤 1: 分析项目结构
  await agent.execPrompt('分析项目目录结构，识别主要模块');

  // 步骤 2: 收集组件
  const components = await agent.execCollectPrompt(
    '收集项目中所有的 React 组件',
    {
      name: { type: 'string', description: '组件名称' },
      file: { type: 'string', description: '所在文件' }
    }
  );

  // 步骤 3: 处理每个组件
  for (const comp of components.data) {
    await agent.execPrompt(
      '为组件 $name 生成使用文档',
      { data: comp }
    );
  }

  // 步骤 4: 生成报告
  await agent.execReport(
    '基于分析结果，生成项目组件分析报告',
    {
      summary: { type: 'string', description: '总体概述' },
      statistics: { type: 'object', description: '统计数据' }
    },
    'report.json'
  );
}

analyzeProject();
```

---

## 调试模式

调试模式下，收集任务只返回第一条数据，适合验证流程：

```typescript
import { setTaskName, enableDebugMode, StepWise } from 'stepwise';

async function debugFlow() {
  // 启用调试模式（全局函数）
  enableDebugMode(true);
  setTaskName('DebugExample');

  const agent = new StepWise('debugger');

  // 收集任务只返回第一条数据
  const result = await agent.execCollectPrompt(
    '收集所有的函数定义',
    {
      name: { type: 'string', description: '函数名' },
      file: { type: 'string', description: '文件路径' }
    }
  );

  console.log('调试模式数据量:', result.data.length);  // 1

  // 禁用调试模式
  enableDebugMode(false);
}

debugFlow();
```

---

## 配置选项

### 跳过 Summarize

```typescript
import { setTaskName, setSkipSummarize, StepWise } from 'stepwise';

async function main() {
  setTaskName('SkipSummarizeTask');
  // 跳过 summarize 阶段，加快执行速度
  setSkipSummarize(true);

  const agent = new StepWise('myAgent');
  await agent.execPrompt('执行任务');
}

main();
```

### 设置智能体类型

```typescript
import { setTaskName, setAgentType, StepWise } from 'stepwise';

async function main() {
  setTaskName('AgentTypeTask');
  // 设置智能体类型
  setAgentType('claude');

  const agent = new StepWise('myAgent');
  await agent.execPrompt('执行任务');
}

main();
```

### 保存和加载收集数据

```typescript
import { setTaskName, saveCollectData, loadCollectData, StepWise } from 'stepwise';

async function manageData() {
  setTaskName('DataManagement');

  // 保存收集数据（全局函数）
  const data = [{ name: 'item1' }, { name: 'item2' }];
  saveCollectData(data, 'my_data.json');

  // 加载收集数据（全局函数）
  const loaded = loadCollectData('my_data.json');
  console.log('加载的数据:', loaded);
}

manageData();
```

---

## 最佳实践

### 1. 合理拆分任务

```typescript
// 推荐：按逻辑步骤拆分
await agent.execPrompt('分析项目结构');           // 步骤 1
const data = await agent.execCollectPrompt(...);  // 步骤 2
for (const item of data.data) {
  await agent.execPrompt('处理 $name', { data: item });  // 步骤 3+
}

// 不推荐：一个大任务完成所有工作
await agent.execPrompt('分析项目结构，收集数据，处理数据，生成报告...');
```

### 2. 自动去重

```typescript
// 第一个必填字段自动用于去重
const format: OutputFormat = {
  name: { type: 'string', description: '项目名称' },  // 自动用于去重
  value: { type: 'number', description: '项目值' }
};
```

### 3. 善用调试模式

```typescript
// 开发阶段启用调试模式，快速验证流程
enableDebugMode(true);

// 生产环境禁用
enableDebugMode(false);
```

### 4. 监控任务进度

```typescript
setTaskName('MyTask');
const agent = new StepWise('myAgent');

console.log('任务目录:', agent.getTaskDir());
console.log('已执行任务数:', agent.getTaskCounter());
```

### 5. 使用 checkPrompt 验证结果

```typescript
const result = await agent.execCollectPrompt(
  '收集 API 定义',
  format,
  {
    checkPrompt: '检查收集结果是否完整，补充遗漏的 API'
  }
);
```