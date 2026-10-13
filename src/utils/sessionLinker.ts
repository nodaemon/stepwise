/**
 * Claude session 跨 cwd 软链工具
 *
 * Claude/CodeAgent 的 session 按 cwd 隔离存储：
 * - Claude Code: ~/.claude/projects/<escaped-cwd>/<sessionId>.jsonl
 * - CodeAgent: ~/.cac/projects/<escaped-cwd>/<sessionId>.jsonl
 *   若设置了 CODEAGENTS3_CONFIG_DIR，则为 $CODEAGENTS3_CONFIG_DIR/projects/<escaped-cwd>/<sessionId>.jsonl
 * forEachParallel 的 worker 在独立 git worktree（cwd 与主仓库不同）运行，导致跨目录 resume
 * 报 "No conversation found"。本工具在 fork 场景下把主仓库的 session 文件软链到 worktree
 * 的 projects 目录，使 worktree 能 resume 原会话并派生新会话。
 *
 * 仅 fork（只读原会话派生新会话）使用软链；纯 resume 跨目录会共享写并发，由调用方报错拦截。
 * OpenCode 不按 cwd 文件隔离（全局 db），本工具对其不适用，调用方应跳过。
 *
 * 【安全不变量】本模块只创建/读取软链，永不删除 session 实体文件。
 * 框架内不存在任何删除 session 文件的代码路径。残留软链无害（dangling symlink
 * 会被执行器自然处理为"找不到会话"），因此不做任何自动清理。
 *
 * 【日志约定】本模块所有文件操作都有日志留痕，包括"源文件不存在直接返回"这类
 * 静默分支。log 参数缺省为 defaultLog（输出到 console），绝不使用 no-op，
 * 保证任何调用路径都不会无声失败。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureDir } from './fileHelper';

/**
 * 各执行器的 session 存储 config 目录名（相对 ~，除非被环境变量覆盖）
 *
 * 注意：这里的 value 才是要传给下方各函数的「目录标记」，本映射的 key 是 agentType。
 * 调用方应传 value（'.claude' / '.cac' / '.pi'），而不是 key（'claude' / 'codeagent' / 'pi'）。
 *
 * - claude: ~/.claude
 * - codeagent: ~/.cac（若设置了 CODEAGENTS3_CONFIG_DIR 则用该目录，见 resolveConfigDir）
 * - pi: ~/.pi/agent（若设置了 PI_CODING_AGENT_DIR 则用该目录；session 路径还多一层 sessions/--<cwd>--）
 */
const CONFIG_SUBDIR: Record<string, string> = {
  claude: '.claude',
  codeagent: '.cac',
  pi: '.pi'
};

/**
 * 将 cwd 绝对路径转义为 projects 目录名（Claude/CodeAgent 格式）
 * 规则：所有非字母数字字符替换为 -（如 /tmp/Code_Agent1 → -tmp-Code-Agent1）
 * 实机验证：Claude/CodeAgent 把 / _ . 空格 @ # + ( ) 等特殊字符统一转为 -
 */
function escapeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * 将 cwd 绝对路径转义为 pi 的 sessions 目录名
 * 规则：去掉前导 / 或 \，将 / \ : 替换为 -，前后加 --
 * 如 /tmp/Code_Agent1 → --tmp-Code-Agent1--
 */
function escapeCwdForPi(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

/**
 * 解析某执行器的 config 根目录绝对路径
 *
 * - claude: ~/.claude
 * - codeagent: $CODEAGENTS3_CONFIG_DIR，未设置（或空串）时回退 ~/.cac
 * - pi: $PI_CODING_AGENT_DIR，未设置（或空串）时回退 ~/.pi/agent
 *
 * 环境变量取值逐字使用，不做 ~ 展开或相对路径解析——保持与被调用方
 * （CodeAgent / Pi 自身）对同一变量的解释一致，避免两边指向不同目录。
 *
 * @param configSubdir config 目录标记（如 .claude / .cac / .pi），由执行器类型决定
 */
function resolveConfigDir(configSubdir: string): string {
  if (configSubdir === '.cac') {
    // CodeAgent 支持 CODEAGENTS3_CONFIG_DIR 指定配置目录，未设置时用默认的 ~/.cac
    return process.env.CODEAGENTS3_CONFIG_DIR
      || path.join(os.homedir(), '.cac');
  }
  if (configSubdir === '.pi') {
    // Pi 默认 ~/.pi/agent，可通过 PI_CODING_AGENT_DIR 环境变量覆盖
    return process.env.PI_CODING_AGENT_DIR
      || path.join(os.homedir(), '.pi', 'agent');
  }
  return path.join(os.homedir(), configSubdir);
}

/**
 * 获取某 cwd 对应的 session 存储目录绝对路径
 * @param configSubdir config 目录标记（如 .claude / .cac / .pi），由执行器类型决定
 * @param cwd 工作目录绝对路径
 */
function getProjectsDir(configSubdir: string, cwd: string): string {
  const configDir = resolveConfigDir(configSubdir);
  if (configSubdir === '.pi') {
    // pi: <configDir>/sessions/--<escaped-cwd>--
    return path.join(configDir, 'sessions', escapeCwdForPi(cwd));
  }
  // Claude/CodeAgent: <configDir>/projects/<escaped-cwd>
  return path.join(configDir, 'projects', escapeCwd(cwd));
}

/**
 * 在 pi session 目录里按后缀查找 sessionId 对应的文件
 * pi 文件格式: <timestamp>_<sessionId>.jsonl，需用 endsWith 而非精确匹配
 * @returns 实体文件（非软链）的路径，未找到返回 null
 */
function findPiSessionFilePath(sessionDir: string, sessionId: string): string | null {
  if (!fs.existsSync(sessionDir)) return null;
  try {
    const files = fs.readdirSync(sessionDir);
    for (const f of files) {
      if (f.endsWith(`_${sessionId}.jsonl`)) {
        const full = path.join(sessionDir, f);
        // 实体文件（非软链）才算本地自建
        if (!fs.lstatSync(full).isSymbolicLink()) {
          return full;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 软链流程的日志回调。
 * 默认实现输出到 console；StepWise 会传入同时写 execute.log 的实现。
 * 生产代码不应传入空函数（会重新引入静默失败）。
 */
export type SessionLinkLog = (message: string) => void;

/** 默认日志实现：绝不静默，保证任何调用路径都有留痕 */
const defaultLog: SessionLinkLog = (message: string): void => {
  console.log(`[sessionLinker] ${message}`);
};

/**
 * 判断某 sessionId 是否为某 cwd 本地创建的会话（实体文件，非软链）
 * 用于区分"worktree 自建会话（本地，无需跨目录处理）"与"来自主仓库（跨目录，需软链/报错）"
 * @param configSubdir config 目录标记（如 .claude / .cac / .pi），由执行器类型决定
 * @param log 日志回调，缺省输出到 console
 */
export function isLocalSession(
  configSubdir: string,
  cwd: string,
  sessionId: string,
  log: SessionLinkLog = defaultLog
): boolean {
  const sessionDir = getProjectsDir(configSubdir, cwd);

  // pi 文件名为 <timestamp>_<sessionId>.jsonl，需按后缀匹配
  if (configSubdir === '.pi') {
    const found = findPiSessionFilePath(sessionDir, sessionId) !== null;
    log(`探测 pi 会话目录: ${sessionDir} → 判定: ${found ? '本地实体会话' : '非本地（文件不存在或为软链）'}`);
    return found;
  }

  // Claude/CodeAgent: 精确文件名匹配
  const file = path.join(sessionDir, `${sessionId}.jsonl`);
  log(`探测会话文件: ${file}`);
  if (!fs.existsSync(file)) {
    log(`判定: 非本地（文件不存在或为软链）: ${file}`);
    return false;
  }
  try {
    const isLocal = !fs.lstatSync(file).isSymbolicLink();
    log(`判定: ${isLocal ? '本地实体会话' : '非本地（文件存在但为软链）'}: ${file}`);
    return isLocal;
  } catch (e) {
    log(`判定: 非本地（lstat 失败: ${e instanceof Error ? e.message : String(e)}）: ${file}`);
    return false;
  }
}

/**
 * 在 pi session 目录里查找 sessionId 对应的文件路径（实体或软链均可）
 * 用于 linkCrossCwdSession 跨目录软链场景
 * @returns 文件路径，未找到返回 null
 */
export function findPiSessionFile(sessionDir: string, sessionId: string): string | null {
  if (!fs.existsSync(sessionDir)) return null;
  try {
    const files = fs.readdirSync(sessionDir);
    for (const f of files) {
      if (f.endsWith(`_${sessionId}.jsonl`)) {
        return path.join(sessionDir, f);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 在 worktree cwd 对应的 projects 目录里软链主仓库的 session 文件
 * 使 worktree 下 --resume <sessionId> 能跨 cwd 找到原会话（fork 只读，安全）
 *
 * - 主仓库 session 文件不存在则记录日志并跳过（不报错，交由执行器处理）
 * - 目标已存在且非符号链接则记录日志并跳过（保护 worktree 自建的同名 session）
 * - 目标是符号链接或不存在则（重新）建立软链
 *
 * 【安全】本函数只创建 worktree 侧的软链，绝不删除源 session 文件。
 *
 * @param configSubdir config 目录标记（如 .claude / .cac），由执行器类型决定
 * @param log 日志回调，缺省输出到 console
 */
export function linkCrossCwdSession(
  configSubdir: string,
  mainCwd: string,
  worktreeCwd: string,
  sessionId: string,
  log: SessionLinkLog = defaultLog
): void {
  try {
    const sourceDir = getProjectsDir(configSubdir, mainCwd);
    log(`解析源目录（主仓库）: ${sourceDir}`);

    // pi 文件名为 <timestamp>_<sessionId>.jsonl，按后缀匹配查找源文件
    const sourceFile = configSubdir === '.pi'
      ? findPiSessionFile(sourceDir, sessionId)
      : path.join(sourceDir, `${sessionId}.jsonl`);
    log(
      configSubdir === '.pi'
        ? `按后缀匹配定位源文件: ${sourceDir} → ${sourceFile ?? '(未找到)'}`
        : `定位源文件: ${sourceFile}`
    );

    if (!sourceFile || !fs.existsSync(sourceFile)) {
      // 主仓库无该 session 文件，无法软链；交由执行器自然报错
      log(`源会话文件不存在，跳过建链（不报错，交由执行器处理）: ${sourceFile ?? '(未定位到源文件)'}`);
      return;
    }

    // 源文件本身是软链属于异常情况（正常流程下主仓会话应为实体文件），记录以便排查
    try {
      if (fs.lstatSync(sourceFile).isSymbolicLink()) {
        log(`警告：源文件本身是符号链接（异常情况）: ${sourceFile} → ${fs.readlinkSync(sourceFile)}`);
      }
    } catch {
      // lstat 失败不影响建链流程
    }

    const targetDir = getProjectsDir(configSubdir, worktreeCwd);
    log(`解析目标目录（worktree）: ${targetDir}`);
    const targetExisted = fs.existsSync(targetDir);
    ensureDir(targetDir);
    log(targetExisted ? `目标目录已就绪: ${targetDir}` : `新建目标目录: ${targetDir}`);

    const targetFile = path.join(targetDir, `${sessionId}.jsonl`);

    // 目标已存在且非符号链接 → 不覆盖（worktree 自建的实体 session）
    if (fs.existsSync(targetFile) && !fs.lstatSync(targetFile).isSymbolicLink()) {
      log(`目标已是实体会话文件，按保护规则不覆盖: ${targetFile}`);
      return;
    }

    // 是符号链接或不存在 → 建立/刷新软链
    if (fs.existsSync(targetFile)) {
      let oldTarget = '(读取失败)';
      try {
        oldTarget = fs.readlinkSync(targetFile);
      } catch {
        // 读不到旧指向不影响删除与重建
      }
      log(`删除旧软链: ${targetFile} → ${oldTarget}`);
      fs.unlinkSync(targetFile);
    }
    fs.symlinkSync(sourceFile, targetFile);
    log(`建立软链: ${sourceFile} → ${targetFile}`);
  } catch (e) {
    // 仅记录后原样抛出，不改变既有错误传播语义（EEXIST/EACCES 等仍向上抛）
    log(`软链创建失败: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

// 保留 CONFIG_SUBDIR 供未来按 agentType 查询（当前调用方直接传 configSubdir 字符串）
export { CONFIG_SUBDIR };

