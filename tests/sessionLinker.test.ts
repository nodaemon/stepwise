import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isLocalSession,
  linkCrossCwdSession,
  findPiSessionFile
} from '../src/utils/sessionLinker';

/**
 * os.homedir 在 Jest 沙箱中是 non-configurable 属性，jest.spyOn 无法重定义，
 * 改用模块 mock 让其可编程控制。默认实现仍返回真实 home，不影响既有 pi 用例。
 * （注：也不能靠改 process.env.HOME——Jest 的 process.env 是沙箱副本，
 *   改不到原生 getenv，实测 os.homedir() 不会跟随变化。）
 */
jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return { ...actual, homedir: jest.fn(() => actual.homedir()) };
});

const realHome = jest.requireActual<typeof import('os')>('os').homedir();

/**
 * sessionLinker 单元测试
 * 重点覆盖 pi session 文件名匹配修复（幽灵 ID 防护）
 */
describe('sessionLinker', () => {
  const testSessionId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const ghostSessionId = 'ghost0000-0000-0000-0000-000000000000';

  let tempHome: string;
  // 模拟的 cwd，getProjectsDir('.pi', cwd) 会生成 --cwd-路径--
  const testCwd = '/test-cwd-路径';

  beforeAll(() => {
    // 创建临时 HOME，模拟 pi session 存储
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionLinker-test-'));
    // PI_CODING_AGENT_DIR 环境变量优先于 ~/.pi/agent
    // pi 的 escapeCwdForPi: --cwd-路径-- → / 转 - 后加 --
    // /test-cwd-路径 → test-cwd-路径 → --test-cwd-路径--
    const escapedCwd = '--' + testCwd.replace(/^[\/\\]/, '').replace(/[\/\\:]/g, '-') + '--';
    const piAgentDir = path.join(tempHome, 'pi-agent');
    const sessionDir = path.join(piAgentDir, 'sessions', escapedCwd);
    fs.mkdirSync(sessionDir, { recursive: true });

    // 模拟 pi 的真实文件命名: <timestamp>_<sessionId>.jsonl
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(sessionDir, `${ts}_${testSessionId}.jsonl`),
      '{"type":"session","id":"' + testSessionId + '"}'
    );
    // ghost ID 文件不存在（模拟 spawn 失败 / 派生前中断）

    // 设置环境变量，让 PiExecutor 使用我们的临时目录
    process.env.PI_CODING_AGENT_DIR = piAgentDir;
  });

  afterAll(() => {
    fs.rmSync(tempHome, { recursive: true, force: true });
    delete process.env.PI_CODING_AGENT_DIR;
  });

  describe('isLocalSession（幽灵 ID 防护）', () => {
    it('pi: 真实存在的会话应被识别', () => {
      const result = isLocalSession('.pi', testCwd, testSessionId);
      expect(result).toBe(true);
    });

    it('pi: 幽灵 ID（文件不存在）应返回 false', () => {
      const result = isLocalSession('.pi', testCwd, ghostSessionId);
      expect(result).toBe(false);
    });

    it('pi: 目录不存在时应返回 false', () => {
      const result = isLocalSession('.pi', '/non-existent-cwd', testSessionId);
      expect(result).toBe(false);
    });

    it('pi: 精确匹配（<sessionId>.jsonl）应失败（确认修复前 bug）', () => {
      // 验证：如果用精确文件名匹配，会找不到带时间戳前缀的文件
      const escapedCwd = '--' + testCwd.replace(/^[\/\\]/, '').replace(/[\/\\:]/g, '-') + '--';
      const sessionDir = path.join(process.env.PI_CODING_AGENT_DIR!, 'sessions', escapedCwd);
      const exactFile = path.join(sessionDir, `${testSessionId}.jsonl`);
      expect(fs.existsSync(exactFile)).toBe(false);
    });

    it('pi: 带时间戳前缀的实际文件存在', () => {
      const escapedCwd = '--' + testCwd.replace(/^[\/\\]/, '').replace(/[\/\\:]/g, '-') + '--';
      const sessionDir = path.join(process.env.PI_CODING_AGENT_DIR!, 'sessions', escapedCwd);
      const files = fs.readdirSync(sessionDir);
      expect(files.some(f => f.endsWith(`_${testSessionId}.jsonl`))).toBe(true);
    });

    it('Claude: 精确匹配行为保持不变', () => {
      // Claude 用 .claude/projects/<escaped-cwd>/<sessionId>.jsonl 格式
      // 设置临时 HOME 后，getProjectsDir('.claude', cwd) 用 os.homedir()
      const result = isLocalSession('.claude', testCwd, ghostSessionId);
      expect(result).toBe(false); // 文件不存在 → false
    });
  });

  describe('findPiSessionFile', () => {
    it('应找到真实存在的 pi 会话文件', () => {
      const escapedCwd = '--' + testCwd.replace(/^[\/\\]/, '').replace(/[\/\\:]/g, '-') + '--';
      const sessionDir = path.join(process.env.PI_CODING_AGENT_DIR!, 'sessions', escapedCwd);
      const found = findPiSessionFile(sessionDir, testSessionId);
      expect(found).not.toBeNull();
      expect(found?.endsWith(`${testSessionId}.jsonl`)).toBe(true);
    });

    it('幽灵 ID 应返回 null', () => {
      const escapedCwd = '--' + testCwd.replace(/^[\/\\]/, '').replace(/[\/\\:]/g, '-') + '--';
      const sessionDir = path.join(process.env.PI_CODING_AGENT_DIR!, 'sessions', escapedCwd);
      const found = findPiSessionFile(sessionDir, ghostSessionId);
      expect(found).toBeNull();
    });

    it('目录不存在时应返回 null', () => {
      const found = findPiSessionFile('/non/existent/dir', testSessionId);
      expect(found).toBeNull();
    });
  });

  /**
   * CodeAgent 支持用 CODEAGENTS3_CONFIG_DIR 覆盖配置目录，
   * 此时 session 存在该目录下而非 ~/.cac。未设置时必须回退 ~/.cac。
   */
  describe('CodeAgent 配置目录（CODEAGENTS3_CONFIG_DIR）', () => {
    const cacSessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const cacGhostId = 'ffffffff-0000-0000-0000-000000000000';
    const mainCwd = '/data1/wangkai/stepwise';
    const worktreeCwd = '/data1/wangkai/stepwise_Worker1';

    // 与 sessionLinker.escapeCwd 一致：非字母数字字符一律转 -
    const esc = (c: string): string => c.replace(/[^a-zA-Z0-9]/g, '-');

    let tmpRoot: string;
    let savedConfigDir: string | undefined;

    /** 在指定 config 根目录下建一个 CodeAgent 格式的会话文件 */
    const makeSession = (configDir: string, cwd: string, sid: string): void => {
      const dir = path.join(configDir, 'projects', esc(cwd));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${sid}.jsonl`), '{"type":"session"}');
    };

    /**
     * 隔离 homedir 指向的目录（配合文件顶部的 os 模块 mock）
     */
    const useHome = (home: string): void => {
      fs.mkdirSync(home, { recursive: true });
      (os.homedir as unknown as jest.Mock).mockReturnValue(home);
    };

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codeagent-cfg-'));
      savedConfigDir = process.env.CODEAGENTS3_CONFIG_DIR;
      // 默认就把 homedir 隔离到临时目录，保证用例绝不触碰真实 home
      useHome(path.join(tmpRoot, 'home'));
    });

    afterEach(() => {
      (os.homedir as unknown as jest.Mock).mockReturnValue(realHome);
      if (savedConfigDir === undefined) delete process.env.CODEAGENTS3_CONFIG_DIR;
      else process.env.CODEAGENTS3_CONFIG_DIR = savedConfigDir;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('环境变量指定的目录下的会话应被识别', () => {
      const cfg = path.join(tmpRoot, 'custom-cac');
      makeSession(cfg, mainCwd, cacSessionId);
      process.env.CODEAGENTS3_CONFIG_DIR = cfg;
      expect(isLocalSession('.cac', mainCwd, cacSessionId)).toBe(true);
    });

    it('环境变量指定目录下幽灵 ID（文件不存在）应返回 false', () => {
      process.env.CODEAGENTS3_CONFIG_DIR = path.join(tmpRoot, 'custom-cac');
      expect(isLocalSession('.cac', mainCwd, cacGhostId)).toBe(false);
    });

    it('未设置环境变量时应回退到 $HOME/.cac', () => {
      const home = path.join(tmpRoot, 'home');
      useHome(home);
      makeSession(path.join(home, '.cac'), mainCwd, cacSessionId);
      delete process.env.CODEAGENTS3_CONFIG_DIR;
      expect(isLocalSession('.cac', mainCwd, cacSessionId)).toBe(true);
    });

    it('环境变量为空串时应视为未设置，回退到 $HOME/.cac', () => {
      const home = path.join(tmpRoot, 'home');
      useHome(home);
      makeSession(path.join(home, '.cac'), mainCwd, cacSessionId);
      process.env.CODEAGENTS3_CONFIG_DIR = '';
      expect(isLocalSession('.cac', mainCwd, cacSessionId)).toBe(true);
    });

    it('与 PI_CODING_AGENT_DIR 互不串扰，各命中各自目录', () => {
      const cfg = path.join(tmpRoot, 'custom-cac');
      makeSession(cfg, mainCwd, cacSessionId);
      process.env.CODEAGENTS3_CONFIG_DIR = cfg;
      // pi 仍命中外层 beforeAll 建的临时目录
      expect(isLocalSession('.pi', testCwd, testSessionId)).toBe(true);
      expect(isLocalSession('.cac', mainCwd, cacSessionId)).toBe(true);
    });

    it('linkCrossCwdSession 应在覆盖目录内建软链，而非 ~/.cac', () => {
      const cfg = path.join(tmpRoot, 'custom-cac');
      makeSession(cfg, mainCwd, cacSessionId);
      const home = path.join(tmpRoot, 'home');
      useHome(home);
      process.env.CODEAGENTS3_CONFIG_DIR = cfg;

      linkCrossCwdSession('.cac', mainCwd, worktreeCwd, cacSessionId);

      const link = path.join(cfg, 'projects', esc(worktreeCwd), `${cacSessionId}.jsonl`);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(link))
        .toBe(path.join(cfg, 'projects', esc(mainCwd), `${cacSessionId}.jsonl`));
      // 默认 ~/.cac 下不应被创建任何东西
      expect(fs.existsSync(path.join(home, '.cac'))).toBe(false);
    });

    it('CODEAGENTS3_CONFIG_DIR 不影响 claude 的目录解析', () => {
      const cfg = path.join(tmpRoot, 'custom-cac');
      makeSession(cfg, mainCwd, cacSessionId);
      useHome(path.join(tmpRoot, 'home'));
      process.env.CODEAGENTS3_CONFIG_DIR = cfg;
      // claude 仍只认 $HOME/.claude，覆盖目录里的会话对它不可见
      expect(isLocalSession('.claude', mainCwd, cacSessionId)).toBe(false);
    });
  });

  /**
   * 软链流程的每一次文件操作都必须有日志留痕，
   * 包括「源文件不存在直接返回」这类此前完全静默的分支。
   */
  describe('软链流程日志留痕', () => {
    const logSessionId = '11111111-2222-3333-4444-555555555555';
    const logCwd = '/data1/wangkai/log-test';
    const logWorktreeCwd = '/data1/wangkai/log-test_Worker1';
    const esc = (c: string): string => c.replace(/[^a-zA-Z0-9]/g, '-');

    let tmpRoot: string;
    let savedConfigDir: string | undefined;
    let logSpy: jest.SpyInstance;

    /** 收集 console.log 输出，作为默认日志实现的断言依据 */
    const capturedLog = (): string =>
      logSpy.mock.calls.map(c => c.map(String).join(' ')).join('\n');

    const makeSession = (configDir: string, cwd: string, sid: string): string => {
      const dir = path.join(configDir, 'projects', esc(cwd));
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${sid}.jsonl`);
      fs.writeFileSync(file, '{"type":"session"}');
      return file;
    };

    beforeEach(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'linklog-test-'));
      savedConfigDir = process.env.CODEAGENTS3_CONFIG_DIR;
      process.env.CODEAGENTS3_CONFIG_DIR = path.join(tmpRoot, 'cac');
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => { /* 静默捕获 */ });
    });

    afterEach(() => {
      logSpy.mockRestore();
      if (savedConfigDir === undefined) delete process.env.CODEAGENTS3_CONFIG_DIR;
      else process.env.CODEAGENTS3_CONFIG_DIR = savedConfigDir;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    // L1：源文件不存在必须留日志（此前是完全静默 return）
    it('L1: 源会话文件不存在时必须有明确日志', () => {
      linkCrossCwdSession('.cac', logCwd, logWorktreeCwd, logSessionId);
      const out = capturedLog();
      expect(out).toContain('源会话文件不存在，跳过建链');
      expect(out).toContain(`${logSessionId}.jsonl`);
    });

    // L2：正常建链应记录源与目标完整路径
    it('L2: 建链成功应记录源与目标完整路径', () => {
      const cfg = process.env.CODEAGENTS3_CONFIG_DIR!;
      const sourceFile = makeSession(cfg, logCwd, logSessionId);

      linkCrossCwdSession('.cac', logCwd, logWorktreeCwd, logSessionId);

      const out = capturedLog();
      expect(out).toContain('建立软链');
      expect(out).toContain(sourceFile);
      expect(out).toContain(path.join(cfg, 'projects', esc(logWorktreeCwd), `${logSessionId}.jsonl`));
    });

    // L3：目标是实体文件时保护性跳过并留日志
    it('L3: 目标已是实体文件时应记录保护日志且不覆盖', () => {
      const cfg = process.env.CODEAGENTS3_CONFIG_DIR!;
      makeSession(cfg, logCwd, logSessionId);
      // worktree 侧预先放一个同名实体文件（worker 自建会话）
      const wtDir = path.join(cfg, 'projects', esc(logWorktreeCwd));
      fs.mkdirSync(wtDir, { recursive: true });
      const targetFile = path.join(wtDir, `${logSessionId}.jsonl`);
      fs.writeFileSync(targetFile, '{"entity":true}');

      linkCrossCwdSession('.cac', logCwd, logWorktreeCwd, logSessionId);

      expect(capturedLog()).toContain('按保护规则不覆盖');
      // 未被替换为软链，内容不变
      expect(fs.lstatSync(targetFile).isSymbolicLink()).toBe(false);
      expect(fs.readFileSync(targetFile, 'utf-8')).toBe('{"entity":true}');
    });

    // L4：isLocalSession 两种判定都要留日志
    it('L4: isLocalSession 的两种判定都应有日志', () => {
      const cfg = process.env.CODEAGENTS3_CONFIG_DIR!;
      makeSession(cfg, logCwd, logSessionId);

      expect(isLocalSession('.cac', logCwd, logSessionId)).toBe(true);
      expect(isLocalSession('.cac', logCwd, 'not-exist-0000')).toBe(false);

      const out = capturedLog();
      expect(out).toContain('探测会话文件');
      expect(out).toContain('本地实体会话');
      expect(out).toContain('非本地');
    });

    // L5：不传 log 参数时默认实现也必须输出（保证绝不失声）
    it('L5: 不传 log 参数时默认仍输出 console 日志', () => {
      const cfg = process.env.CODEAGENTS3_CONFIG_DIR!;
      makeSession(cfg, logCwd, logSessionId);

      linkCrossCwdSession('.cac', logCwd, logWorktreeCwd, logSessionId);

      const out = capturedLog();
      expect(out).toContain('[sessionLinker]');
      expect(out).toContain('建立软链');
    });
  });

  /**
   * 数据安全回归护栏：软链流程绝不能删除用户的 session 文件。
   */
  describe('数据安全：绝不删除 session 文件', () => {
    const safeSessionId = '99999999-8888-7777-6666-555555555555';
    const safeCwd = '/data1/wangkai/safe-test';
    const safeWorktreeCwd = '/data1/wangkai/safe-test_Worker1';
    const esc = (c: string): string => c.replace(/[^a-zA-Z0-9]/g, '-');
    const SESSION_CONTENT = '{"type":"session","userData":"不可丢失"}';

    let tmpRoot: string;
    let savedConfigDir: string | undefined;

    const setup = (): { cfg: string; sourceFile: string } => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-test-'));
      savedConfigDir = process.env.CODEAGENTS3_CONFIG_DIR;
      const cfg = path.join(tmpRoot, 'cac');
      process.env.CODEAGENTS3_CONFIG_DIR = cfg;
      const dir = path.join(cfg, 'projects', esc(safeCwd));
      fs.mkdirSync(dir, { recursive: true });
      const sourceFile = path.join(dir, `${safeSessionId}.jsonl`);
      fs.writeFileSync(sourceFile, SESSION_CONTENT);
      return { cfg, sourceFile };
    };

    afterEach(() => {
      if (savedConfigDir === undefined) delete process.env.CODEAGENTS3_CONFIG_DIR;
      else process.env.CODEAGENTS3_CONFIG_DIR = savedConfigDir;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    // S1：完整建链流程后源文件字节级不变
    it('S1: 建链后主仓 session 文件内容字节级不变', () => {
      const { sourceFile } = setup();
      linkCrossCwdSession('.cac', safeCwd, safeWorktreeCwd, safeSessionId);
      expect(fs.existsSync(sourceFile)).toBe(true);
      expect(fs.readFileSync(sourceFile, 'utf-8')).toBe(SESSION_CONTENT);
    });

    // S2：删除 worktree 目录不会连带删掉软链目标
    it('S2: 删除 worktree 目录后主仓 session 仍完好', () => {
      const { sourceFile } = setup();
      linkCrossCwdSession('.cac', safeCwd, safeWorktreeCwd, safeSessionId);

      // 模拟 forEachParallel 收尾：删除 worktree 目录
      const fakeWorktree = path.join(tmpRoot, 'worktree_dir');
      const wtProjects = path.join(fakeWorktree, 'projects');
      fs.mkdirSync(wtProjects, { recursive: true });
      fs.symlinkSync(sourceFile, path.join(wtProjects, 'link.jsonl'));
      fs.rmSync(fakeWorktree, { recursive: true, force: true });

      expect(fs.existsSync(sourceFile)).toBe(true);
      expect(fs.readFileSync(sourceFile, 'utf-8')).toBe(SESSION_CONTENT);
    });

    // S3：worktree 内含文件软链与目录软链时，rmSync 递归删除不跟随软链
    it('S3: rmSync(recursive) 不跟随软链，目标数据完好', () => {
      const { cfg, sourceFile } = setup();
      const preciousDir = path.join(cfg, 'projects', 'precious');
      fs.mkdirSync(preciousDir, { recursive: true });
      fs.writeFileSync(path.join(preciousDir, 'keep.txt'), '重要数据');

      const wt = path.join(tmpRoot, 'wt2');
      fs.mkdirSync(wt, { recursive: true });
      fs.symlinkSync(sourceFile, path.join(wt, 'file_link.jsonl'));
      fs.symlinkSync(preciousDir, path.join(wt, 'dir_link'));

      fs.rmSync(wt, { recursive: true, force: true });

      expect(fs.existsSync(sourceFile)).toBe(true);
      expect(fs.readFileSync(sourceFile, 'utf-8')).toBe(SESSION_CONTENT);
      expect(fs.existsSync(path.join(preciousDir, 'keep.txt'))).toBe(true);
      expect(fs.readFileSync(path.join(preciousDir, 'keep.txt'), 'utf-8')).toBe('重要数据');
    });

    // S4：静态护栏——删除能力不得被重新接回并行流程
    it('S4: forEachParallel 源码中不得出现 session 删除能力', () => {
      const src = path.join(__dirname, '..', 'src', 'forEachParallel.ts');
      const content = fs.readFileSync(src, 'utf-8');
      expect(content).not.toContain('cleanWorktreeSessionLinks');
      expect(content).not.toContain('sessionLinker');
      // 并行流程也不得直接操作 ~/.claude / ~/.cac 等 session 存储目录
      expect(content).not.toMatch(/unlinkSync/);
    });
  });
});
