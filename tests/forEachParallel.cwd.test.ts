/**
 * forEachParallel cwd 选项测试
 */
import * as path from 'path';
import { setTaskName, _resetState } from '../src';

// 保存真实的 fs 引用，用于 beforeEach/afterEach 中的临时目录管理
const realFs = jest.requireActual('fs') as typeof import('fs');

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
    // 使用真实的 fs 操作管理临时目录
    if (!realFs.existsSync(tempDir)) {
      realFs.mkdirSync(tempDir, { recursive: true });
    }
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    // 使用真实的 fs 操作清理临时目录
    if (realFs.existsSync(tempDir)) {
      realFs.rmSync(tempDir, { recursive: true, force: true });
    }
    _resetState();
  });

  describe('ensureWorktrees 使用 effectiveCwd', () => {
    it('当指定 cwd 时，git 命令应该在指定目录执行', async () => {
      setTaskName('test_cwd_task');
      const customCwd = '/tmp/custom-repo';

      const { forEachParallel } = await import('../src/forEachParallel');

      const items = ['item1'];
      const workerConfigs = [{ branchName: 'Agent1' }];

      try {
        await forEachParallel(items, workerConfigs, async (ctx) => {
          // handler 什么都不做
        }, { cwd: customCwd, autoConfirmCleanup: true });
      } catch {
        // 预期可能因 mock 不完整而报错，我们只关心 execSync 的 cwd 参数
      }

      const calls = (mockedExecSync as jest.Mock).mock.calls;
      const gitCalls = calls.filter(
        (call: [string, any]) =>
          typeof call[0] === 'string' && call[0].includes('git')
      );

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

      const callsWithProcessCwd = gitCalls.filter(
        (call: [string, any]) => call[1]?.cwd === tempDir
      );

      expect(callsWithProcessCwd.length).toBeGreaterThan(0);
    });
  });
});
