/**
 * buildSelfCheckPrompt 提示词构造测试
 *
 * 覆盖反幻觉相关的关键约束：证据文件路径、输入集合的动态组装、
 * 四个新维度的边界、模型执行层面问题的排除，以及占位符必须全部替换。
 */
import { buildSelfCheckPrompt } from '../src/utils/promptBuilder';

const PARAMS = {
  taskName: 'DemoTask',
  stepLabel: 'collect',
  taskIndex: 3,
  promptFilePath: '/abs/agent/logs/3_collect/prompt.txt',
  outputFilePath: '/abs/agent/logs/3_collect/output.txt',
  reportPath: '/abs/agent/logs/3_collect/self_check.md'
};

describe('buildSelfCheckPrompt', () => {
  let prompt: string;

  beforeAll(() => {
    prompt = buildSelfCheckPrompt(PARAMS);
  });

  describe('输入文件与产物路径', () => {
    it('应包含步骤提示词与最终输出的绝对路径', () => {
      expect(prompt).toContain(PARAMS.promptFilePath);
      expect(prompt).toContain(PARAMS.outputFilePath);
    });

    it('应包含报告路径', () => {
      expect(prompt).toContain(PARAMS.reportPath);
    });

    it('应包含工作流名称、步骤类型与任务序号', () => {
      expect(prompt).toContain('DemoTask');
      expect(prompt).toContain('collect');
      expect(prompt).toContain('3');
    });

    it('不应残留未替换的模板占位符', () => {
      expect(prompt).not.toMatch(
        /\$\{(taskName|stepLabel|taskIndex|promptFilePath|outputFilePath|reportPath)\}/
      );
    });

    it('执行轨迹不再作为输入文件', () => {
      // 审查对象是输入本身，执行轨迹既非审查对象、又是模型行为噪声的唯一来源
      expect(prompt).not.toContain('verbose_output.txt');
      expect(prompt).not.toContain('执行轨迹');
    });
  });

  describe('输入集合按实际存在动态组装', () => {
    it('未提供后检查与 skill 时，提示词里不应出现相关字样', () => {
      expect(prompt).not.toContain('post_check_prompt.txt');
      expect(prompt).not.toContain('post_check_output.txt');
      expect(prompt).not.toContain('SKILL.md');
      expect(prompt).not.toContain('后检查要求的达成情况');
    });

    it('提供后检查提示词与结果时，两者都应作为输入出现', () => {
      const p = buildSelfCheckPrompt({
        ...PARAMS,
        postCheckPromptFilePath: '/abs/agent/logs/3_collect/post_check_prompt.txt',
        postCheckOutputFilePath: '/abs/agent/logs/3_collect/post_check_output.txt'
      });
      expect(p).toContain('/abs/agent/logs/3_collect/post_check_prompt.txt');
      expect(p).toContain('/abs/agent/logs/3_collect/post_check_output.txt');
      expect(p).toContain('后检查要求的达成情况');
    });

    it('提供 skill 文件时，skill 应作为输入与审查对象出现', () => {
      const p = buildSelfCheckPrompt({
        ...PARAMS,
        skillFilePaths: ['/abs/cwd/.claude/skills/handle_retry/SKILL.md']
      });
      expect(p).toContain('/abs/cwd/.claude/skills/handle_retry/SKILL.md');
      expect(p).toContain('对象 C：Skill 内容');
    });

    it('多个 skill 文件应全部列出', () => {
      const p = buildSelfCheckPrompt({
        ...PARAMS,
        skillFilePaths: [
          '/abs/cwd/.claude/skills/a/SKILL.md',
          '/abs/cwd/.claude/skills/b/SKILL.md'
        ]
      });
      expect(p).toContain('/abs/cwd/.claude/skills/a/SKILL.md');
      expect(p).toContain('/abs/cwd/.claude/skills/b/SKILL.md');
    });

    it('skill 未定位到时，应说明并给出候选目录', () => {
      const p = buildSelfCheckPrompt({
        ...PARAMS,
        skillUnresolved: true,
        skillDirs: ['/abs/cwd/.claude/skills']
      });
      expect(p).toContain('未能定位到具体的 skill 文件');
      expect(p).toContain('/abs/cwd/.claude/skills');
    });
  });

  describe('四个检查维度', () => {
    it('应包含四个新维度的标题', () => {
      expect(prompt).toContain('## 维度一：目标与思路是否清晰');
      expect(prompt).toContain('## 维度二：是否需要补充');
      expect(prompt).toContain('## 维度三：是否冗余');
      expect(prompt).toContain('## 维度四：是否有逻辑错误');
    });

    it('旧的「工具调用与思考是否走了弯路」维度应已移除', () => {
      expect(prompt).not.toContain('工具调用与思考是否走了弯路');
    });

    it('每个维度都应给出计入标准、不计入与证据要求', () => {
      const count = (needle: string) => prompt.split(needle).length - 1;
      expect(count('**计入标准**')).toBe(4);
      expect(count('**不计入**')).toBe(4);
      expect(count('**证据要求**')).toBe(4);
    });
  });

  describe('反幻觉与降级约束', () => {
    it('应声明审查者没有记忆，仅依据文件判断', () => {
      expect(prompt).toContain('你没有参与这次执行');
      expect(prompt).toContain('仅依据下面列出的文件');
      // 不得出现依赖记忆的表述（那是复用会话方案才成立的写法）
      expect(prompt).not.toContain('回顾你刚');
      expect(prompt).not.toContain('你刚才');
    });

    it('应要求逐字引用原文，引用不到就不输出', () => {
      expect(prompt).toContain('逐字复制');
      expect(prompt).toContain('无法定位到原文的判断，说明你无法确认，不要写进报告');
    });

    it('应允许无问题时不输出，并规定空输出内容', () => {
      expect(prompt).toContain('没问题的维度整节省略');
      expect(prompt).toContain('本次执行未发现需要改进的问题。');
    });

    it('应要求无论有无问题都必须创建报告文件', () => {
      expect(prompt).toContain('必须创建这个文件');
    });

    it('应排除框架自动注入内容，避免误报为输入冗余', () => {
      expect(prompt).toContain('## 不要计入的问题');
      expect(prompt).toContain('框架注入段落');
      expect(prompt).toContain('工具返回内容被截断');
    });

    it('应排除模型执行层面的问题', () => {
      expect(prompt).toContain('模型执行层面的问题');
      expect(prompt).toContain('工具调用命令写错');
      expect(prompt).toContain('重复思考');
      expect(prompt).toContain('返工');
    });

    it('应禁止修改文件与输出通用最佳实践', () => {
      expect(prompt).toContain('不要修改任何代码或数据文件');
      expect(prompt).toContain('不要输出与本次执行无关的通用最佳实践');
    });
  });

  describe('报告格式约定', () => {
    it('应规定标题行与条目结构', () => {
      expect(prompt).toContain('# 自检复盘：');
      expect(prompt).toContain('严重级：高 | 中 | 低');
      expect(prompt).toContain('**现象**');
      expect(prompt).toContain('**影响**');
      expect(prompt).toContain('**建议**');
      expect(prompt).toContain('**审查对象**');
    });
  });
});
