import { McodeExecutor } from '../src/executors/mcode';

/**
 * McodeExecutor 单元测试
 *
 * 覆盖 mcode 后端与其它执行器的三处关键差异：
 * 1. 会话 ID 由 mcode 自行分配（mvs_<32位hex>），新会话不得传 --session
 * 2. 非 mcode 会话 ID 需降级为新建会话（mcode 的 --session 走 getSession(id)，
 *    传不存在的 ID 会直接失败）
 * 3. mcode 无 fork 能力，fork 请求必须显式抛错而非静默降级
 */
describe('McodeExecutor', () => {
  const executor = new McodeExecutor();
  const buildArgs = (prompt: string, sessionId: string, isResume: boolean, fork = false): string[] =>
    (executor as any).buildArgs(prompt, sessionId, isResume, undefined, fork);
  const buildProbeArgs = (): string[] => (executor as any).buildProbeArgs();

  /** 合法的 mcode 会话 ID */
  const MCODE_SESSION_ID = 'mvs_1bb5c3c79d9f4735a4026694fcaa57ed';

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getCommand / usesNDJsonOutput', () => {
    it('非 Windows 下命令名为 mcode', () => {
      if (process.platform === 'win32') return;
      expect((executor as any).getCommand()).toBe('mcode');
    });

    it('应使用 NDJSON 输出', () => {
      expect((executor as any).usesNDJsonOutput()).toBe(true);
    });

    it('agentType 应为 mcode', () => {
      expect(executor.agentType).toBe('mcode');
    });
  });

  describe('buildArgs：新会话', () => {
    const args = buildArgs('hello', 'framework-uuid-placeholder', false);

    it('应使用 mcode exec 无头入口', () => {
      expect(args[0]).toBe('exec');
    });

    it('应固定使用 --permission full（无头宿主无法应答权限确认）', () => {
      expect(args).toContain('--permission');
      expect(args[args.indexOf('--permission') + 1]).toBe('full');
    });

    it('应使用 --output-format stream-json 以获得逐行事件流', () => {
      expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    });

    it('不应传 --session：框架预生成的 UUID 对 mcode 无意义', () => {
      expect(args).not.toContain('--session');
    });

    it('提示词应为最后一个参数', () => {
      expect(args[args.length - 1]).toBe('hello');
    });
  });

  describe('buildArgs：恢复会话', () => {
    it('合法 mvs_ 会话 ID 应附加 --session', () => {
      const args = buildArgs('continue', MCODE_SESSION_ID, true);
      expect(args).toContain('--session');
      expect(args[args.indexOf('--session') + 1]).toBe(MCODE_SESSION_ID);
    });

    it('框架预生成的 UUID 应降级为新建会话，不传 --session 且不抛异常', () => {
      const args = buildArgs('resume', '11111111-2222-4333-8444-555555555555', true);
      expect(args).not.toContain('--session');
      expect(args[0]).toBe('exec');
    });

    it('降级时应输出告警，说明无法续接原上下文', () => {
      buildArgs('resume', 'not-a-mcode-session-id', true);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('不是 mcode 会话 ID')
      );
    });

    it('合法 ID 时不应告警', () => {
      buildArgs('continue', MCODE_SESSION_ID, true);
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe('fork 拒绝', () => {
    it('fork=true 应抛出明确错误，而不是静默降级为新建会话', async () => {
      await expect(
        executor.execute('prompt', { fork: true, sessionId: MCODE_SESSION_ID })
      ).rejects.toThrow(/fork 模式不受支持/);
    });

    it('错误信息应给出可操作的替代方案', async () => {
      await expect(
        executor.execute('prompt', { fork: true, sessionId: MCODE_SESSION_ID })
      ).rejects.toThrow(/不传 sessionId/);
    });

    it('assertForkSupported 应抛出同样的错误（供 StepWise 在写入 progress 前调用）', () => {
      expect(() => executor.assertForkSupported()).toThrow(/fork 模式不受支持/);
    });
  });

  describe('重试时续接同一会话', () => {
    it('首次执行捕获的真实会话 ID 应在重试时用于 --session', async () => {
      const calls: string[][] = [];
      let attempt = 0;

      // 模拟基类 runCommand：真实实现内部同样是调用 buildArgs 拼装参数
      (executor as any).runCommand = jest.fn(
        async (prompt: string, sessionId: string, options: any) => {
          calls.push(
            (executor as any).buildArgs(prompt, sessionId, options.useResume === true, undefined, options.fork)
          );
          attempt++;
          if (attempt === 1) {
            // 模拟基类从 stdout 解析到派生 ID 后回调 onDerivedSessionId
            options.onDerivedSessionId?.(MCODE_SESSION_ID);
            return { stdout: '', stderr: 'boom', exitCode: 1 };
          }
          return { stdout: '{"type":"exec.started"}', stderr: '', exitCode: 0 };
        }
      );

      await executor.execute('prompt', { cwd: process.cwd() });

      expect(calls).toHaveLength(2);
      // 首次执行：不传 --session（框架 UUID 对 mcode 无意义）
      expect(calls[0]).not.toContain('--session');
      // 重试：续接首次派生出的真实会话，而不是新建会话
      expect(calls[1]).toContain('--session');
      expect(calls[1][calls[1].indexOf('--session') + 1]).toBe(MCODE_SESSION_ID);
    });

    it('已捕获真实会话 ID 时，buildArgs 应优先使用它而非框架预生成的 UUID', () => {
      (executor as any).derivedSessionId = MCODE_SESSION_ID;
      const args = buildArgs('retry', '11111111-2222-4333-8444-555555555555', true);

      expect(args[args.indexOf('--session') + 1]).toBe(MCODE_SESSION_ID);
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  describe('限额识别', () => {
    const checkRateLimit = (stdout: string, stderr = '') =>
      (executor as any).checkRateLimitError(stdout, stderr);

    it('基类口径（429 / rate_limit_error / usage limit exceeded）应命中', () => {
      expect(checkRateLimit('HTTP 429 Too Many Requests')).not.toBeNull();
      expect(checkRateLimit('{"type":"error","error":{"type":"rate_limit_error"}}')).not.toBeNull();
    });

    it('mcode 口径的空格分隔 "rate limit" 也应被识别为限额', () => {
      // mcode 自身判定 provider 限额错误的正则：
      // /\b(?:rate.?limit(?:ed)?|too many requests|HTTP\s*429)\b/iu
      const info = checkRateLimit(
        '',
        'mcode exec failed: The run failed: Number of request tokens has exceeded your per-minute rate limit.'
      );
      expect(info).not.toBeNull();
      expect(info.resetTime.getTime()).toBeGreaterThan(Date.now());
    });

    it('"too many requests" 也应被识别为限额', () => {
      expect(checkRateLimit('', 'provider returned Too Many Requests')).not.toBeNull();
    });

    it('与限额无关的错误不应被识别为限额', () => {
      expect(checkRateLimit('', 'Session workspace does not match --cwd')).toBeNull();
    });
  });

  describe('buildProbeArgs', () => {
    const probe = buildProbeArgs();

    it('应使用 mcode exec 无头入口', () => {
      expect(probe[0]).toBe('exec');
    });

    it('应携带 --permission full', () => {
      expect(probe[probe.indexOf('--permission') + 1]).toBe('full');
    });

    it('应发送一个简单请求用于探测限额是否恢复', () => {
      expect(probe).toContain('reply ok');
    });
  });
});
