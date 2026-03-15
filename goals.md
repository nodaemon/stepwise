# StepWise

StepWise 是一个高效构建具备稳定完成复杂代码任务智能体的工具。它提供造作多个Claude Code工具协作完成任务的能力，通过将复杂任务拆分为一个个可稳定完成的小任务，从而实现复杂任务的AI自主稳定处理。

## 实现思路

基于nodejs和ts语言实现一套能定制复杂代码任务处理流程的接口。用户可以调用接口定制处理流程，并为每一个步定制提示词。每一次提示词的执行交由ClaudeCode的AI编程智能体完成。可以使用ClaudeCode的无头模式调用来完成一个基础任务的执行:

```bash
# 1. 为每次任务生成一个合法不冲突的UUID，例如: 123e4567-e89b-12d3-a456-426614174000
# 2. 使用无头模式执行一个子任务，注意都需要使用 --dangerously-skip-permissions ，确保任务直接执行完成。
claude --dangerously-skip-permissions --session-id 123e4567-e89b-12d3-a456-426614174000  -p "当前的文件路径是什么"

# 3. 在历史子任务的上下文基础上再执行新的子任务：
claude --dangerously-skip-permissions --resume 123e4567-e89b-12d3-a456-426614174000  -p "你刚刚作了什么"

# 4. 生成新session id，在新的上下文上执行任务
claude --dangerously-skip-permissions --session-id 123e4567-e89b-12d3-a456-426614174001  -p "你刚刚作了什么"
```

## 接口及功能设计

### 全局设置接口

```typescript
// 设置任务名称，基于任务名称加时间生成任务目录
setTaskName(taskName: string): void

// 设置恢复路径，从指定任务目录恢复执行
// 例如：
//      对于任务 MyTask 生成了任务目录： MyTask_20260307_120000_123
//      执行完成：1-普通任务，2-收集任务（收集到5个数据）  3-处理任务1  4-处理任务2
//      执行 5- 处理任务3 时被用户主动中断
//      加上 setResumePath("MyTask_20260307_120000_123") 再次执行任务，执行任务1、2、3、4时可以从任务目录的历史记录中读取到已经完成，则直接跳过，直到任务5时重新执行。
setResumePath(path: string): void

// 启用/禁用调试模式
// 调试模式打开后，所有收集任务执行完成以后，在返回给用户前只返回第一个数据，方便快速调试
enableDebugMode(enabled?: boolean): void

// 设置是否跳过 summarize（反思生成 skill）
// 设置后，所有会话结束时不会自动执行 summarize
// 适用于不需要生成技能文件的场景
setSkipSummarize(skip?: boolean): void

// 保存收集的数据到磁盘（存储在当前工作目录cwd）
saveCollectData(data: Record<string, any>[], fileName?: string): void

// 从磁盘加载收集的数据（从当前工作目录cwd读取）
loadCollectData(fileName?: string): Record<string, any>[]

// 设置智能体类型，决定使用哪个智能体执行任务
// type: 'claude' 使用 Claude Code 智能体（默认）, 'opencode' 使用 OpenCode 智能体
// 应在 setTaskName() 之前调用
setAgentType(type: AgentType): void
```

### 任务管理类StepWise支持的接口

### 任务创建
```typescript
// 创建指定名字的任务
// 该对象上执行的Agent任务都存放在name + 时间戳命名的目录下。Agent任务又放在Task目录下
// TaskName必须设置，未设置TaskName直接新建StepWise则报错，提示用户设置TaskName
// 用户可以指定1个TaskName和多个StepWise Name，这些名字全局保存，不能有重复。出现重复后立即停止任务提示用户修改名字。
//时间戳精确到毫秒，格式：{YYYYMMDD}_{HHmmss}_{毫秒}
// defaultCwd: 默认工作目录，未指定则使用 process.cwd()
// defaultEnv: 默认环境变量数组，格式为 ["KEY=VALUE"]
// workerId: Worker 标识，用于 forEachParallel 并发处理
new StepWise(name: string, defaultCwd?: string, defaultEnv?: string[], workerId?: string)
```

### 启动打印
```
================================================================================
StepWise 任务启动
任务名称: {taskName}
任务目录: {taskName}_{timestamp}
恢复命令: setResumePath("{taskName}_{timestamp}")
================================================================================
```

### 错误提示

**名字重复错误**：
```
[错误] StepWise 名字重复: "{name}"
已存在重复的 StepWise 名字，请使用不同的名字区分
```

**未设置 TaskName 错误**：
```
[错误] TaskName 未设置
请先调用 setTaskName("your_task_name") 设置任务名称
```

**恢复失败错误**：
```
[错误] 无法恢复任务
找不到Agent 目录: {name}
恢复路径: {resumePath}
建议: 去掉 setResumePath() 调用，从头开始执行
```

### 串行任务

```typescript
// 使用claude执行提示词，cwd未指定则使用当前进程的cwd
// newSession 未指定或为 false: 复用上一个任务的 session id（如果没有则创建新的）
// newSession 为 true: 创建新的 session id
// 若指定data, 需要将prompt中$name $desc等变量替换成data中真实的key对应的value，然后执行提示词
// StepWise创建时打印StepWise开始的日志到控制台，说明名字和目录
// 若checkPrompt指定，需要再claude code调用完成后，使用--resume 再执行checkPrompt中的提示词，checkPrompt也支持data变量替换
// 返回本次执行的ExecutionResult中各个字段的信息
StepWise.execPrompt(prompt: string, options?: ExecOptions): Promise<ExecutionResult>
```

### 收集任务

```typescript
// 使用outputFormat和当前任务目录下的collect.json为输出文件生成额外提示词，确保claude执行输出的结果按照固定json数组方式输出，并写入到本地磁盘文件中。
// 额外提示词必须是中文，且明确告知文件已存在时追加合并，对于primary_key相同的数据需要去重。
// 除了普通的任务返回信息，还需要从磁盘读取生成的json数组，返回CollectResult中的data
// 注意checkPrompt的执行要在从磁盘读取json并返回之前，避免check时的修改，没有读到
// ExecOptions中的出参数支持与execPrompt保持一致
StepWise.execCollectPrompt(prompt: string, outputFormat: OutputFormat, options?: ExecOptions): Promise<CollectResult>
```

### 检查任务

```typescript
// 用户不用输入json格式的输出字段描述，输出的数据只有true/false
// 通过添加提示词要求AI输出到json文件中，然后再读取出来，返回CheckResult中的result
// ExecOptions中的出参数支持与execPrompt保持一致
// 输出格式为 { "result": true 或 false }
StepWise.execCheckPrompt(prompt: string, options?: ExecOptions): Promise<CheckResult>
```

### 报告任务

```typescript
// 使用outputFormat和outputFileName生成额外提示词，确保claude执行输出的结果按照固定json数组方式输出，并写入到本地磁盘文件中。
// 注意outputFile存放的路径为TaskName所在的目录，而不是StepWise子Agent所在的目录
// 额外提示词必须是中文，且明确告知文件已存在时追加合并，对于primary_key相同的数据需要去重。
// ExecOptions中的出参数支持与execPrompt保持一致
// 除了普通的任务返回信息，还需要从磁盘读取生成的json数组，返回CollectResult中的data
StepWise.execReport(prompt: string, outputFormat: OutputFormat, outputFileName: string, options?: ExecOptions): Promise<CollectResult>
```

### Shell 任务

```typescript
// 执行 Shell 命令，用于运行系统命令或脚本
// command: Shell 命令内容
// options: Shell 执行选项
//   - cwd: 工作目录，未指定则使用 process.cwd()
//   - timeout: 超时时间（毫秒），默认 5 分钟 (300000ms)
//   - env: 环境变量，会与 process.env 合并
//   - retry: 失败时是否自动重试，默认 false
//   - retryCount: 重试次数，默认 3 次
// 支持断点恢复：已执行的命令会被跳过
StepWise.execShell(command: string, options?: ShellOptions): Promise<ShellResult>
```

---

### 并发处理

```typescript
// 并发处理数组元素，自动创建 git worktree 进行隔离
// items: 要处理的数组
// workerConfigs: Worker 配置数组，定义每个 worker 的分支名和环境变量
// handler: 处理函数，接收 WorkerContext 上下文
// 自动为每个 Worker 创建 git worktree、绑定 worker 标识、处理 Resume 逻辑
forEachParallel<T>(
  items: T[],
  workerConfigs: WorkerConfig[],
  handler: (ctx: WorkerContext<T>) => Promise<void>,
  options?: ForEachParallelOptions
): Promise<void>
```

---

## 类型定义

```typescript
// 智能体类型
type AgentType = 'claude' | 'opencode';

// 执行选项
interface ExecOptions {
  cwd?: string;
  data?: Record<string, any>
  newSession?: boolean;  // true: 创建新 session; false/未指定: 复用上一个 session（默认）
  checkPrompt?: string;
  env?: string[];        // 额外的环境变量数组，格式为 "KEY=VALUE"
  validateOptions?: ValidateOptions; // JSON 输出校验选项
}

// JSON 输出校验选项
interface ValidateOptions {
  enabled?: boolean;   // 是否启用校验，默认 true
  maxRetries?: number; // 最大重试次数，默认 3
}

interface OutputFormat {
  primaryKey?: string;
  keys: OutputKey[];
}

interface OutputKey {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
}

interface ExecutionResult {
  sessionId: string;
  output: string;
  success: boolean;
  error?: string;
  timestamp: number;
  duration: number;
}

interface CollectResult extends ExecutionResult {
  data: Record<string, any>[];
}

// Shell 执行选项
interface ShellOptions {
  cwd?: string;        // 工作目录
  timeout?: number;    // 超时时间（毫秒），默认 300000
  env?: Record<string, string>; // 环境变量
  retry?: boolean;     // 失败时是否重试，默认 false
  retryCount?: number; // 重试次数，默认 3
}

// Shell 执行结果
interface ShellResult {
  stdout: string;    // 标准输出
  stderr: string;    // 标准错误输出
  exitCode: number;  // 退出码，0 表示成功
  success: boolean;  // 是否成功
  duration: number;  // 执行耗时（毫秒）
  taskIndex: number; // 任务序号
}

// 任务类型
type TaskType = 'task' | 'collect' | 'process' | 'process_collect' | 'report' | 'check' | 'summarize' | 'shell';

// 任务状态
interface TaskStatus {
  taskIndex: number;
  taskName: string;
  sessionId: string;
  status: TaskStatusType;
  timestamp: number;
  taskType: TaskType;
  outputFileName?: string; // 输出文件名（仅收集类任务）
  checkResult?: boolean;   // check 任务的结果（仅 check 类型任务）
  command?: string;        // Shell 命令内容（仅 shell 类型任务）
}

// 总结选项
interface SummarizeOptions {
  cwd?: string;
  customPrompt?: string;
  env?: string[];        // 额外的环境变量数组，格式为 "KEY=VALUE"
}

// Worker 配置
interface WorkerConfig {
  branchName: string;  // 分支名，用于创建 git worktree 和作为 worker 标识
  env?: string[];      // 环境变量数组，格式为 "KEY=VALUE"
}

// Worker 上下文
interface WorkerContext<T> {
  item: T;              // 当前处理的元素
  index: number;        // 元素在数组中的索引
  workerConfig: WorkerConfig; // 当前 worker 配置
  workspacePath: string; // 工作空间路径（git worktree 目录）
  stepWise: StepWise;   // 已创建好的 StepWise 实例
}
```

---

## 重要辅助功能

1. **日志记录**：详细记录所有StepWise子Agent任务的完整提示词、执行过程、执行结果、执行时间等等信息，方便任务执行出错时进行调试
   日志放在[StepWise子Agent目录]/logs下，按任务执行顺序命名日志目录
   例如：1_collect  2_process_and_collect  3_process ...
   另外生成一个汇总的execute.log

2. **重试机制**：Claude执行失败自动重试3次，3次都失败则退出进程。
   对于Coding Plan短期资源耗尽支持等待到资源恢复时间

3. **任务恢复**：执行到一半停止的任务可从停止位置继续执行
对于任务 MyTask 生成了任务目录： MyTask_20260307_120000_123
可以将用于记录执行进展、session_id等信息记录在
    MyTask_20260307_120000_123/Agent1_20260307_120001_456/data
    MyTask_20260307_120000_123/Agent2_20260307_120002_789/data
中,恢复场景首先根据 StepWiseAgent 名字，例如 Agent1 找到对应的目录，例如：Agent1_20260307_120001_456。
再根据 StepWiseAgent 目录下的具体任务执行情况恢复，例如：
    执行完成：1-普通任务，2-收集任务（收集到5个数据）3-处理任务1  4-处理任务2
    执行 5- 处理任务3 时被用户主动中断
    用户加上了 setResumePath("MyTask_20260307_120000_123") 再次执行任务，执行任务1、2、3、4时可以从任务目录的历史记录中读取到已经完成，直接跳过，直到任务5时重新执行。
    如果找不到对应的 Agent 目录，则报错退出，提示用户去掉 setResumePath 从头执行。

4. **调试模式**：调试模式打开后，所有收集任务的提示词修改为只收集一个数据，执行完成以后，在接口返回给用户前只返回第一个数据，方便快速调试

---

## 任务执行信息目录结构

多次任务执行，执行信息统一存放在执行时的cwd目录下的stepwise_exec_infos中，例如
```
stepwise_exec_infos/
└── {task-name}_{timestamp1}/                  # TaskName 目录（时间戳精确到毫秒）
    ├── report/                                 # 报告任务输出（所有 Agent 汇总）
    │   ├── report1.json
    │   └── report2.json
    ├── {StepWiseAgent-name2}_{timestamp2}/     # StepWise Agent 目录
    │   ├── data/                               # 执行信息，用于恢复数据
    │   ├── logs/                               # 执行日志
    │   │   ├── 1_task/                         # 普通任务日志
    │   │   ├── 2_collect/                      # 收集任务日志
    │   │   ├── 3_check/                        # 检查任务日志
    │   │   ├── 4_shell/                        # Shell 任务日志
    │   │   └── ...
    │   ├── collect/                            # 收集类任务输出
    │   │   ├── 2_collect/
    │   │   │   └── output.json
    │   │   └── ...
    │   └── check/                              # 检查任务输出
    │       ├── 3_check/
    │       │   └── check_result.json
    │       └── ...
    └── {StepWiseAgent-name3}_{timestamp3}/     # 另一个 StepWise Agent
        ├── data/
        ├── logs/
        └── collect/
```

**目录命名规则**：
- TaskName 目录：`{taskName}_{YYYYMMDD}_{HHmmss}_{毫秒}`
- StepWise Agent 目录：`{agentName}_{YYYYMMDD}_{HHmmss}_{毫秒}`

**时间戳格式说明**：
- 格式：`20260307_120000_123`（年月日_时分秒_毫秒）
- 精确到毫秒，减少命名冲突

## 自学习能力
在每次new session的时候，如果前面有session，说明前面的Session已经完成了，可以先--resume前面的Session，让claude code自己总结前面的步骤中是否有：
1. 经过多次尝试最终成功的技能，总结成claude code的SKILL文件。
2. 当前项目一些公共的动作，后续很可能还会遇到，如果形成总结可以加速的，总结成claude code的SKILL文件。
Skill文件输出在当前cwd目录下的.claude/skills/[skill_name]/SKILL.md中