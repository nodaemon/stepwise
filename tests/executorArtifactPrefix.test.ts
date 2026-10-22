/**
 * 执行器产物文件名前缀测试
 *
 * 背景：一个步骤目录里会先后跑好几次执行（步骤本体、后检查、输出缺失重试、
 * 校验失败修复、会话末尾总结、自检复盘）。每次执行都会生成 command.sh /
 * execution_info.json / debug.log / verbose_output.txt 等产物——
 * 不加区分时，后一次执行会覆盖前一次的产物，步骤本体的复现脚本也会消失。
 *
 * 本测试验证：带前缀执行时，产物落成带前缀的文件，
 * 且**不会覆盖**目录里已有的同名文件。
 */
import * as fs from 'fs';
import * as path from 'path';
import { BaseExecutor } from '../src/executors/base';
import {
  STDIN_PROMPT_FILE,
  POST_CHECK_ARTIFACT_PREFIX,
  FILE_MISSING_ARTIFACT_PREFIX,
  VALIDATION_FIX_ARTIFACT_PREFIX,
  SUMMARIZE_ARTIFACT_PREFIX
} from '../src/constants';
import { AgentExecutorOptions } from '../src/executors/types';

/** 回显 stdin 的桩执行器 */
class EchoExecutor extends BaseExecutor {
  readonly agentType = 'claude' as const;
  protected getCommand(): string { return process.execPath; }
  protected buildArgs(): string[] { return ['-e', 'process.stdin.pipe(process.stdout) // echo']; }
  protected buildProbeArgs(): string[] { return ['-e', 'process.stdin.pipe(process.stdout) // echo']; }
}

describe('执行器产物前缀', () => {
  let tempDir: string;
  let taskLogDir: string;

  beforeEach(() => {
    tempDir = path.join(__dirname, '.temp_artifact_prefix_test');
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    taskLogDir = path.join(tempDir, 'logs', '1_task');
    fs.mkdirSync(taskLogDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('带前缀执行时，产物应落成带前缀的文件', async () => {
    const executor = new EchoExecutor();
    const options: AgentExecutorOptions = {
      cwd: process.cwd(),
      taskLogDir,
      promptLogFile: 'self_check_prompt.txt',
      artifactPrefix: 'self_check_'
    };

    await executor.execute('HELLO', options);

    expect(fs.existsSync(path.join(taskLogDir, 'self_check_command.sh'))).toBe(true);
    expect(fs.existsSync(path.join(taskLogDir, 'self_check_execution_info.json'))).toBe(true);
    expect(fs.existsSync(path.join(taskLogDir, 'self_check_verbose_output.txt'))).toBe(true);
    // 提示词记录文件由调用方显式指定，不加前缀
    expect(fs.existsSync(path.join(taskLogDir, 'self_check_prompt.txt'))).toBe(true);
  }, 30000);

  it('带前缀执行不得覆盖目录里已有的无前缀产物', async () => {
    const executor = new EchoExecutor();
    const sentinel = path.join(taskLogDir, 'command.sh');
    fs.writeFileSync(sentinel, '#!/bin/sh\n# sentinel\n', 'utf-8');

    await executor.execute('HELLO', {
      cwd: process.cwd(),
      taskLogDir,
      promptLogFile: 'self_check_prompt.txt',
      artifactPrefix: 'self_check_'
    });

    expect(fs.readFileSync(sentinel, 'utf-8')).toBe('#!/bin/sh\n# sentinel\n');
  }, 30000);

  it('不带前缀执行时，产物文件名保持原样', async () => {
    const executor = new EchoExecutor();

    await executor.execute('HELLO', { cwd: process.cwd(), taskLogDir });

    expect(fs.existsSync(path.join(taskLogDir, 'command.sh'))).toBe(true);
    expect(fs.existsSync(path.join(taskLogDir, 'execution_info.json'))).toBe(true);
    expect(fs.existsSync(path.join(taskLogDir, 'verbose_output.txt'))).toBe(true);
  }, 30000);

  it('stdin 临时文件加前缀且用完即删', async () => {
    const executor = new EchoExecutor();

    await executor.execute('HELLO', {
      cwd: process.cwd(),
      taskLogDir,
      promptLogFile: 'self_check_prompt.txt',
      artifactPrefix: 'self_check_'
    });

    // 隐藏文件保持隐藏语义：前缀插到点号之后
    expect(fs.existsSync(path.join(taskLogDir, '.self_check.stdin_prompt'))).toBe(false);
    expect(fs.existsSync(path.join(taskLogDir, STDIN_PROMPT_FILE))).toBe(false);
  }, 30000);

  it('execution_info.json 应记录提示词记录文件的实际路径', async () => {
    const executor = new EchoExecutor();

    await executor.execute('HELLO', {
      cwd: process.cwd(),
      taskLogDir,
      promptLogFile: 'self_check_prompt.txt',
      artifactPrefix: 'self_check_'
    });

    const info = JSON.parse(
      fs.readFileSync(path.join(taskLogDir, 'self_check_execution_info.json'), 'utf-8')
    );
    expect(info.promptLogFile).toBe(path.join(taskLogDir, 'self_check_prompt.txt'));
    // 复现脚本引用带前缀的提示词记录文件
    expect(info.command).toContain(`cat '${path.join(taskLogDir, 'self_check_prompt.txt')}' |`);
  }, 30000);

  it('各类执行的产物互不覆盖：command.sh 始终属于步骤本体', async () => {
    const executor = new EchoExecutor();

    // 步骤本体（无前缀）
    await executor.execute('BODY', { cwd: process.cwd(), taskLogDir, promptLogFile: 'prompt.txt' });
    // 步骤本体之后又跑了四种带前缀的执行
    const prefixed: Array<[string, string]> = [
      [POST_CHECK_ARTIFACT_PREFIX, 'post_check_prompt.txt'],
      [FILE_MISSING_ARTIFACT_PREFIX, 'file_missing_prompt.txt'],
      [VALIDATION_FIX_ARTIFACT_PREFIX, 'validation_fix_prompt.txt'],
      [SUMMARIZE_ARTIFACT_PREFIX, 'summarize_prompt.txt']
    ];
    for (const [prefix, promptFile] of prefixed) {
      await executor.execute('SECONDARY', {
        cwd: process.cwd(), taskLogDir, promptLogFile: promptFile, artifactPrefix: prefix
      });
    }

    // 步骤本体的 command.sh 仍在，且引用步骤本体的提示词
    const bodyScript = fs.readFileSync(path.join(taskLogDir, 'command.sh'), 'utf-8');
    expect(bodyScript).toContain(`cat '${path.join(taskLogDir, 'prompt.txt')}' |`);

    // 每次执行都有自己的复现脚本，且各引用各的提示词记录文件
    for (const [prefix, promptFile] of prefixed) {
      const scriptFile = path.join(taskLogDir, `${prefix}command.sh`);
      expect(fs.existsSync(scriptFile)).toBe(true);
      const script = fs.readFileSync(scriptFile, 'utf-8');
      expect(script).toContain(`cat '${path.join(taskLogDir, promptFile)}' |`);
      expect(fs.existsSync(path.join(taskLogDir, `${prefix}execution_info.json`))).toBe(true);
      expect(fs.existsSync(path.join(taskLogDir, `${prefix}verbose_output.txt`))).toBe(true);
    }
  }, 60000);
});
