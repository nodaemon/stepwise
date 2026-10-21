import { ClaudeExecutor } from '../src/executors/claude';
import { CodeAgentExecutor } from '../src/executors/codeagent';

/**
 * CodeAgentExecutor / ClaudeExecutor 命令参数单元测试
 *
 * 重点覆盖 --skip-safe-check：
 * CodeAgent 需无条件携带该 flag（跳过目录首次使用时的安全确认，
 * 否则确认产生的报错会被写入 verbose_output.txt / error_report.txt）；
 * Claude 不认识该 flag，必须保持命令形态不变。
 */
describe('--skip-safe-check 命令行参数', () => {
  const SESSION_ID = '11111111-2222-4333-8444-555555555555';

  describe('CodeAgentExecutor（应携带 --skip-safe-check）', () => {
    // 通过 as any 访问 protected 方法，与 probeRateLimit.test.ts 一致
    // 注意：buildArgs() 不再接收 prompt 形参——提示词统一经 stdin 管道下发
    const buildArgs = (executor: CodeAgentExecutor, ...rest: unknown[]): string[] =>
      (executor as any).buildArgs(SESSION_ID, ...rest);

    it('新会话应携带该 flag，且紧跟在 --dangerously-skip-permissions 之后', () => {
      const executor = new CodeAgentExecutor();
      const args = buildArgs(executor, false);

      expect(args).toContain('--skip-safe-check');
      expect(args[0]).toBe('--dangerously-skip-permissions');
      expect(args[1]).toBe('--skip-safe-check');
    });

    it('新会话应使用 --session-id，flag 不影响会话参数', () => {
      const executor = new CodeAgentExecutor();
      const args = buildArgs(executor, false);

      expect(args).toContain('--session-id');
      expect(args).toContain(SESSION_ID);
      expect(args).not.toContain('--resume');
    });

    it('恢复会话应携带该 flag，且 --resume <sessionId> 保留', () => {
      const executor = new CodeAgentExecutor();
      const args = buildArgs(executor, true);

      expect(args).toContain('--skip-safe-check');
      const resumeIdx = args.indexOf('--resume');
      expect(args[resumeIdx + 1]).toBe(SESSION_ID);
    });

    it('fork 会话应携带该 flag，且 --fork-session 保留', () => {
      const executor = new CodeAgentExecutor();
      const args = buildArgs(executor, true, undefined, true);

      expect(args).toContain('--skip-safe-check');
      expect(args).toContain('--fork-session');
    });

    it('探测命令应携带该 flag（探测与正式执行同 cwd）', () => {
      const executor = new CodeAgentExecutor();
      const args = (executor as any).buildProbeArgs();

      // 探测提示词经 stdin 管道下发，不在命令行参数中
      expect(args).toEqual([
        '--dangerously-skip-permissions',
        '--skip-safe-check',
        '--no-session-persistence',
        '-p'
      ]);
    });

    it('可执行程序名应为 codeagent（回归保护）', () => {
      const executor = new CodeAgentExecutor();

      expect((executor as any).getCommand()).toBe('codeagent');
      expect(executor.agentType).toBe('codeagent');
    });
  });

  describe('ClaudeExecutor（不应携带该 flag，命令形态不变）', () => {
    it('buildArgs 不应包含 --skip-safe-check', () => {
      const executor = new ClaudeExecutor();
      const args = (executor as any).buildArgs(SESSION_ID, false);

      expect(args).not.toContain('--skip-safe-check');
      expect(args[0]).toBe('--dangerously-skip-permissions');
      expect(args[1]).toBe('--verbose');
    });

    it('buildProbeArgs 应保持原有参数不变（探测提示词改为经 stdin 下发）', () => {
      const executor = new ClaudeExecutor();
      const args = (executor as any).buildProbeArgs();

      expect(args).toEqual(['--dangerously-skip-permissions', '--no-session-persistence', '-p']);
    });
  });
});
