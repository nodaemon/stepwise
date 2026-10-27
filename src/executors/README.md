# 执行器模块

本模块实现了智能体执行器的抽象和具体实现，支持多种 AI 智能体（Claude、OpenCode、CodeAgent、Pi、mcode 等）。

## 目录结构

```
src/executors/
├── index.ts      # 公共导出
├── types.ts      # 接口定义
├── base.ts       # 抽象基类
├── claude.ts     # Claude 执行器实现（同时作为 CodeAgent 的基类）
├── codeagent.ts  # CodeAgent 执行器实现（继承 ClaudeExecutor）
├── opencode.ts   # OpenCode 执行器实现
├── pi.ts         # Pi 执行器实现（@earendil-works/pi-coding-agent）
└── mcode.ts      # mcode 执行器实现（Minimax Code，@minimax-ai/code）
```

## 架构设计

本模块采用**模板方法模式**（Template Method Pattern）：

- `BaseExecutor`：抽象基类，定义执行流程和公共逻辑
- `ClaudeExecutor` / `OpenCodeExecutor` / `CodeAgentExecutor` / `PiExecutor` / `McodeExecutor`：具体实现类，实现特定智能体的逻辑
- `CodeAgentExecutor` 继承 `ClaudeExecutor`：命令参数与 Claude 基本一致（仅可执行程序名不同，另额外携带 CodeAgent 独有的 `--skip-safe-check`），故复用 `buildArgs()`，仅覆写 `getCommand()` 与 `buildSafetyArgs()`

### 类图

```
              AgentExecutor (interface)
                      │
                      │ implements
                      ▼
                BaseExecutor (abstract)
           ┌─────────┬──────────┬──────────┬──────────┐
           │         │          │          │          │
           ▼         ▼          ▼          ▼          ▼
    ClaudeExecutor  OpenCodeExecutor  CodeAgentExecutor  PiExecutor  McodeExecutor
           ▲                                              │
           │ extends                                       │
           └─────────────────────── (复用 buildArgs，仅覆盖 getCommand/agentType)
```

## 如何添加新的执行器

### 步骤 1：创建执行器类

在 `src/executors/` 目录下创建新文件，例如 `aider.ts`：

```typescript
import { BaseExecutor } from './base';

export class AiderExecutor extends BaseExecutor {
  /** 执行器类型标识 */
  readonly agentType = 'aider';

  /** 返回 CLI 命令名称 */
  protected getCommand(): string {
    return 'aider';
  }

  /**
   * 构建命令行参数（**不含提示词**）
   *
   * 提示词统一由基类经 stdin 管道下发，本方法只负责其余参数。
   * 若该 CLI 需要显式声明"从 stdin 读提示词"，把对应开关写在本方法内
   * （如 mcode 的 --input -）。
   */
  protected buildArgs(
    sessionId: string,
    isResume: boolean,
    debugFile?: string,
    fork?: boolean
  ): string[] {
    const args: string[] = [];
    // ... 构建参数逻辑（不含提示词）
    return args;
  }

  /** 可选：重写环境变量构建 */
  protected buildEnv(extraEnv?: string[]): NodeJS.ProcessEnv {
    const env = super.buildEnv(extraEnv);
    // 添加特定环境变量
    return env;
  }
}
```

### 步骤 2：更新类型定义

在 `src/types.ts` 中更新 `AgentType` 类型：

```typescript
export type AgentType = 'claude' | 'opencode' | 'codeagent' | 'pi' | 'mcode';
```

### 步骤 3：注册到工厂

在 `src/utils/executor.ts` 中注册新执行器：

```typescript
import { AiderExecutor } from '../executors/aider';

const executorFactories: Record<AgentType, () => AgentExecutor> = {
  claude: () => new ClaudeExecutor(),
  opencode: () => new OpenCodeExecutor(),
  codeagent: () => new CodeAgentExecutor(),
  pi: () => new PiExecutor(),
  mcode: () => new McodeExecutor(),
  aider: () => new AiderExecutor(),  // 新增
};
```

### 步骤 4：导出新类

在 `src/executors/index.ts` 中导出新类：

```typescript
export { AiderExecutor } from './aider';
```

## 抽象方法说明

| 方法 | 说明 |
|------|------|
| `agentType` | 返回执行器类型标识 |
| `getCommand()` | 返回 CLI 命令名称 |
| `buildArgs()` | 构建命令行参数（**不含提示词**——提示词统一经 stdin 管道下发，见「提示词传递方式」） |
| `buildProbeArgs()` | 构建 429 探测命令参数（同样不含提示词，探测提示词由基类经 stdin 传入）。不适用探测的执行器（如 OpenCode）应抛出含「探测不适用」的错误，`base.ts` 会捕获并跳过探测循环 |

## 可重写方法

| 方法 | 说明 |
|------|------|
| `buildEnv()` | 构建环境变量，默认返回 `process.env` |
| `usesNDJsonOutput()` | 是否输出 NDJSON（stream-json）格式，默认 `false`。Claude、CodeAgent、Pi、mcode 返回 `true`（空行跳过、按 type 格式化）；OpenCode 为 `false`（空行保留） |
| `buildSafetyArgs()` | 构建「安全确认类」参数，追加在 `--dangerously-skip-permissions` 之后，默认返回 `[]`。ClaudeExecutor 保持为空；CodeAgentExecutor 覆写为 `['--skip-safe-check']`，跳过目录首次使用时的安全确认 |
| `execute()` | 执行提示词任务，默认在 `BaseExecutor` 中实现重试、错误处理等逻辑。Pi 执行器重写此方法以在 fork 模式下预生成派生 session ID；mcode 执行器重写此方法以拒绝 fork |
| `getSessionIdAfterExecution()` | 执行完成后获取 sessionId。OpenCode 通过 `session list` 获取；Pi 在 fork 模式下返回预生成的派生 ID |
| `assertForkSupported()` | fork 能力断言，默认不做校验。不支持 fork 的后端（mcode）覆写为抛错，由 `StepWise` 在写入 progress（标记 `in_progress`）之前调用，避免任务卡在 `in_progress` 且续跑必然再次失败 |
| `getRateLimitPatterns()` | 速率限制检测正则表达式 |
| `checkRateLimitError()` | 速率限制错误检测逻辑 |

## 提示词传递方式

**提示词统一经 stdin 管道下发，永远不进入命令行参数。**

### 为什么

Linux 对单个 argv 字符串的硬上限是 `MAX_ARG_STRLEN = 32 × PAGE_SIZE = 131072` 字节（128 KiB）。
提示词若作为命令行参数传递，超过 128 KiB 就会让 `spawn` 直接失败并报 `E2BIG`（Argument list too long），
且该失败会在重试循环里连续发生三次。管道传输不受此限制（只受内存/磁盘限制）。

### 契约

- `buildArgs()` 的返回值中**永远不含提示词**——签名里就没有 `prompt` 形参，不存在"按长度/按执行器切换"的分支
- 基类在 `runCommand()` 中统一 `child.stdin.end(prompt, 'utf-8')`
- 各 CLI 读 stdin 所需的开关写在自己的 `buildArgs()` 内部
- **有代码守卫**：基类在 `runCommand()` 里断言参数中不含提示词，
  违规时立即抛出指向 `buildArgs()` 的报错，而不是等到超长提示词触发 `E2BIG` 才暴露。
  新增执行器时若误把提示词 push 进参数，会立刻看到：

  ```
  [claude] 提示词出现在命令行参数中。提示词必须经 stdin 管道下发
  （Linux 单个 argv 上限 128 KiB，超长提示词会直接报 E2BIG），请检查 buildArgs() 是否误将 prompt 放入参数。
  ```

### 各 CLI 的 stdin 开关

| CLI | 命令形态（`<` 表示提示词来自 stdin） | 备注 |
|---|---|---|
| Claude | `claude --dangerously-skip-permissions --verbose --output-format stream-json (--session-id U \| --resume U [--fork-session]) -p < prompt` | `-p` 是打印模式开关 |
| CodeAgent | 同 Claude，额外带 `--skip-safe-check` | `-p` 打印模式下从 stdin 读提示词（已实测确认） |
| Pi | `pi --session-id U --mode json -p < prompt` | 会 trim stdin 首尾空白 |
| mcode | `mcode exec --permission full --output-format stream-json [--session mvs_x] --input - < prompt` | `--input` 只接受 `-`；与位置参数提示词**互斥** |
| OpenCode | `opencode run --thinking [--session ses_x] [--fork] < prompt` | 无需额外开关，会自动读 stdin |

### 落盘与复现

任务日志目录里有两类文件，各司其职：

**1) 提示词记录文件（长期留存）**

执行器把**本次实际下发的提示词**写入 `options.promptLogFile` 指定的文件（默认 `prompt.txt`）。
文件名由调用方按提示词类型给出，同一任务目录内的不同提示词各记各的、互不覆盖：

| 提示词 | 记录文件 | 常量 |
|---|---|---|
| 任务本体 | `prompt.txt` | `PROMPT_FILE` |
| postCheck | `post_check_prompt.txt` | `POST_CHECK_PROMPT_FILE` |
| 会话末尾总结 | `summarize_prompt.txt` | `SUMMARIZE_PROMPT_FILE` |
| 输出文件缺失重试 | `file_missing_prompt.txt` | `FILE_MISSING_PROMPT_FILE` |
| 输出校验失败修复 | `validation_fix_prompt.txt` | `VALIDATION_FIX_PROMPT_FILE` |
| 自检复盘 | `self_check_prompt.txt` | `SELF_CHECK_PROMPT_FILE` |

`command.sh` 末行引用其中与本次执行对应的那一份，因此复现的一定是同一次执行：

```sh
cat '/abs/path/logs/3_task/prompt.txt' | claude --dangerously-skip-permissions ... -p
```

**2) 产物文件名前缀（`options.artifactPrefix`）**

同一步骤目录内会先后跑好几次执行（步骤本体、postCheck、输出缺失重试、校验失败修复、
会话末尾总结、自检复盘），每次执行都会生成 `command.sh` / `execution_info.json` /
`debug.log` / `verbose_output.txt` 等产物。不加区分时，后一次执行会覆盖前一次的产物，
步骤本体的复现脚本也会消失。

传 `artifactPrefix` 后，本次执行的产物带前缀落盘，**不会覆盖目录里已有的同名文件**：

| 产物 | 带 `artifactPrefix: 'self_check_'` 时 |
|---|---|
| `command.sh` | `self_check_command.sh` |
| `execution_info.json` | `self_check_execution_info.json` |
| `debug.log` | `self_check_debug.log` |
| `verbose_output.txt` | `self_check_verbose_output.txt` |
| `error_report.txt` | `self_check_error_report.txt` |
| stdin 临时文件 | `.self_check.stdin_prompt`（隐藏语义保留：前缀插到点号之后） |

**提示词记录文件不受前缀影响**——它的文件名由 `options.promptLogFile` 显式指定，
避免「前缀 + 已带前缀的名字」造成二次加前缀。

框架里各次执行使用的常量（`src/constants.ts`）：

| 执行 | 提示词记录文件 | 产物前缀常量 |
|---|---|---|
| 步骤本体 | `prompt.txt` | 无（独占无前缀的名字） |
| postCheck | `post_check_prompt.txt` | `POST_CHECK_ARTIFACT_PREFIX` |
| 输出缺失重试 | `file_missing_prompt.txt` | `FILE_MISSING_ARTIFACT_PREFIX` |
| 校验失败修复 | `validation_fix_prompt.txt` | `VALIDATION_FIX_ARTIFACT_PREFIX` |
| 会话末尾总结 | `summarize_prompt.txt` | `SUMMARIZE_ARTIFACT_PREFIX` |
| 自检复盘 | `self_check_prompt.txt` | `SELF_CHECK_ARTIFACT_PREFIX` |

前缀与提示词记录文件同名，保证「同一次执行」的文件能对上号：
`post_check_prompt.txt` ↔ `post_check_command.sh`。

**3) stdin 临时文件（用完即删）**

运行时的提示词写进 `STDIN_PROMPT_FILE`（`.stdin_prompt`），再从它读出喂给子进程 stdin；
子进程退出后立即删除，目录里不留残留。固定名的意义是**所有执行在底层走同一条通路**：
写固定名文件 → 从它读 → 喂 stdin → 退出即删。

带 `artifactPrefix` 的执行用同一条通路，只是文件名带上前缀
（`.self_check.stdin_prompt`）——**隐藏语义保留**：前缀插到点号之后。

`execution_info.json` 的 `args` 不再含提示词，另记录 `promptDelivery: "stdin"` 与 `promptLogFile`。

### 迁移说明（面向继承 BaseExecutor 的第三方执行器）

`buildArgs()` 的签名已去掉 `prompt` 形参：

```diff
- protected abstract buildArgs(prompt: string, sessionId: string, isResume: boolean, debugFile?: string, fork?: boolean): string[];
+ protected abstract buildArgs(sessionId: string, isResume: boolean, debugFile?: string, fork?: boolean): string[];
```

迁移步骤：删掉 `prompt` 形参 → 删掉把提示词 push 进 args 的语句 → 若该 CLI 需要显式声明
"从 stdin 读提示词"，把对应开关写进 `buildArgs()` 内部（如 mcode 的 `--input -`）。
`buildProbeArgs()` 同样去掉提示词，探测提示词由基类经 `spawnSync` 的 `input` 选项传入。

## 超时终止

基类在超时后按「优雅终止 → 强制终止」两步走，保证**直接子进程一定退出**。第三方执行器**不需要做任何改动**，但要知道它的行为约定。

### SIGTERM → 宽限期 → SIGKILL

超时时先给子进程发 `SIGTERM`，宽限期（`PROCESS_TERMINATE_GRACE_MS`，3 秒）内没退出就发 `SIGKILL`。`SIGKILL` 不可捕获、不可忽略，是「超时后子进程一定退出」的最终保障——AI 任务常因 CLI 自身的 event loop 卡住而无法响应 `SIGTERM`，只有 `SIGKILL` 能收掉它。

升级分支**不能**写成 `if (!child.killed)`：`child.killed` 只表示「信号已发出」，`SIGTERM` 发出后它就是 `true`，那个条件永远不成立，`SIGKILL` 从不执行，卡死的子进程会一直残留。

### 不改动宿主进程的信号语义

框架**不接管** `SIGINT` / `SIGTERM`，子进程也留在父进程的前台进程组里：终端的 Ctrl-C 照常送达子进程，行为与框架自身无关。宿主程序注册的信号监听器不会被框架触碰。

### 结算前子进程必已退出

超时**不会立刻**把 Promise 判为失败。基类只在子进程真正退出之后才结算：

- 正常结束：`close` 事件（进程已退出 **且** stdio 管道已关闭）
- 超时结束：`SIGTERM` → 宽限期 → `SIGKILL` 之后，等 `close` 到达再结算

孙进程持有 stdout 管道时 `close` 可能一直不触发，为此超时路径在发出 `SIGKILL` 后额外挂一道兜底闸门（`SIGKILL_SETTLE_GATE_MS`，1 秒），到期强制结算，避免 Promise 永远挂住。此时 `SIGKILL` 早已生效，直接子进程确定已退出。

这条契约的意义：框架抛错返回时，上一个 agent 进程一定已经死了。紧接着发起的重试不会和还活着的旧进程抢同一个会话文件。

### 重试一律续接同一会话

`execute()` 的重试循环里，「是否 resume」由独立的 `sessionStarted` 标志决定，**与重试预算计数 `attempts` 分离**：

- `attempts` 是预算（普通错误消耗，429/503 不消耗），决定还能重试几次
- `sessionStarted` 表达「这个会话已经存在了」，决定重试时该怎么调用 CLI

判据**不能**写成 `attempts > 1`：429/503 分支会执行 `attempts--` 把计数退回去，用 `attempts` 判定会让 429 之后的第一次重试退回「新建会话」模式。对 Claude 而言，这等于用同一个 uuid 再次 `--session-id`，而该 uuid 的会话文件在首次执行时已落盘，CLI 直接报 `Session ID ... is already in use.`，整轮重试机制随之失效。

语义：只要本会话已启动过一次，后续任何重试（含 429/503 分支）都必须续用同一会话。首次执行不强制 resume（调用方显式传入 `useResume` 时则原样透传）。

### 已知边界：孙进程不在清理范围

框架只保证**直接子进程**退出。子进程派生的孙进程（如 agent 正在跑的 bash 工具）会被 init 收养后继续运行，不在清理范围内。

这带来一个连带问题：孙进程持有 stdout 管道时，`close` 事件不会触发。为此超时路径自己做收尾——销毁 stdout/stderr 管道（否则框架自身的事件循环会被挂住，框架反而退不出去）、flush `verbose_output.txt`、删 stdin 临时文件。

> 另有一条固有限制：父进程被 `SIGKILL` 或机器掉电时无法执行任何清理（Node 没有 `PR_SET_PDEATHSIG` 的等价能力）。

## isResume 参数说明

不同 CLI 工具对会话恢复的处理方式不同：

| CLI 工具 | 新会话参数 | 恢复会话参数 | 自动检测 |
|---------|-----------|-------------|---------|
| Claude | `--session-id <uuid>` | `--resume <uuid>` | 否 |
| CodeAgent | `--session-id <uuid>` | `--resume <uuid>` | 否 |
| OpenCode | `--session <uuid>` | `--session <uuid>` | 是 |
| Pi | `--session-id <uuid>` | `--session-id <uuid>` | 是（自动判断创建/打开） |
| mcode | 不传（由 mcode 自行分配） | `--session <mvs_id>` | 否 |

在实现 `buildArgs()` 方法时，需要根据具体 CLI 工具的参数设计来处理 `isResume` 参数。

## mcode 后端的特殊约束

mcode（Minimax Code）的会话模型与其它后端不同，接入时需注意：

- **会话 ID 由 mcode 自行分配**（形如 `mvs_<32 位 hex>`），调用方无法指定。其 `createSession()` 内部固定调用 `makeSessionId()`，因此框架预生成的 UUID 对 mcode 无意义，新会话时一律不传 `--session`。
- **真实会话 ID 从输出流解析**：mcode stream-json 事件的公共信封携带 `sessionId`，且该值来自已解析的真实会话，在首个事件 `exec.started` 即可读到。`ndjsonFormatter` 提取该字段后，经 `BaseExecutor` 的 `onDerivedSessionId` 钩子实时回写 `progress.json`，使子进程被 kill 后仍可按真实 ID 续接。
- **不支持 fork**：mcode 无从已有会话派生新会话的能力，且会话的 `workspaceDir` 必须与 `--cwd` 严格一致。fork 请求显式抛错而非静默降级——无人值守场景下静默丢失上下文比早失败更危险。抛错点在 `StepWise` 写入 progress（标记任务 `in_progress`）之前，任务不会卡在 `in_progress`、续跑也不会必然再次失败。
- **重试续接同一会话**：框架预生成的 UUID 对 mcode 无效，但首次执行捕获到的真实 `mvs_*` ID 会被保留，重试时以 `--session <mvs_id>` 续接同一个会话，而不是每次重试都新建会话、丢失失败前的上下文。
- **限额文案口径不同**：mcode 判定 provider 限额错误的正则含空格分隔的 `rate limit`（基类只认 `429` / `rate_limit_error` / `usage limit exceeded`），故 `McodeExecutor` 覆写 `checkRateLimitError()` 补齐该口径，否则限额等待与 429 探测循环不会触发。
- **工具过程可从事件流还原**：`item.completed` 的 `tool_call` 事件带完整 `toolCall`（`{id, name, status, input, output}`），其中 `input` 是工具入参、`output.content` 是工具执行结果，`verbose_output.txt` 中两者都会渲染。
- **不支持跨 cwd 恢复**：会话存于 `$MINIMAX_DATA_DIR/v2/sessions/<日期>/…`（按日期分区，不按 cwd），但 `workspaceDir` 校验是硬性的。因此 `StepWise.getConfigSubdir()` 对 mcode 返回 `null`，跳过 `sessionLinker` 的跨目录软链逻辑。
- **提示词经 stdin 传入**：mcode 的 `--input` 只接受 `-`（读 stdin），且与位置参数提示词**互斥**（同时给出会直接报错）。因此 `buildArgs()` 用 `--input -` 而非位置参数传提示词。
- **429 探测会产生会话**：mcode 没有「不落盘 session」开关（除非指定 `--session` / `--continue`），每次探测都会新建一个会话目录。这是为了更快恢复限额所做的自觉取舍。

## 测试

运行测试：

```bash
npm test
```

类型检查：

```bash
npx tsc --noEmit
```