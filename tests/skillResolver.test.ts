/**
 * Skill 引用解析测试
 *
 * 覆盖自检复盘定位「提示词要求加载的 skill」的四种情形：
 * 1. 提示词点名了候选目录下的 skill
 * 2. 提示词只泛泛提到 skill，但执行轨迹里出现过 SKILL.md 路径
 * 3. 提示词完全没提 skill —— 不应产生任何 skill 输入
 * 4. 要求使用但定位不到 —— unresolved
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolveSkillRefs } from '../src/utils/skillResolver';

describe('resolveSkillRefs', () => {
  let tempDir: string;

  const writeSkill = (name: string, content = '# skill\n'): string => {
    const dir = path.join(tempDir, '.claude', 'skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf-8');
    return path.join(dir, 'SKILL.md');
  };

  beforeEach(() => {
    tempDir = path.join(__dirname, '.temp_skill_resolver_test');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('提示词点名 skill 时应解析出对应文件', () => {
    const skillFile = writeSkill('handle_api_retry');

    const result = resolveSkillRefs({
      promptText: '请使用 handle_api_retry skill 处理重试逻辑',
      cwd: tempDir
    });

    expect(result.required).toBe(true);
    expect(result.unresolved).toBe(false);
    expect(result.skillFiles.map(s => s.filePath)).toContain(skillFile);
    expect(result.skillFiles[0].name).toBe('handle_api_retry');
    expect(result.skillFiles[0].source).toBe('prompt');
  });

  it('提示词未点名、但轨迹里出现过 SKILL.md 路径时应解析成功', () => {
    const otherDir = path.join(tempDir, 'runtime', 'skills', 'pdf_tool');
    fs.mkdirSync(otherDir, { recursive: true });
    const skillFile = path.join(otherDir, 'SKILL.md');
    fs.writeFileSync(skillFile, '# pdf_tool\n', 'utf-8');

    const result = resolveSkillRefs({
      promptText: '按照 skill 的流程处理这个文件',
      traceText: `[Read]\n  File: ${skillFile}\n`,
      cwd: tempDir
    });

    expect(result.required).toBe(true);
    expect(result.skillFiles.map(s => s.filePath)).toContain(skillFile);
    expect(result.skillFiles[0].source).toBe('trace');
  });

  it('提示词完全没提 skill 时不应产生 skill 输入', () => {
    writeSkill('handle_api_retry');

    const result = resolveSkillRefs({
      promptText: '把这段代码翻译成英文',
      cwd: tempDir
    });

    expect(result.required).toBe(false);
    expect(result.skillFiles).toHaveLength(0);
    expect(result.unresolved).toBe(false);
  });

  it('只提到 skill 但没有加载动作时不算「明确要求」', () => {
    writeSkill('handle_api_retry');

    const result = resolveSkillRefs({
      promptText: '这个任务和 skill 无关，直接做即可',
      cwd: tempDir
    });

    expect(result.required).toBe(false);
    expect(result.skillFiles).toHaveLength(0);
  });

  it('要求使用 skill 但定位不到文件时应标记 unresolved', () => {
    const result = resolveSkillRefs({
      promptText: '请加载 nonexistent_skill 完成本步骤',
      cwd: tempDir
    });

    expect(result.required).toBe(true);
    expect(result.skillFiles).toHaveLength(0);
    expect(result.unresolved).toBe(true);
    // 候选目录仍要给出，供审查者自行查找
    expect(result.skillDirs.length).toBeGreaterThan(0);
  });

  it('skill 目录不存在时返回空结果且不抛错', () => {
    const result = resolveSkillRefs({
      promptText: '请使用 handle_api_retry skill',
      cwd: path.join(tempDir, 'not_exist_dir')
    });

    expect(result.required).toBe(true);
    expect(result.skillFiles).toHaveLength(0);
    expect(result.unresolved).toBe(true);
  });

  it('同一个 skill 被提示词与轨迹同时命中时只保留一份', () => {
    const skillFile = writeSkill('handle_api_retry');

    const result = resolveSkillRefs({
      promptText: '请使用 handle_api_retry skill',
      traceText: `[Read]\n  File: ${skillFile}\n`,
      cwd: tempDir
    });

    expect(result.skillFiles).toHaveLength(1);
    expect(result.skillFiles[0].filePath).toBe(skillFile);
  });

  it('多个 skill 都能被识别', () => {
    const a = writeSkill('alpha_skill');
    const b = writeSkill('beta_skill');

    const result = resolveSkillRefs({
      promptText: '请先使用 alpha_skill，再使用 beta_skill',
      cwd: tempDir
    });

    const paths = result.skillFiles.map(s => s.filePath);
    expect(paths).toContain(a);
    expect(paths).toContain(b);
  });

  it('名字只是更长单词的一部分时不应误判', () => {
    writeSkill('pdf');

    const result = resolveSkillRefs({
      promptText: '请加载 pdf2text skill 目录里的内容',
      cwd: tempDir
    });

    // 提示词确实要求使用 skill（应进入解析流程）
    expect(result.required).toBe(true);
    // 但名字只是更长单词的一部分，不该被当成引用了 pdf 这个 skill
    expect(result.skillFiles).toHaveLength(0);
  });

  describe('否定语境不算「要求使用 skill」', () => {
    const negativeCases = [
      '请不要使用 skill，直接处理这个文件',
      '本任务不需要加载任何 skill',
      '无需按 skill 流程执行',
      '禁止使用 skill',
      "don't use any skill for this task"
    ];

    negativeCases.forEach((prompt) => {
      it(`不应把「${prompt}」判为要求使用 skill`, () => {
        writeSkill('handle_api_retry');

        const result = resolveSkillRefs({ promptText: prompt, cwd: tempDir });

        expect(result.required).toBe(false);
        expect(result.skillFiles).toHaveLength(0);
        expect(result.unresolved).toBe(false);
      });
    });

    it('否定词与 skill 提及之间隔了分句标点时，不算否定', () => {
      writeSkill('handle_api_retry');

      const result = resolveSkillRefs({
        promptText: '不要跳过检查，请使用 handle_api_retry skill',
        cwd: tempDir
      });

      expect(result.required).toBe(true);
      expect(result.skillFiles.map(s => s.name)).toContain('handle_api_retry');
    });
  });

  describe('框架注入的段落不算用户要求', () => {
    it('文件访问白名单里出现 .claude/skills 不应被判为要求使用 skill', () => {
      writeSkill('handle_api_retry');

      const accessPrompt = [
        '[严格文件访问策略 - 必须遵守]',
        '允许读取的目录（只能读取以下路径中的文件）:',
        `  - ${path.join(tempDir, '.claude', 'skills')}`,
        '重要约束:',
        '- 禁止读取上述目录以外的任何文件'
      ].join('\n');

      const result = resolveSkillRefs({
        promptText: `${accessPrompt}\n\n---\n\n请统计这批文件的行数`,
        cwd: tempDir
      });

      expect(result.required).toBe(false);
      expect(result.skillFiles).toHaveLength(0);
    });

    it('白名单 + 真实要求时，仍能识别出 skill', () => {
      writeSkill('handle_api_retry');

      const accessPrompt = [
        '[严格文件访问策略 - 必须遵守]',
        `  - ${path.join(tempDir, '.claude', 'skills')}`
      ].join('\n');

      const result = resolveSkillRefs({
        promptText: `${accessPrompt}\n\n---\n\n请使用 handle_api_retry skill`,
        cwd: tempDir
      });

      expect(result.required).toBe(true);
      expect(result.skillFiles.map(s => s.name)).toContain('handle_api_retry');
    });
  });

  describe('skill 目录与轨迹的定位口径', () => {
    it('应递归扫描嵌套的 skill 目录（与框架 findGeneratedSkillFiles 同口径）', () => {
      const nested = path.join(tempDir, '.claude', 'skills', 'group', 'deep_skill');
      fs.mkdirSync(nested, { recursive: true });
      fs.writeFileSync(path.join(nested, 'SKILL.md'), '# deep_skill\n', 'utf-8');

      const result = resolveSkillRefs({
        promptText: '请使用 deep_skill 处理嵌套技能',
        cwd: tempDir
      });

      expect(result.skillFiles.map(s => s.filePath)).toContain(path.join(nested, 'SKILL.md'));
    });

    it('文件名不是 SKILL.md 的文件不算 skill', () => {
      const dir = path.join(tempDir, '.claude', 'skills', 'docs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'MY_SKILL.md'), '# not a skill\n', 'utf-8');

      const result = resolveSkillRefs({
        promptText: '请使用 docs skill 参考文档',
        traceText: `[Read]\n  File: ${path.join(dir, 'MY_SKILL.md')}\n`,
        cwd: tempDir
      });

      expect(result.skillFiles.map(s => s.filePath)).not.toContain(path.join(dir, 'MY_SKILL.md'));
    });

    it('未点名但轨迹里加载过的 skill 也能定位到', () => {
      const skillFile = writeSkill('handle_api_retry');

      const result = resolveSkillRefs({
        promptText: '按照 skill 的流程处理这个文件',
        traceText: `[Read]\n  File: ${skillFile}\n`,
        cwd: tempDir
      });

      expect(result.required).toBe(true);
      expect(result.skillFiles.map(s => s.filePath)).toContain(skillFile);
      expect(result.skillFiles[0].source).toBe('trace');
    });
  });
});
