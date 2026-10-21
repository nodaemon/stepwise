# API 文档

本文档详细介绍 StepWise 的所有 API 接口。

---

## 目录

- [全局函数](#全局函数)
  - [initTask](#inittasktaskname-string-resumepath-string-void)
  - [setTaskName](#settasknametaskname-string-void)
  - [setResumePath](#setresumepathpath-string-void)
  - [enableDebugMode](#enabledebugmodeenabled-boolean-void)
  - [setSkipSummarize](#setskipsummarizeskip-boolean-void)
  - [saveCollectData](#savecollectdatadata-recordstring-any-filename-string-void)
  - [loadCollectData](#loadcollectdatafilename-string-recordstring-any)
  - [setAgentType](#setagenttypetype-agenttype-void)
  - [setAllowRead](#setallowreadpaths-string-void)
  - [setAllowWrite](#setallowwritepaths-string-void)
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

### initTask(taskName: string, resumePath?: string): void

初始化任务,合并 taskName 与可选 resumePath,消除 `setTaskName`/`setResumePath` 的调用顺序依赖。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| taskName | string | 任务名称,建议使用英文和下划线 |
| resumePath | string (可选) | 恢复路径(任务目录名)。指定时为恢复模式,复用旧任务目录 |

**行为**

- resumePath 指定时:复用旧任务目录(恢复模式,跳过已完成步骤、重执行中断步骤)
- resumePath 省略时:生成时间戳新目录
- 必须在创建 StepWise 实例之前调用
- TaskName 会全局注册,不能与 StepWise 名称重复

**示例**

```typescript
import { initTask } from 'stepwise';

// 新任务
initTask('AnalyzeCodebase');
// 创建目录: stepwise_exec_infos/AnalyzeCodebase_20260307_103000_123/

// 从历史目录恢复（替代 setResumePath + setTaskName）
initTask('AnalyzeCodebase', 'AnalyzeCodebase_20260307_103000_123');
```

---

### setTaskName(taskName: string): void

> **已废弃**:推荐使用 {@link initTask}。

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

> **已废弃**:推荐使用 {@link initTask}(传 resumePath 参数)。

设置恢复路径，从指定任务目录恢复执行。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| path | string | 任务目录名称（不含完整路径） |

**行为**

- 必须在 `setTaskName()` 之前调用（`setTaskName` 会读取 resumePath 决定是否生成新目录）；
  `initTask` 内部已保证此顺序,推荐改用 `initTask`
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
- 每个 AI 任务步骤执行成功后，自动追加一次**自检复盘**（见下）
- 用于快速验证流程

**自检复盘**

开启调试模式后，`execPrompt` / `execCollectPrompt` / `execCheckPrompt` / `execReport` /
`execPromptSchema` 每成功执行一步，框架会**新开一个会话**，把这一步的
`prompt.txt`、`output.txt`、`verbose_output.txt` 交给一个独立的第三方审查者，
复盘四个维度：目标是否清晰、输入信息是否缺失、输入信息是否冗余、
工具调用与思考是否走了弯路。

因为运行在全新会话中，审查者对原过程没有任何记忆，只能依据上述文件判断；
同时提示词强制要求**每条结论逐字引用原文**，引用不到就不输出，以避免编造。
没有问题的维度会在报告中整节省略。

**产物位置**

```
stepwise_exec_infos/<任务名>_<时间戳>/<Agent名>_<时间戳>/
├── logs/
│   ├── 1_collect/                ← 被审查的步骤
│   │   ├── prompt.txt            ← 证据
│   │   ├── output.txt            ← 证据
│   │   ├── verbose_output.txt    ← 证据
│   │   ├── command.sh / execution_info.json / usage.json
│   │   └── self_check.md         ← 自检报告（与 output.txt 同级）
│   └── 1_self_check/             ← 审查者自身的执行日志
```

报告文件名固定为 `self_check.md`。审查者的执行日志放在独立的 `1_self_check/`
目录：它需要读取 `verbose_output.txt`，若共用目录会把自己的读取记录追加进这份
证据文件，同时会覆盖父任务的 `command.sh` 等产物。

**注意事项**

- 自检失败不会中断主流程，只在 `execute.log` 中记录
- 自检不占用任务序号，也不写入 `progress.json`，不影响断点恢复
- 自检耗时在 `performance.txt` 中以 `selfCheck` 类型单独统计
- 断点恢复重跑时，报告会覆盖为最新结果，审查者日志追加到上次的 `1_self_check/`

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

保存收集的数据到磁盘。

**参数**

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| data | Record<string, any>[] | - | 要保存的数据数组 |
| fileName | string | 'collect_data.json' | 文件名或路径。绝对路径直接使用；相对路径/纯文件名相对当前工作目录 cwd 解析 |

**示例**

```typescript
import { saveCollectData } from 'stepwise';

// 相对路径：相对 cwd 解析
saveCollectData(result.data, 'my_data.json');

// 绝对路径：直接使用
saveCollectData(result.data, '/abs/path/my_data.json');
```

---

### loadCollectData(fileName?: string): Record<string, any>[]

从磁盘加载收集的数据。

**参数**

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| fileName | string | 'collect_data.json' | 文件名或路径。绝对路径直接读取；相对路径/纯文件名相对当前工作目录 cwd 解析 |

**返回值**

| 类型 | 描述 |
|------|------|
| Record<string, any>[] | 数据数组，文件不存在时返回空数组 |

**示例**

```typescript
import { loadCollectData } from 'stepwise';

// 相对路径：相对 cwd 解析
const data = loadCollectData('my_data.json');

// 绝对路径：直接读取
const data = loadCollectData('/abs/path/my_data.json');
```

---

### setAgentType(type: AgentType): void

设置智能体类型，决定使用哪个智能体执行任务。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| type | AgentType | 智能体类型：`'claude'`、`'opencode'`、`'codeagent'`、`'pi'` 或 `'mcode'` |

**行为**

- 应在 `setTaskName()` 之前调用
- 同一任务内所有 Agent 使用相同智能体类型
- 默认使用 `'claude'`（Claude Code 智能体）
- `'codeagent'` 的命令行参数和输出格式与 `'claude'` 完全一致，仅可执行程序名（`codeagent`）不同。CodeAgent 的配置目录默认为 `~/.cac`，可通过 `CODEAGENT3_CONFIG_DIR` 环境变量覆盖
- `'pi'` 使用 Pi 智能体（`@earendil-works/pi-coding-agent`）；纯文本输出，无需权限标志，session 通过 `--session-id` 自动判断创建/恢复。Pi 的配置目录默认为 `~/.pi/agent`，可通过 `PI_CODING_AGENT_DIR` 环境变量覆盖
- `'mcode'` 使用 mcode 智能体（Minimax Code，`@minimax-ai/code`），以 `mcode exec --output-format stream-json` 无头执行。需要先完成 `mcode login`。**会话 ID 由 mcode 自行分配**（形如 `mvs_<hex>`），恢复时框架会把它写回 `progress.json`，因此断点续跑与崩溃恢复正常；**不支持 fork**（`sessionId` + `newSession:true` 会直接抛错），也不支持跨目录（worktree）复用主仓库会话

**示例**

```typescript
import { setTaskName, setAgentType } from 'stepwise';

// 使用 OpenCode 智能体
setAgentType('opencode');
setTaskName('MyTask');

// 使用 CodeAgent 智能体（参数与 claude 基本一致，另额外携带 --skip-safe-check）
setAgentType('codeagent');
setTaskName('MyTask');

// 使用 mcode 智能体（Minimax Code）
setAgentType('mcode');
setTaskName('MyTask');

// 或使用默认的 Claude Code 智能体
setAgentType('claude'); // 可省略，默认就是 claude
setTaskName('MyTask');
```

---

### setAllowRead(paths: string[]): void

设置全局允许读取的目录路径列表。所有 StepWise 实例和所有步骤都会受到此限制。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| paths | string[] | 允许读取的目录路径列表。支持相对路径和 `~` 展开。 |

**示例**

```typescript
import { setTaskName, setAllowRead } from 'stepwise';

setTaskName('MyTask');

// 只允许读取项目源码和文档目录
setAllowRead(['/project/src', '/project/docs', '~/shared/config']);
```

---

### setAllowWrite(paths: string[]): void

设置全局允许写入的目录路径列表。所有 StepWise 实例和所有步骤都会受到此限制。

**参数**

| 参数 | 类型 | 描述 |
|------|------|------|
| paths | string[] | 允许写入的目录路径列表。支持相对路径和 `~` 展开。 |

**示例**

```typescript
import { setTaskName, setAllowWrite } from 'stepwise';

setTaskName('MyTask');

// 只允许写入工作区目录
setAllowWrite(['/workspace']);
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
  sessionId?: string;        // 指定已有会话 ID 直接复用（强制 resume 模式）；与 newSession:true 同时指定为 fork 语义
  data?: Record<string, any>; // 变量替换数据
  postCheckPrompt?: string;  // 主任务完成后执行的检查提示词
  env?: string[];            // 额外的环境变量数组，格式为 "KEY=VALUE"
  validateOptions?: ValidateOptions; // JSON 输出校验选项
  allowRead?: string[];      // 允许读取的目录路径列表，支持相对路径和 ~ 展开
  allowWrite?: string[];     // 允许写入的目录路径列表，支持相对路径和 ~ 展开
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
  tokenUsage?: TokenUsage; // token 消耗与 AI 耗时（仅 Claude/CodeAgent/mcode；Pi/OpenCode 为 undefined）
}
```

**TokenUsage**

```typescript
interface TokenUsage {
  inputTokens: number;         // 输入 token 数
  outputTokens: number;        // 输出 token 数
  cacheCreationTokens: number; // 缓存创建 token 数
  cacheReadTokens: number;     // 缓存读取 token 数
  costUsd: number;             // 总成本（美元）
  durationMs: number;          // 总耗时（毫秒），来自 Claude result.duration_ms
  durationApiMs: number;       // 纯 API 耗时（毫秒），来自 Claude result.duration_api_ms
}
```

`tokenUsage` 仅由基于 NDJSON 的执行器（Claude/CodeAgent/mcode）上报；Pi/OpenCode 为 `undefined`。存在时会按步导出到 `logs/<N_task>/usage.json`（结构：`{ taskIndex, sessionId, duration, tokenUsage }`）。

**提示词下发方式**

提示词经 **stdin 管道**下发给 agent CLI，**不进入命令行参数**：

```sh
cat '<abs>/logs/<N_task>/prompt.txt' | claude --dangerously-skip-permissions --verbose --output-format stream-json --session-id <uuid> -p
```

Linux 对单个 argv 字符串的硬上限是 128 KiB（`MAX_ARG_STRLEN`），提示词若作为命令行参数传递，
超长时 `spawn` 会直接失败并报 `E2BIG`（Argument list too long）；管道则没有该限制。

提示词在任务日志目录内**按类型分开记录**，互不覆盖：任务本体记在 `prompt.txt`，
后检查记在 `post_check_prompt.txt`，会话末尾总结记在 `summarize_prompt.txt`，
输出校验重试记在 `file_missing_prompt.txt` / `validation_fix_prompt.txt`。
`command.sh` 引用其中与本次执行对应的那一份，因此复现的一定是同一次执行。
运行时另有一个固定名的 stdin 临时文件供各执行统一使用，子进程退出后即被删除，目录里不留残留。

`execution_info.json` 记录 `promptDelivery: "stdin"` 与 `promptLogFile` 路径，
`args` 中不再内嵌提示词。

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

#### execPromptSchema(prompt: string, schema: JsonSchemaDef, outputFile: string, options?: ExecOptions): Promise\<SchemaResult\>

执行 Schema 驱动任务：AI 按用户定义的 JSON Schema 输出 JSON，支持任意嵌套与递归树形结构。

**参数**

| 参数 | 类型 | 说明 |
|------|------|------|
| prompt | string | 提示词内容，支持变量替换 |
| schema | JsonSchemaDef | Schema 定义（见 `JsonSchemaDef` 类型）。顶层 `type` 可为 `object`、`array`、`string`、`number`、`boolean` |
| outputFile | string | 输出文件名（保存到任务的 `report/` 目录，所有 agent 共享） |
| options | ExecOptions | 执行选项（可选） |

**Schema（JsonSchemaDef）**

```typescript
interface JsonSchemaDef {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  /** type === 'object'：字段定义，每个字段又是 JsonSchemaDef，支持任意嵌套 */
  properties?: Record<string, JsonSchemaDef>;
  /** type === 'object'：必填字段名列表；不指定时默认所有字段必填 */
  required?: string[];
  /** type === 'array'：数组元素结构，本身又是 JsonSchemaDef（与 prefixItems 互斥） */
  items?: JsonSchemaDef;
  /** type === 'array'：元组定义（与 items 互斥）。按位置定义每个元素的类型，
      分量可为任意 type；数组长度必须严格等于 prefixItems.length（固定长度元组）。
      分量不可定义 recursive/recursiveFields/maxDepth（分量内可用独立递归树） */
  prefixItems?: JsonSchemaDef[];
  /** 固定值约束（仅 type === 'string' | 'number' | 'boolean' 时有效）：
      输出中该字段的值必须严格等于 const 指定的值 */
  const?: string | number | boolean;
  /** 仅 type === 'object' 时有效：标记为递归树形结构 */
  recursive?: boolean;
  /** 仅 recursive === true 时有效：自引用的数组字段名列表（必须为 array 类型，仅允许 type/description） */
  recursiveFields?: string[];
  /** 仅 recursive === true 时有效：递归最大深度，默认 3，范围 1~10 */
  maxDepth?: number;
  /** 仅顶层有效：可复用子结构定义，对应 JSON Schema 标准 $defs；组件可互相 ref（允许自引用），禁止循环引用（构建期检测） */
  defs?: Record<string, JsonSchemaDef>;
  /** JSON Pointer 引用（如 '#/$defs/Dependency'）；含 ref 的字段上仅允许 ref + description，其它字段出现即构建期抛异常 */
  ref?: string;
}
```

**递归树形结构**：在 object 上设置 `recursive: true` 后，将其自引用的数组字段列入 `recursiveFields`。框架自动把这些字段的 `items` 填充为自引用结构。超过 `maxDepth` 的节点成为叶子，递归字段为空数组。

**元组（prefixItems）**：`type: 'array'` 时用 `prefixItems` 代替 `items` 定义固定长度元组——按位置声明每个元素的类型，数组长度必须严格等于 `prefixItems.length`。分量可为任意 type（含 object/array），但分量本身不可标记 `recursive`（分量内的嵌套字段可以用独立递归树）。与 `items` 互斥。

**固定值（const）**：基础类型字段（string/number/boolean）可加 `const` 约束，输出值必须严格等于该值。常用于固定节点名、固定标签。

**可复用子结构（defs / ref）**：同一段子结构被多处引用时，在顶层 `defs` 里定义一次（框架映射为 JSON Schema 标准 `$defs`），引用处只写 `{ ref: '#/$defs/<组件名>' }`（映射为 `$ref`）。prompt 中组件全文只渲染一次、引用点保留 `$ref` 标记由模型按名回查展开——10 字段子结构 × 10 处引用，实测约 10000 → 700 tokens（-93%）。组件内 `items: { ref: '#/$defs/TreeNode' }` 自引用即无限深度递归树，可替代 `recursive`/`maxDepth` 逐层展开。校验由 AJV 8 原生完成，错误路径仍指向展开后的真实位置（如 `/wbs/0/id`）。

**defs / ref 边界规则**（均在构建期校验，prompt 发出之前立即暴露）：

- `ref` 节点仅允许 `ref` + `description`（AJV 中 `type` 与 `$ref` 是 AND 语义，不可混写）
- `ref` 必须指向顶层 `defs` 中已定义的组件；组件内不允许再定义 `defs`
- 组件间循环引用抛异常并附引用链（`A -> B -> A`）；组件引用自身合法
- `recursive` 与 `ref`/`defs` 不能在同一 schema 节点混用，需改用 defs 自引用
- 嵌套层的 `defs` 被忽略并 `console.warn`（仅顶层 schema 的 `defs` 有效）

> 去重渲染（内部函数 `expandRefs`）与构建期校验（内部函数 `validateRefsAndDefs`）由框架在调用 `execPromptSchema` 时自动完成，**不从 `stepwise` 包导出**，不列入下方「导出的 Schema 工具函数」清单。用户无需手动调用。

**输出位置**：保存到 TaskName 目录的 `report/` 子目录（所有 agent 共享），文件名为 `outputFile`。

**SchemaResult**

```typescript
interface SchemaResult extends ExecutionResult {
  data: unknown; // 类型由 schema.type 决定：object→单个对象，array→数组，标量→对应基础类型
}
```

**示例（基础版）**

```typescript
const result = await agent.execPromptSchema(
  '生成项目概览（单个对象）',
  {
    type: 'object',
    properties: {
      name: { type: 'string', description: '项目名' },
      version: { type: 'string', description: '版本' },
      dependencies: { type: 'array', items: { type: 'string', description: '依赖名' } }
    }
  },
  'project_overview.json'
);
// result.data 为生成的对象
```

**示例（递归树）**

```typescript
const result = await agent.execPromptSchema(
  '生成本项目的目录树',
  {
    type: 'object',
    recursive: true,
    recursiveFields: ['children'],
    maxDepth: 5,
    properties: {
      name: { type: 'string', description: '文件或目录名' },
      type: { type: 'string', description: "'file' 或 'directory'" },
      children: { type: 'array', description: '子条目（递归定义）' }
    }
  },
  'dir_tree.json'
);
// result.data 为树根；深度超过 maxDepth 的节点 children 为空数组
```

**示例（元组 + 固定值：固定骨架的树）**

```typescript
// 2/3 之下的递归树节点
const treeNode: JsonSchemaDef = {
  type: 'object',
  recursive: true,
  recursiveFields: ['children'],
  maxDepth: 3,
  properties: {
    name: { type: 'string' },
    children: { type: 'array' }
  }
};

const result = await agent.execPromptSchema(
  '生成固定骨架的树：根节点名为 "1"，恰好两个子节点 "2"、"3"，其下递归展开',
  {
    type: 'object',
    properties: {
      name: { type: 'string', const: '1' },          // 固定为 "1"
      children: {
        type: 'array',
        prefixItems: [                               // 恰好两个子节点
          {
            type: 'object',
            properties: {
              name: { type: 'string', const: '2' },
              children: { type: 'array', items: treeNode }   // 独立递归树
            }
          },
          {
            type: 'object',
            properties: {
              name: { type: 'string', const: '3' },
              children: { type: 'array', items: treeNode }
            }
          }
        ]
      }
    }
  },
  'fixed_tree.json'
);
```

**示例（defs 复用 + 自引用递归树）**

```typescript
const result = await agent.execPromptSchema(
  '生成 WBS 工作树与风险树',
  {
    type: 'object',
    description: '项目分析',
    defs: {
      TreeNode: {
        type: 'object',
        description: '树节点',
        properties: {
          id: { type: 'string', description: '节点编号' },
          children: { type: 'array', description: '子节点', items: { ref: '#/$defs/TreeNode' } }
        }
      }
    },
    properties: {
      wbs: { type: 'array', description: '工作树', items: { ref: '#/$defs/TreeNode' } },
      riskTree: { ref: '#/$defs/TreeNode', description: '风险树' }
    }
  },
  'wbs.json'
);
// prompt 中 TreeNode 全文只出现一次，wbs / riskTree 处为 $ref 标记
// 校验错误路径指向展开位置，如 /wbs/0/id
```

**导出的 Schema 工具函数**（来自 `stepwise`）：

```typescript
// Schema 构建与检查
buildJsonSchema(format: OutputFormat): JsonSchema
getFirstRequiredField(format: OutputFormat): string | null
getRequiredFields(format: OutputFormat): string[]
checkDuplicateKeys(...): ...
validateAgainstSchema(...): ...
formatValidationErrors(errors: SchemaValidationError[]): string

// 递归 Schema 校验与转换
convertToAjvSchema(schema: JsonSchemaDef): JsonSchema
unrollRecursiveSchema(schema: JsonSchemaDef): JsonSchema
validateRecursiveSchema(schema: JsonSchemaDef): void
validateJsonBySchema(...): ...
buildSchemaFixPrompt(...): string
generateSchemaExample(schema: JsonSchemaDef, currentDepth?: number): unknown
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
  env?: string[];      // 环境变量，格式 "KEY=VALUE"，会与 process.env 合并
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
  cwd: './project'    // 指定工作目录
});

// 使用环境变量
const result = await agent.execShell('npm run deploy', {
  env: ['NODE_ENV=production']
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
| options | ForEachParallelOptions | 并发处理选项，详见 ForEachParallelOptions 章节 |

**行为**

- 自动为每个 Worker 创建 git worktree
- 自动绑定 worker 标识
- 自动处理 Resume 逻辑
- 任务结束后**无条件**整合所有 Worker 的报告：把各 Worker 目录 `report/*.json` 中的数组按文件名合并到 `{TaskName 目录}/report/`（与 `skipBranchMerge` 无关，始终执行）
- 默认执行确定性收尾脚本：逐个 Worker 在 worktree 内 `git add -A` + `git commit --allow-empty`（注入 `stepwise@local` 身份）提交到自己的分支，随后 `git worktree remove` 删除 worktree，**分支保留**
- **不会把任何改动合并到主分支**（避免 AI 合并误删代码）；结束时会打印分支清单并提示按需手动 `git merge <分支名>` / `git branch -d <分支名>`
- 收尾全程为固定脚本、不依赖 AI，单个 Worker 失败只记录错误、不阻断整体

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

### ForEachParallelOptions

并发处理选项。

```typescript
interface ForEachParallelOptions {
  /**
   * 当发现已存在的 worktree 时，自动执行清理操作而无需用户确认
   * - true: 跳过用户确认，直接清理
   * - false 或 undefined: 提示用户确认（默认行为）
   * @default false
   */
  autoConfirmCleanup?: boolean;
  /**
   * 工作目录，指向 git 仓库根目录。
   * forEachParallel 将在该目录对应的 git 仓库中创建 worktree 并并行执行。
   * @default process.cwd()
   */
  cwd?: string;
  /**
   * 是否跳过收尾脚本（preserveWorkerBranches）。选项名为历史遗留：
   * 框架从不把改动合并到主分支，该开关实际控制的是「提交改动 + 删除 worktree」这一整段收尾。
   * - true: 跳过收尾——worktree 改动不提交，且 worktree 目录不会被删除，分支可能不含最新改动
   * - false 或 undefined: 执行收尾（默认）——把各 worktree 的改动提交到各自分支、保留分支、删除 worktree；不会合并到主分支
   * 注意：无论该开关取值如何，Worker 报告都会整合到 {TaskName 目录}/report/
   * @default false
   */
  skipBranchMerge?: boolean;
}
```

**使用示例**

```typescript
// 默认行为（需要用户确认）
await forEachParallel(items, workerConfigs, handler);

// 自动确认清理（无需用户交互）
await forEachParallel(items, workerConfigs, handler, { autoConfirmCleanup: true });

// 在 CI/CD 环境中使用
await forEachParallel(items, workerConfigs, handler, {
  autoConfirmCleanup: process.env.CI === 'true'
});
```

**cwd 示例**

```typescript
// 指定不同的 git 仓库作为工作目录
await forEachParallel(items, workerConfigs, handler, {
  cwd: '/path/to/other-repo'
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
type AgentType = 'claude' | 'opencode' | 'codeagent' | 'pi' | 'mcode';
```

- `'claude'`: 使用 Claude Code 智能体（默认）
- `'opencode'`: 使用 OpenCode 智能体
- `'codeagent'`: 使用 CodeAgent 智能体（命令行参数与 claude 基本一致，另额外携带 CodeAgent 独有的 --skip-safe-check）
- `'pi'`: 使用 Pi 智能体（`@earendil-works/pi-coding-agent`；纯文本输出，无需权限标志，session 通过 `--session-id` 自动判断创建/恢复）
- `'mcode'`: 使用 mcode 智能体（`@minimax-ai/code`；`mcode exec --output-format stream-json` 无头输出；会话 ID 由 mcode 自行分配，不支持 fork 与跨目录恢复）

---

### ExecOptions

执行选项。

```typescript
interface ExecOptions {
  cwd?: string;              // 工作目录
  newSession?: boolean;      // 是否使用新会话（默认: false）
  sessionId?: string;        // 指定已有会话 ID 直接复用（强制 resume 模式）；与 newSession:true 同时指定为 fork 语义
  data?: Record<string, any>; // 变量替换数据
  postCheckPrompt?: string;  // 主任务完成后执行的检查提示词
  env?: string[];            // 额外的环境变量数组，格式为 "KEY=VALUE"
  validateOptions?: ValidateOptions; // JSON 输出校验选项
  allowRead?: string[];      // 允许读取的目录路径列表，支持相对路径和 ~ 展开
  allowWrite?: string[];     // 允许写入的目录路径列表，支持相对路径和 ~ 展开
}
```

**指定会话 ID（sessionId）**

`sessionId` 允许显式复用一个已知的会话 ID，而非由框架生成或复用上一个任务的 ID。适用于跨 StepWise 实例或跨进程恢复某个会话的场景。

- 指定后，agent 以 resume 模式执行（`--resume <sessionId>`），即视为恢复一个已存在的会话
- 与 `newSession: true` 同时指定时为 **fork 语义**：从指定 sessionId 派生一个新会话（原会话保留，新会话独立），底层用 `--resume <sessionId> --fork-session`（Claude/CodeAgent）、`--session <sessionId> --fork`（OpenCode）或 `--fork <sessionId> --session-id <新ID>`（Pi，预先指定派生 ID）
- 不能为空字符串
- 不指定时行为不变（按 `newSession` 复用上一个会话或创建新会话）

> **fork 后的 sessionId**：fork 会派生一个新 session ID。执行成功后，派生出的新 ID 会被记录到 `progress.json` 和 `currentSessionId`（而非原 sessionId）。

> **fork 中断恢复**：fork 执行期间，派生的新 ID 一旦从子进程输出（system/init 块）即被实时写入 `progress.json`。因此即使 fork 步骤中断，`setResumePath` 恢复时也会用派生 ID 续传（`--resume <派生ID>`），不会重新派生。恢复命中该步骤的 in_progress 记录时，历史派生 ID 优先于再次传入的 `sessionId`+`newSession`。
>
> **OpenCode 限制**：OpenCode 的派生 ID 仅在执行结束后通过 `session list` 可取，无法在执行中途获取。故 OpenCode 的 fork 步骤若中断，恢复时会重新派生新 ID（无法续传原派生分支）。Claude/CodeAgent 不受此限。此外，OpenCode 仅当 sessionId 为 `ses_` 前缀时才附加 `--session`/`--fork`；非 `ses_` 前缀的 sessionId 会导致 `--fork` 被忽略并打印警告（fork 不生效）。

> **mcode 不支持 fork**：mcode 自行分配会话 ID（形如 `mvs_<hex>`，调用方无法指定），没有从已有会话派生新会话的能力，因此 `sessionId` + `newSession: true` 在 mcode 下会**直接抛错**而非静默降级。同时 mcode 硬性校验会话的 `workspaceDir` 必须与 `--cwd` 一致，故也无法跨目录（worktree）复用主仓库会话。

**文件访问限制**

`allowRead` 和 `allowWrite` 通过提示词约束限制 AI agent 的文件访问范围。

- 不设置（默认）：无限制
- 设置后：agent 只能访问指定目录

**合并规则**：全局级别（通过 `setAllowRead()` / `setAllowWrite()` 设置）与步骤级别（通过 `ExecOptions` 设置）按维度合并：
- 步骤级别指定了某维度 → 步骤覆盖全局
- 步骤级别未指定 → 继承全局

**路径规范化**：支持相对路径（基于 cwd 解析）、`~`（展开为主目录）、`..` 和 `./`（自动解析）。重复路径会自动去重。

**使用示例**

```typescript
import { setTaskName, setAllowWrite, StepWise } from 'stepwise';

setTaskName('MyTask');

// 全局：所有 agent 只能写入 workspace
setAllowWrite(['/path/to/workspace']);

// 步骤级别：覆盖全局的 allowWrite
await stepWise.execPrompt(prompt, {
  allowWrite: ['/path/to/workspace/src']
});
```

---

### ValidateOptions

JSON 输出校验选项。

```typescript
interface ValidateOptions {
  enabled?: boolean;   // 是否启用校验，默认 true
  maxRetries?: number; // 最大重试次数，默认 3
  retryOnFileMissing?: boolean; // 输出文件不存在时是否触发重试，默认 true
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
  /** 可复用子结构定义（语义同 JsonSchemaDef.defs） */
  defs?: Record<string, PropertyDef>;
  /** JSON Pointer 引用（如 '#/$defs/Dependency'），语义同 JsonSchemaDef.ref */
  ref?: string;
}
```

**关键特性：**

- `required` 未指定时默认为 `true`
- 第一个必填字段自动用于去重
- 自动生成 JSON Schema 用于 AI 引导
- `OutputFormat` 是扁平结构、无顶层容器位置：`defs` 挂在任一字段上，框架会合并进生成的 `$defs`（多字段同名时后者覆盖并 `console.warn`）
- `array` 字段携带的 defs 组件按「数组元素」语义包装为 `{ type: 'array', items: ... }`，使属性层 `$ref` 解析后可直接校验数组数据

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
  tokenUsage?: TokenUsage; // token 消耗与 AI 耗时（仅 Claude/CodeAgent/mcode；Pi/OpenCode 为 undefined）
}
```

---

### TokenUsage

token 消耗与 AI 耗时。仅由基于 NDJSON 的执行器（Claude/CodeAgent）上报；Pi/OpenCode 为 `undefined`。存在时会按步导出到 `logs/<N_task>/usage.json`（结构：`{ taskIndex, sessionId, duration, tokenUsage }`）。

```typescript
interface TokenUsage {
  inputTokens: number;         // 输入 token 数
  outputTokens: number;        // 输出 token 数
  cacheCreationTokens: number; // 缓存创建 token 数
  cacheReadTokens: number;     // 缓存读取 token 数
  costUsd: number;             // 总成本（美元）
  durationMs: number;          // 总耗时（毫秒），来自 Claude result.duration_ms
  durationApiMs: number;       // 纯 API 耗时（毫秒），来自 Claude result.duration_api_ms
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
  env?: string[];      // 环境变量，格式 "KEY=VALUE"
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
type TaskType = 'task' | 'collect' | 'process' | 'process_collect' | 'report' | 'check' | 'summarize' | 'shell' | 'schema';
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
    ├── logs/                               # 任务级日志
    │   ├── performance.json                # 性能统计（单步执行 ≥3s 时自动写出）
    │   └── performance.txt                 # 可读的性能报告
    │                                        #   （每步展示 总耗时/任务耗时/重试等待耗时 三项耗时）
    ├── {agent-name}_{timestamp2}/          # StepWise Agent 目录
    │   ├── data/                           # 执行状态
    │   │   └── progress.json
    │   ├── logs/                           # 执行日志
    │   │   ├── 1_task/
    │   │   │   ├── prompt.txt              # 任务提示词（本次实际下发的提示词）
    │       │   │   │   ├── command.sh              # 复现脚本（POSIX shell，可直接执行）
    │   │   │   ├── output.txt              # 标准输出摘要
    │   │   │   ├── verbose_output.txt      # 详细输出（AI思考过程、工具调用等）★关键调试文件
    │   │   │   ├── debug.log               # 调试日志
    │   │   │   ├── post_check_prompt.txt   # 后检查提示词（如有）
    │   │   │   ├── execution_info.json     # 执行信息
    │   │   │   └── usage.json              # token 用量与 AI 耗时（Claude/CodeAgent/mcode，有则写出）
    │   │   ├── 2_collect/
    │   │   │   ├── ...（同上）
    │   │   └── execute.log                 # 执行汇总日志
    │   └── collect/                        # 收集数据
    │       ├── 2_collect/
    │       └── 3_check/
    └── ...
```

**verbose_output.txt 说明**：
- 记录 AI 的完整思考过程、工具调用、返回结果等详细信息
- 是分析执行过程、调试问题的最关键文件
- 当有 postCheckPrompt 时，会在文件末尾追加后检查的输出（带分隔标记）
- 每个输出块的首行附加实时时间戳前缀，形如 `[YYYY-MM-DD HH:mm:ss.SSS]`，标记子进程输出该块的时刻。`stderr` 行标记为 `[stderr]`（同样附加时间戳），便于区分输出与错误流

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
const MAX_PROBE_ATTEMPTS = 10; // 429 探测恢复：最大探测次数（探测耗尽不抛错）
const PROBE_TIMEOUT_MS = 30000; // 429 探测恢复：单次探测超时（毫秒）
```