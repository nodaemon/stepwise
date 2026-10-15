/**
 * 复现脚本（command.sh）生成器测试
 *
 * 测试内容：
 * - buildReproScript 输出结构（shebang / set -e / export / cd / 命令）
 * - shell 单引号转义对 $ ` " \ 的惰性处理
 * - env 解析规则与框架 buildEnv 对齐（丢弃无等号条目）
 * - presetEnv 与 env 的优先级顺序
 * - writeReproScript 的内容与 0755 权限
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildReproScript, shellQuote, writeReproScript } from '../src/utils/reproScript';

const CWD = '/data1/wangkai/stepwise';
const COMMAND = 'claude --resume abc -p \'hello\'';

/** 取出脚本中所有 export 行 */
function exportLines(script: string): string[] {
  return script.split('\n').filter(line => line.startsWith('export '));
}

describe('shellQuote 单引号转义', () => {
  test('普通值用单引号包裹', () => {
    expect(shellQuote('abc')).toBe("'abc'");
  });

  test('单引号按 POSIX 规则转义为 \'\\\'\'', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  test('$ 反引号 双引号 反斜杠 均保持惰性', () => {
    expect(shellQuote('$HOME')).toBe("'$HOME'");
    expect(shellQuote('`id`')).toBe("'`id`'");
    expect(shellQuote('a"b')).toBe("'a\"b'");
    expect(shellQuote('a\\b')).toBe("'a\\b'");
  });
});

describe('buildReproScript 输出结构', () => {
  test('无 env 时结构完整，命令在末行', () => {
    const script = buildReproScript({ command: COMMAND, cwd: CWD });
    const lines = script.split('\n');

    expect(lines[0]).toBe('#!/bin/sh');
    expect(script).toContain('set -e');
    expect(script).toContain(`cd '${CWD}'`);
    expect(exportLines(script)).toEqual([]);
    expect(lines[lines.length - 2]).toBe(COMMAND);
    expect(lines[lines.length - 1]).toBe('');
  });

  test('头部注释包含工作目录与生成时间', () => {
    const script = buildReproScript({ command: COMMAND, cwd: CWD });
    expect(script).toContain(`# 工作目录: ${CWD}`);
    expect(script).toMatch(/# 生成时间: \d{4}\/\d{1,2}\/\d{1,2}/);
  });

  test('以换行结尾', () => {
    const script = buildReproScript({ command: COMMAND, cwd: CWD });
    expect(script.endsWith('\n')).toBe(true);
  });

  test('cwd 只出现一次（cd 语句）', () => {
    const script = buildReproScript({ command: COMMAND, cwd: CWD });
    // 头部注释 1 次 + cd 语句 1 次 = 2 次；执行语义中仅 cd 这一次
    expect(script.split(`cd '${CWD}'`).length - 1).toBe(1);
  });

  test('命令只出现一次（末行）', () => {
    const script = buildReproScript({ command: COMMAND, cwd: CWD });
    expect(script.split(COMMAND).length - 1).toBe(1);
  });
});

describe('buildReproScript 环境变量处理', () => {
  test('env 值含特殊字符时单引号包裹，不产生可执行插值', () => {
    const script = buildReproScript({
      command: COMMAND,
      cwd: CWD,
      env: ['A=$HOME', 'B=`id`', 'C=a"b', 'D=a\\b']
    });

    expect(exportLines(script)).toEqual([
      "export A='$HOME'",
      "export B='`id`'",
      "export C='a\"b'",
      "export D='a\\b'"
    ]);
  });

  test('env 值含单引号按 POSIX 规则转义', () => {
    const script = buildReproScript({
      command: COMMAND,
      cwd: CWD,
      env: ["KEY=it's"]
    });
    expect(exportLines(script)).toEqual(["export KEY='it'\\''s'"]);
  });

  test('空值 env 输出空单引号', () => {
    const script = buildReproScript({ command: COMMAND, cwd: CWD, env: ['KEY='] });
    expect(exportLines(script)).toEqual(["export KEY=''"]);
  });

  test('丢弃无等号与空键名的条目（与框架 buildEnv 一致）', () => {
    const script = buildReproScript({
      command: COMMAND,
      cwd: CWD,
      env: ['NO_EQUALS', '=EMPTY_KEY', 'GOOD=value']
    });
    expect(exportLines(script)).toEqual(["export GOOD='value'"]);
    expect(script).not.toContain('NO_EQUALS');
    expect(script).not.toContain('EMPTY_KEY');
  });

  test('env 为空数组时不产生空 export 行与多余空行', () => {
    const script = buildReproScript({ command: COMMAND, cwd: CWD, env: [] });
    expect(exportLines(script)).toEqual([]);
    expect(script).toContain('# 环境变量: 无');
    // set -e 与 cd 之间不应有连续空行
    expect(script).not.toContain('\n\n\n');
  });

  test('presetEnv 先于 env 输出（对齐 buildEnv 覆盖顺序）', () => {
    const script = buildReproScript({
      command: COMMAND,
      cwd: CWD,
      env: ['PAGER=less', 'USER_KEY=v'],
      presetEnv: { PAGER: 'cat' }
    });

    expect(exportLines(script)).toEqual([
      "export PAGER='cat'",
      "export PAGER='less'",
      "export USER_KEY='v'"
    ]);

    // 用户 env 在后即可覆盖框架预设
    const first = script.indexOf("export PAGER='cat'");
    const second = script.indexOf("export PAGER='less'");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  test('头部注释列出全部环境变量键名', () => {
    const script = buildReproScript({
      command: COMMAND,
      cwd: CWD,
      env: ['ANTHROPIC_API_KEY=sk-xxx', 'BROKEN'],
      presetEnv: { PAGER: 'cat' }
    });
    expect(script).toContain('# 环境变量: PAGER, ANTHROPIC_API_KEY（值可能为敏感信息，请勿外传）');
  });
});

describe('buildReproScript 超时说明', () => {
  test('传入 timeout 时如实标注框架的超时终止行为', () => {
    const script = buildReproScript({
      command: COMMAND,
      cwd: CWD,
      timeout: 3 * 60 * 60 * 1000
    });
    expect(script).toContain('# 说明: 框架内超时 10800000ms 会主动终止子进程，本脚本无超时限制');
  });

  test('未传 timeout 时不断言超时行为（不输出说明行）', () => {
    const script = buildReproScript({ command: COMMAND, cwd: CWD });
    expect(script).not.toContain('# 说明:');
    expect(script).not.toContain('框架内不设超时');
  });
});

describe('buildReproScript 多行命令', () => {
  test('含换行的 prompt 原样保留在末行', () => {
    const multiLine = "claude -p 'line1\nline2'";
    const script = buildReproScript({ command: multiLine, cwd: CWD });

    expect(script.trimEnd().endsWith(multiLine)).toBe(true);
    expect(script).toContain("cd '/data1/wangkai/stepwise'\n" + multiLine);
  });
});

describe('writeReproScript 写盘', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reproScript-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('内容完整写入', () => {
    const file = path.join(tmpDir, 'command.sh');
    const content = buildReproScript({ command: COMMAND, cwd: CWD, env: ['K=v'] });

    writeReproScript(file, content);

    expect(fs.readFileSync(file, 'utf-8')).toBe(content);
    expect(content.startsWith('#!/bin/sh')).toBe(true);
    expect(content.endsWith('\n')).toBe(true);
  });

  test('权限为 0755，可直接执行', () => {
    const file = path.join(tmpDir, 'command.sh');
    writeReproScript(file, buildReproScript({ command: COMMAND, cwd: CWD }));

    expect(fs.statSync(file).mode & 0o777).toBe(0o755);
  });

  test('覆盖已存在文件时权限仍为 0755', () => {
    const file = path.join(tmpDir, 'command.sh');
    fs.writeFileSync(file, '#!/bin/sh\necho old\n', 'utf-8');
    fs.chmodSync(file, 0o600);

    writeReproScript(file, buildReproScript({ command: COMMAND, cwd: CWD }));

    expect(fs.statSync(file).mode & 0o777).toBe(0o755);
  });
});
