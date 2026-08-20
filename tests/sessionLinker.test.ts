import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isLocalSession, findPiSessionFile } from '../src/utils/sessionLinker';

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
});
