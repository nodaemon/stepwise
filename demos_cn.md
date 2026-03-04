# 使用示例

本文档提供 StepWise 的完整使用示例。

---

## 目录

- [基础示例](#基础示例)
- [数据收集与处理](#数据收集与处理)
- [任务恢复](#任务恢复)
- [调试模式](#调试模式)
- [完整项目示例](#完整项目示例)

---

## 基础示例

### 执行单个任务

```typescript
import { StepWise } from 'stepwise';

async function main() {
  const agent = new StepWise();

  // 设置任务名称
  agent.setTaskName('SimpleTask');

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

### 带会话恢复的任务

```typescript
import { StepWise } from 'stepwise';

async function main() {
  const agent = new StepWise();
  agent.setTaskName('SessionExample');

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

---

## 数据收集与处理

### 收集 API 接口

```typescript
import { StepWise, OutputFormat } from 'stepwise';

async function collectAPIs() {
  const agent = new StepWise();
  agent.setTaskName('CollectAPIs');

  const outputFormat: OutputFormat = {
    primaryKey: 'name',
    keys: [
      { name: 'name', description: 'API 名称', type: 'string' },
      { name: 'method', description: 'HTTP 方法 (GET/POST/PUT/DELETE)', type: 'string' },
      { name: 'path', description: 'API 路径', type: 'string' },
      { name: 'description', description: '功能描述', type: 'string' },
      { name: 'params', description: '请求参数', type: 'array' }
    ]
  };

  const result = await agent.execCollectPrompt(
    `请遍历项目中的所有源代码文件，收集所有的 API 接口定义。
    包括 Express 路由、Fastify 路由或其他 HTTP 框架的路由定义。`,
    outputFormat,
    'apis.json'
  );

  console.log(`收集到 ${result.data.length} 个 API 接口`);

  // 打印前 5 个
  result.data.slice(0, 5).forEach(api => {
    console.log(`- ${api.method} ${api.path}: ${api.name}`);
  });

  return result.data;
}

collectAPIs();
```

### 批量处理数据

```typescript
import { StepWise } from 'stepwise';

async function processAPIs(apis: any[]) {
  const agent = new StepWise();
  agent.setTaskName('ProcessAPIs');

  for (const api of apis) {
    const result = await agent.execProcessData(
      `为以下 API 生成详细的接口文档：

      API 名称: $name
      HTTP 方法: $method
      路径: $path
      描述: $description

      请生成 Markdown 格式的文档，包括：
      1. 接口说明
      2. 请求参数说明
      3. 响应格式说明
      4. 示例请求和响应`,
      api
    );

    if (result.success) {
      console.log(`已生成 ${api.name} 的文档`);
    }
  }
}

// 假设 apis 是之前收集的数据
// processAPIs(apis);
```

### 处理并收集结果

```typescript
import { StepWise, OutputFormat } from 'stepwise';

async function generateTests(apis: any[]) {
  const agent = new StepWise();
  agent.setTaskName('GenerateTests');

  const outputFormat: OutputFormat = {
    primaryKey: 'apiName',
    keys: [
      { name: 'apiName', description: 'API 名称', type: 'string' },
      { name: 'testFile', description: '测试文件路径', type: 'string' },
      { name: 'testCases', description: '测试用例列表', type: 'array' }
    ]
  };

  for (const api of apis) {
    await agent.execProcessDataAndCollect(
      `为以下 API 生成单元测试用例：

      API 名称: $name
      HTTP 方法: $method
      路径: $path

      使用 Jest 测试框架，生成至少 3 个测试用例：
      1. 正常情况测试
      2. 边界情况测试
      3. 错误情况测试`,
      api,
      outputFormat,
      'test_cases.json'
    );

    console.log(`已为 ${api.name} 生成测试用例`);
  }

  // 加载所有测试用例
  const allTests = agent.loadCollectData('test_cases.json');
  console.log(`共生成 ${allTests.length} 个 API 的测试用例`);
}

// generateTests(apis);
```

---

## 任务恢复

### 从中断点恢复

假设你有一个长时间运行的任务，执行到一半被中断：

```typescript
import { StepWise } from 'stepwise';

async function analyzeProject() {
  const agent = new StepWise();

  // 恢复模式：设置要恢复的任务目录
  // agent.setResumePath('AnalyzeProject_2026_03_03_14_30_00');

  // 新任务模式：设置任务名称
  agent.setTaskName('AnalyzeProject');

  // 步骤 1: 分析项目结构
  await agent.execPrompt('分析项目目录结构，识别主要模块');

  // 步骤 2: 收集组件
  const components = await agent.execCollectPrompt(
    '收集项目中所有的 React 组件',
    {
      primaryKey: 'name',
      keys: [
        { name: 'name', description: '组件名称', type: 'string' },
        { name: 'file', description: '所在文件', type: 'string' },
        { name: 'props', description: 'Props 类型定义', type: 'object' }
      ]
    },
    'components.json'
  );

  // 步骤 3: 处理每个组件
  for (const comp of components.data) {
    await agent.execProcessData(
      '为组件 $name 生成使用文档和示例代码',
      comp
    );
  }

  // 步骤 4: 生成报告
  await agent.execReport(
    '基于分析结果，生成项目组件分析报告',
    {
      keys: [
        { name: 'summary', description: '总体概述', type: 'string' },
        { name: 'statistics', description: '统计数据', type: 'object' },
        { name: 'recommendations', description: '优化建议', type: 'array' }
      ]
    },
    'report.json'
  );
}

analyzeProject();
```

**恢复执行**

如果任务在步骤 3 执行到一半被中断：

```typescript
async function resumeProject() {
  const agent = new StepWise();

  // 设置恢复路径（中断的任务目录）
  agent.setResumePath('AnalyzeProject_2026_03_03_14_30_00');

  // 重新执行相同的代码
  // 已完成的任务会自动跳过
  await agent.execPrompt('分析项目目录结构，识别主要模块');  // 跳过

  const components = await agent.execCollectPrompt(
    '收集项目中所有的 React 组件',
    { /* ... */ },
    'components.json'
  );  // 跳过，从磁盘读取数据

  // 从中断的组件继续处理
  for (const comp of components.data) {
    await agent.execProcessData(
      '为组件 $name 生成使用文档和示例代码',
      comp
    );  // 部分跳过，从中断点继续
  }

  await agent.execReport(
    '基于分析结果，生成项目组件分析报告',
    { /* ... */ },
    'report.json'
  );  // 新任务，正常执行
}

resumeProject();
```

---

## 调试模式

### 快速验证流程

调试模式下，收集任务只返回第一条数据，适合验证任务流程是否正确：

```typescript
import { StepWise } from 'stepwise';

async function debugFlow() {
  const agent = new StepWise();

  // 启用调试模式
  agent.enableDebugMode(true);
  agent.setTaskName('DebugExample');

  // 收集任务只返回第一条数据
  const result = await agent.execCollectPrompt(
    '收集所有的函数定义',
    {
      keys: [
        { name: 'name', description: '函数名', type: 'string' },
        { name: 'file', description: '文件路径', type: 'string' }
      ]
    },
    'functions.json'
  );

  // 调试模式：只返回第一条
  console.log('调试模式数据量:', result.data.length);  // 1

  // 禁用调试模式，获取完整数据
  agent.enableDebugMode(false);
  const fullData = agent.loadCollectData('functions.json');
  console.log('完整数据量:', fullData.length);
}

debugFlow();
```

---

## 完整项目示例

### 代码审查工具

```typescript
import { StepWise, OutputFormat } from 'stepwise';

/**
 * 自动代码审查工具
 * 1. 收集所有源文件
 * 2. 分析代码质量
 * 3. 生成审查报告
 */
class CodeReviewer {
  private agent: StepWise;

  constructor() {
    this.agent = new StepWise();
  }

  async review(projectPath: string, resumePath?: string) {
    // 设置恢复路径或新任务
    if (resumePath) {
      this.agent.setResumePath(resumePath);
    } else {
      this.agent.setTaskName('CodeReview');
    }

    // 步骤 1: 分析项目结构
    console.log('步骤 1: 分析项目结构...');
    await this.agent.execPrompt(
      `分析 ${projectPath} 的项目结构，识别：
      - 项目类型（前端/后端/全栈）
      - 使用的主要框架和库
      - 目录组织方式`
    );

    // 步骤 2: 收集需要审查的文件
    console.log('步骤 2: 收集源文件...');
    const filesResult = await this.agent.execCollectPrompt(
      `收集 ${projectPath} 中所有需要审查的源文件，
      排除 node_modules、dist、build 等目录。
      重点关注 .ts, .tsx, .js, .jsx 文件。`,
      {
        primaryKey: 'path',
        keys: [
          { name: 'path', description: '文件路径', type: 'string' },
          { name: 'type', description: '文件类型', type: 'string' },
          { name: 'lines', description: '代码行数', type: 'number' }
        ]
      },
      'source_files.json'
    );

    console.log(`发现 ${filesResult.data.length} 个源文件`);

    // 步骤 3: 审查每个文件
    console.log('步骤 3: 审查代码...');
    const reviewFormat: OutputFormat = {
      primaryKey: 'filePath',
      keys: [
        { name: 'filePath', description: '文件路径', type: 'string' },
        { name: 'score', description: '代码质量评分 (1-10)', type: 'number' },
        { name: 'issues', description: '发现的问题', type: 'array' },
        { name: 'suggestions', description: '改进建议', type: 'array' }
      ]
    };

    // 调试模式下只处理第一个文件
    const filesToProcess = this.agent.isDebugMode()
      ? filesResult.data.slice(0, 1)
      : filesResult.data;

    for (const file of filesToProcess) {
      console.log(`  审查: ${file.path}`);
      await this.agent.execProcessDataAndCollect(
        `审查文件 $path 的代码质量，检查：
        - 代码风格和规范
        - 潜在的 bug 和安全问题
        - 性能问题
        - 可维护性

        文件类型: $type
        代码行数: $lines`,
        file,
        reviewFormat,
        'review_results.json'
      );
    }

    // 步骤 4: 生成报告
    console.log('步骤 4: 生成报告...');
    await this.agent.execReport(
      '基于代码审查结果，生成项目代码质量报告',
      {
        keys: [
          { name: 'overallScore', description: '整体评分', type: 'number' },
          { name: 'summary', description: '总体评价', type: 'string' },
          { name: 'criticalIssues', description: '严重问题列表', type: 'array' },
          { name: 'recommendations', description: '改进建议', type: 'array' }
        ]
      },
      'review_report.json'
    );

    console.log('审查完成！');
    console.log('结果目录:', this.agent.getTaskDir());

    return this.agent.getTaskDir();
  }
}

// 使用示例
async function main() {
  const reviewer = new CodeReviewer();

  // 新任务
  await reviewer.review('/path/to/project');

  // 或者从断点恢复
  // await reviewer.review('/path/to/project', 'CodeReview_2026_03_03_14_30_00');
}

main();
```

### API 文档生成器

```typescript
import { StepWise } from 'stepwise';

/**
 * 自动生成 API 文档
 */
async function generateAPIDocs(projectPath: string) {
  const agent = new StepWise();
  agent.setTaskName('GenerateAPIDocs');

  // 1. 收集 API 定义
  const apis = await agent.execCollectPrompt(
    `遍历 ${projectPath}，收集所有 API 接口定义。
    支持 Express、Fastify、Koa 等框架。`,
    {
      primaryKey: 'id',
      keys: [
        { name: 'id', description: '唯一标识', type: 'string' },
        { name: 'name', description: '接口名称', type: 'string' },
        { name: 'method', description: 'HTTP 方法', type: 'string' },
        { name: 'path', description: '路径', type: 'string' },
        { name: 'handler', description: '处理函数', type: 'string' },
        { name: 'params', description: '参数定义', type: 'object' },
        { name: 'response', description: '响应格式', type: 'object' }
      ]
    },
    'api_definitions.json'
  );

  console.log(`发现 ${apis.data.length} 个 API`);

  // 2. 为每个 API 生成文档
  for (const api of apis.data) {
    await agent.execProcessData(
      `为 API $name 生成详细的接口文档（Markdown 格式）

      方法: $method
      路径: $path
      参数: $params
      响应: $response

      文档应包含：
      - 接口描述
      - 请求参数说明
      - 响应格式说明
      - 示例请求和响应
      - 错误码说明`,
      api
    );
  }

  // 3. 生成汇总文档
  await agent.execReport(
    '生成 API 文档目录和汇总',
    {
      keys: [
        { name: 'title', description: '文档标题', type: 'string' },
        { name: 'toc', description: '目录', type: 'array' },
        { name: 'overview', description: 'API 概览', type: 'string' }
      ]
    },
    'api_docs_index.json'
  );

  return agent.getTaskDir();
}

// generateAPIDocs('/path/to/project');
```

---

## 最佳实践

### 1. 合理拆分任务

```typescript
// 推荐：按逻辑步骤拆分
await agent.execPrompt('分析项目结构');           // 步骤 1
const data = await agent.execCollectPrompt(...);  // 步骤 2
for (const item of data) {
  await agent.execProcessData(...);               // 步骤 3+
}

// 不推荐：一个大任务完成所有工作
await agent.execPrompt('分析项目结构，收集数据，处理数据，生成报告...');
```

### 2. 使用主键去重

```typescript
// 使用 primaryKey 避免重复数据
const format = {
  primaryKey: 'name',  // 相同 name 的数据只保留最新一条
  keys: [/* ... */]
};
```

### 3. 善用调试模式

```typescript
// 开发阶段启用调试模式，快速验证流程
agent.enableDebugMode(true);

// 生产环境禁用
agent.enableDebugMode(false);
```

### 4. 保存关键数据

```typescript
// 定期保存中间结果
agent.saveCollectData(processedData, 'checkpoint.json');

// 需要时加载
const checkpoint = agent.loadCollectData('checkpoint.json');
```

### 5. 监控任务进度

```typescript
console.log('任务目录:', agent.getTaskDir());
console.log('已执行任务数:', agent.getTaskCounter());
```