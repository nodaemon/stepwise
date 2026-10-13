/**
 * StepWise.handleParallelCrossCwdSession 的跨目录判定日志测试
 *
 * 该私有方法是 fork 跨 worktree 软链的决策入口，共 6 条分支路径，
 * 也是「为什么没建链」的唯一诊断来源，因此逐条覆盖。
 *
 * 沿用仓库既有惯例，通过 (stepWise as any) 访问私有成员（见 piExecutor.test.ts）。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StepWise, setTaskName, _resetState, setAgentType } from '../src';
import { SESSION_LINK_LOG_PREFIX } from '../src/utils/sessionLinker';

describe('StepWise 跨目录判定日志', () => {
  const testSessionId = 'abcdabcd-1111-2222-3333-444444444444';
  const mainCwd = '/data1/wangkai/log-gate-main';
  const worktreeCwd = '/data1/wangkai/log-gate-main_Worker1';
  const esc = (c: string): string => c.replace(/[^a-zA-Z0-9]/g, '-');

  let tempDir: string;
  let originalCwd: string;
  let logSpy: jest.SpyInstance;

  /** 构造一个带并行上下文的 StepWise，并返回其私有方法 */
  const makeStepWise = (workerId: string | undefined, resolvedMainCwd: string | undefined) => {
    setTaskName('GateLogTest');
    const sw = new StepWise('GateWorker', tempDir, undefined, workerId, resolvedMainCwd);
    const internal = sw as unknown as {
      handleParallelCrossCwdSession: (fork: boolean, cwd: string | undefined, sid: string) => void;
    };
    return internal;
  };

  /** 收集日志输出 */
  const capturedLog = (): string =>
    logSpy.mock.calls.map(c => c.map(String).join(' ')).join('\n');

  const setAgent = (type: 'claude' | 'codeagent' | 'opencode') => setAgentType(type);

  /** 在 CODEAGENTS3_CONFIG_DIR 下创建会话文件，返回其绝对路径 */
  const makeSession = (cfgDir: string, cwd: string, sid: string): string => {
    const dir = path.join(cfgDir, 'projects', esc(cwd));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${sid}.jsonl`);
    fs.writeFileSync(file, '{"type":"session"}');
    return file;
  };

  beforeEach(() => {
    _resetState();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-log-test-'));
    originalCwd = process.cwd();
    process.chdir(tempDir);
    // 统一走 codeagent，config 目录由环境变量控制
    setAgent('codeagent');
    process.env.CODEAGENTS3_CONFIG_DIR = path.join(tempDir, 'cac');
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => { /* 静默捕获 */ });
  });

  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.CODEAGENTS3_CONFIG_DIR;
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    _resetState();
  });

  // 分支1：无 workerId → 非并行场景
  it('G1: 缺少 workerId 时应记录非并行跳过原因', () => {
    const sw = makeStepWise(undefined, mainCwd);
    sw.handleParallelCrossCwdSession(true, worktreeCwd, testSessionId);
    const out = capturedLog();
    expect(out).toContain(SESSION_LINK_LOG_PREFIX);
    expect(out).toContain('非并行场景');
    expect(out).not.toContain('探测');
  });

  // 分支2：无 mainCwd
  it('G2: 缺少 mainCwd 时应记录非并行跳过原因', () => {
    const sw = makeStepWise('W1', undefined);
    sw.handleParallelCrossCwdSession(true, worktreeCwd, testSessionId);
    expect(capturedLog()).toContain('非并行场景');
  });

  // 分支3：空 sessionId
  it('G3: 空 sessionId 时应记录自建会话跳过原因', () => {
    const sw = makeStepWise('W1', mainCwd);
    sw.handleParallelCrossCwdSession(true, worktreeCwd, '');
    const out = capturedLog();
    expect(out).toContain('无 sessionId');
    expect(out).not.toContain('探测');
  });

  // 分支4：OpenCode 不按 cwd 隔离
  it('G4: OpenCode 应记录跳过原因', () => {
    setAgent('opencode');
    const sw = makeStepWise('W1', mainCwd);
    sw.handleParallelCrossCwdSession(true, worktreeCwd, testSessionId);
    expect(capturedLog()).toContain('OpenCode');
  });

  // 分支5：闸门3 —— worktree 已有本地实体会话
  it('G5: 闸门3 命中时应记录跳过原因', () => {
    const cfg = process.env.CODEAGENTS3_CONFIG_DIR!;
    makeSession(cfg, worktreeCwd, testSessionId);

    const sw = makeStepWise('W1', mainCwd);
    sw.handleParallelCrossCwdSession(true, worktreeCwd, testSessionId);

    expect(capturedLog()).toContain('闸门3');
  });

  // 分支6（关键诊断场景）：闸门4 失败 —— 必须打印实际查找的路径
  it('G6: 闸门4 失败时应打印主仓库与 worktree 的实际会话目录', () => {
    const cfg = process.env.CODEAGENTS3_CONFIG_DIR!;

    const sw = makeStepWise('W1', mainCwd);
    sw.handleParallelCrossCwdSession(true, worktreeCwd, testSessionId);

    const out = capturedLog();
    expect(out).toContain('闸门4');
    // 关键：失败分支也必须能看到框架实际查找的目录，否则配置错误无从定位
    expect(out).toContain(`探测 worktree 会话目录: ${path.join(cfg, 'projects', esc(worktreeCwd))}`);
    expect(out).toContain(`探测 主仓库会话目录: ${path.join(cfg, 'projects', esc(mainCwd))}`);
  });

  // 分支7：闸门4 通过 + fork → 实际建链，日志串起完整链路
  it('G7: fork 成功时日志应串起探测到建链的完整链路', () => {
    const cfg = process.env.CODEAGENTS3_CONFIG_DIR!;
    const sourceFile = makeSession(cfg, mainCwd, testSessionId);

    const sw = makeStepWise('W1', mainCwd);
    sw.handleParallelCrossCwdSession(true, worktreeCwd, testSessionId);

    const out = capturedLog();
    expect(out).toContain('闸门4 通过');
    expect(out).toContain('fork 模式');
    expect(out).toContain('建立软链');
    expect(out).toContain(sourceFile);
    // 软链真的建成了
    const link = path.join(cfg, 'projects', esc(worktreeCwd), `${testSessionId}.jsonl`);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    // 源文件未被改动
    expect(fs.lstatSync(sourceFile).isSymbolicLink()).toBe(false);
  });

  // 分支8：闸门4 通过 + 纯 resume → 报错，日志应记录到抛错前
  it('G8: 纯 resume 跨目录应记录原因并抛错', () => {
    const cfg = process.env.CODEAGENTS3_CONFIG_DIR!;
    makeSession(cfg, mainCwd, testSessionId);

    const sw = makeStepWise('W1', mainCwd);
    expect(() => sw.handleParallelCrossCwdSession(false, worktreeCwd, testSessionId))
      .toThrow(/不能直接复用其他目录的 session/);
    expect(capturedLog()).toContain('纯 resume 跨目录');
  });

  // 双通道：execute.log 也必须落盘
  it('G9: 判定日志应同时写入任务汇总日志 execute.log', () => {
    const sw = makeStepWise('W1', mainCwd);
    const agentDir = (sw as unknown as { agentDir: string }).agentDir;
    sw.handleParallelCrossCwdSession(true, worktreeCwd, testSessionId);

    const logFile = path.join(agentDir, 'logs', 'execute.log');
    expect(fs.existsSync(logFile)).toBe(true);
    const content = fs.readFileSync(logFile, 'utf-8');
    expect(content).toContain(SESSION_LINK_LOG_PREFIX);
    expect(content).toContain('闸门4');
  });
});