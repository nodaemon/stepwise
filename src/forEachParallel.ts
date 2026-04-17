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
import * as readline from 'readline';
import { execSync } from 'child_process';
import { StepWise } from './StepWise';
import { _getTaskName, _getResumePath, _isDebugMode, _getTaskDir, _clearRegisteredNames } from './globalState';
import { DATA_DIR, PROGRESS_FILE } from './constants';

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
 * 并发处理选项
 */
export interface ForEachParallelOptions {
  /**
   * 当发现已存在的 worktree 时，自动执行清理操作而无需用户确认
   * - true: 跳过用户确认，直接清理
   * - false 或 undefined: 提示用户确认（默认行为）
   * @default false
   */
  autoConfirmCleanup?: boolean;
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
 * 任务恢复状态
 */
interface TaskResumeState {
  /** 任务索引 */
  index: number;
  /** Worker 标识 */
  workerId: string;
  /** 任务状态 */
  status: 'completed' | 'in_progress';
  /** 任务目录路径 */
  taskDir: string;
}

/**
 * 扫描已有任务目录，构建恢复状态表
 */
function scanResumeStates(taskDir: string, itemsLength: number): Map<number, TaskResumeState> {
  const states = new Map<number, TaskResumeState>();

  if (!fs.existsSync(taskDir)) {
    return states;
  }

  const entries = fs.readdirSync(taskDir, { withFileTypes: true });
  // 匹配格式: {index}_{workerId}_{timestamp}，例如: 13_TestAgent5_20250101_120000_123
  const pattern = /^(\d+)_(.+)_\d{8}_\d{6}_\d{3}$/;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const match = entry.name.match(pattern);
    if (!match) continue;

    const index = parseInt(match[1], 10);
    const workerId = match[2];

    // 超出范围的任务索引，跳过
    if (index >= itemsLength) continue;

    const progressPath = path.join(taskDir, entry.name, DATA_DIR, PROGRESS_FILE);

    if (fs.existsSync(progressPath)) {
      try {
        const progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
        const isCompleted = progress.isCompleted === true;
        const status = isCompleted ? 'completed' : 'in_progress';

        // 如果已有记录，保留 in_progress 的（优先恢复）
        const existing = states.get(index);
        if (!existing || (existing.status === 'completed' && status === 'in_progress')) {
          states.set(index, {
            index,
            workerId,
            status,
            taskDir: path.join(taskDir, entry.name)
          });
        }
      } catch {
        // progress.json 损坏，视为 in_progress
        states.set(index, {
          index,
          workerId,
          status: 'in_progress',
          taskDir: path.join(taskDir, entry.name)
        });
      }
    }
  }

  return states;
}

/**
 * 检查 forEachParallel 是否已开始执行
 * 通过检查任务目录下是否有任务子目录来判断
 * @param taskDir 任务目录路径
 * @returns 是否已开始执行
 */
function hasForEachParallelStarted(taskDir: string): boolean {
  if (!fs.existsSync(taskDir)) {
    return false;
  }

  const entries = fs.readdirSync(taskDir, { withFileTypes: true });
  // 匹配格式: {index}_{workerId}_{timestamp}
  const pattern = /^(\d+)_.+_\d{8}_\d{6}_\d{3}$/;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (pattern.test(entry.name)) {
      return true;
    }
  }

  return false;
}

/**
 * 用户确认交互
 * @param prompt 提示信息
 * @returns 用户是否确认（true/false）
 */
async function confirmAction(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * 检查目录是否是有效的 git worktree
 * @param worktreePath worktree 目录路径
 * @returns 是否是有效的 git 仓库
 */
function isValidGitWorktree(worktreePath: string): boolean {
  try {
    execSync('git rev-parse --git-dir', { cwd: worktreePath, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 清理已存在的 worktree 和本地分支
 *
 * 处理逻辑：
 * 1. 检查目录是否是有效的 git worktree
 * 2. 如果是有效 worktree，使用 git worktree remove 删除
 * 3. 删除残留目录（如果存在）
 * 4. 删除本地分支（无论是否已推送远端）
 *    这确保新创建的分支基于主工作目录的最新状态
 *
 * @param worktreePath worktree 目录路径
 * @param branchName 分支名称
 * @param cwd 主仓库目录
 */
function cleanWorktree(
  worktreePath: string,
  branchName: string,
  cwd: string
): void {
  console.log(`[forEachParallel] 清理 worktree: ${worktreePath}`);

  // 1. 先清理无效的 worktree 引用（无论目录是否存在）
  //    这确保分支不被占用，可以正常删除
  execSync('git worktree prune', { cwd, stdio: 'pipe' });

  // 2. 检查是否是有效的 git worktree
  const isValidWorktree = fs.existsSync(worktreePath) && isValidGitWorktree(worktreePath);

  if (isValidWorktree) {
    // 是有效的 worktree，使用 git worktree remove 删除
    try {
      execSync(`git worktree remove --force "${worktreePath}"`, { cwd, stdio: 'inherit' });
      console.log(`[forEachParallel] worktree 已删除`);
    } catch {
      // 如果 git worktree remove 失败，手动删除目录
      console.log(`[forEachParallel] git worktree remove 失败，手动删除目录`);
    }
  }

  // 3. 删除残留目录（如果存在）
  if (fs.existsSync(worktreePath)) {
    console.log(`[forEachParallel] 删除目录: ${worktreePath}`);
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }

  // 4. 删除本地分支（无论是否已推送远端）
  //    这确保新创建的分支基于主工作目录的最新状态
  try {
    execSync(`git branch -D "${branchName}"`, { cwd, stdio: 'pipe' });
    console.log(`[forEachParallel] 本地分支 "${branchName}" 已删除`);
  } catch {
    // 分支可能已不存在，忽略错误
  }
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
  const taskDir = _getTaskDir();

  // 恢复模式：清理之前注册的名字，避免名字重复错误
  if (isResume) {
    _clearRegisteredNames();
    console.log('[forEachParallel] 恢复模式：已清理已注册的名字');
  }

  // 1. 确保所有 worktree 已创建
  const workspacePaths = await ensureWorktrees(workerConfigs, isResume, taskDir, options);

  // 2. 恢复模式：扫描已有任务状态
  const resumeStates = isResume ? scanResumeStates(taskDir, items.length) : undefined;

  // 3. 统计恢复信息
  if (resumeStates && resumeStates.size > 0) {
    const completed = [...resumeStates.values()].filter(s => s.status === 'completed').length;
    const inProgress = resumeStates.size - completed;
    console.log(`[forEachParallel] 恢复模式: ${completed} 个任务已完成, ${inProgress} 个任务进行中`);
  }

  // 4. 创建主 StepWise（用于最后 merge）
  const mainStepWise = new StepWise('main');

  // 5. 并发执行
  const recoveredIndices = new Set<number>();  // 记录阶段 A 已恢复的索引
  let newItemIndex = 0;  // 新任务的分配索引

  const worker = async (workerIndex: number) => {
    const workerConfig = workerConfigs[workerIndex];
    const workspacePath = workspacePaths[workerIndex];
    const workerId = workerConfig.branchName;

    // 步骤 A: 恢复自己负责的进行中任务
    if (resumeStates) {
      for (const [index, state] of resumeStates) {
        if (state.workerId === workerId && state.status === 'in_progress') {
          console.log(`[forEachParallel] Worker ${workerId} 恢复任务 ${index}`);

          const stepWise = new StepWise(String(index), workspacePath, workerConfig.env, workerId);
          const context: WorkerContext<T> = {
            item: items[index],
            index,
            workerConfig,
            workspacePath,
            stepWise
          };

          try {
            await handler(context);
          } catch (error) {
            // 构造详细错误信息
            const errorDetails = [
              `[forEachParallel] 执行错误`,
              `  workerId: ${workerId}`,
              `  itemIndex: ${index}`,
              `  workspacePath: ${workspacePath}`,
              `  原始错误: ${error instanceof Error ? error.message : String(error)}`
            ].join('\n');

            // 保留原始堆栈
            const enhancedError = new Error(errorDetails);
            enhancedError.stack = errorDetails + '\n\n原始堆栈:\n' + (error instanceof Error ? error.stack : '');

            throw enhancedError;
          }

          // 标记为已恢复
          recoveredIndices.add(index);
          stepWise.markCompleted();
        }
      }
    }

    // 步骤 B: 处理新任务（或非恢复模式）
    while (newItemIndex < items.length) {
      const currentIndex = newItemIndex++;

      // Debug 模式下只处理第一个元素
      if (_isDebugMode() && currentIndex > 0) {
        break;
      }

      // 恢复模式：检查任务状态
      if (resumeStates) {
        const state = resumeStates.get(currentIndex);

        if (state) {
          if (state.status === 'completed') {
            // 已完成，跳过
            console.log(`[forEachParallel] 跳过已完成的任务 ${currentIndex}`);
            continue;
          }
          if (state.status === 'in_progress') {
            // 所有 in_progress 任务都在步骤 A 中被处理，跳过
            continue;
          }
        }

        // 检查是否已被阶段 A 恢复
        if (recoveredIndices.has(currentIndex)) {
          continue;
        }
      }

      const item = items[currentIndex];
      const stepWise = new StepWise(String(currentIndex), workspacePath, workerConfig.env, workerId);

      const context: WorkerContext<T> = {
        item,
        index: currentIndex,
        workerConfig,
        workspacePath,
        stepWise
      };

      try {
        await handler(context);
        stepWise.markCompleted();
      } catch (error) {
        // 构造详细错误信息
        const errorDetails = [
          `[forEachParallel] 执行错误`,
          `  workerId: ${workerId}`,
          `  itemIndex: ${currentIndex}`,
          `  workspacePath: ${workspacePath}`,
          `  原始错误: ${error instanceof Error ? error.message : String(error)}`
        ].join('\n');

        // 保留原始堆栈
        const enhancedError = new Error(errorDetails);
        enhancedError.stack = errorDetails + '\n\n原始堆栈:\n' + (error instanceof Error ? error.stack : '');

        throw enhancedError;
      }
    }
  };

  // 并发执行所有 worker
  await Promise.all(workerConfigs.map((_, idx) => worker(idx)));
  console.log("[forEachParallel] 已全部执行完成");

  // 6. 整合所有 worker 的报告（任务完成后）
  await mergeWorkerReports(taskDir, workerConfigs);

  // 7. 串行执行 merge（任务完成后）
  await mergeWorkerBranches(workerConfigs, mainStepWise);
}

/**
 * 确保所有 worktree 已创建
 */
async function ensureWorktrees(workerConfigs: WorkerConfig[], isResume: boolean, taskDir: string, options?: ForEachParallelOptions): Promise<string[]> {
  const cwd = process.cwd();
  const parentDir = path.dirname(cwd);
  const cwdName = path.basename(cwd);

  // 检查当前是否在 git 仓库中
  try {
    execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
  } catch {
    throw new Error('[forEachParallel] 当前目录不是 git 仓库，无法创建 git worktree');
  }

  // 1. 先扫描哪些 worktree 目录已存在（非 Resume 模式）
  // 同时清理残留分支（目录不存在但分支存在的情况）
  const existingWorktrees: Array<{ config: WorkerConfig; path: string }> = [];

  if (!isResume) {
    // 先清理无效的 worktree 引用，避免分支被占用导致删除失败
    execSync('git worktree prune', { cwd, stdio: 'pipe' });

    for (const config of workerConfigs) {
      const worktreePath = path.join(parentDir, `${cwdName}_${config.branchName}`);

      // 清理残留分支（即使目录不存在）
      try {
        execSync(`git branch -D "${config.branchName}"`, { cwd, stdio: 'pipe' });
        console.log(`[forEachParallel] 清理残留分支: ${config.branchName}`);
      } catch {
        // 分支不存在，忽略
      }

      if (fs.existsSync(worktreePath)) {
        existingWorktrees.push({
          config,
          path: worktreePath
        });
      }
    }
  }

  // 2. 如果有已存在的，统一提示并确认一次
  if (existingWorktrees.length > 0) {
    console.log('');
    console.log('================================================================================');
    console.log('[forEachParallel] 发现以下已存在的 worktree 目录：');

    for (const item of existingWorktrees) {
      console.log(`  - ${item.path}`);
      console.log(`    分支 "${item.config.branchName}"，执行操作：`);
      console.log(`      1. 删除 worktree 目录`);
      console.log(`      2. 删除本地分支`);
      console.log(`      3. 基于当前 HEAD 创建新分支`);
    }

    console.log('================================================================================');

    // 检查是否自动确认
    const shouldAutoConfirm = options?.autoConfirmCleanup === true;

    let confirmed: boolean;
    if (shouldAutoConfirm) {
      console.log('[forEachParallel] 自动确认清理模式，跳过用户确认');
      confirmed = true;
    } else {
      confirmed = await confirmAction('是否执行以上清理操作？[y/N]: ');
    }

    if (!confirmed) {
      throw new Error(
        '[forEachParallel] 用户取消清理\n' +
        '如需手动处理，请执行: git worktree remove <path>'
      );
    }

    // 3. 执行清理（遇到错误直接退出）
    for (const item of existingWorktrees) {
      cleanWorktree(item.path, item.config.branchName, cwd);
    }
  }

  // 4. 创建所有 worktree（始终基于当前 HEAD 创建新分支）
  const workspacePaths: string[] = [];

  // 判断 forEachParallel 是否已开始执行
  const hasStarted = isResume && hasForEachParallelStarted(taskDir);

  for (const config of workerConfigs) {
    const worktreePath = path.join(parentDir, `${cwdName}_${config.branchName}`);
    const isValidWorktree = fs.existsSync(worktreePath) && isValidGitWorktree(worktreePath);

    if (isResume) {
      if (hasStarted && isValidWorktree) {
        // forEachParallel 已执行且有有效 worktree，直接复用
        console.log(`[forEachParallel] Resume 模式，复用已存在的 worktree: ${worktreePath}`);
        workspacePaths.push(worktreePath);
        continue;
      } else {
        // forEachParallel 未执行或 worktree 无效，清理残留后重新创建
        console.log(`[forEachParallel] Resume 模式，清理残留的分支: ${config.branchName}`);
        cleanWorktree(worktreePath, config.branchName, cwd);
      }
    }

    // 创建 worktree（始终创建新分支，基于当前 HEAD）
    console.log(`[forEachParallel] 创建 worktree: ${worktreePath}`);
    console.log(`[forEachParallel] 创建分支: ${config.branchName}（基于当前 HEAD）`);
    execSync(`git worktree add -b "${config.branchName}" "${worktreePath}"`, { cwd, stdio: 'inherit' });

    workspacePaths.push(worktreePath);
  }

  return workspacePaths;
}

/**
 * 整合所有 worker 的报告文件
 * 将各个 TestAgent 目录下的 report/*.json 文件合并到 taskDir/report/ 目录
 */
async function mergeWorkerReports(taskDir: string, workerConfigs: WorkerConfig[]): Promise<void> {
  const reportDir = path.join(taskDir, 'report');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  console.log(`[forEachParallel] 开始整合报告文件...`);

  // 遍历任务目录下的所有子目录（每个 worker 会创建自己的目录）
  const entries = fs.readdirSync(taskDir, { withFileTypes: true });
  const workerDirs: string[] = [];

  // 匹配格式: {index}_{workerName}_{timestamp}，例如: 63_TestAgent4_20260319_102847_757
  const workerDirPattern = /^\d+_.+_\d{8}_\d{6}_\d{3}$/;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!workerDirPattern.test(entry.name)) continue;
    if (entry.name === 'logs' || entry.name === 'report') continue;

    workerDirs.push(path.join(taskDir, entry.name));
  }

  console.log(`[forEachParallel] 找到 ${workerDirs.length} 个 worker 目录`);

  // 收集所有报告数据
  const allReports: Map<string, any[]> = new Map();

  for (const workerDir of workerDirs) {
    const workerReportDir = path.join(workerDir, 'report');
    if (!fs.existsSync(workerReportDir)) continue;

    const files = fs.readdirSync(workerReportDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const filePath = path.join(workerReportDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (Array.isArray(data)) {
          const existing = allReports.get(file) || [];
          allReports.set(file, [...existing, ...data]);
        }
      } catch (error) {
        console.warn(`[forEachParallel] 读取报告文件失败: ${filePath}`);
      }
    }
  }

  // 写入合并后的报告文件
  for (const [fileName, data] of allReports.entries()) {
    const outputPath = path.join(reportDir, fileName);
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[forEachParallel] 合并报告: ${fileName} (${data.length} 条记录)`);
  }

  console.log(`[forEachParallel] 报告整合完成，共 ${allReports.size} 个文件`);
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
      `如果遇到冲突，请合理解决冲突，优先保留当前分支的修改。`,
      {
        newSession: true,
        env: config.env
      }
    );
  }
}
