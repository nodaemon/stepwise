# API 文档

本文档详细介绍 StepWise 的所有 API 接口。

---

## 目录

- [全局函数](#全局函数)
  - [setTaskName](#settasknametaskname-string-void)
  - [setResumePath](#setresumepathpath-string-void)
  - [enableDebugMode](#enabledebugmodeenabled-boolean-void)
  - [setSkipSummarize](#setskipsummarizeskip-boolean-void)
  - [saveCollectData](#savecollectdatadata-recordstring-any-filename-string-void)
  - [loadCollectData](#loadcollectdatafilename-string-recordstring-any)
  - [setAgentType](#setagenttypetype-agenttype-void)
  - [getTaskDir](#gettaskdir-string)
  - [getReportPath](#getreportpathfilename-string-string)
- [StepWise 类](#stepwise-类)
  - [构造函数](#构造函数)
  - [任务执行方法](#任务执行方法)
  - [总结方法](#总结方法)
  - [辅助方法](#辅助方法)
- [并发处理](#并发处理)
  - [forEachParallel](#foreachparallelt-items-t-workerconfigs-workerconfig-handler-promisevoid-options-foreachparalleloptions-promisevoid)
  - [WorkerConfig](#workerconfig)
  - [WorkerContext](#workercontextt)
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

### setSkipSummarize(skip?: boolean): void

设置是否跳过 summarize（反思生成 skill）。

**参数**

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| skip | boolean | true | 是否跳过 summarize |

**行为**

- 设置后，所有会话结束时不会自动执行 summarize
- 适用于不需要生成技能文件的场景
- 可在任务执行过程中随时调用

**示例**

```typescript
import { setSkipSummarize } from 'stepwise';

setSkipSummarize(true);  // 跳过 summarize
setSkipSummarize(false); // 不跳过（默认行为）
setSkipSummarize();      // 跳过（默认）
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

### setAgentType(type: AgentType): void

设置智能体类型，决定使用哪个智能体执行任务。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| type | AgentType | 智能体类型：`'claude'` 或 `'opencode'` |

**行为**

- 应在 `setTaskName()` 之前调用
- 同一任务内所有 Agent 使用相同智能体类型
- 默认使用 `'claude'`（Claude Code 智能体）

**示例**

```typescript
import { setTaskName, setAgentType } from 'stepwise';

// 使用 OpenCode 智能体
setAgentType('opencode');
setTaskName('MyTask');

// 或使用默认的 Claude Code 智能体
setAgentType('claude'); // 可省略，默认就是 claude
setTaskName('MyTask');
```

---

### getTaskDir(): string

获取任务目录路径（Task 级别）。

**返回值**

| 类型 | 描述 |
|------|------|
| string | 任务目录的绝对路径 |

**示例**

```typescript
import { getTaskDir } from 'stepwise';

const taskDir = getTaskDir();
console.log('任务目录:', taskDir);
// 输出: /path/to/stepwise_exec_infos/MyTask_20260324_120000_123
```

---

### getReportPath(fileName: string): string

获取任务级别报告文件的绝对路径。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| fileName | string | 报告文件名（如 `"api_report.json"`） |

**返回值**

| 类型 | 描述 |
|------|------|
| string | 报告文件的绝对路径（文件可能不存在） |

**行为**

- 用于获取 `forEachParallel` 并行执行后，各 Agent 报告合并后的 Task 级别 report 目录路径
- 与 StepWise 实例的 `getReportPath` 方法功能相同，但可在不创建实例的情况下使用

**示例**

```typescript
import { getReportPath } from 'stepwise';

// 获取报告文件路径
const reportPath = getReportPath('api_report.json');
console.log('报告路径:', reportPath);
// 输出: /path/to/stepwise_exec_infos/MyTask_xxx/report/api_report.json

// 读取报告内容
if (fs.existsSync(reportPath)) {
  const content = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  console.log('报告数据:', content);
}
```

---

## StepWise 类

提供核心任务编排功能的主类。

### 构造函数

```typescript
new StepWise(name: string, defaultCwd?: string, defaultEnv?: string[], workerId?: string)
```

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| name | string | 唯一的 Agent 名称 |
| defaultCwd | string | 默认工作目录（可选），未指定则使用 process.cwd() |
| defaultEnv | string[] | 默认环境变量数组（可选），格式为 `["KEY=VALUE"]` |
| workerId | string | Worker 标识（可选），用于 forEachParallel 并发处理 |

**行为**

- 创建 StepWise 前必须先设置 TaskName
- 名称不能与 TaskName 或其他 StepWise 名称重复
- 首次创建时打印启动信息

**示例**

```typescript
import { StepWise, setTaskName } from 'stepwise';

setTaskName('MyTask');

// 基础用法
const agent = new StepWise('MainAgent');

// 指定默认工作目录
const agent2 = new StepWise('SubAgent', '/path/to/project');

// 指定默认工作目录和环境变量
const agent3 = new StepWise(
  'DataAgent',
  '/path/to/project',
  ['NODE_ENV=production', 'DEBUG=true']
);

// 完整参数（通常由 forEachParallel 内部使用）
const agent4 = new StepWise(
  'WorkerAgent',
  '/path/to/workspace',
  ['API_KEY=xxx'],
  'worker_1'
);
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
  cwd?: string;              // 工作目录，默认当前进程目录
  newSession?: boolean;      // 是否使用新会话，默认 false（复用上一个会话）
  data?: Record<string, any>; // 变量替换数据
  checkPrompt?: string;      // 主任务完成后执行的检查提示词
  env?: string[];            // 额外的环境变量数组，格式为 "KEY=VALUE"
  validateOptions?: ValidateOptions; // JSON 输出校验选项
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
interface PropertyDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;  // 字段描述
  required?: boolean;    // 是否必填，默认 true
}

// OutputFormat 直接映射字段名到 PropertyDef
type OutputFormat = Record<string, PropertyDef>;
```

**自动去重**

第一个 `required: true` 的字段（或未指定 `required` 时的第一个字段）自动用于去重。

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
// 第一个必填字段自动用于去重
const result = await agent.execCollectPrompt(
  '收集项目中所有的 TypeScript 接口定义',
  {
    name: { type: 'string', description: '接口名称' },
    file: { type: 'string', description: '文件位置' },
    properties: { type: 'array', description: '属性列表' },
    description: { type: 'string', description: '接口描述', required: false }
  }
);

// 'name' 自动作为去重键（第一个必填字段）

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
    title: { type: 'string', description: '报告标题' },
    summary: { type: 'string', description: '摘要' },
    recommendations: { type: 'array', description: '建议' }
  },
  'api_report.json'
);
```

---

#### execShell(command: string, options?: ShellOptions): Promise\<ShellResult\>

执行 Shell 命令，用于运行系统命令或脚本。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| command | string | Shell 命令内容 |
| options | ShellOptions | Shell 执行选项（可选） |

**ShellOptions**

```typescript
interface ShellOptions {
  cwd?: string;        // 工作目录，未指定则使用 process.cwd()
  timeout?: number;    // 超时时间（毫秒），默认 5 分钟 (300000ms)
  env?: Record<string, string>; // 环境变量，会与 process.env 合并
  retry?: boolean;     // 失败时是否自动重试，默认 false
  retryCount?: number; // 重试次数，默认 3 次
}
```

**ShellResult**

```typescript
interface ShellResult {
  stdout: string;    // 标准输出
  stderr: string;    // 标准错误输出
  exitCode: number;  // 退出码，0 表示成功
  success: boolean;  // 是否成功 (exitCode === 0)
  duration: number;  // 执行耗时（毫秒）
  taskIndex: number; // 任务序号
}
```

**行为**

- 命令执行过程会记录日志
- 支持断点恢复：已执行的命令会被跳过
- 超时后命令会被强制终止

**示例**

```typescript
// 基础用法
const result = await agent.execShell('npm run build');
console.log('成功:', result.success);
console.log('输出:', result.stdout);

// 带选项
const result = await agent.execShell('npm test', {
  timeout: 60000,     // 超时 60 秒
  cwd: './project',   // 指定工作目录
  retry: true,        // 失败时重试
  retryCount: 3       // 重试 3 次
});

// 使用环境变量
const result = await agent.execShell('npm run deploy', {
  env: { NODE_ENV: 'production' }
});
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
  env?: string[];        // 额外的环境变量数组，格式为 "KEY=VALUE"
}
```

**行为**

- 使用当前会话 ID 回顾所有已完成的工作
- 只有发现真正有价值的经验时才创建 SKILL.md 文件
- **质量优于数量**：如果没有值得总结的内容，直接完成而不创建文件
- 在 `.claude/skills/` 目录下生成 SKILL.md 文件
- 日志写入到 session 最后一个任务的目录中（自动总结）或单独目录（手动总结）
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

#### getReportPath(fileName: string): string

获取报告文件的绝对路径。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| fileName | string | 报告文件名（如 `"api_report.json"`） |

**返回值**

| 类型 | 描述 |
|------|------|
| string | 报告文件的绝对路径（文件可能不存在） |

**示例**

```typescript
// 生成报告
await agent.execReport(
  '分析项目中的所有 API 接口',
  format,
  'api_report.json'
);

// 获取报告文件路径
const reportPath = agent.getReportPath('api_report.json');
console.log('报告路径:', reportPath);
// 输出: /path/to/stepwise_exec_infos/TaskName_xxx/report/api_report.json

// 读取报告内容
if (fs.existsSync(reportPath)) {
  const content = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  console.log('数据:', content);
}
```

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

## 并发处理

用于并行处理多个任务的接口。

### forEachParallel\<T\>(items: T[], workerConfigs: WorkerConfig[], handler: (ctx: WorkerContext\<T\>) => Promise\<void\>, options?: ForEachParallelOptions): Promise\<void\>

并发处理数组元素，自动创建 git worktree 进行隔离。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| items | T[] | 要处理的数组 |
| workerConfigs | WorkerConfig[] | Worker 配置数组 |
| handler | (ctx: WorkerContext\<T\>) => Promise\<void\> | 处理函数 |
| options | ForEachParallelOptions | 选项（预留扩展） |

**行为**

- 自动为每个 Worker 创建 git worktree
- 自动绑定 worker 标识
- 自动处理 Resume 逻辑
- 任务完成后自动合并分支

**示例**

```typescript
import { setTaskName, forEachParallel, WorkerConfig } from 'stepwise';

setTaskName("my_task");

const workerConfigs: WorkerConfig[] = [
  { branchName: "Agent1" },
  { branchName: "Agent2" },
];

await forEachParallel(items, workerConfigs, async (ctx) => {
  // ctx.stepWise 默认在 ctx.workspacePath 下执行任务
  // 如需使用其他目录，可手动指定 cwd
  await ctx.stepWise.execPrompt("处理任务", {
    data: ctx.item,
  });
});
```

**使用环境变量配置**

```typescript
const workerConfigs: WorkerConfig[] = [
  { branchName: "Agent1", env: ["API_KEY=xxx", "NODE_ENV=test"] },
  { branchName: "Agent2", env: ["API_KEY=yyy", "NODE_ENV=production"] },
];

await forEachParallel(items, workerConfigs, async (ctx) => {
  // 每个 Worker 使用各自配置的环境变量执行任务
  await ctx.stepWise.execPrompt("调用 API 处理任务", {
    data: ctx.item,
  });
});
```

---

### WorkerConfig

Worker 配置，定义每个 worker 的分支名和环境变量。

```typescript
interface WorkerConfig {
  /** 分支名，用于创建 git worktree 和作为 worker 标识 */
  branchName: string;
  /** 环境变量数组，格式为 "KEY=VALUE" */
  env?: string[];
}
```

---

### WorkerContext\<T\>

Worker 上下文，框架提供给处理函数的所有信息。

```typescript
interface WorkerContext<T> {
  /** 当前处理的元素 */
  item: T;
  /** 元素在数组中的索引 */
  index: number;
  /** 当前 worker 配置 */
  workerConfig: WorkerConfig;
  /** 工作空间路径（git worktree 目录） */
  workspacePath: string;
  /** 已创建好的 StepWise 实例，名称为 index，自动绑定 workerId */
  stepWise: StepWise;
}
```

---

## 类型定义

### AgentType

智能体类型。

```typescript
type AgentType = 'claude' | 'opencode';
```

- `'claude'`: 使用 Claude Code 智能体（默认）
- `'opencode'`: 使用 OpenCode 智能体

---

### ExecOptions

执行选项。

```typescript
interface ExecOptions {
  cwd?: string;              // 工作目录
  newSession?: boolean;      // 是否使用新会话（默认: false）
  data?: Record<string, any>; // 变量替换数据
  checkPrompt?: string;      // 主任务完成后执行的检查提示词
  env?: string[];            // 额外的环境变量数组，格式为 "KEY=VALUE"
  validateOptions?: ValidateOptions; // JSON 输出校验选项
}
```

---

### ValidateOptions

JSON 输出校验选项。

```typescript
interface ValidateOptions {
  enabled?: boolean;   // 是否启用校验，默认 true
  maxRetries?: number; // 最大重试次数，默认 3
}
```

---

### OutputFormat

输出格式定义。

```typescript
// OutputFormat 直接映射字段名到 PropertyDef
type OutputFormat = Record<string, PropertyDef>;
```

---

### PropertyDef

输出字段定义。

```typescript
interface PropertyDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;  // 字段描述（可选）
  required?: boolean;    // 是否必填，默认 true
}
```

**关键特性：**

- `required` 未指定时默认为 `true`
- 第一个必填字段自动用于去重
- 自动生成 JSON Schema 用于 AI 引导

---

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

---

### CollectResult

收集任务结果。

```typescript
interface CollectResult extends ExecutionResult {
  data: Record<string, any>[]; // 收集的数据
}
```

---

### CheckResult

检查任务结果。

```typescript
interface CheckResult extends ExecutionResult {
  result: boolean; // 检查结果: true 或 false
}
```

---

### ShellOptions

Shell 执行选项。

```typescript
interface ShellOptions {
  cwd?: string;        // 工作目录
  timeout?: number;    // 超时时间（毫秒），默认 300000
  env?: Record<string, string>; // 环境变量
  retry?: boolean;     // 失败时是否重试，默认 false
  retryCount?: number; // 重试次数，默认 3
}
```

---

### ShellResult

Shell 执行结果。

```typescript
interface ShellResult {
  stdout: string;    // 标准输出
  stderr: string;    // 标准错误输出
  exitCode: number;  // 退出码，0 表示成功
  success: boolean;  // 是否成功
  duration: number;  // 执行耗时（毫秒）
  taskIndex: number; // 任务序号
}
```

---

### TaskStatus

任务状态。

```typescript
interface TaskStatus {
  taskIndex: number;       // 任务序号
  taskName: string;        // 任务名称
  sessionId: string;       // 会话 ID
  status: TaskStatusType;  // 状态
  timestamp: number;       // 时间戳
  taskType: TaskType;      // 任务类型
  outputFileName?: string; // 输出文件名（仅收集类任务）
  checkResult?: boolean;   // check 任务的结果（仅 check 类型任务）
  command?: string;        // Shell 命令内容（仅 shell 类型任务）
}
```

---

### TaskStatusType

任务状态类型。

```typescript
type TaskStatusType = 'pending' | 'in_progress' | 'completed';
```

---

### TaskType

任务类型。

```typescript
type TaskType = 'task' | 'collect' | 'process' | 'process_collect' | 'report' | 'check' | 'summarize' | 'shell';
```

---

### SummarizeOptions

总结选项。

```typescript
interface SummarizeOptions {
  cwd?: string;          // 工作目录
  customPrompt?: string; // 自定义提示词
  env?: string[];        // 额外的环境变量数组，格式为 "KEY=VALUE"
}
```

---

### SummarizeResult

总结结果。

```typescript
interface SummarizeResult extends ExecutionResult {
  skillFiles: string[]; // 生成的 SKILL.md 文件路径列表
}
```

---

### ValidationResult

校验结果。现在是 `SchemaValidationResult` 的类型别名。

```typescript
type ValidationResult<T = unknown> = SchemaValidationResult<T>;
```

详见 `SchemaValidationResult`。

---

### SchemaValidationError

Schema 校验错误详情，直接映射 AJV ErrorObject，保留完整的原始信息。

```typescript
interface SchemaValidationError {
  /** AJV 实例路径，如 "/0/name" */
  path: string;
  /** AJV 原始错误消息（英文） */
  message: string;
  /** AJV 错误关键字，如 'required'、'type'、'additionalProperties' 等 */
  keyword: string;
  /** AJV 错误参数 */
  params: Record<string, unknown>;
  /** 实际的数据值 */
  data: unknown;
}
```

**关键特性：**

- `path`：AJV 实例路径格式（如 `/0/name`），保留原始结构
- `message`：AJV 原始英文错误信息，比翻译更精确，AI 理解更准确
- `keyword`：标识错误类型（便于程序化处理）
- `params`：AJV 错误参数，包含额外的上下文信息
- `data`：错误位置的实际数据值

---

### SchemaValidationResult

Schema 校验结果。

```typescript
interface SchemaValidationResult<T> {
  valid: boolean;                  // 是否有效
  errors: SchemaValidationError[]; // 错误列表
  data?: T;                        // 解析后的数据（校验成功时）
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