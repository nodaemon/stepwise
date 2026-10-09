import { buildSchemaFixPrompt, buildFixPrompt } from '../src/utils/validator';
import { SchemaValidationError } from '../src/utils/schemaUtils';
import { JsonSchemaDef } from '../src/types';

/** 生成 n 个校验错误，path 唯一以便计数 */
function makeErrors(n: number): SchemaValidationError[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `/item/${i}`,
    message: `should be string (error #${i})`,
    keyword: 'type',
    params: {},
    data: i
  }));
}

/** 统计子串出现次数 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  return haystack.split(needle).length - 1;
}

describe('校验错误提示词 50 条上限', () => {
  const simpleSchema: JsonSchemaDef = {
    type: 'object',
    properties: { a: { type: 'string' } }
  };

  describe('buildSchemaFixPrompt', () => {
    it('超过 50 条时只显示前 50 条并补充说明', () => {
      const prompt = buildSchemaFixPrompt(makeErrors(60), '/f.json', simpleSchema);

      expect(countOccurrences(prompt, '- 路径:')).toBe(50);
      expect(prompt).toContain('共 60 条错误，当前仅显示前 50 条');
    });

    it('错误总数动态反映在说明文案中', () => {
      const prompt = buildSchemaFixPrompt(makeErrors(73), '/f.json', simpleSchema);

      expect(countOccurrences(prompt, '- 路径:')).toBe(50);
      expect(prompt).toContain('共 73 条错误，当前仅显示前 50 条');
    });

    it('恰好 50 条时不补充说明（边界）', () => {
      const prompt = buildSchemaFixPrompt(makeErrors(50), '/f.json', simpleSchema);

      expect(countOccurrences(prompt, '- 路径:')).toBe(50);
      expect(prompt).not.toContain('当前仅显示前');
    });

    it('少于 50 条时全部显示且不补充说明', () => {
      const prompt = buildSchemaFixPrompt(makeErrors(30), '/f.json', simpleSchema);

      expect(countOccurrences(prompt, '- 路径:')).toBe(30);
      expect(prompt).not.toContain('当前仅显示前');
    });
  });

  describe('buildFixPrompt', () => {
    it('超过 50 条时只显示前 50 条并补充说明', () => {
      const prompt = buildFixPrompt(makeErrors(60), '/f.json', 'object');

      expect(countOccurrences(prompt, '- path:')).toBe(50);
      expect(prompt).toContain('共 60 条错误，当前仅显示前 50 条');
    });

    it('恰好 50 条时不补充说明（边界）', () => {
      const prompt = buildFixPrompt(makeErrors(50), '/f.json', 'object');

      expect(countOccurrences(prompt, '- path:')).toBe(50);
      expect(prompt).not.toContain('当前仅显示前');
    });

    it('少于 50 条时全部显示且不补充说明', () => {
      const prompt = buildFixPrompt(makeErrors(30), '/f.json', 'object');

      expect(countOccurrences(prompt, '- path:')).toBe(30);
      expect(prompt).not.toContain('当前仅显示前');
    });
  });
});
