# forEachParallel cwd 支持实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 forEachParallel 增加 cwd 选项，允许指定 git 仓库根目录来创建 worktree 和执行并行任务。

**Architecture:** 在 ForEachParallelOptions 中新增 cwd 字段，通过 effectiveCwd 变量传递到 ensureWorktrees 和 mainStepWise 构造函数，替换硬编码的 process.cwd()。

**Tech Stack:** TypeScript, Jest, Node.js child_process (execSync)

---

### Task 1: ForEachParallelOptions 接口增加 cwd 字段

**Files:**
- Modify: `src/forEachParallel.ts:32-40`

- [ ] **Step 1: 在 ForEachParallelOptions 接口中增加 cwd 字段**

在 `src/forEachParallel.ts` 的 `ForEachParallelOptions` 接口中增加 `cwd` 属性：

```typescript
export interface ForEachParallelOptions {
  /**
   * 当发现已存在的 worktree 时，自动执行清理操作而无需用户确认
   * - true: 跳过用户确认，直接清理
   * - false 或 undefined: 提示用户确认（默认行为）
   * @default false
   */
  autoConfirmCleanup?: boolean;
  /**
   * 工作目录，指向 git 仓库根目录
   * forEachParallel 将在该目录对应的 git 仓库中创建 worktree 并并行执行
   * @default process.cwd()
   */
  cwd?: string;
}
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/forEachParallel.ts
git commit -m "feat: add cwd field to ForEachParallelOptions interface"
```

---

### Task 2: forEachParallel 函数解析 effectiveCwd 并传递

**Files:**
- Modify: `src/forEachParallel.ts:289-333`

- [ ] **Step 1: 在 forEachParallel 函数中解析 effectiveCwd**

在 `src/forEachParallel.ts` 的 `forEachParallel` 函数中，在 `const isResume = ...` 之前增加 effectiveCwd 解析，并修改 ensureWorktrees 调用和 mainStepWise 创建。

找到以下代码（约 line 310-333）：

```typescript
  const isResume = !!_getResumePath();
  const taskDir = _getTaskDir();
```

在 `const isResume` 之前插入：

```typescript
  const effectiveCwd = options?.cwd || process.cwd();
```

然后修改 line 320 的 ensureWorktrees 调用：

```typescript
  // 当前：
  const workspacePaths = await ensureWorktrees(workerConfigs, isResume, taskDir, options);
  // 改为：
  const workspacePaths = await ensureWorktrees(workerConfigs, isResume, taskDir, options, effectiveCwd);
```

然后修改 line 333 的 mainStepWise 创建：

```typescript
  // 当前：
  const mainStepWise = new StepWise('main');
  // 改为：
  const mainStepWise = new StepWise('main', effectiveCwd);
```

- [ ] **Step 2: 验证 TypeScript 编译通过**

Run: `npx tsc --noEmit`
Expected: 报错 `ensureWorktrees` 参数不匹配（因为签名还没改），这是预期的

---

### Task 3: ensureWorktrees 函数签名和实现修改

**Files:**
- Modify: `src/forEachParallel.ts:463-574`

- [ ] **Step 1: 修改 ensureWorktrees 函数签名**

找到（line 463）：

```typescript
async function ensureWorktrees(workerConfigs: WorkerConfig[], isResume: boolean, taskDir: string, options?: ForEachParallelOptions): Promise<string[]> {
```

替换为：

```typescript
async function ensureWorktrees(workerConfigs: WorkerConfig[], isResume: boolean, taskDir: string, options?: ForEachParallelOptions, effectiveCwd?: string): Promise<string[]> {
```

- [ ] **Step 2: 修改 ensureWorktrees 内部的 cwd 解析**

找到（line 464）：

```typescript
  const cwd = process.cwd();
```

替换为：

```typescript
  const cwd = effectiveCwd || process.cwd();
```

- [ ] **Step 3: 验证 TypeScript 编译通过**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/forEachParallel.ts
git commit -m "feat: pass effectiveCwd through forEachParallel to ensureWorktrees and mainStepWise"
```

---

### Task 4: 编写 forEachParallel cwd 单元测试

**Files:**
- Create: `tests/forEachParallel.cwd.test.ts`

- [ ] **Step 1: 创建测试文件，编写验证 cwd 传递的测试**

创建 `tests/forEachParallel.cwd.test.ts`：

```typescript
/**
 * forEachParallel cwd 选项测试
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { setTaskName, _resetState, _setTaskDir } from '../src';

// 模块级 mock：拦截 child_process.execSync 以验证 cwd 参数
jest.mock('child_process', () => {
  const original = jest.requireActual('child_process');
  return {
    ...original,
    execSync: jest.fn((cmd: string, options?: any) => {
      // git rev-parse --git-dir 在验证阶段需要返回成功
      if (cmd === 'git rev-parse --git-dir') {
        return '';
      }
      // git worktree prune 也返回空
      if (cmd.includes('git worktree prune')) {
        return '';
      }
      // git branch -D 也返回空（分支不存在）
      if (cmd.includes('git branch -D')) {
        return '';
      }
      // git worktree add 返回空
      if (cmd.includes('git worktree add')) {
        return '';
      }
      // 其他命令委托给原始实现
      return original.execSync(cmd, options);
    }),
  };
});

// 模块级 mock：拦截 fs 的部分方法以避免实际文件操作
jest.mock('fs', () => {
  const original = jest.requireActual('fs');
  return {
    ...original,
    existsSync: jest.fn((p: string) => {
      // worktree 目录不存在（新创建场景）
      return false;
    }),
    readdirSync: jest.fn((p: string, options?: any) => {
      return [];
    }),
    mkdirSync: jest.fn(),
    rmSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(),
  };
});

// 模块级 mock：阻止 readline 交互
jest.mock('readline', () => ({
  createInterface: jest.fn(() => ({
    question: jest.fn(),
    close: jest.fn(),
  })),
}));

// 导入 mock 后的模块
import { execSync as mockedExecSync } from 'child_process';

describe('forEachParallel cwd 选项', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    _resetState();
    jest.clearAllMocks();

    tempDir = path.join(__dirname, '.temp_foreach_cwd_test');
    originalCwd = process.cwd();
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    // 只清理测试创建的临时目录，不影响 mock
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    _resetState();
  });

  describe('ensureWorktrees 使用 effectiveCwd', () => {
    it('当指定 cwd 时，git 命令应该在指定目录执行', async () => {
      setTaskName('test_cwd_task');
      const customCwd = '/tmp/custom-repo';

      // 动态导入以使用 mock
      const { forEachParallel } = await import('../src/forEachParallel');

      // forEachParallel 会执行，但大部分操作被 mock
      // 我们只验证 execSync 收到的 cwd 参数
      const items = ['item1'];
      const workerConfigs = [{ branchName: 'Agent1' }];

      try {
        await forEachParallel(items, workerConfigs, async (ctx) => {
          // handler 什么都不做
        }, { cwd: customCwd, autoConfirmCleanup: true });
      } catch {
        // 预期可能因 mock 不完整而报错，我们只关心 execSync 的 cwd 参数
      }

      // 验证 execSync 调用中有使用 customCwd 作为 cwd
      const calls = (mockedExecSync as jest.Mock).mock.calls;
      const gitCalls = calls.filter(
        (call: [string, any]) =>
          typeof call[0] === 'string' && call[0].includes('git')
      );

      // 至少有一条 git 命令使用了 customCwd
      const callsWithCustomCwd = gitCalls.filter(
        (call: [string, any]) => call[1]?.cwd === customCwd
      );

      expect(callsWithCustomCwd.length).toBeGreaterThan(0);
    });

    it('当未指定 cwd 时，git 命令使用 process.cwd()', async () => {
      setTaskName('test_no_cwd_task');

      const { forEachParallel } = await import('../src/forEachParallel');

      const items = ['item1'];
      const workerConfigs = [{ branchName: 'Agent1' }];

      try {
        await forEachParallel(items, workerConfigs, async (ctx) => {}, {
          autoConfirmCleanup: true,
        });
      } catch {
        // 预期可能因 mock 不完整而报错
      }

      const calls = (mockedExecSync as jest.Mock).mock.calls;
      const gitCalls = calls.filter(
        (call: [string, any]) =>
          typeof call[0] === 'string' && call[0].includes('git')
      );

      // git 命令使用 process.cwd()（即 tempDir）
      const callsWithProcessCwd = gitCalls.filter(
        (call: [string, any]) => call[1]?.cwd === tempDir
      );

      expect(callsWithProcessCwd.length).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: 运行测试，确认测试可通过**

Run: `npx jest tests/forEachParallel.cwd.test.ts --verbose`
Expected: 测试通过（可能需要根据 mock 行为调整）

- [ ] **Step 3: Commit**

```bash
git add tests/forEachParallel.cwd.test.ts
git commit -m "test: add forEachParallel cwd option tests"
```

---

### Task 5: 更新文档

**Files:**
- Modify: `doc/api.md` (约 line 896-925)
- Modify: `doc/api_cn.md` (对应中文部分)
- Modify: `README.md` (约 line 107 之后)
- Modify: `README_CN.md` (约 line 107 之后)
- Modify: `demos.md` (约 line 275 之后)

- [ ] **Step 1: 更新 doc/api.md 中 ForEachParallelOptions 接口文档**

找到 `doc/api.md` 中 `ForEachParallelOptions` 接口定义区域（约 line 896-925），在 `autoConfirmCleanup` 之后增加 `cwd` 字段说明：

```typescript
interface ForEachParallelOptions {
  /**
   * When existing worktrees are found, automatically execute cleanup without user confirmation
   * - true: Skip user confirmation and proceed with cleanup directly
   * - false or undefined: Prompt user for confirmation (default)
   * @default false
   */
  autoConfirmCleanup?: boolean;
  /**
   * Working directory, pointing to a git repository root directory.
   * forEachParallel will create worktrees in this repository for parallel execution.
   * @default process.cwd()
   */
  cwd?: string;
}
```

并在示例代码区域（约 line 919-924）补充 cwd 用法示例：

```typescript
// Specify a different git repo as working directory
await forEachParallel(items, workerConfigs, handler, {
  cwd: '/path/to/other-repo'
});
```

- [ ] **Step 2: 更新 doc/api_cn.md 中对应的中文文档**

找到 `doc/api_cn.md` 中 `ForEachParallelOptions` 部分，同步增加 `cwd` 字段的中文说明：

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
}
```

并在示例代码区域补充 cwd 用法示例。

- [ ] **Step 3: 更新 README.md 示例**

在 `README.md` 的 forEachParallel 代码块之后（约 line 112 之后），补充 cwd 用法注释：

```typescript
// Specify a different git repo as working directory
await forEachParallel(apis, workerConfigs, async (ctx) => {
  await ctx.stepWise.execPrompt(
    'Generate test for API: $name ($method $path)',
    { data: ctx.item }
  );
}, { cwd: '/path/to/other-repo' });
```

- [ ] **Step 4: 更新 README_CN.md 示例**

在 `README_CN.md` 的 forEachParallel 代码块之后（约 line 112 之后），补充 cwd 用法中文注释：

```typescript
// 指定不同的 git 仓库作为工作目录
await forEachParallel(apis, workerConfigs, async (ctx) => {
  await ctx.stepWise.execPrompt(
    '为 API 生成测试: $name ($method $path)',
    { data: ctx.item }
  );
}, { cwd: '/path/to/other-repo' });
```

- [ ] **Step 5: 更新 demos.md 示例**

在 `demos.md` 的 parallel processing 部分（约 line 275 之后），补充一个 cwd 用法的示例代码块：

```typescript
// Parallel processing with custom working directory
await forEachParallel(items, workerConfigs, async (ctx) => {
  await ctx.stepWise.execPrompt('Process task', { data: ctx.item });
}, { cwd: '/path/to/other-repo' });
```

- [ ] **Step 6: Commit**

```bash
git add doc/api.md doc/api_cn.md README.md README_CN.md demos.md
git commit -m "docs: add cwd option documentation for forEachParallel"
```
