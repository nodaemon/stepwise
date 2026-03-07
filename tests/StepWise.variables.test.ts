/**
 * StepWise options.data 变量替换测试
 *
 * 这里的测试只是验证 replaceVariables 函数是否正确工作
 */
import { replaceVariables } from '../src/utils/promptBuilder';

describe('StepWise Variables Replacement', () => {
  describe('replaceVariables 函数', () => {
    it('应该替换 $name 变量', () => {
      const prompt = 'Hello $name, your age is $age';
      const data = { name: 'John', age: 25 };
      const result = replaceVariables(prompt, data);

      expect(result).toContain('Hello John');
      expect(result).toContain('your age is 25');
    });

    it('应该替换 $desc 变量', () => {
      const prompt = 'Description: $desc';
      const data = { desc: 'This is a test description' };
      const result = replaceVariables(prompt, data);

      expect(result).toContain('Description: This is a test description');
    });

    it('没有匹配变量时应该保持原始占位符', () => {
      const prompt = 'Value: $unknown is here';
      const data = { other: 'value' };
      const result = replaceVariables(prompt, data);

      expect(result).toContain('$unknown');
    });

    it('支持对象类型的变量', () => {
      const prompt = 'Data: $data';
      const objValue = { key: 'value', nested: { inner: 'test' } };
      const result = replaceVariables(prompt, { data: objValue });

      expect(result).toContain(JSON.stringify(objValue, null, 2));
    });

    it('空 data 时应该返回原始提示词', () => {
      const prompt = 'No variables here';
      const result = replaceVariables(prompt, {});

      expect(result).toBe('No variables here');
    });
  });
});
