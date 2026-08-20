import { PiExecutor } from '../src/executors/pi';
import { ExecutorRawResult } from '../src/executors/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * PiExecutor 单元测试
 * 重点覆盖 NDJSON 输出的成功/失败判断（isExecutionSuccessful）
 * 这是修复 429 重试机制 bug 的关键
 */
describe('PiExecutor', () => {
  const executor = new PiExecutor();

  // 通过 as any 访问 protected 方法
  const isSuccessful = (result: ExecutorRawResult): boolean =>
    (executor as any).isExecutionSuccessful(result);

  /**
   * 构造 pi --mode json 输出的辅助函数
   * 默认最后一条 message_end 的 stopReason 由 stopReason 参数控制
   */
  function buildNdjsonOutput(stopReason: string, errorMessage?: string): string {
    const lines = [
      JSON.stringify({ type: 'session', id: 'test-session', cwd: '/tmp' }),
      JSON.stringify({ type: 'agent_start' }),
      JSON.stringify({ type: 'turn_start' }),
      JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }),
      JSON.stringify({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason,
          errorMessage,
          content: []
        }
      }),
      JSON.stringify({ type: 'turn_end', message: { role: 'assistant' }, toolResults: [] }),
      JSON.stringify({ type: 'agent_end', messages: [], willRetry: false }),
      JSON.stringify({ type: 'agent_settled' })
    ];
    return lines.join('\n');
  }

  describe('isExecutionSuccessful（429 重试修复）', () => {
    it('stopReason=error + exitCode=0 (pi --mode json) 应判定为失败，触发 retry', () => {
      const stdout = buildNdjsonOutput('error', '429 Budget has been exceeded!');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(false);
    });

    it('stopReason=aborted + exitCode=0 应判定为失败，触发 retry', () => {
      const stdout = buildNdjsonOutput('aborted');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(false);
    });

    it('stopReason=stop + exitCode=0 应判定为成功', () => {
      const stdout = buildNdjsonOutput('stop');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(true);
    });

    it('stopReason=toolUse + exitCode=0 应判定为成功（工具调用导致流中断是正常的）', () => {
      const stdout = buildNdjsonOutput('toolUse');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(true);
    });

    it('stopReason=length + exitCode=0 应判定为成功（上下文截断属于可接受结束）', () => {
      const stdout = buildNdjsonOutput('length');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(true);
    });

    it('exitCode=1 应判定为失败（与 stopReason 无关）', () => {
      const stdout = buildNdjsonOutput('stop');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 1 });
      expect(result).toBe(false);
    });

    it('空 stdout + exitCode=0 应判定为成功（由 base.ts "空输出视为失败"逻辑兜底）', () => {
      const result = isSuccessful({ stdout: '', stderr: '', exitCode: 0 });
      expect(result).toBe(true);
    });

    it('非 JSON 的 stdout + exitCode=0 应判定为成功（容错）', () => {
      const result = isSuccessful({
        stdout: 'not json at all\nrandom text',
        stderr: '',
        exitCode: 0
      });
      expect(result).toBe(true);
    });

    it('多 message_end 场景应取最后一个', () => {
      // 第一轮 stop，第二轮 error → 应判定为失败
      const stdout = buildNdjsonOutput('stop') + '\n' +
        JSON.stringify({ type: 'turn_start' }) + '\n' +
        JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }) + '\n' +
        JSON.stringify({
          type: 'message_end',
          message: { role: 'assistant', stopReason: 'error', errorMessage: '429 budget' }
        }) + '\n' +
        JSON.stringify({ type: 'turn_end', message: { role: 'assistant' }, toolResults: [] });
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(false);
    });

    it('多 message_end 场景：最后一轮成功应判定为成功', () => {
      // 第一轮 error，第二轮 stop → 应判定为成功
      const stdout = buildNdjsonOutput('error', '429 budget') + '\n' +
        JSON.stringify({ type: 'turn_start' }) + '\n' +
        JSON.stringify({ type: 'message_start', message: { role: 'assistant' } }) + '\n' +
        JSON.stringify({
          type: 'message_end',
          message: { role: 'assistant', stopReason: 'stop' }
        }) + '\n' +
        JSON.stringify({ type: 'turn_end', message: { role: 'assistant' }, toolResults: [] });
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(true);
    });

    it('混合 user / assistant message_end 时只检查 assistant', () => {
      const stdout = [
        JSON.stringify({ type: 'message_end', message: { role: 'user' } }),  // user 角色，忽略
        JSON.stringify({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } })
      ].join('\n');
      const result = isSuccessful({ stdout, stderr: '', exitCode: 0 });
      expect(result).toBe(true);
    });
  });

  describe('基本属性', () => {
    it('agentType 应为 pi', () => {
      expect(executor.agentType).toBe('pi');
    });

    it('usesNDJsonOutput 应返回 true', () => {
      expect((executor as any).usesNDJsonOutput()).toBe(true);
    });
  });

  /**
   * 幽灵 ID 防护：fork 前必须确认 fork 源会话真实存在
   * 若 fork 源不存在（幽灵 ID / 过期会话），降级为新建会话
   */
  describe('fork 源验证（幽灵 ID 防护）', () => {
    let tempHome: string;
    const testCwd = '/test-cwd-路径';
    const realSessionId = 'real1234-5678-90ab-cdef-123456789012';
    const ghostSessionId = 'ghost0000-0000-0000-0000-000000000000';

    beforeAll(() => {
      tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-fork-test-'));
      const piAgentDir = path.join(tempHome, 'pi-agent');
      const escapedCwd = '--' + testCwd.replace(/^[\/\\]/, '').replace(/[\/\\:]/g, '-') + '--';
      const sessionDir = path.join(piAgentDir, 'sessions', escapedCwd);
      fs.mkdirSync(sessionDir, { recursive: true });

      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(
        path.join(sessionDir, `${ts}_${realSessionId}.jsonl`),
        '{"type":"session","id":"' + realSessionId + '"}'
      );
      // ghost 不创建

      process.env.PI_CODING_AGENT_DIR = piAgentDir;
    });

    afterAll(() => {
      fs.rmSync(tempHome, { recursive: true, force: true });
      delete process.env.PI_CODING_AGENT_DIR;
    });

    it('isPiSessionExists: 真实会话应返回 true', () => {
      const exec = executor as any;
      exec.currentCwd = testCwd;
      expect(exec.isPiSessionExists(realSessionId)).toBe(true);
    });

    it('isPiSessionExists: 幽灵 ID 应返回 false', () => {
      const exec = executor as any;
      exec.currentCwd = testCwd;
      expect(exec.isPiSessionExists(ghostSessionId)).toBe(false);
    });

    it('isPiSessionExists: 空 cwd 应返回 false', () => {
      const exec = executor as any;
      exec.currentCwd = '';
      expect(exec.isPiSessionExists(realSessionId)).toBe(false);
    });

    it('isPiSessionExists: 目录不存在时应返回 false', () => {
      const exec = executor as any;
      exec.currentCwd = '/non-existent-cwd-xxx';
      expect(exec.isPiSessionExists(realSessionId)).toBe(false);
    });

    it('fork 源存在时：buildArgs 应拼装 --fork', () => {
      const exec = executor as any;
      exec.currentCwd = testCwd;
      exec.forkNewSessionId = 'derived-uuid-1234';

      const args = exec.buildArgs('test prompt', realSessionId, true, undefined, true);
      expect(args).toContain('--fork');
      expect(args).toContain(realSessionId);
      expect(args).toContain('--session-id');
      expect(args).toContain('derived-uuid-1234');
    });

    it('降级后（fork=false, forkNewSessionId=null）：buildArgs 不含 --fork', () => {
      const exec = executor as any;
      exec.currentCwd = testCwd;
      exec.forkNewSessionId = null;

      const newUuid = 'fresh-uuid-5678';
      const args = exec.buildArgs('test prompt', newUuid, true, undefined, false);
      expect(args).not.toContain('--fork');
      expect(args).toContain('--session-id');
      expect(args).toContain(newUuid);
    });

    /**
     * 并行 worktree + 悬空 symlink 场景：
     * worktree 中的 symlink 指向主仓库已被清理的会话（主仓库会话被删）
     * 错误修正：isPiSessionExists 必须跳过悬空 symlink（statSync 验证）
     * 否则会误判为 true，fork 错误创建报 "No session found"
     */
    it('悬空 symlink（主仓库会话已清理）应返回 false', () => {
      const exec = executor as any;
      // 使用一个不同的 cwd 模拟 worktree
      const worktreeCwd = '/worktree-cwd';
      const escapedCwd = '--' + worktreeCwd.replace(/^[\/\\]/, '').replace(/[\/\\:]/g, '-') + '--';
      const sessionDir = path.join(process.env.PI_CODING_AGENT_DIR!, 'sessions', escapedCwd);

      // 创建 worktree 的 session 目录
      fs.mkdirSync(sessionDir, { recursive: true });

      // 创建悬空 symlink：指向一个不存在的文件
      const danglingTarget = path.join(tempHome, 'non-existent-session.jsonl');
      const danglingLink = path.join(sessionDir, `2026-01-01T00-00-00-000Z_${ghostSessionId}.jsonl`);
      fs.symlinkSync(danglingTarget, danglingLink);

      exec.currentCwd = worktreeCwd;
      const result = exec.isPiSessionExists(ghostSessionId);
      expect(result).toBe(false);  // 悬空 symlink 应返回 false

      // 清理
      fs.unlinkSync(danglingLink);
      fs.rmdirSync(sessionDir);
    });

    it('有效 symlink（指向存在的文件）应返回 true', () => {
      const exec = executor as any;
      const worktreeCwd = '/worktree-cwd-2';
      const escapedCwd = '--' + worktreeCwd.replace(/^[\/\\]/, '').replace(/[\/\\:]/g, '-') + '--';
      const sessionDir = path.join(process.env.PI_CODING_AGENT_DIR!, 'sessions', escapedCwd);

      fs.mkdirSync(sessionDir, { recursive: true });

      // 创建有效 symlink：指向已存在的文件（realSessionId 的 session）
      const realSessionFile = fs.readdirSync(path.join(process.env.PI_CODING_AGENT_DIR!, 'sessions',
        '--' + testCwd.replace(/^[\/\\]/, '').replace(/[\/\\:]/g, '-') + '--'))
        .find(f => f.endsWith(`_${realSessionId}.jsonl`))!;
      const realSessionPath = path.join(process.env.PI_CODING_AGENT_DIR!, 'sessions',
        '--' + testCwd.replace(/^[\/\\]/, '').replace(/[\/\\:]/g, '-') + '--', realSessionFile);

      const validLink = path.join(sessionDir, `2026-01-01T00-00-00-000Z_${realSessionId}.jsonl`);
      fs.symlinkSync(realSessionPath, validLink);

      exec.currentCwd = worktreeCwd;
      const result = exec.isPiSessionExists(realSessionId);
      expect(result).toBe(true);  // 有效 symlink 应返回 true

      // 清理
      fs.unlinkSync(validLink);
      fs.rmdirSync(sessionDir);
    });
  });
});