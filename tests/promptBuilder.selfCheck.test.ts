/**
 * buildSelfCheckPrompt 提示词构造测试
 *
 * 覆盖反幻觉相关的关键约束：证据文件路径、空轨迹兜底、
 * 框架注入内容排除、以及占位符必须全部替换。
 */
import { buildSelfCheckPrompt } from '../src/utils/promptBuilder';

const PARAMS = {
  taskName: 'DemoTask',
  stepLabel: 'collect',
  taskIndex: 3,
  promptFilePath: '/abs/agent/logs/3_collect/prompt.txt',
  outputFilePath: '/abs/agent/logs/3_collect/output.txt',
  traceFilePath: '/abs/agent/logs/3_collect/verbose_output.txt',
  reportPath: '/abs/agent/logs/3_collect/self_check.md'
};

describe('buildSelfCheckPrompt', () => {
  let prompt: string;

  beforeAll(() => {
    prompt = buildSelfCheckPrompt(PARAMS);
  });

  describe('证据文件与产物路径', () => {
    it('应包含三个证据文件的绝对路径', () => {
      expect(prompt).toContain(PARAMS.promptFilePath);
      expect(prompt).toContain(PARAMS.outputFilePath);
      expect(prompt).toContain(PARAMS.traceFilePath);
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
      expect(prompt).not.toMatch(/\$\{(taskName|stepLabel|taskIndex|promptFilePath|outputFilePath|traceFilePath|reportPath)\}/);
    });
  });

  describe('四个检查维度', () => {
    it('应包含四个维度的标题', () => {
      expect(prompt).toContain('## 维度一：目标是否清晰明确');
      expect(prompt).toContain('## 维度二：输入信息是否缺失');
      expect(prompt).toContain('## 维度三：输入信息是否冗余');
      expect(prompt).toContain('## 维度四：工具调用与思考是否走了弯路');
    });

    it('每个维度都应给出计入标准、不计入与证据要求', () => {
      // 四个维度各自都要有这四类约束，防止某一维度被放宽成自由发挥
      const count = (needle: string) => prompt.split(needle).length - 1;
      expect(count('**计入标准**')).toBe(4);
      expect(count('**不计入**')).toBe(4);
      expect(count('**证据要求**')).toBe(4);
    });
  });

  describe('反幻觉与降级约束', () => {
    it('应声明审查者没有记忆，仅依据文件判断', () => {
      expect(prompt).toContain('你没有参与这次执行');
      expect(prompt).toContain('仅依据下面三个文件');
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

    it('应包含空轨迹的兜底处理方式', () => {
      expect(prompt).toContain('若文件 3 为空或不存在');
      expect(prompt).toContain('执行轨迹不可用，维度四未审查');
    });

    it('应排除框架自动注入内容，避免误报为输入冗余', () => {
      expect(prompt).toContain('## 不要计入的问题');
      expect(prompt).toContain('框架注入段落');
      expect(prompt).toContain('工具返回内容被截断');
    });

    it('维度四应要求连续片段并给出可照做的动作', () => {
      expect(prompt).toContain('连续片段');
      expect(prompt).toContain('孤立地引用一个失败结果无法证明存在弯路');
      expect(prompt).toContain('而不是「下次小心一点」');
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
    });
  });

  describe('大规模轨迹的分段读取指引', () => {
    it('应说明轨迹文件可能很大并给出读取策略', () => {
      expect(prompt).toContain('文件 3 可能很大');
      expect(prompt).toContain('Grep');
      expect(prompt).toContain('offset/limit');
    });

    it('应提到轨迹中的关键段落标记', () => {
      expect(prompt).toContain('[Thinking]');
      expect(prompt).toContain('[Tool Result]');
    });
  });
});
