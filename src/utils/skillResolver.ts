/**
 * Skill 引用解析
 *
 * 用途：debug 模式的自检复盘要「对 skill 的内容做同样的检查」，
 * 前提是框架能把「提示词要求加载的 skill」定位到具体文件。
 *
 * 定位口径两条，互为补充：
 * 1. **按名字**：框架约定的 skill 目录 `{cwd}/.claude/skills/<name>/SKILL.md`
 *    （与 StepWise.getSkillsDir / findGeneratedSkillFiles 同口径：递归扫描、文件名恰为 SKILL.md），
 *    提示词在「skill 语境」里提到该名字时视为引用了它；
 * 2. **按轨迹**：执行轨迹里出现过的 `…/SKILL.md` 绝对路径——
 *    覆盖 skill 不在 `{cwd}/.claude/skills` 的后端（如 mcode），
 *    也覆盖提示词只写「按 skill 流程」没有点名的情况。
 *
 * 两条纪律（都是为了让「提示词明确要求使用 skill」这个判定可信）：
 * - **只看用户写的内容**：框架注入的文件访问白名单整段剥掉再判定，
 *   否则白名单里出现 `.claude/skills` 路径会让每一步都被误判成「要求用 skill」；
 * - **否定语境不算要求**：「不要使用 skill」「不需要加载任何 skill」不是要求。
 *
 * 本模块是纯函数实现：任何异常都在内部降级为空结果，
 * 绝不因解析失败影响主流程。
 */
import * as fs from 'fs';
import * as path from 'path';

/** 单个 skill 引用 */
export interface SkillRef {
  /** skill 目录名（从路径推断，可能为空串） */
  name: string;
  /** SKILL.md 的绝对路径 */
  filePath: string;
  /** 定位来源：提示词点名 / 执行轨迹中出现 */
  source: 'prompt' | 'trace';
}

/** Skill 解析结果 */
export interface SkillResolution {
  /** 提示词是否明确要求使用 skill */
  required: boolean;
  /** 解析出的 SKILL.md（去重，按发现顺序） */
  skillFiles: SkillRef[];
  /** 要求使用 skill 但未能定位到任何文件 */
  unresolved: boolean;
  /** 候选 skill 目录，供审查者自行查找 */
  skillDirs: string[];
}

/** 框架约定的 skill 目录名（相对 cwd） */
const SKILLS_DIR_RELATIVE = path.join('.claude', 'skills');

/** skill 定义文件名（必须完全等同，MY_SKILL.md 不算） */
const SKILL_FILE_NAME = 'SKILL.md';

/** 框架注入的文件访问策略块起始标记 */
const ACCESS_POLICY_MARKER = '[严格文件访问策略';

/**
 * 「明确要求使用 skill」的判定模式
 *
 * 要求出现「动作动词 + skill」或「skill + 动作动词」，
 * 避免把「这个任务和 skill 无关」这类顺带提及误判为要求加载。
 */
const SKILL_DIRECTIVE_PATTERNS: RegExp[] = [
  // 动词在前：使用 skill / 按 skill 流程 / 加载 skill
  /(加载|载入|使用|调用|按|按照|遵循|参考|应用|读取|读一下|load|use|apply|follow|invoke|read)\s*[^\n]{0,20}\bskills?\b/i,
  // 动词在后：skill 按…执行 / skill 的使用方式
  /\bskills?\b[^\n]{0,20}(加载|载入|使用|调用|遵循|参考|应用|执行|load|use|apply|follow|invoke)/i,
  // 标识符形式：alpha_skill / handle-api-skill / handle_retry_skill
  // （\b 不认下划线，`\bskill\b` 匹配不到 `alpha_skill` 里的 skill；
  //   前缀里可能有多段分隔符，故允许 [A-Za-z0-9_]*）
  /\b[A-Za-z0-9_]*[-_]skills?\b/i,
  // 直接点名文件或目录
  /SKILL\.md/i,
  /\.claude[/\\]skills/i,
  // Skill 工具调用形式
  /Skill\s*\(/i
];

/** 否定词：出现在 skill 提及附近时，该提及不构成「要求使用 skill」 */
const NEGATION_MARKERS = [
  '不要', '别', '无需', '不需要', '不必', '不用', '禁止', '不得', '勿',
  "don't", 'do not', 'no need', 'without', 'avoid', 'skip'
];

/** 否定词与 skill 提及之间允许的最大间隔（字符） */
const NEGATION_GAP = 8;

/** 名字与「skill 语境标记」之间允许的最大间隔（字符） */
const SKILL_CONTEXT_GAP = 30;

/** skill 语境标记：skill / 技能 / 技能包 */
const SKILL_CONTEXT_PATTERN = /\bskills?\b|技能|SKILL\.md/i;

/** 轨迹中 SKILL.md 路径的匹配模式（引号、空格、换行等均为边界） */
const SKILL_PATH_PATTERN = /[^\s"'`<>|()\[\]]*SKILL\.md/g;

/** 正则元字符转义 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 剥掉框架注入的段落，只留用户写的内容
 *
 * 目前会注入且与「skill」判定有关的只有文件访问策略块：
 * 它把允许读写的目录逐行列出，路径里若含 `.claude/skills`，
 * 会被误当成用户在要求使用 skill。
 */
export function stripFrameworkBlocks(text: string): string {
  if (!text) return text;
  const start = text.indexOf(ACCESS_POLICY_MARKER);
  if (start < 0) return text;

  // 该块与用户提示词之间用 --- 分隔
  const sep = text.indexOf('\n---\n', start);
  if (sep < 0) return text.slice(0, start);
  return text.slice(0, start) + text.slice(sep + '\n---\n'.length);
}

/**
 * 判断某处 skill 提及是否处于否定语境
 *
 * 「不要使用 skill」「不需要加载任何 skill」不是「要求使用 skill」。
 * 否定词必须与提及**紧邻**才算否定——中间不能有分句标点，
 * 否则「不要跳过检查，请使用 skill」会被误判成否定。
 */
function isNegatedMention(text: string, matchStart: number, matchEnd: number): boolean {
  const before = text.slice(Math.max(0, matchStart - NEGATION_GAP * 3), matchStart);
  const after = text.slice(matchEnd, matchEnd + NEGATION_GAP);

  for (const marker of NEGATION_MARKERS) {
    const idx = before.toLowerCase().lastIndexOf(marker.toLowerCase());
    if (idx >= 0) {
      const gapText = before.slice(idx + marker.length);
      // 否定词与提及之间隔了分句标点 → 否定管不到这一句
      if (/[，,。.；;！!？?\n]/.test(gapText)) continue;
      if (gapText.length <= NEGATION_GAP) return true;
    }
  }

  // 提及之后紧跟的否定表述：skill 不存在 / skill 未安装 / skill 不可用
  if (/(不需要|不存在|未安装|没有安装|不可用|勿用)/.test(after)) return true;

  return false;
}

/**
 * 判定提示词是否明确要求使用 skill
 *
 * 任一「动词 + skill」型提及不在否定语境里，才算要求。
 */
function detectSkillRequirement(text: string): boolean {
  for (const pattern of SKILL_DIRECTIVE_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = globalPattern.exec(text)) !== null) {
      if (match[0].length === 0) {
        globalPattern.lastIndex++;
        continue;
      }
      if (!isNegatedMention(text, match.index, match.index + match[0].length)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 判断文本是否在「skill 语境」中提到了该名字
 *
 * 名字本身出现在文中不足以说明引用了 skill——「把 pdf 文件转成文本」
 * 不等于引用了名为 pdf 的 skill。命中的条件：
 * - 名字附近有 skill 语境标记（skill / 技能 / SKILL.md），或
 * - 名字本身就带 skill 后缀（alpha_skill / handle-api-skill）
 */
function isSkillNameMentioned(text: string, name: string): boolean {
  if (!name) return false;

  const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(name)}([^A-Za-z0-9_]|$)`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;

    // 名字自带 skill 后缀（alpha_skill）：提到即算，无需再找语境标记
    if (/[-_]skills?$/i.test(name)) return true;

    // 否则要求名字附近有 skill 语境标记（skill / 技能 / SKILL.md）
    const window = text.slice(Math.max(0, start - SKILL_CONTEXT_GAP), end + SKILL_CONTEXT_GAP);
    if (SKILL_CONTEXT_PATTERN.test(window)) return true;

    if (pattern.lastIndex === match.index) pattern.lastIndex++;
  }
  return false;
}

/**
 * 列出候选 skill 目录下的 SKILL.md（递归）
 *
 * 口径与框架的 findGeneratedSkillFiles 一致：递归下钻、文件名恰为 SKILL.md。
 * 目录不存在或不可读时返回空数组。
 */
function listSkillFilesInDir(skillsDir: string): SkillRef[] {
  const refs: SkillRef[] = [];
  const visited = new Set<string>();

  const scan = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const subDir = path.join(dir, entry.name);
      let realPath: string;
      try {
        realPath = fs.realpathSync(subDir);
      } catch {
        realPath = subDir;
      }
      // 防止软链成环
      if (visited.has(realPath)) continue;
      visited.add(realPath);

      const filePath = path.join(subDir, SKILL_FILE_NAME);
      try {
        if (fs.existsSync(filePath)) {
          refs.push({ name: entry.name, filePath, source: 'prompt' });
        }
      } catch {
        // 单个文件探测失败不影响其余结果
      }
      scan(subDir);
    }
  };

  try {
    if (!fs.existsSync(skillsDir)) return refs;
  } catch {
    return refs;
  }
  scan(skillsDir);
  return refs;
}

/**
 * 从执行轨迹里捞出 SKILL.md 路径
 *
 * 轨迹里的路径可能是绝对路径，也可能是相对 cwd 的路径；
 * 相对路径按 cwd 解析后仍需文件真实存在，且文件名必须恰为 SKILL.md
 * （docs/MY_SKILL.md 这类不算）。
 */
function listSkillFilesInTrace(traceText: string, cwd?: string): SkillRef[] {
  const refs: SkillRef[] = [];
  if (!traceText) return refs;

  const matches = traceText.match(SKILL_PATH_PATTERN);
  if (!matches) return refs;

  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:]+$/, '');
    if (!cleaned) continue;
    if (path.basename(cleaned) !== SKILL_FILE_NAME) continue;

    const absolute = path.isAbsolute(cleaned)
      ? cleaned
      : path.resolve(cwd || process.cwd(), cleaned);
    try {
      if (!fs.existsSync(absolute)) continue;
    } catch {
      continue;
    }
    const name = path.basename(path.dirname(absolute));
    refs.push({ name, filePath: absolute, source: 'trace' });
  }
  return refs;
}

/**
 * 解析提示词（与可选的执行轨迹）中引用的 skill
 *
 * @param params.promptText 步骤提示词全文（框架注入的段落会被剥掉再判定）
 * @param params.traceText 执行轨迹全文（可选，仅用于定位 SKILL.md 路径）
 * @param params.cwd 步骤工作目录
 */
export function resolveSkillRefs(params: {
  promptText: string;
  traceText?: string;
  cwd?: string;
}): SkillResolution {
  const { promptText = '', traceText, cwd } = params;

  // 只看用户写的内容：框架注入的访问白名单不算「用户要求使用 skill」
  const userText = stripFrameworkBlocks(promptText);

  const required = detectSkillRequirement(userText);

  const skillsDir = path.resolve(cwd || process.cwd(), SKILLS_DIR_RELATIVE);
  const skillDirs = [skillsDir];

  // 未要求使用 skill：不产出任何 skill 输入
  if (!required) {
    return { required: false, skillFiles: [], unresolved: false, skillDirs };
  }

  const collected: SkillRef[] = [];
  const seen = new Set<string>();

  const push = (ref: SkillRef) => {
    const key = path.resolve(ref.filePath);
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(ref);
  };

  // 1) 按名字定位：提示词在 skill 语境里点名了候选目录下的某个 skill
  for (const ref of listSkillFilesInDir(skillsDir)) {
    if (isSkillNameMentioned(userText, ref.name)) {
      push(ref);
    }
  }

  // 2) 按轨迹定位：轨迹里实际出现过的 SKILL.md
  for (const ref of listSkillFilesInTrace(traceText || '', cwd)) {
    push(ref);
  }

  return {
    required: true,
    skillFiles: collected,
    unresolved: collected.length === 0,
    skillDirs
  };
}
