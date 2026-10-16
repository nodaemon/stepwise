# StepWise

<p align="center">
  <strong>把 AI 编程助手变成可靠、可断点续跑的工作流的 TypeScript SDK</strong>
</p>

<p align="center">
  <a href="#为什么需要-stepwise">为什么需要</a> • <a href="#工作原理">工作原理</a> • <a href="#快速开始">快速开始</a> • <a href="#用法示例">用法示例</a> • <a href="#执行结果目录结构">目录结构</a> • <a href="#文档">文档</a> • <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MulanPSL2-blue.svg" alt="License">
</p>

---

## 为什么需要 StepWise？

StepWise 面向的是这样一类任务：你写好脚本就离开，让它自己跑几小时、跨一整夜——批量重构并修好所有调用方、给一批文件补测试、把一个仓库按规则迁移干净。中途机器重启、限额重置、进程被杀，回来时你需要一个能判断可信度的结果，而不是一句「已完成」。

这类任务和交互式写代码的差别不在 agent 能力，而在**没有人在场**：没人能在第 20 分钟喊停，没人能察觉它已经跑偏，也没人能在失败时接手继续。失败因此不是一次性的，而是整夜算力被反复消耗。

### 为什么不是直接用 Claude Code

Claude Code 本身已经很强：单会话恢复与文件检查点、JSON Schema 结构化输出并自动重提示、`--worktree` 并行隔离、操作系统级沙箱。这些 StepWise 多数不再重复造，差异集中在**恢复的粒度**与**运行边界**上：

| 平台已经原生提供 | StepWise 补的是什么 |
|---|---|
| 文件检查点：回滚被改过的代码 | 任务级断点续跑：记住「第 N 步已完成」，重跑脚本直接跳过已完成步骤，不重算 |
| 单会话恢复：接着上次的对话继续 | 跨进程、跨会话恢复：恢复路径打印在启动日志里，重跑同一个脚本即可，与原会话是否还在无关 |
| 交互会话内配额耗尽会等待重置 | 非交互路径的配额韧性：429 / 503 用用完即弃的会话探测是否恢复，等待不消耗重试预算，限流报错也不会写进真实上下文 |
| JSON Schema 结构化输出：格式合规即通过 | 内容级校验：先确认产物文件确实存在，再校验内容，不合格自动生成修复提示词重试 |

其中配额韧性是价值密度最高的一条：平台在非交互式的 `claude -p` 与 SDK 路径下，配额耗尽会直接失败而不是等待，而限流恰恰是批处理最常见的失效原因。

### 跑一整夜之后，你拿回什么

| 会出什么问题 | StepWise 怎么解决 |
|---|---|
| 进程被杀或机器重启，前功尽弃 | 恢复执行时自动跳过已完成步骤——用启动时打印的恢复路径重跑同一个脚本即可 |
| 跑一晚上的任务被配额打断 | 429 与 503 自动等待重试，且不消耗重试预算；先用用完即弃的会话探测是否恢复，429 报错不会污染真实上下文 |
| 中途静默跑偏，无人察觉 | debug 模式下每步自动追加一次自检复盘：独立审查者复核目标清晰度、输入缺失与冗余、过程弯路，结论必须逐字引用原文佐证 |
| AI 说「做完了」只是一句空话 | 声明输出格式；StepWise 先确认文件存在、再校验内容，然后自动生成修复提示词并重试 |
| 长任务为什么出错、耗时与 token 消耗等难以分析 | 每一步都可观测——耗时与 token 消耗逐项统计，AI 的思考过程与工具调用全程留痕，任务时间与限额等待分开算，任何一步都能原样重跑 |
| 并行的 agent 互相踩文件 | 每个 Worker 独占一个 git worktree，任务从共享队列领取；分支只提交到自己分支，绝不自动合并进主分支 |
| 只能绑死一家 agent CLI | Claude Code（默认）、OpenCode、CodeAgent、Pi 共用同一套工作流脚本，换后端不必重写 |
| 同一个坑每周再踩一次 | 有效经验被自动沉淀成 Skill，agent CLI 下次会话原生加载 |
| 影响范围太大 | `setAllowRead` / `setAllowWrite` 把单步限制在指定目录内——这是提示词级护栏，不是操作系统级沙箱 |

### 什么时候不需要它

StepWise 只解决上面这一类问题。边聊边改的交互式开发、只有两三个步骤的小任务、或者只是想借一个 agent 更强的单次能力，直接用 Claude Code 原生功能更省事。

需要跨机器、分布式、可审计的长时恢复时，也不该用 StepWise——那一层属于 Temporal、Restate 这类持久化执行基础设施，它们为此要引入外部服务与状态存储。StepWise 的取舍正好相反：单进程、零外部依赖、状态全部落在磁盘上，一次运行就是一个可检查、可归档的文件夹。

---

## 工作原理

1. **你写一个脚本。** 每个 `exec*` 调用就是流程中的一格。没有 YAML，没有常驻进程，没有控制台。
2. **状态落在磁盘上。** 每一步完成时都会写下自己的序号、状态和会话 ID，因此一次运行就是一个文件夹——你可以检查它、归档它，或者从中恢复。
3. **上下文是你掌控的会话。** 各步骤默认复用同一个会话；你可以开新会话，也可以分叉出一条分支去试另一种做法而不动原会话。

---

## 快速开始

需要 **Node.js 16+**（构建目标为 `moduleResolution: Node16`），以及 `PATH` 上至少一个 AI 编程助手 CLI——Claude Code（默认）、OpenCode、CodeAgent 或 Pi。使用 OpenCode 时，请在 `opencode.json` 中设置 `"permission": "allow"`，否则它会不停弹确认。

StepWise 尚未发布到 npm，请从源码构建：

```bash
git clone https://gitee.com/nodaemon/stepwise.git
cd stepwise && npm install && npm run build
```

然后写你的工作流。启动时会打印任务目录和恢复命令——把它作为 `initTask` 的第二个参数传回来，所有已完成的步骤都会被跳过：

```typescript
import { initTask, StepWise } from './stepwise/dist';

initTask('RefactorAuth');   // 恢复执行: initTask('RefactorAuth', 'RefactorAuth_20260315_143000_123')
const agent = new StepWise('MainAgent');

await agent.execPrompt('分析模块依赖关系');
await agent.execPrompt('抽取公共接口定义');
await agent.execPrompt('重构核心逻辑');
```

---

## 用法示例

### 1. 任务步骤控制

用真实命令验证每一步，而不是采信 AI 的自述：

```typescript
const build = await agent.execShell('npm run build');
if (!build.success) {
  await agent.execPrompt('修复构建错误');
}
```

### 2. 结构化数据收集

声明想要的格式；第一个必填字段自动用于去重。校验与修复重试默认开启——需要时按步骤微调：

```typescript
const result = await agent.execCollectPrompt('收集所有 API 端点', {
  name: { type: 'string', description: 'API 名称' },
  method: { type: 'string', description: 'HTTP 方法' },
  path: { type: 'string', description: 'API 路径' },
  description: { type: 'string', description: 'API 描述', required: false }
}, {
  validateOptions: { maxRetries: 3, retryOnFileMissing: true }
});
```

### 3. 条件分支

根据条件把任务分发到不同的 Agent：

```typescript
const checkResult = await agent.execCheckPrompt('检查测试是否通过');

if (!checkResult.result) {
  const fixAgent = new StepWise('FixAgent');
  await fixAgent.execPrompt('修复失败的测试');
} else {
  const deployAgent = new StepWise('DeployAgent');
  await deployAgent.execPrompt('部署到预发环境');
}
```

### 4. 并行处理

用一个处理函数跑遍所有条目，各 Worker 相互隔离。想在另一个仓库里执行，追加第四个参数 `{ cwd: '/path/to/other-repo' }`：

```typescript
import { forEachParallel, WorkerConfig, loadCollectData } from 'stepwise';

const apis = loadCollectData('api_endpoints.json');
const workerConfigs: WorkerConfig[] = [{ branchName: 'Worker1' }, { branchName: 'Worker2' }];

await forEachParallel(apis, workerConfigs, async (ctx) => {
  await ctx.stepWise.execPrompt('为 API 生成测试: $name ($method $path)', { data: ctx.item });
});
```

每个 Worker 运行在自己的 worktree 中，会话按目录分别存储。跨 worktree 做 fork（`sessionId` + `newSession: true`）会自动把会话软链过去；单独传 `sessionId` 跨 worktree 会直接报错，而不是冒着并发写坏会话的风险继续。

### 5. Schema 驱动输出

按你定义的 Schema 输出 JSON——支持任意嵌套与递归树形结构：

```typescript
const tree = await agent.execPromptSchema(
  '生成项目的目录树',
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
```

### 6. 会话管理

```typescript
const r2 = await agent.execPrompt('实现 CRUD 接口');   // 会话默认自动复用
const sessionId = r2.sessionId;

await agent.execPrompt('开始一个独立的新需求', { newSession: true });
await agent.execPrompt('继续完善', { sessionId });              // 恢复指定会话

const forked = await agent.execPrompt('尝试另一种实现思路', {
  sessionId,                                        // fork：派生新会话
  newSession: true                                  // 原会话保持不变
});
```

### 7. 断点恢复与调试模式

开启调试模式可以让整条流程只处理一条数据；恢复一次中断的运行时，把它的路径传进来即可：

```typescript
import { initTask, StepWise, enableDebugMode } from 'stepwise';

enableDebugMode(true);   // 只收集 1 条数据，快速验证整条流程

initTask('MyTask', 'MyTask_20260315_143000_123');
const agent = new StepWise('MainAgent');

await agent.execPrompt('步骤1：分析项目');                    // 跳过
await agent.execCollectPrompt('步骤2：收集数据', fmt);       // 跳过
await agent.execPrompt('步骤3：处理条目 $name', { data: { name: 'item1' } }); // 从这里恢复
```

**debug 模式下的自检复盘**

调试模式下每成功执行一个 AI 步骤，框架会新开一个会话，把这一步的提示词、输出和执行轨迹交给一个独立审查者，复盘目标是否清晰、输入是否缺失或冗余、工具调用是否走了弯路。审查者必须逐字引用原文佐证每条结论，引用不到就不输出；报告写在同目录的 `self_check.md`。详见[执行结果目录结构](#执行结果目录结构)。

---

## 执行结果目录结构

一次运行就是一个文件夹，位于工作目录下的 `stepwise_exec_infos/`。启动时打印的恢复路径就是这个文件夹名：

```
stepwise_exec_infos/
└── <TaskName>_<YYYYMMDD>_<HHmmss>_<ms>/          ← 一次运行 = 一个文件夹
    ├── logs/
    │   ├── performance.json                     ← 耗时 / token 累计统计（机器可读）
    │   └── performance.txt                      ← 同上，可读版
    ├── report/                                  ← execReport 产出的报告
    │
    └── <AgentName>_<timestamp>/                 ← 每个 Agent / Worker 一个
        ├── data/
        │   └── progress.json                    ← 断点恢复状态（步骤序号、状态、会话 ID）
        ├── logs/
        │   ├── execute.log                      ← 每步的开始 / 结束 / 重试 / 跳过
        │   ├── 1_collect/                       ← 第 1 个 collect 步骤
        │   │   ├── prompt.txt                   ←   实际发出的提示词
        │   │   ├── output.txt                   ←   最终输出
        │   │   ├── verbose_output.txt           ←   思考过程与工具调用全量轨迹
        │   │   ├── command.sh                   ←   可直接 ./command.sh 原样重跑
        │   │   ├── execution_info.json          ←   命令行、会话 ID、环境变量
        │   │   ├── usage.json                   ←   token 用量（NDJSON 执行器）
        │   │   ├── schema.json                  ←   execPromptSchema 的 schema 定义
        │   │   ├── post_check_prompt.txt        ←   postCheckPrompt 原文
        │   │   ├── error.txt                    ←   失败原因（仅失败时）
        │   │   └── self_check.md                ←   自检报告（仅 debug 模式）
        │   ├── 2_task/                          ← 第 2 个步骤，以此类推
        │   └── 1_self_check/                    ← 自检审查者自身的日志（仅 debug 模式）
        └── collect/
            └── 1_collect/
                └── collect_1.json               ← 收集类任务的输出
```

步骤目录名格式为 `{序号}_{类型}`，类型取自 `exec*` 接口（`task` / `collect` / `check` / `report` / `schema` / `shell`）。按条件出现的文件：

| 文件 | 何时出现 |
|---|---|
| `error.txt` | 该步骤执行失败 |
| `usage.json` | 使用 Claude Code / CodeAgent 等 NDJSON 执行器 |
| `schema.json` | `execPromptSchema` |
| `post_check_prompt.txt` | 该步骤配置了 `postCheckPrompt` |
| `self_check.md` | debug 模式下的自检报告 |

没有任何东西是不可还原的：`progress.json` 决定断点续跑从哪继续，`command.sh` 让任何一步都能脱离框架单独重跑，`verbose_output.txt` 保留了 AI 当时究竟看到了什么、做了什么、走过哪些弯路。

---

## 文档

- [API 文档](doc/api_cn.md) — 完整 API 说明
- [示例](demos_cn.md) — 可直接运行的完整示例
- [English](README.md) — English documentation

发现问题或想参与 StepWise 的迭代？欢迎提交 Issue 或 Pull Request。

---

## 开源协议

MulanPSL2 — 木兰宽松许可证，第 2 版。详见[协议全文](https://license.coscl.org.cn/MulanPSL2)。
