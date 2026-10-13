import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isLocalSession,
  linkCrossCwdSession,
  cleanWorktreeSessionLinks,
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

    it('cleanWorktreeSessionLinks 应在覆盖目录内清理残留软链', () => {
      const cfg = path.join(tmpRoot, 'custom-cac');
      makeSession(cfg, mainCwd, cacSessionId);
      process.env.CODEAGENTS3_CONFIG_DIR = cfg;
      linkCrossCwdSession('.cac', mainCwd, worktreeCwd, cacSessionId);

      const wtDir = path.join(cfg, 'projects', esc(worktreeCwd));
      expect(fs.readdirSync(wtDir)).toHaveLength(1);

      cleanWorktreeSessionLinks('.cac', worktreeCwd);
      expect(fs.readdirSync(wtDir)).toHaveLength(0);
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
});
