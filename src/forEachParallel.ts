/**
 * forEachParallel - 并发处理数组元素的框架封装
 *
 * 提供完整的工作空间管理：
 * - 自动创建 git worktree
 * - 自动绑定 worker 标识
 * - 自动处理 Resume 逻辑
 */

import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { StepWise } from './StepWise';
import { _getTaskName, _getResumePath, _isDebugMode } from './globalState';

/**
 * Worker 配置
 * 用户只需定义每个 worker 的分支名和环境变量
 */
export interface WorkerConfig {
  /** 分支名，用于创建 git worktree 和作为 worker 标识 */
  branchName: string;
  /** 环境变量数组，格式为 "KEY=VALUE" */
  env?: string[];
}

/**
 * 并发处理选项（预留扩展）
 */
export interface ForEachParallelOptions {
  // 预留扩展
}

/**
 * Worker 上下文
 * 框架提供给用户的所有信息
 */
export interface WorkerContext<T> {
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

/**
 * 并发处理数组元素
 *
 * @param items 要处理的数组
 * @param workerConfigs Worker 配置数组
 * @param handler 处理函数
 * @param options 选项（预留）
 *
 * @example
 * ```typescript
 * import { setTaskName, forEachParallel, WorkerConfig } from 'stepwise';
 *
 * setTaskName("my_task");
 *
 * const workerConfigs: WorkerConfig[] = [
 *   { branchName: "Agent1" },
 *   { branchName: "Agent2" },
 * ];
 *
 * await forEachParallel(items, workerConfigs, async (ctx) => {
 *   // ctx.stepWise 默认在 ctx.workspacePath 下执行任务
 *   // 如需使用其他目录，可手动指定 cwd
 *   await ctx.stepWise.execPrompt("处理任务", {
 *     data: ctx.item,
 *   });
 * });
 * ```
 *
 * @example
 * ```typescript
 * // 使用环境变量配置
 * const workerConfigs: WorkerConfig[] = [
 *   { branchName: "Agent1", env: ["API_KEY=xxx", "NODE_ENV=test"] },
 *   { branchName: "Agent2", env: ["API_KEY=yyy", "NODE_ENV=production"] },
 * ];
 *
 * await forEachParallel(items, workerConfigs, async (ctx) => {
 *   // 每个 Worker 使用各自配置的环境变量执行任务
 *   await ctx.stepWise.execPrompt("调用 API 处理任务", {
 *     data: ctx.item,
 *   });
 * });
 * ```
 */
export async function forEachParallel<T>(
  items: T[],
  workerConfigs: WorkerConfig[],
  handler: (ctx: WorkerContext<T>) => Promise<void>,
  options?: ForEachParallelOptions
): Promise<void> {
  // 0. 前置检查
  const taskName = _getTaskName();
  if (!taskName) {
    throw new Error('[forEachParallel] 请先调用 setTaskName("your_task_name")');
  }

  if (!workerConfigs || workerConfigs.length === 0) {
    throw new Error('[forEachParallel] workerConfigs 不能为空');
  }

  if (!items || items.length === 0) {
    console.log('[forEachParallel] 没有需要处理的元素');
    return;
  }

  const isResume = !!_getResumePath();

  // 1. 确保所有 worktree 已创建
  const workspacePaths = ensureWorktrees(workerConfigs, isResume);

  // 2. 创建主 StepWise（用于最后 merge）
  const mainStepWise = new StepWise('main');

  // 3. 并发执行
  let itemIndex = 0;

  const worker = async (workerIndex: number) => {
    const workerConfig = workerConfigs[workerIndex];
    const workspacePath = workspacePaths[workerIndex];
    const workerId = workerConfig.branchName;

    while (itemIndex < items.length) {
      const currentIndex = itemIndex++;

      // Debug 模式下只处理第一个元素
      if (_isDebugMode() && currentIndex > 0) {
        break;
      }

      const item = items[currentIndex];

      // 创建 StepWise，名称为 index，默认 cwd 为 workspacePath，默认 env 为 workerConfig.env
      // workerId 作为实例属性传入，避免并发时的全局状态竞态
      const stepWise = new StepWise(String(currentIndex), workspacePath, workerConfig.env, workerId);

      const context: WorkerContext<T> = {
        item,
        index: currentIndex,
        workerConfig,
        workspacePath,
        stepWise
      };

      await handler(context);
    }
  };

  // 并发执行所有 worker
  await Promise.all(workerConfigs.map((_, idx) => worker(idx)));

  // 4. 串行执行 merge（任务完成后）
  await mergeWorkerBranches(workerConfigs, mainStepWise);
}

/**
 * 确保所有 worktree 已创建
 */
function ensureWorktrees(workerConfigs: WorkerConfig[], isResume: boolean): string[] {
  const cwd = process.cwd();
  const parentDir = path.dirname(cwd);
  const cwdName = path.basename(cwd);

  // 检查当前是否在 git 仓库中
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
  } catch {
    throw new Error('[forEachParallel] 当前目录不是 git 仓库，无法创建 git worktree');
  }

  const workspacePaths: string[] = [];

  for (const config of workerConfigs) {
    const worktreePath = path.join(parentDir, `${cwdName}_${config.branchName}`);

    if (fs.existsSync(worktreePath)) {
      // 目录已存在
      if (isResume) {
        // Resume 模式：worktree 一定已经存在，直接使用
        console.log(`[forEachParallel] Resume 模式，使用已存在的 worktree: ${worktreePath}`);
        workspacePaths.push(worktreePath);
        continue;
      } else {
        // 非 Resume 模式：报错让用户清理
        throw new Error(
          `[forEachParallel] 目录已存在: ${worktreePath}\n` +
          `如果不是 worktree，请手动删除后重试。\n` +
          `如果是之前创建的 worktree，请先清理: git worktree remove "${worktreePath}"`
        );
      }
    }

    // 非 Resume 模式，目录不存在，创建新 worktree
    console.log(`[forEachParallel] 创建 worktree: ${worktreePath}`);

    // 检查分支是否存在
    let branchExists = false;
    try {
      execSync(`git rev-parse --verify "${config.branchName}"`, { cwd, stdio: 'pipe' });
      branchExists = true;
    } catch {
      branchExists = false;
    }

    if (branchExists) {
      // 分支已存在，检查是否已被其他 worktree 使用
      const worktreeList = execSync('git worktree list', { cwd, encoding: 'utf-8' });
      if (worktreeList.includes(config.branchName)) {
        // 分支已被其他 worktree 使用
        throw new Error(
          `[forEachParallel] 分支 "${config.branchName}" 已被其他 worktree 使用\n` +
          `请先清理: git worktree list\n` +
          `然后: git worktree remove <path>`
        );
      }
      // 分支存在但未被 worktree 使用，创建 worktree
      execSync(`git worktree add "${worktreePath}" "${config.branchName}"`, { cwd, stdio: 'inherit' });
    } else {
      // 分支不存在，创建新分支并创建 worktree
      console.log(`[forEachParallel] 创建分支: ${config.branchName}`);
      execSync(`git worktree add -b "${config.branchName}" "${worktreePath}"`, { cwd, stdio: 'inherit' });
    }

    workspacePaths.push(worktreePath);
  }

  return workspacePaths;
}

/**
 * 将所有 worktree 的分支合并到当前目录
 * 任务完成后串行执行
 */
async function mergeWorkerBranches(
  workerConfigs: WorkerConfig[],
  mainStepWise: StepWise
): Promise<void> {
  for (const config of workerConfigs) {
    console.log(`[forEachParallel] 合并分支: ${config.branchName}`);

    await mainStepWise.execPrompt(
      `将分支 ${config.branchName} 的代码合并到当前分支。` +
      `如果遇到冲突，请合理解决冲突，优先保留当前分支的修改。` +
      `合并完成后推送到远端。`,
      { newSession: true }
    );
  }
}
