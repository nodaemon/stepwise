/**
 * 环境变量条目解析测试
 *
 * parseEnvEntries() 是 buildEnv / ShellExecutor / command.sh 生成三处共用的解析规则，
 * 这里固定住契约本身：三处一旦各自实现，脚本与框架的执行环境就可能静默分叉。
 */

import { parseEnvEntries } from '../src/utils/envHelper';

describe('parseEnvEntries 解析规则', () => {
  test('解析标准 KEY=VALUE', () => {
    const { entries, invalid } = parseEnvEntries(['KEY=value']);
    expect(entries).toEqual([{ key: 'KEY', value: 'value' }]);
    expect(invalid).toEqual([]);
  });

  test('值为空字符串是合法的', () => {
    expect(parseEnvEntries(['KEY=']).entries).toEqual([{ key: 'KEY', value: '' }]);
  });

  test('值中可包含等号，按第一个等号切分', () => {
    expect(parseEnvEntries(['URL=a=b=c']).entries).toEqual([
      { key: 'URL', value: 'a=b=c' }
    ]);
  });

  test('保留空格的键名与值原样返回（不做 trim）', () => {
    expect(parseEnvEntries([' KEY = value ']).entries).toEqual([
      { key: ' KEY ', value: ' value ' }
    ]);
  });

  test('无等号的条目进 invalid，不进 entries', () => {
    const { entries, invalid } = parseEnvEntries(['NO_EQUALS']);
    expect(entries).toEqual([]);
    expect(invalid).toEqual(['NO_EQUALS']);
  });

  test('键名为空的条目（=VALUE）进 invalid', () => {
    const { entries, invalid } = parseEnvEntries(['=VALUE']);
    expect(entries).toEqual([]);
    expect(invalid).toEqual(['=VALUE']);
  });

  test('合法与非法条目混合时各自归位，顺序保持', () => {
    const { entries, invalid } = parseEnvEntries([
      'A=1',
      'BAD1',
      'B=2',
      '=BAD2',
      'C=3'
    ]);
    expect(entries).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
      { key: 'C', value: '3' }
    ]);
    expect(invalid).toEqual(['BAD1', '=BAD2']);
  });

  test('undefined / 空数组返回空结果', () => {
    expect(parseEnvEntries(undefined)).toEqual({ entries: [], invalid: [] });
    expect(parseEnvEntries([])).toEqual({ entries: [], invalid: [] });
  });
});
