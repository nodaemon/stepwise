# StepWise

StepWise 是一个高效构建具备稳定完成复杂代码任务智能体的工具。它支持定制复杂任务的处理流程，然后将流程中各个步骤分配给子Agent执行，从而实现负责任务的稳定处理。

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

### 全局设置

```typescript
// 设置任务名称，基于任务名称加时间生成任务目录
setTaskName(taskName: string): void

// 设置恢复路径，从指定任务目录恢复执行
// 例如：
//      对于任务 MyTask 生成了任务目录： MyTask_2026_02_32_22_00_00
//      执行完成：1-普通任务，2-收集任务（收集到5个数据）  3-处理任务1  4-处理任务2
//      执行 5- 处理任务3 时被用户主动中断
//      加上 setResumePath("MyTask_2026_02_32_22_00_00") 再次执行任务，执行任务1、2、3、4时可以从任务目录的历史记录中读取到已经完成，则直接跳过，直到任务5时重新执行。
setResumePath(path: string): void

// 启用/禁用调试模式
// 调试模式打开后，所有收集任务执行完成以后，在返回给用户前只返回第一个数据，方便快速调试
enableDebugMode(enabled?: boolean): void

// 检查调试模式是否启用
isDebugMode(): boolean
```

### 串行任务

```typescript
// 使用claude执行提示词，cwd未指定则使用当前进程的cwd
// newSession 未指定或为 false: 复用上一个任务的 session id（如果没有则创建新的）
// newSession 为 true: 创建新的 session id
// 返回本次执行的ExecutionResult中各个字段的信息
execPrompt(prompt: string, options?: ExecOptions): Promise<ExecutionResult>
```

### 收集任务

```typescript
// 使用outputFormat和outputFileName生成额外提示词，确保claude执行输出的结果按照固定json数组方式输出，并写入到本地磁盘文件中。
// 额外提示词必须是中文，且明确告知文件已存在时追加合并，对于primary_key相同的数据需要去重。
// 除了普通的任务返回信息，还需要从磁盘读取生成的json数组，返回CollectResult中的data
execCollectPrompt(prompt: string, outputFormat: OutputFormat, outputFileName: string, options?: ExecOptions): Promise<CollectResult>

// 保存收集的数据到磁盘
saveCollectData(data: Record<string, any>[], fileName?: string): void

// 从磁盘加载收集的数据
loadCollectData(fileName?: string): Record<string, any>[]
```

### 处理任务

```typescript
// 需要将prompt中$name $desc等变量替换成data中真实的key对应的value，然后执行提示词，其他执行模式和返回值与普通任务一样
execProcessData(prompt: string, data: Record<string, any>, options?: ExecOptions): Promise<ExecutionResult>

// 需要将prompt中$name $desc等变量替换成data中真实的key对应的value
// 使用outputFormat和outputFileName生成额外提示词，确保claude执行输出的结果按照固定json数组方式输出，并写入到本地磁盘文件中。
// 额外提示词必须是中文，且明确告知文件已存在时追加合并，对于primary_key相同的数据需要去重。
// 除了普通的任务返回信息，还需要从磁盘读取生成的json数组，返回CollectResult中的data
execProcessDataAndCollect(prompt: string, data: Record<string, any>, outputFormat: OutputFormat, outputFileName: string, options?: ExecOptions): Promise<CollectResult>
```

### 报告任务

```typescript
// 使用outputFormat和outputFileName生成额外提示词，确保claude执行输出的结果按照固定json数组方式输出，并写入到本地磁盘文件中。
// 额外提示词必须是中文，且明确告知文件已存在时追加合并，对于primary_key相同的数据需要去重。
// 除了普通的任务返回信息，还需要从磁盘读取生成的json数组，返回CollectResult中的data
execReport(prompt: string, outputFormat: OutputFormat, outputFileName: string, options?: ExecOptions): Promise<CollectResult>
```

---

## 类型定义

```typescript
interface ExecOptions {
  cwd?: string;
  newSession?: boolean;  // true: 创建新 session; false/未指定: 复用上一个 session（默认）
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
```

---

## 重要辅助功能

1. **日志记录**：详细记录所有任务的完整提示词、执行过程、执行结果、执行时间等等信息，方便任务执行出错时进行调试
   日志放在[任务目录]/logs下，按任务执行顺序命名日志目录
   例如：1_collect  2_process_and_collect  3_process ...
   另外生成一个汇总的execute.log

2. **重试机制**：Claude执行失败自动重试3次，3次都失败则退出进程。

3. **任务恢复**：执行到一半停止的任务可从停止位置继续执行
对于任务 MyTask 生成了任务目录： MyTask_2026_02_32_22_00_00
可以将用于记录执行进展、session_id等信息记录在 MyTask_2026_02_32_22_00_00/data 中
恢复场景，例如：
        执行完成：1-普通任务，2-收集任务（收集到5个数据）  3-处理任务1  4-处理任务2
        执行 5- 处理任务3 时被用户主动中断
        用户加上了 setResumePath("MyTask_2026_02_32_22_00_00") 再次执行任务，执行任务1、2、3、4时可以从任务目录的历史记录中读取到已经完成，直接跳过，直到任务5时重新执行。

4. **调试模式**：调试模式打开后，所有收集任务提示词不变，执行完成以后，在接口返回给用户前只返回第一个数据，方便快速调试

---

## 任务执行信息目录结构

多次任务执行，执行信息统一存放在执行时的cwd目录下的stepwise_exec_infos中，例如
```
stepwise_exec_infos/
└── {task-name1}-{timestamp1}/
    ├── data/              # 执行信息，用于恢复数据
    ├── logs/               # 执行日志
    │   ├── 1_collect/      # 收集任务日志
    │   ├── 2_process/      # 处理任务日志
    │   └── ...
    ├── collect/             # 收集类任务输出
    │   ├── 1_collect/
    │   │   └── output.json
    │   ├── 3_process_and_collect/
    │   │   └── result.json
    │   └── ...
    └── report/              # 报告任务输出（汇聚在一起）
        ├── report1.json
        ├── report2.json
        └── ...
```
