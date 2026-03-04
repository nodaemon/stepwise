# API 文档

本文档详细介绍 StepWise 的所有 API 接口。

---

## 目录

- [StepWise 类](#stepwise-类)
  - [全局设置](#全局设置)
  - [任务执行](#任务执行)
  - [辅助方法](#辅助方法)
- [类型定义](#类型定义)
- [常量](#常量)

---

## StepWise 类

主类，提供任务编排的核心功能。

```typescript
import { StepWise } from 'stepwise';

const agent = new StepWise();
```

---

### 全局设置

#### setTaskName(taskName: string): void

设置任务名称，用于生成任务目录。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| taskName | string | 任务名称，建议使用英文和下划线 |

**示例**

```typescript
agent.setTaskName('AnalyzeCodebase');
// 生成目录: stepwise_exec_infos/AnalyzeCodebase_2026_03_03_10_30_00/
```

---

#### setResumePath(path: string): void

设置恢复路径，从指定任务目录恢复执行。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| path | string | 任务目录名称（不含完整路径） |

**行为说明**

- 设置后，已完成的任务会被跳过
- 中断的任务会重新执行
- 新任务继续追加

**示例**

```typescript
// 从历史目录恢复
agent.setResumePath('AnalyzeCodebase_2026_03_03_10_30_00');
```

---

#### enableDebugMode(enabled?: boolean): void

启用或禁用调试模式。

**参数**

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| enabled | boolean | true | 是否启用调试模式 |

**调试模式行为**

- 收集任务只返回第一条数据
- 用于快速验证任务流程

**示例**

```typescript
agent.enableDebugMode(true);  // 启用
agent.enableDebugMode(false); // 禁用
```

---

#### isDebugMode(): boolean

检查调试模式是否启用。

**返回值**

| 类型 | 描述 |
|------|------|
| boolean | 调试模式状态 |

---

### 任务执行

#### execPrompt(prompt: string, options?: ExecOptions): Promise\<ExecutionResult\>

执行普通任务。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| prompt | string | 提示词内容 |
| options | ExecOptions | 执行选项（可选） |

**ExecOptions**

```typescript
interface ExecOptions {
  cwd?: string;        // 工作目录，默认当前进程目录
  newSession?: boolean; // 是否使用新会话，默认 false（复用上一个会话）
}
```

**会话行为说明**

- `newSession: false`（默认）：复用上一个任务的 session id。如果没有上一个会话，则创建新的。
- `newSession: true`：创建新的 session id，开始一个新的对话上下文。

**ExecutionResult**

```typescript
interface ExecutionResult {
  sessionId: string;    // 会话ID
  output: string;       // 执行输出
  success: boolean;     // 是否成功
  error?: string;       // 错误信息
  timestamp: number;    // 执行时间戳
  duration: number;     // 执行耗时（毫秒）
}
```

**示例**

```typescript
const result = await agent.execPrompt('分析项目结构');

if (result.success) {
  console.log('执行成功:', result.output);
} else {
  console.error('执行失败:', result.error);
}
```

---

#### execCollectPrompt(prompt: string, outputFormat: OutputFormat, outputFileName: string, options?: ExecOptions): Promise\<CollectResult\>

执行收集任务，收集数据并保存为 JSON 文件。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| prompt | string | 提示词内容 |
| outputFormat | OutputFormat | 输出格式定义 |
| outputFileName | string | 输出文件名 |
| options | ExecOptions | 执行选项（可选） |

**OutputFormat**

```typescript
interface OutputFormat {
  primaryKey?: string;  // 主键，用于去重
  keys: OutputKey[];    // 输出键列表
}

interface OutputKey {
  name: string;        // 键名
  description: string; // 键描述
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
}
```

**CollectResult**

```typescript
interface CollectResult extends ExecutionResult {
  data: Record<string, any>[]; // 收集到的数据
}
```

**示例**

```typescript
const result = await agent.execCollectPrompt(
  '收集项目中所有的 TypeScript 接口定义',
  {
    primaryKey: 'name',
    keys: [
      { name: 'name', description: '接口名称', type: 'string' },
      { name: 'file', description: '所在文件', type: 'string' },
      { name: 'properties', description: '属性列表', type: 'array' }
    ]
  },
  'interfaces.json'
);

console.log(`收集到 ${result.data.length} 个接口`);
```

---

#### execProcessData(prompt: string, data: Record\<string, any\>, options?: ExecOptions): Promise\<ExecutionResult\>

执行处理任务，处理单条数据。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| prompt | string | 提示词模板，支持变量替换 |
| data | Record<string, any> | 数据对象 |
| options | ExecOptions | 执行选项（可选） |

**变量替换**

提示词中使用 `$变量名` 格式，会被替换为 data 中对应的值：

```typescript
// 提示词模板
const prompt = '分析以下函数的复杂度：函数名 $name，位于 $file';

// 数据
const data = { name: 'getUser', file: 'src/user.ts' };

// 实际执行的提示词
// 分析以下函数的复杂度：函数名 getUser，位于 src/user.ts
```

**示例**

```typescript
const items = [
  { name: 'login', path: '/api/login' },
  { name: 'logout', path: '/api/logout' }
];

for (const item of items) {
  await agent.execProcessData(
    '为以下 API 生成文档：$name ($path)',
    item
  );
}
```

---

#### execProcessDataAndCollect(prompt: string, data: Record\<string, any\>, outputFormat: OutputFormat, outputFileName: string, options?: ExecOptions): Promise\<CollectResult\>

执行处理任务并收集结果。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| prompt | string | 提示词模板 |
| data | Record<string, any> | 数据对象 |
| outputFormat | OutputFormat | 输出格式定义 |
| outputFileName | string | 输出文件名 |
| options | ExecOptions | 执行选项（可选） |

**示例**

```typescript
const apis = [
  { name: 'login', method: 'POST', path: '/api/login' },
  { name: 'logout', method: 'POST', path: '/api/logout' }
];

for (const api of apis) {
  await agent.execProcessDataAndCollect(
    '为 API $name 生成测试用例',
    api,
    {
      primaryKey: 'apiName',
      keys: [
        { name: 'apiName', description: 'API 名称', type: 'string' },
        { name: 'testCases', description: '测试用例', type: 'array' }
      ]
    },
    'test_cases.json'
  );
}
```

---

#### execReport(prompt: string, outputFormat: OutputFormat, outputFileName: string, options?: ExecOptions): Promise\<CollectResult\>

执行报告任务，生成汇总报告。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| prompt | string | 提示词内容 |
| outputFormat | OutputFormat | 输出格式定义 |
| outputFileName | string | 输出文件名 |
| options | ExecOptions | 执行选项（可选） |

**示例**

```typescript
await agent.execReport(
  '基于之前收集的数据，生成项目 API 分析报告',
  {
    keys: [
      { name: 'title', description: '报告标题', type: 'string' },
      { name: 'summary', description: '总结', type: 'string' },
      { name: 'recommendations', description: '建议列表', type: 'array' }
    ]
  },
  'api_report.json'
);
```

---

### 辅助方法

#### saveCollectData(data: Record\<string, any\>[], fileName?: string): void

保存收集的数据到磁盘。

**参数**

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| data | Record<string, any>[] | - | 数据数组 |
| fileName | string | 'collect_data.json' | 文件名 |

**示例**

```typescript
agent.saveCollectData(result.data, 'my_data.json');
```

---

#### loadCollectData(fileName?: string): Record\<string, any\>[]

从磁盘加载收集的数据。

**参数**

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| fileName | string | 'collect_data.json' | 文件名 |

**返回值**

| 类型 | 描述 |
|------|------|
| Record<string, any>[] | 数据数组，不存在时返回空数组 |

**示例**

```typescript
const data = agent.loadCollectData('my_data.json');
```

---

#### getTaskDir(): string

获取当前任务目录路径。

**返回值**

| 类型 | 描述 |
|------|------|
| string | 任务目录的绝对路径 |

---

#### getTaskCounter(): number

获取当前任务计数。

**返回值**

| 类型 | 描述 |
|------|------|
| number | 当前已执行的任务数量 |

---

#### getCurrentSessionId(): string

获取当前任务执行使用的 session id。

**返回值**

| 类型 | 描述 |
|------|------|
| string | 当前 session id，未初始化时返回空字符串 |

**示例**

```typescript
const sessionId = agent.getCurrentSessionId();
console.log('当前会话ID:', sessionId);
```

---

## 类型定义

### ExecOptions

执行选项。

```typescript
interface ExecOptions {
  cwd?: string;        // 工作目录
  newSession?: boolean; // 是否使用新会话（默认：false）
}
```

### OutputFormat

输出格式定义。

```typescript
interface OutputFormat {
  primaryKey?: string;  // 主键（可选）
  keys: OutputKey[];    // 输出键列表
}
```

### OutputKey

输出键定义。

```typescript
interface OutputKey {
  name: string;        // 键名
  description: string; // 键描述
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
}
```

### ExecutionResult

执行结果。

```typescript
interface ExecutionResult {
  sessionId: string;    // 会话ID
  output: string;       // 执行输出
  success: boolean;     // 是否成功
  error?: string;       // 错误信息
  timestamp: number;    // 执行时间戳
  duration: number;     // 执行耗时（毫秒）
}
```

### CollectResult

收集任务结果。

```typescript
interface CollectResult extends ExecutionResult {
  data: Record<string, any>[]; // 收集到的数据
}
```

### TaskStatus

任务状态。

```typescript
interface TaskStatus {
  taskIndex: number;    // 任务序号
  taskName: string;     // 任务名称
  sessionId: string;    // 会话ID
  status: TaskStatusType; // 状态
  timestamp: number;    // 时间戳
  taskType: TaskType;   // 任务类型
  outputFileName?: string; // 输出文件名
}
```

### TaskStatusType

任务状态类型。

```typescript
type TaskStatusType = 'pending' | 'in_progress' | 'completed';
```

### TaskType

任务类型。

```typescript
type TaskType = 'task' | 'collect' | 'process' | 'process_collect' | 'report';
```

---

## 常量

```typescript
// 目录名常量
const EXEC_INFO_DIR = 'stepwise_exec_infos';  // 执行信息根目录
const DATA_DIR = 'data';        // 数据目录
const LOGS_DIR = 'logs';        // 日志目录
const COLLECT_DIR = 'collect';  // 收集数据目录
const REPORT_DIR = 'report';    // 报告数据目录

// 文件名常量
const PROGRESS_FILE = 'progress.json'; // 进度文件
const EXECUTE_LOG = 'execute.log';     // 汇总日志文件

// 其他常量
const MAX_RETRIES = 3; // 最大重试次数
```