/**
 * 提示词统一经 stdin 管道下发 —— 不变量与集成测试
 *
 * 覆盖：
 * 1. 绝对不变量：buildArgs() 的返回值中永远不含提示词（签名里就没有 prompt 形参）
 * 2. 各 CLI 读 stdin 所需的开关：claude/pi 的 -p、mcode 的 --input -
 * 3. 集成：200 KB 提示词经管道完整送达（Linux 单个 argv 上限 128 KiB，走 argv 必然 E2BIG）
 * 4. 落盘与复现：prompt.txt 与实际下发内容一致、command.sh 走管道、execution_info.json 字段
 * 5. 限流探测提示词同样经 stdin 下发，不进命令行参数
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BaseExecutor } from '../src/executors/base';
import { ClaudeExecutor } from '../src/executors/claude';
import { CodeAgentExecutor } from '../src/executors/codeagent';
import { PiExecutor } from '../src/executors/pi';
import { McodeExecutor } from '../src/executors/mcode';
import { OpenCodeExecutor } from '../src/executors/opencode';
import { PROBE_PROMPT, PROMPT_FILE, PROMPT_STDIN_FILE } from '../src/constants';
import { AgentExecutorOptions } from '../src/executors/types';
import { StepWise, setTaskName, enableDebugMode, _resetState } from '../src';

/**
 * 回显 stdin 的桩执行器
 *
 * 命令为 `node -e '<脚本>'`，脚本把 stdin 原样转发到 stdout——
 * 因此 stdout 出现的内容只能来自 stdin，可用于验证提示词确实经管道送达。
 */
class EchoExecutor extends BaseExecutor {
  readonly agentType = 'claude' as const;
  protected getCommand(): string { return process.execPath; }
  protected buildArgs(): string[] { return ['-e', 'process.stdin.pipe(process.stdout) // echo']; }
  protected buildProbeArgs(): string[] { return ['-e', 'process.stdin.pipe(process.stdout) // echo']; }
}

/** 提示词特征串：用于断言提示词没有出现在命令行参数里 */
const MARKER = 'PROMPT-UNIQUE-MARKER-9f3a2b';

/** 超长提示词：200 KB，超过 Linux 单个 argv 的 128 KiB 上限 */
const HUGE_PROMPT = `${MARKER} ${'x'.repeat(200 * 1024)}`;

describe('提示词投递：不变量', () => {
  it('五个内置执行器的 buildArgs() 签名都不含 prompt 形参（参数个数为 4）', () => {
    const executors = [
      new ClaudeExecutor(),
      new CodeAgentExecutor(),
      new PiExecutor(),
      new McodeExecutor(),
      new OpenCodeExecutor()
    ];

    for (const executor of executors) {
      // sessionId, isResume, debugFile?, fork?
      expect((executor as any).buildArgs.length).toBe(4);
    }
  });

  it('五个内置执行器的 buildArgs() 返回值中都不含提示词', () => {
    const sessionId = '11111111-2222-4333-8444-555555555555';
    const executors: Array<[string, any]> = [
      ['claude', new ClaudeExecutor()],
      ['codeagent', new CodeAgentExecutor()],
      ['pi', new PiExecutor()],
      ['mcode', new McodeExecutor()],
      ['opencode', new OpenCodeExecutor()]
    ];

    for (const [name, executor] of executors) {
      const args: string[] = executor.buildArgs(sessionId, false, undefined, false);
      // 提示词既不整体出现，也不以片段形式出现
      expect(args.join(' ')).not.toContain(MARKER);
      // 不得存在"自由文本"位置参数：所有元素都应是开关或短标识
      for (const arg of args) {
        expect(arg.length).toBeLessThan(200);
      }
      expect(name).toBeTruthy();
    }
  });
});

describe('提示词投递：各 CLI 读 stdin 所需的开关', () => {
  const sessionId = '11111111-2222-4333-8444-555555555555';

  it('Claude：保留 -p 打印模式开关，其余参数不变', () => {
    const args: string[] = (new ClaudeExecutor() as any).buildArgs(sessionId, false);
    expect(args).toContain('-p');
    expect(args[args.length - 1]).toBe('-p');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--verbose');
    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args).toContain('--session-id');
    expect(args).toContain(sessionId);
  });

  it('Claude：恢复会话使用 --resume，fork 追加 --fork-session', () => {
    const args: string[] = (new ClaudeExecutor() as any).buildArgs(sessionId, true, undefined, true);
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe(sessionId);
    expect(args).toContain('--fork-session');
    expect(args).toContain('-p');
  });

  it('CodeAgent：保留 --skip-safe-check 且紧跟 --dangerously-skip-permissions', () => {
    const args: string[] = (new CodeAgentExecutor() as any).buildArgs(sessionId, false);
    expect(args[0]).toBe('--dangerously-skip-permissions');
    expect(args[1]).toBe('--skip-safe-check');
    expect(args).toContain('-p');
  });

  it('Pi：保留 --mode json 与 -p', () => {
    const args: string[] = (new PiExecutor() as any).buildArgs(sessionId, false);
    expect(args).toContain('--mode');
    expect(args[args.indexOf('--mode') + 1]).toBe('json');
    expect(args[args.length - 1]).toBe('-p');
    expect(args).toContain('--session-id');
  });

  it('mcode：用 --input - 从 stdin 读提示词，不再带位置参数提示词', () => {
    const args: string[] = (new McodeExecutor() as any).buildArgs(sessionId, false);
    expect(args).toContain('--input');
    expect(args[args.indexOf('--input') + 1]).toBe('-');
    expect(args[args.length - 1]).toBe('-');
    expect(args).not.toContain(MARKER);
    // mcode 的 --input 与位置参数提示词互斥，故不得出现裸提示词参数
    expect(args.filter(a => a === '-')).toHaveLength(1);
  });

  it('OpenCode：不再携带位置消息', () => {
    const args: string[] = (new OpenCodeExecutor() as any).buildArgs(sessionId, false);
    expect(args[0]).toBe('run');
    expect(args).toContain('--thinking');
    expect(args).not.toContain(MARKER);
    // 位置消息已移除，末尾只应是开关或其取值
    expect(['--thinking', '--fork', '--session']).toContain(args[args.length - 1]);
  });
});

describe('提示词投递：集成（200 KB 提示词经管道完整送达）', () => {
  let taskLogDir: string;

  beforeEach(() => {
    taskLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepwise-stdin-'));
  });

  afterEach(() => {
    fs.rmSync(taskLogDir, { recursive: true, force: true });
  });

  it('200 KB 提示词应原样送达子进程（走 argv 必然 E2BIG）', async () => {
    const executor = new EchoExecutor();
    const options: AgentExecutorOptions = { cwd: process.cwd(), taskLogDir };

    const result = await executor.execute(HUGE_PROMPT, options);

    expect(result.success).toBe(true);
    // stdout 只能来自 stdin 回显，故证明提示词确实经管道送达且逐字节完整
    expect(result.output).toBe(HUGE_PROMPT);
    expect(result.output.length).toBe(HUGE_PROMPT.length);
  }, 30000);

  it('Linux 下把同样长度的提示词放进 argv 会失败（本次改造的根因）', () => {
    if (process.platform !== 'linux') return;

    const childProcess = jest.requireActual('child_process') as typeof import('child_process');
    const result = childProcess.spawnSync(
      process.execPath,
      ['-e', 'process.stdout.write("ok")', HUGE_PROMPT],
      { encoding: 'utf-8' }
    );

    expect(result.error).toBeDefined();
    expect((result.error as NodeJS.ErrnoException).code).toBe('E2BIG');
  });
});

describe('提示词投递：落盘与复现脚本', () => {
  let taskLogDir: string;

  beforeEach(() => {
    taskLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepwise-stdin-'));
  });

  afterEach(() => {
    fs.rmSync(taskLogDir, { recursive: true, force: true });
  });

  it('prompt_stdin.txt 应与实际下发的提示词逐字节一致', async () => {
    const executor = new EchoExecutor();
    const options: AgentExecutorOptions = { cwd: process.cwd(), taskLogDir };

    await executor.execute(HUGE_PROMPT, options);

    const promptFile = path.join(taskLogDir, PROMPT_STDIN_FILE);
    expect(fs.existsSync(promptFile)).toBe(true);
    expect(fs.readFileSync(promptFile, 'utf-8')).toBe(HUGE_PROMPT);
  }, 30000);

  it('执行器不得写 prompt.txt（那是 StepWise 的任务提示词日志）', async () => {
    const executor = new EchoExecutor();
    const options: AgentExecutorOptions = { cwd: process.cwd(), taskLogDir };

    // 预置 StepWise 写好的任务提示词
    const taskPromptFile = path.join(taskLogDir, PROMPT_FILE);
    fs.writeFileSync(taskPromptFile, 'TASK-PROMPT-FROM-STEPWISE', 'utf-8');

    await executor.execute(HUGE_PROMPT, options);

    // 任务提示词日志必须原样保留
    expect(fs.readFileSync(taskPromptFile, 'utf-8')).toBe('TASK-PROMPT-FROM-STEPWISE');
  }, 30000);

  it('command.sh 应以管道形式引用 prompt_stdin.txt，且不含提示词原文', async () => {
    const executor = new EchoExecutor();
    const options: AgentExecutorOptions = { cwd: process.cwd(), taskLogDir };

    await executor.execute(HUGE_PROMPT, options);

    const promptFile = path.join(taskLogDir, PROMPT_STDIN_FILE);
    const script = fs.readFileSync(path.join(taskLogDir, 'command.sh'), 'utf-8');

    expect(script).toContain(`cat '${promptFile}' |`);
    expect(script).not.toContain(MARKER);
  }, 30000);

  it('execution_info.json 的 args 不含提示词，并记录投递通道与提示词文件', async () => {
    const executor = new EchoExecutor();
    const options: AgentExecutorOptions = { cwd: process.cwd(), taskLogDir };

    await executor.execute(HUGE_PROMPT, options);

    const promptFile = path.join(taskLogDir, PROMPT_STDIN_FILE);
    const info = JSON.parse(fs.readFileSync(path.join(taskLogDir, 'execution_info.json'), 'utf-8'));

    expect(info.args.join(' ')).not.toContain(MARKER);
    expect(info.promptDelivery).toBe('stdin');
    expect(info.promptStdinFile).toBe(promptFile);
    expect(info.command).toContain(`cat '${promptFile}' |`);
  }, 30000);
});

describe('提示词投递：同目录多次执行不污染任务提示词日志', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    _resetState();
    tempDir = path.join(__dirname, '.temp_prompt_delivery_test');
    originalCwd = process.cwd();
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    _resetState();
  });

  it('postCheck 执行后，任务目录的 prompt.txt 仍应是任务提示词', async () => {
    // postCheck 与 debug 模式互斥（StepWise: `options?.postCheckPrompt && !_isDebugMode()`），
    // 故这里必须关掉 debug，postCheck 才会真的执行、才会真的覆盖 prompt.txt
    enableDebugMode(false);
    setTaskName('PromptDeliveryTest');
    const agent = new StepWise('PromptDeliveryAgent');
    // 换成真实执行器（会落盘 prompt_stdin.txt），而不是 mock 掉整个执行器模块
    (agent as any).executor = new EchoExecutor();

    await agent.execPrompt('ORIGINAL_TASK_PROMPT_MARKER', {
      postCheckPrompt: 'POSTCHECK_PROMPT_MARKER'
    });

    const taskDir = path.join((agent as any).agentDir, 'logs', '1_task');
    const taskPrompt = fs.readFileSync(path.join(taskDir, PROMPT_FILE), 'utf-8');

    // 任务提示词日志不能被 postCheck 的提示词覆盖
    expect(taskPrompt).toContain('ORIGINAL_TASK_PROMPT_MARKER');
    expect(taskPrompt).not.toContain('POSTCHECK_PROMPT_MARKER');
  }, 30000);

  it('execPromptSchema 的 postCheck 执行后，自检拿到的提示词证据仍是任务提示词', async () => {
    // execPromptSchema 的 postCheck 没有 `!_isDebugMode()` 条件（StepWise:2219），
    // 是唯一会在自检之前用不同提示词覆盖任务目录 prompt.txt 的路径——
    // 自检随后把该文件当证据读，必须仍是任务提示词
    enableDebugMode(true);
    setTaskName('PromptDeliveryTest2');
    const agent = new StepWise('PromptDeliveryAgent2');
    (agent as any).executor = new EchoExecutor();

    await agent.execPromptSchema(
      'ORIGINAL_TASK_PROMPT_MARKER',
      { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
      'schema_output.json',
      { postCheckPrompt: 'POSTCHECK_PROMPT_MARKER' }
    );

    // execPromptSchema 的任务目录按 taskType=schema 命名
    const taskDir = path.join((agent as any).agentDir, 'logs', '1_schema');
    const reviewDir = path.join((agent as any).agentDir, 'logs', '1_self_check');

    // 审查者的提示词落在独立目录
    expect(fs.existsSync(path.join(reviewDir, PROMPT_FILE))).toBe(true);
    // 被审查对象的提示词证据仍是任务提示词，不能被 postCheck 覆盖
    const taskPrompt = fs.readFileSync(path.join(taskDir, PROMPT_FILE), 'utf-8');
    expect(taskPrompt).toContain('ORIGINAL_TASK_PROMPT_MARKER');
    expect(taskPrompt).not.toContain('POSTCHECK_PROMPT_MARKER');
  }, 30000);

  it('每次执行覆盖 prompt_stdin.txt，与 command.sh 引用的一致', async () => {
    enableDebugMode(false);
    setTaskName('PromptDeliveryTest3');
    const agent = new StepWise('PromptDeliveryAgent3');
    (agent as any).executor = new EchoExecutor();

    await agent.execPrompt('ORIGINAL_TASK_PROMPT_MARKER', {
      postCheckPrompt: 'POSTCHECK_PROMPT_MARKER'
    });

    const taskDir = path.join((agent as any).agentDir, 'logs', '1_task');
    const stdinFile = path.join(taskDir, PROMPT_STDIN_FILE);
    const script = fs.readFileSync(path.join(taskDir, 'command.sh'), 'utf-8');

    // 传输槽位内容 = 最近一次执行（postCheck）实际下发的提示词
    expect(fs.readFileSync(stdinFile, 'utf-8')).toContain('POSTCHECK_PROMPT_MARKER');
    // command.sh 引用的正是该槽位，复现的一定是同一次执行
    expect(script).toContain(`cat '${stdinFile}' |`);
  }, 30000);
});

describe('提示词投递：argv 守卫', () => {
  /**
   * 模拟"有人把提示词塞进 args"的执行器
   * 用固定字符串充当提示词，模拟违规实现把提示词当命令行参数下发
   */
  class LeakyExecutor extends BaseExecutor {
    readonly agentType = 'claude' as const;
    protected getCommand(): string { return process.execPath; }
    protected buildArgs(): string[] {
      return ['-e', 'process.stdin.pipe(process.stdout) // echo', LEAKED_PROMPT];
    }
    protected buildProbeArgs(): string[] { return []; }
  }

  const LEAKED_PROMPT = 'LEAKED_PROMPT_MARKER';

  it('提示词出现在命令行参数中时，应立即报错并指出问题所在', async () => {
    const executor = new LeakyExecutor();

    await expect(
      executor.execute(LEAKED_PROMPT, { cwd: process.cwd() })
    ).rejects.toThrow(/提示词出现在命令行参数中/);
  });

  it('报错信息应指向 buildArgs()，便于定位', async () => {
    const executor = new LeakyExecutor();

    await expect(
      executor.execute(LEAKED_PROMPT, { cwd: process.cwd() })
    ).rejects.toThrow(/buildArgs/);
  });

  it('正常执行器不受影响', async () => {
    const executor = new EchoExecutor();
    const result = await executor.execute('正常提示词', { cwd: process.cwd() });
    expect(result.success).toBe(true);
  });
});

describe('提示词投递：限流探测', () => {
  it('各执行器的 buildProbeArgs() 都不含探测提示词', () => {
    const executors = [
      new ClaudeExecutor(),
      new CodeAgentExecutor(),
      new PiExecutor(),
      new McodeExecutor()
    ];

    for (const executor of executors) {
      const args: string[] = (executor as any).buildProbeArgs();
      expect(args).not.toContain(PROBE_PROMPT);
      expect(args.join(' ')).not.toContain(PROBE_PROMPT);
    }
  });

  it('mcode 的探测参数使用 --input -', () => {
    const args: string[] = (new McodeExecutor() as any).buildProbeArgs();
    expect(args).toContain('--input');
    expect(args[args.indexOf('--input') + 1]).toBe('-');
  });

  it('probeRateLimit 应把探测提示词经 spawnSync 的 input 选项传入', async () => {
    const childProcess = jest.requireActual('child_process') as typeof import('child_process');
    const spawnSyncSpy = jest.spyOn(childProcess, 'spawnSync').mockReturnValue({
      status: 0,
      stdout: 'ok',
      stderr: '',
      pid: 12345,
      output: [null, 'ok', ''],
      signal: null
    } as any);

    try {
      const executor = new ClaudeExecutor();
      const recovered = await (executor as any).probeRateLimit({ cwd: process.cwd() });

      expect(recovered).toBe(true);
      expect(spawnSyncSpy).toHaveBeenCalledTimes(1);
      const callArgs = spawnSyncSpy.mock.calls[0];
      expect(callArgs[1]).not.toContain(PROBE_PROMPT);
      expect((callArgs[2] as any).input).toBe(PROBE_PROMPT);
    } finally {
      spawnSyncSpy.mockRestore();
    }
  });
});
