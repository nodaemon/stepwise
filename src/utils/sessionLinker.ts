/**
 * Claude session 跨 cwd 软链工具
 *
 * Claude/CodeAgent 的 session 按 cwd 隔离存储于 ~/.claude/projects/<escaped-cwd>/<sessionId>.jsonl。
 * forEachParallel 的 worker 在独立 git worktree（cwd 与主仓库不同）运行，导致跨目录 resume
 * 报 "No conversation found"。本工具在 fork 场景下把主仓库的 session 文件软链到 worktree
 * 的 projects 目录，使 worktree 能 resume 原会话并派生新会话。
 *
 * 仅 fork（只读原会话派生新会话）使用软链；纯 resume 跨目录会共享写并发，由调用方报错拦截。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureDir } from './fileHelper';

/**
 * 将 cwd 绝对路径转义为 Claude projects 目录名
 * 规则：路径中的 / 全部替换为 -（如 /tmp/fork-test → -tmp-fork-test）
 */
function escapeCwd(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

/**
 * 获取某 cwd 对应的 Claude projects 目录绝对路径
 */
function getProjectsDir(cwd: string): string {
  return path.join(os.homedir(), '.claude', 'projects', escapeCwd(cwd));
}

/**
 * 判断某 sessionId 是否为某 cwd 本地创建的会话（实体文件，非软链）
 * 用于区分"worktree 自建会话（本地，无需跨目录处理）"与"来自主仓库（跨目录，需软链/报错）"
 */
export function isLocalSession(cwd: string, sessionId: string): boolean {
  const file = path.join(getProjectsDir(cwd), `${sessionId}.jsonl`);
  if (!fs.existsSync(file)) return false;
  try {
    // 实体文件（非符号链接）才算本地自建；软链指向的是别处
    return !fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * 在 worktree cwd 对应的 projects 目录里软链主仓库的 session 文件
 * 使 worktree 下 --resume <sessionId> 能跨 cwd 找到原会话（fork 只读，安全）
 *
 * - 主仓库 session 文件不存在则跳过（不报错，可能本就无）
 * - 目标已存在且非符号链接则不覆盖（保护 worktree 自建的同名 session）
 * - 目标是符号链接或不存在则（重新）建立软链
 */
export function linkCrossCwdSession(mainCwd: string, worktreeCwd: string, sessionId: string): void {
  const sourceDir = getProjectsDir(mainCwd);
  const sourceFile = path.join(sourceDir, `${sessionId}.jsonl`);
  if (!fs.existsSync(sourceFile)) {
    // 主仓库无该 session 文件，无法软链；交由 Claude 自然报错
    return;
  }

  const targetDir = getProjectsDir(worktreeCwd);
  ensureDir(targetDir);
  const targetFile = path.join(targetDir, `${sessionId}.jsonl`);

  // 目标已存在且非符号链接 → 不覆盖（worktree 自建的实体 session）
  if (fs.existsSync(targetFile) && !fs.lstatSync(targetFile).isSymbolicLink()) {
    return;
  }

  // 是符号链接或不存在 → 建立/刷新软链
  if (fs.existsSync(targetFile)) {
    fs.unlinkSync(targetFile);
  }
  fs.symlinkSync(sourceFile, targetFile);
}

/**
 * 清理某 worktree cwd 对应 projects 目录下的残留符号链接
 *
 * 注意：当前 forEachParallel 不自动调用此方法——软链残留无害（最坏为 dangling symlink，
 * Claude 自然处理为"找不到会话"），避免删 worktree 时遍历删除的误判风险。
 * 如需手动清理堆积的残留软链，可在外部调用此方法。
 */
export function cleanWorktreeSessionLinks(worktreeCwd: string): void {
  const targetDir = getProjectsDir(worktreeCwd);
  if (!fs.existsSync(targetDir)) return;

  let entries: string[];
  try {
    entries = fs.readdirSync(targetDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(targetDir, entry);
    try {
      if (fs.lstatSync(fullPath).isSymbolicLink()) {
        fs.unlinkSync(fullPath);
      }
    } catch {
      // 单个条目清理失败不阻断整体
    }
  }
}
