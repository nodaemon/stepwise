# forEachParallel cwd 支持设计

## 目标

为 `forEachParallel` 接口增加 `cwd` 参数，允许用户动态指定 git 仓库根目录，使 worktree 在该仓库下创建和并行执行。

## 背景

当前 `forEachParallel` 硬编码使用 `process.cwd()` 确定 git 仓库路径（`ensureWorktrees` line 464）。用户需要在不同的仓库目录下调用 forEachParallel，而不依赖进程的工作目录。

其他接口（`execPrompt`、`execShell` 等）已通过 `options.cwd` 支持此模式。

## 设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| cwd 位置 | 放在 `ForEachParallelOptions` 中 | 与其他接口的 options.cwd 模式一致 |
| 默认值 | `process.cwd()` | 向后兼容 |
| cwd 含义 | git 仓库根目录 | 由用户确认 |
| 任务目录 | 不变，仍在 process.cwd() 下 | 隔离关注点 |
| 分支合并 | 在 cwd 仓库中执行 | 分支属于 cwd 仓库 |
| remapGlobalPaths | 本次不修改 | 按需后续处理 |

## 变更详情

### 1. ForEachParallelOptions 接口

文件：`src/forEachParallel.ts`

```typescript
export interface ForEachParallelOptions {
  autoConfirmCleanup?: boolean;
  /** 工作目录，指向 git 仓库根目录。默认 process.cwd() */
  cwd?: string;
}
```

### 2. forEachParallel 函数

文件：`src/forEachParallel.ts`

在函数开头解析 effectiveCwd：

```typescript
const effectiveCwd = options?.cwd || process.cwd();
```

传递给 `ensureWorktrees`（第 5 个参数）和 `mainStepWise` 构造。

### 3. ensureWorktrees 函数

文件：`src/forEachParallel.ts`

签名新增 `effectiveCwd` 参数：

```typescript
async function ensureWorktrees(
  workerConfigs: WorkerConfig[],
  isResume: boolean,
  taskDir: string,
  options?: ForEachParallelOptions,
  effectiveCwd?: string
): Promise<string[]>
```

内部将 `const cwd = process.cwd()` 改为 `const cwd = effectiveCwd || process.cwd()`。

### 4. mainStepWise 创建

文件：`src/forEachParallel.ts` line 333

当前：`new StepWise('main')`
改为：`new StepWise('main', effectiveCwd)`

确保合并分支在 cwd 仓库中执行。

## 不变的部分

- Worker StepWise 实例仍使用 workspacePath（worktree）作为 defaultCwd
- `remapGlobalPaths` 保持现状
- 任务目录（stepwise_exec_infos）仍在 process.cwd() 下
- 导出接口无变化

## 影响范围

仅修改 `src/forEachParallel.ts`。完全向后兼容。
