# StepWise

<p align="center">
  <strong>把 AI 编程助手变成可靠、可断点续跑的工作流的 TypeScript SDK</strong>
</p>

<p align="center">
  <a href="#为什么需要-stepwise">为什么需要</a> • <a href="#工作原理">工作原理</a> • <a href="#快速开始">快速开始</a> • <a href="#用法示例">用法示例</a> • <a href="#文档">文档</a> • <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MulanPSL2-blue.svg" alt="License">
</p>

---

## 为什么需要 StepWise？

你给 AI 编程助手甩一句「重构认证模块，顺带改完所有调用方，再把测试跑通」。二十分钟后，它已经跑偏了，安安静静漏掉了一半需求，而你根本无从判断哪些部分真的完成了。

问题通常不在模型智商，而在于**一次长跑没有检查点**：没有东西在观察进度，没有东西能在中断后存活，也没有东西在你要基于结果继续干活之前先验证它。

StepWise 把这一次长跑，换成一串每个都能稳定收尾的小步骤：

| 痛点 | StepWise 解决方案 |
|------|------------------|
| 长任务跑偏、多任务遗漏 | 任务拆分为稳定的小步骤，数据校验确保输出正确，条件检查验证执行结果 |
| 私有数据处理困难 | 支持 Skill 生成 Agent，多次尝试成功后自动总结 Skill |
| 调试困难、中断丢失 | 断点恢复、调试模式快速验证 |

StepWise 是一个 **TypeScript SDK**——不是命令行工具，也不是编排平台。你写一个脚本，每个 `exec*` 调用就是流程里的一步，框架负责以无头模式驱动 Claude Code、OpenCode、CodeAgent 或 Pi，并在多次运行之间持久化状态。

---

## 工作原理

1. **你写一个脚本。** 每个 `exec*` 调用就是流程中的一格。没有 YAML，没有常驻进程，没有控制台。
2. **每一格都会自己存档。** 步骤完成后，它的序号和状态会写入 `progress.json`。进程在任何时刻被杀掉，用启动时打印的恢复命令重跑同一个脚本，已完成的步骤会被跳过。
3. **每一格背后是一个真实的 agent 会话。** 上下文默认跨步骤复用，也可以分叉出一条新路线去试另一种做法，而不动原会话。

结构化输出在使用前会被校验：收集步骤返回的数据若不符合声明的格式，StepWise 会自动生成修复提示词并重试，而不是把坏结果交给你。

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

校验与重试内置；第一个必填字段自动用于去重：

```typescript
const result = await agent.execCollectPrompt('收集所有 API 端点', {
  name: { type: 'string', description: 'API 名称' },
  method: { type: 'string', description: 'HTTP 方法' },
  path: { type: 'string', description: 'API 路径' },
  description: { type: 'string', description: 'API 描述', required: false }
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

每个 Worker 运行在自己的 git worktree 中，并行的 agent 不会互相争抢同一批文件。想换个仓库跑，追加第四个参数 `{ cwd: '/path/to/other-repo' }`：

```typescript
import { forEachParallel, WorkerConfig, loadCollectData } from 'stepwise';

const apis = loadCollectData('api_endpoints.json');
const workerConfigs: WorkerConfig[] = [{ branchName: 'Worker1' }, { branchName: 'Worker2' }];

await forEachParallel(apis, workerConfigs, async (ctx) => {
  await ctx.stepWise.execPrompt('为 API 生成测试: $name ($method $path)', { data: ctx.item });
});
```

各 worktree 的改动会提交到自己的分支，**绝不自动合并进主分支**——控制台会打印分支名，由你决定合哪些。跨 worktree 时，fork（`sessionId` + `newSession: true`）会自动软链会话；单独传 `sessionId` 会直接报错，而不是冒着并发写坏会话的风险继续。

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

```typescript
import { initTask, StepWise, enableDebugMode } from 'stepwise';

enableDebugMode(true);   // 只收集 1 条数据，快速验证整条流程

initTask('MyTask', 'MyTask_20260315_143000_123');
const agent = new StepWise('MainAgent');

await agent.execPrompt('步骤1：分析项目');                    // 跳过
await agent.execCollectPrompt('步骤2：收集数据', fmt);       // 跳过
await agent.execPrompt('步骤3：处理条目 $name', { data: { name: 'item1' } }); // 从这里恢复
```

出问题时，任务目录里保留着每一步的完整提示词，以及 AI 的完整思考与工具调用（`verbose_output.txt`）——排查某一步时，这是第一个该看的文件。

---

## 文档

- [API 文档](doc/api_cn.md) — 完整 API 说明
- [示例](demos_cn.md) — 可直接运行的完整示例
- [English](README.md) — English documentation

发现问题或想参与 StepWise 的迭代？欢迎提交 Issue 或 Pull Request。

---

## 开源协议

MulanPSL2 — 木兰宽松许可证，第 2 版。详见[协议全文](https://license.coscl.org.cn/MulanPSL2)。
