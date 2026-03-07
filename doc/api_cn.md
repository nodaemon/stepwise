# API 文档

本文档详细介绍 StepWise 的所有 API 接口。

---

## 目录

- [全局函数](#全局函数)
  - [setTaskName](#settasknametaskname-string-void)
  - [setResumePath](#setresumepathpath-string-void)
  - [enableDebugMode](#enabledebugmodeenabled-boolean-void)
  - [saveCollectData](#savecollectdatadata-recordstring-any-filename-string-void)
  - [loadCollectData](#loadcollectdatafilename-string-recordstring-any)
- [StepWise 类](#stepwise-类)
  - [构造函数](#构造函数)
  - [任务执行方法](#任务执行方法)
  - [总结方法](#总结方法)
  - [辅助方法](#辅助方法)
- [类型定义](#类型定义)

---

## 全局函数

用于配置和数据管理的全局函数。

### setTaskName(taskName: string): void

设置任务名称，用于生成任务目录。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| taskName | string | 任务名称，建议使用英文和下划线 |

**行为**

- 必须在创建 StepWise 实例之前调用
- TaskName 会全局注册，不能与 StepWise 名称重复
- 空 taskName 会报错并退出

**示例**

```typescript
import { setTaskName } from 'stepwise';

setTaskName('AnalyzeCodebase');
// 创建目录: stepwise_exec_infos/AnalyzeCodebase_20260307_103000_123/
```

---

### setResumePath(path: string): void

设置恢复路径，从指定任务目录恢复执行。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| path | string | 任务目录名称（不含完整路径） |

**行为**

- 设置后，已完成的任务会被跳过
- 中断的任务会重新执行
- 找不到 Agent 目录时会报错退出

**示例**

```typescript
import { setResumePath } from 'stepwise';

// 从历史目录恢复
setResumePath('AnalyzeCodebase_20260307_103000_123');
```

---

### enableDebugMode(enabled?: boolean): void

启用或禁用调试模式。

**参数**

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| enabled | boolean | true | 是否启用调试模式 |

**调试模式行为**

- 收集任务的提示词添加"只收集1条数据"的说明
- 返回结果只包含第一条数据
- 用于快速验证流程

**示例**

```typescript
import { enableDebugMode } from 'stepwise';

enableDebugMode(true);  // 启用
enableDebugMode(false); // 禁用
enableDebugMode();      // 启用（默认）
```

---

### saveCollectData(data: Record<string, any>[], fileName?: string): void

保存收集的数据到磁盘（存储在当前工作目录 cwd）。

**参数**

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| data | Record<string, any>[] | - | 要保存的数据数组 |
| fileName | string | 'collect_data.json' | 文件名 |

**示例**

```typescript
import { saveCollectData } from 'stepwise';

saveCollectData(result.data, 'my_data.json');
```

---

### loadCollectData(fileName?: string): Record<string, any>[]

从磁盘加载收集的数据（从当前工作目录 cwd 读取）。

**参数**

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| fileName | string | 'collect_data.json' | 文件名 |

**返回值**

| 类型 | 描述 |
|------|------|
| Record<string, any>[] | 数据数组，文件不存在时返回空数组 |

**示例**

```typescript
import { loadCollectData } from 'stepwise';

const data = loadCollectData('my_data.json');
```

---

## StepWise 类

提供核心任务编排功能的主类。

### 构造函数

```typescript
new StepWise(name: string)
```

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| name | string | 唯一的 Agent 名称 |

**行为**

- 创建 StepWise 前必须先设置 TaskName
- 名称不能与 TaskName 或其他 StepWise 名称重复
- 首次创建时打印启动信息

**示例**

```typescript
import { StepWise, setTaskName } from 'stepwise';

setTaskName('MyTask');
const agent = new StepWise('MainAgent');
```

---

### 任务执行方法

#### execPrompt(prompt: string, options?: ExecOptions): Promise\<ExecutionResult\>

执行普通任务。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| prompt | string | 提示词内容，支持 `$变量名` 替换 |
| options | ExecOptions | 执行选项（可选） |

**ExecOptions**

```typescript
interface ExecOptions {
  cwd?: string;           // 工作目录，默认当前进程目录
  newSession?: boolean;   // 是否使用新会话，默认 false（复用上一个会话）
  data?: Record<string, any>; // 变量替换数据
}
```

**变量替换**

在提示词中使用 `$变量名` 格式，通过 `options.data` 提供变量值：

```typescript
const prompt = '分析这个函数的复杂度: $name 在 $file 中';
const options = { data: { name: 'getUser', file: 'src/user.ts' } };
// 实际执行的提示词:
// 分析这个函数的复杂度: getUser 在 src/user.ts 中
```

**ExecutionResult**

```typescript
interface ExecutionResult {
  sessionId: string;    // 会话 ID
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
  console.log('成功:', result.output);
}
```

---

#### execCollectPrompt(prompt: string, outputFormat: OutputFormat, options?: ExecOptions): Promise\<CollectResult\>

执行收集任务，收集数据并保存为 JSON 文件。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| prompt | string | 提示词内容，支持变量替换 |
| outputFormat | OutputFormat | 输出格式定义 |
| options | ExecOptions | 执行选项（可选） |

**OutputFormat**

```typescript
interface OutputFormat {
  primaryKey?: string;  // 主键，用于去重
  keys: OutputKey[];    // 输出字段列表
}

interface OutputKey {
  name: string;        // 字段名
  description: string; // 字段描述
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
}
```

**输出位置**

输出文件自动生成为 `collect_{taskIndex}.json`，保存在 Agent 的 collect 目录下。

**CollectResult**

```typescript
interface CollectResult extends ExecutionResult {
  data: Record<string, any>[]; // 收集的数据
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
      { name: 'file', description: '文件位置', type: 'string' },
      { name: 'properties', description: '属性列表', type: 'array' }
    ]
  }
);

console.log(`收集到 ${result.data.length} 个接口`);
```

---

#### execCheckPrompt(prompt: string, options?: ExecOptions): Promise\<CheckResult\>

执行检查任务，返回布尔结果（true/false）。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| prompt | string | 检查问题/提示词，支持变量替换 |
| options | ExecOptions | 执行选项（可选） |

**输出位置**

输出文件自动保存为 `check_result.json`，保存在 Agent 的 check 目录下。

**CheckResult**

```typescript
interface CheckResult extends ExecutionResult {
  result: boolean; // 检查结果: true 或 false
}
```

**示例**

```typescript
const result = await agent.execCheckPrompt(
  '检查项目是否有完善的单元测试'
);

if (result.success && result.result) {
  console.log('检查通过');
}
```

---

#### execReport(prompt: string, outputFormat: OutputFormat, outputFileName: string, options?: ExecOptions): Promise\<CollectResult\>

执行报告任务，生成汇总报告。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| prompt | string | 提示词内容，支持变量替换 |
| outputFormat | OutputFormat | 输出格式定义 |
| outputFileName | string | 输出文件名 |
| options | ExecOptions | 执行选项（可选） |

**输出位置**

输出保存到 TaskName 目录的 `report/` 子目录（所有 Agent 共享）。

**示例**

```typescript
await agent.execReport(
  '根据收集的数据生成项目 API 分析报告',
  {
    keys: [
      { name: 'title', description: '报告标题', type: 'string' },
      { name: 'summary', description: '摘要', type: 'string' },
      { name: 'recommendations', description: '建议', type: 'array' }
    ]
  },
  'api_report.json'
);
```

---

### 总结方法

#### summarize(options?: SummarizeOptions): Promise\<SummarizeResult\>

总结当前会话的经验，生成技能文件。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| options | SummarizeOptions | 总结选项（可选） |

**SummarizeOptions**

```typescript
interface SummarizeOptions {
  cwd?: string;          // 工作目录，默认当前进程目录
  customPrompt?: string; // 自定义提示词，覆盖默认的总结提示词
}
```

**行为**

- 使用当前会话 ID 回顾所有已完成的工作
- 在 `.claude/skills/` 目录下生成 SKILL.md 文件
- 在独立的 `summarize_{timestamp}` 目录下创建日志
- 不增加任务序号

**自动总结**

当任何执行方法传入 `newSession: true` 时，创建新会话前会自动总结前一个会话。

**输出位置**

技能文件保存到：`{cwd}/.claude/skills/{skill_name}/SKILL.md`

**SKILL.md 文件格式**

```markdown
# [技能名称]

## 描述
[一句话描述该技能解决的问题]

## 使用场景
- 场景1：[描述]
- 场景2：[描述]

## 执行步骤
1. [第一步]
2. [第二步]
3. ...
```

**SummarizeResult**

```typescript
interface SummarizeResult extends ExecutionResult {
  skillFiles: string[]; // 生成的 SKILL.md 文件路径列表
}
```

**示例**

```typescript
// 最后主动总结
const result = await agent.summarize();
console.log('生成的技能文件:', result.skillFiles);

// 使用自定义提示词
const result = await agent.summarize({
  customPrompt: '只关注错误处理模式'
});
```

**自动总结示例**

```typescript
const agent = new StepWise('MainAgent');

await agent.execPrompt('任务1');                    // 会话 A
await agent.execPrompt('任务2');                    // 复用会话 A
await agent.execPrompt('任务3', {newSession: true}); // 总结 A → 创建会话 B
await agent.execPrompt('任务4');                    // 复用会话 B

// 最后总结会话 B
await agent.summarize();
```

---

### 辅助方法

#### getAgentDir(): string

获取当前 Agent 目录路径。

**返回值**

| 类型 | 描述 |
|------|------|
| string | Agent 目录的绝对路径 |

---

#### getTaskDir(): string

获取当前任务目录路径（TaskName 目录）。

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
| number | 已执行的任务数量 |

---

#### getCurrentSessionId(): string

获取当前用于执行任务的会话 ID。

**返回值**

| 类型 | 描述 |
|------|------|
| string | 当前会话 ID，如果尚未初始化则为空字符串 |

---

## 类型定义

### ExecOptions

执行选项。

```typescript
interface ExecOptions {
  cwd?: string;                    // 工作目录
  newSession?: boolean;            // 是否使用新会话（默认: false）
  data?: Record<string, any>;      // 变量替换数据
  checkPrompt?: string;            // 主任务完成后执行的检查提示词
}
```

### OutputFormat

输出格式定义。

```typescript
interface OutputFormat {
  primaryKey?: string;  // 主键（可选）
  keys: OutputKey[];    // 输出字段列表
}
```

### OutputKey

输出字段定义。

```typescript
interface OutputKey {
  name: string;        // 字段名
  description: string; // 字段描述
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
}
```

### ExecutionResult

执行结果。

```typescript
interface ExecutionResult {
  sessionId: string;    // 会话 ID
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
  data: Record<string, any>[]; // 收集的数据
}
```

### CheckResult

检查任务结果。

```typescript
interface CheckResult extends ExecutionResult {
  result: boolean; // 检查结果: true 或 false
}
```

### TaskStatus

任务状态。

```typescript
interface TaskStatus {
  taskIndex: number;    // 任务序号
  taskName: string;     // 任务名称
  sessionId: string;    // 会话 ID
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
type TaskType = 'task' | 'collect' | 'check' | 'report' | 'summarize';
```

### SummarizeOptions

总结选项。

```typescript
interface SummarizeOptions {
  cwd?: string;          // 工作目录
  customPrompt?: string; // 自定义提示词，覆盖默认的总结提示词
}
```

### SummarizeResult

总结结果。

```typescript
interface SummarizeResult extends ExecutionResult {
  skillFiles: string[]; // 生成的 SKILL.md 文件路径列表
}
```

---

## 目录结构

```
stepwise_exec_infos/
└── {task-name}_{timestamp1}/              # TaskName 目录
    ├── report/                             # 报告输出（execReport）
    ├── {agent-name}_{timestamp2}/          # StepWise Agent 目录
    │   ├── data/                           # 执行状态
    │   │   └── progress.json
    │   ├── logs/                           # 执行日志
    │   │   ├── 1_task/
    │   │   ├── 2_collect/
    │   │   └── execute.log
    │   └── collect/                        # 收集数据
    │       ├── 2_collect/
    │       └── 3_check/
    └── ...
```

**目录命名规则**：
- TaskName 目录：`{taskName}_{YYYYMMDD}_{HHmmss}_{毫秒}`
- StepWise Agent 目录：`{agentName}_{YYYYMMDD}_{HHmmss}_{毫秒}`

**时间戳格式说明**：
- 格式：`20260307_103000_123`（年月日_时分秒_毫秒）
- 精确到毫秒，减少命名冲突

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
