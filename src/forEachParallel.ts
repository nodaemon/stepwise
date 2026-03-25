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
        const hasInProgress = progress.tasks?.some?.((t: any) => t.status === 'in_progress');
        const status = hasInProgress ? 'in_progress' : 'completed';

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
  const workspacePaths = ensureWorktrees(workerConfigs, isResume);

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
      `如果遇到冲突，请合理解决冲突，优先保留当前分支的修改。` +
      `合并完成后推送到远端。`,
      {
        newSession: true,
        env: config.env
      }
    );
  }
}
