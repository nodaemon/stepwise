/**
 * mcode 执行器（Minimax Code，@minimax-ai/code）
 *
 * mcode 是一个终端编程智能体，无头模式入口为 `mcode exec`。本执行器基于
 * mcode 0.6.5 的 `mcode exec --output-format stream-json` 事件流实现。
 *
 * 命令格式：
 * - 新会话: mcode exec --permission full --output-format stream-json "prompt"
 * - 恢复会话: mcode exec --permission full --output-format stream-json --session <mvs_id> "prompt"
 *
 * 权限：
 * 无头宿主无法应答交互式权限确认（mcode 的 `--permission ask` 在无头下直接报错），
 * 因此固定使用 `--permission full`。mcode 内部将其映射为 bypassPermissions，
 * 语义等价于 Claude 的 --dangerously-skip-permissions。
 *
 * 输出模式（--output-format stream-json）：
 * stdout 为逐行 JSON 事件流，公共信封为
 *   {schemaVersion, sequence, timestampMs, runId, sessionId, turnId, ...payload}
 * 事件类型：exec.started / session.started|resumed / turn.started /
 *          item.started|updated|completed / turn.completed|failed / exec.completed
 * item.type ∈ reasoning | agent_message | tool_call。
 * verbose_output.txt 中按事件类型格式化输出（见 ndjsonFormatter.ts）。
 * item.completed 的 tool_call 事件带完整 toolCall：
 *   {id, name, status, input, output}，其中 output.content 为工具执行结果
 *   （{content:[{type:'text',text}], details:{...}}），故工具入参与执行结果
 *   均可从事件流直接还原，无需查会话 messages.jsonl。
 *
 * Session ID 归属（与其它执行器的关键差异）：
 * mcode 自行分配会话 ID（形如 mvs_<32 位 hex>），调用方无法指定——
 * 其 createSession() 内部固定调用 makeSessionId()。因此：
 * - 新会话时框架预生成的 UUID 对 mcode 无意义，buildArgs() 一律不传 --session；
 * - 真实 ID 在首个事件（exec.started）即可读到，由 ndjsonFormatter 提取为 sessionId，
 *   经 BaseExecutor 的 onDerivedSessionId 钩子实时回写 progress.json，
 *   使「子进程被 kill 后仍可按真实 ID 续接」的崩溃恢复能力得以保留；
 * - 恢复时仅当 sessionId 形如 mvs_* 才传 --session（mcode 的 --session 走
 *   getSession(id)，传不存在的 ID 会直接失败），否则降级为新建会话并告警；
 * - 重试时以首次执行捕获到的真实 ID 续接同一个会话，避免每次重试都新建
 *   会话、丢失失败前的上下文。
 *
 * 能力限制：
 * - 不支持 fork：mcode 无从已有会话派生新会话的能力（会话 ID 不可指定），
 *   且会话的 workspaceDir 必须与 --cwd 严格一致。因此 fork 请求显式抛错，
 *   而不是静默降级——无人值守场景下静默丢失上下文比早失败更危险。
 * - 不支持跨 cwd 恢复：mcode 会话不按 cwd 文件隔离（存于
 *   $MINIMAX_DATA_DIR/v2/sessions/<日期>/… 全局按日期分区），但其 workspaceDir
 *   校验是硬性的，故 StepWise.getConfigSubdir() 对 mcode 返回 null，
 *   跳过 sessionLinker 的跨目录软链逻辑。
 * - 429 探测可用但每次探测会新建一个会话（mcode 无「不落盘 session」开关）。
 *
 * 版本说明：上述 stream-json 事件结构依据 mcode 0.6.12 实测核实
 * （0.6.5 事件结构一致）。mcode 升级若改动事件结构，
 * 需同步更新 ndjsonFormatter.ts 中的 mcode 分支。
 */

import { BaseExecutor, RateLimitInfo } from './base';
import { AgentType, ExecutionResult } from '../types';
import { AgentExecutorOptions } from './types';
import { DEFAULT_RETRY_WAIT_MS } from '../constants';

/**
 * 检测当前是否为 Windows 系统
 */
function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * 判断是否是 mcode 格式的会话 ID
 * mcode 会话 ID 形如 mvs_<32 位 hex>，由 mcode 自行分配
 */
function isMcodeSessionId(sessionId: string): boolean {
  return /^mvs_[0-9a-f]{32}$/.test(sessionId);
}

/**
 * mcode 的限额文案
 *
 * mcode 自身判定 provider 限额错误的正则是
 *   /\b(?:rate.?limit(?:ed)?|too many requests|HTTP\s*429)\b/iu
 * （见 mcode 源码中 provider 错误的分类逻辑），即空格/下划线分隔的
 * "rate limit" 也算限额。
 *
 * 基类的门限只认 "429" / "rate_limit_error" / "usage limit exceeded"，
 * 而 provider 返回的文案通常是 Anthropic 风格的
 * "...has exceeded your per-minute rate limit..."，三者均不匹配，
 * 会导致限额等待与 429 探测循环整段失效（退化为普通错误重试）。
 */
const MCODE_RATE_LIMIT_PATTERN = /\b(?:rate[\s_-]*limit(?:ed)?|too\s+many\s+requests)\b/i;

/**
 * mcode 不支持 fork 的错误提示
 */
const MCODE_FORK_UNSUPPORTED_MESSAGE =
  '[mcode] fork 模式不受支持：mcode 不提供从已有会话派生新会话的能力' +
  '（会话 ID 由 mcode 自行分配，调用方无法指定；且会话的 workspaceDir 必须与 --cwd 严格一致）。' +
  '请改为：① 不传 sessionId，让该 worktree 独立会话；' +
  '或 ② 复用同一 cwd 下的已有会话（去掉 newSession:true）。';

/**
 * mcode 执行器
 */
export class McodeExecutor extends BaseExecutor {
  /** 执行器类型标识 */
  readonly agentType: AgentType = 'mcode';

  /**
   * 本次执行中从事件流捕获到的真实 mcode 会话 ID
   *
   * 框架预生成的 UUID 对 mcode 无效（mcode 的会话 ID 由 mcode 自行分配），
   * 但重试需要真实的 mvs_* ID 才能续接同一个会话——否则每次重试都会新建
   * 会话，丢失失败前已完成的上下文，与基类"重试时使用恢复模式，在之前
   * 失败的基础上继续"的重试契约相悖。
   */
  private derivedSessionId: string | null = null;

  /**
   * 返回 CLI 命令名称
   * Windows 下需要使用 mcode.cmd
   */
  protected getCommand(): string {
    return isWindows() ? 'mcode.cmd' : 'mcode';
  }

  /**
   * mcode 使用 stream-json（NDJSON）输出格式
   * 空行无意义需跳过，每行按事件类型格式化后写入 verbose_output.txt
   */
  protected usesNDJsonOutput(): boolean {
    return true;
  }

  /**
   * fork 能力断言：mcode 不支持 fork，一旦被要求派生即抛错
   *
   * 调用时机：
   * - StepWise 在写入 progress（标记任务 in_progress）之前调用，
   *   使失败发生在污染进度状态之前——否则任务会永久停留在 in_progress，
   *   且续跑时必然再次失败、无法自愈；
   * - execute() 内部再调用一次作为兜底（直接使用执行器时不经过 StepWise）。
   */
  assertForkSupported(): void {
    throw new Error(MCODE_FORK_UNSUPPORTED_MESSAGE);
  }

  /**
   * 重写 execute：
   * - fork 请求显式拒绝
   * - 捕获真实 mcode 会话 ID，供重试时续接同一个会话
   *
   * mcode 不提供从已有会话派生新会话的能力（会话 ID 由 mcode 自行分配，
   * 调用方无法指定），且会话的 workspaceDir 必须与 --cwd 严格一致。
   * 此时若静默降级为新建会话，fork 携带的上下文会被无声丢弃——
   * 对无人值守批处理而言这比早失败危险得多，因此直接抛错并给出替代方案。
   */
  async execute(prompt: string, options: AgentExecutorOptions): Promise<ExecutionResult> {
    if (options.fork) {
      this.assertForkSupported();
    }

    // 真实会话 ID 由首个 exec.started 事件给出，经 BaseExecutor 的
    // onDerivedSessionId 钩子回传；在此拦截一份供重试时使用
    this.derivedSessionId = null;
    const userOnDerivedSessionId = options.onDerivedSessionId;
    const executorOptions: AgentExecutorOptions = {
      ...options,
      onDerivedSessionId: (derivedId: string) => {
        this.derivedSessionId = derivedId;
        userOnDerivedSessionId?.(derivedId);
      }
    };

    return super.execute(prompt, executorOptions);
  }

  /**
   * 限额识别：兼容 mcode 的 provider 限额文案
   *
   * 基类只认 "429" / "rate_limit_error" / "usage limit exceeded"，而 mcode 的
   * provider 限额文案通常是空格分隔的 "rate limit"（见 MCODE_RATE_LIMIT_PATTERN
   * 的说明）。这里在基类未命中时补一层 mcode 口径的识别，使限额等待与
   * 429 探测循环能够正常触发。
   */
  protected checkRateLimitError(stdout: string, stderr: string): RateLimitInfo | null {
    const detected = super.checkRateLimitError(stdout, stderr);
    if (detected) return detected;

    if (MCODE_RATE_LIMIT_PATTERN.test(stdout + stderr)) {
      const waitMinutes = Math.round(DEFAULT_RETRY_WAIT_MS / 60000);
      return {
        resetTime: new Date(Date.now() + DEFAULT_RETRY_WAIT_MS),
        message: `已达到 mcode API 使用限额。未获取到具体重置时间，将等待 ${waitMinutes} 分钟后重试。`
      };
    }

    return null;
  }

  /**
   * 构建命令行参数
   *
   * @param prompt 提示词内容
   * @param sessionId 会话 ID（仅 isResume 且形如 mvs_* 时才实际传给 mcode）
   * @param isResume 是否使用恢复模式
   * @param debugFile debug 日志文件路径（mcode 无此参数，忽略）
   * @param fork 是否 fork 模式（mcode 不支持，已在 execute() 中拒绝）
   * @returns 命令行参数数组
   */
  protected buildArgs(
    prompt: string,
    sessionId: string,
    isResume: boolean,
    debugFile?: string,
    fork?: boolean
  ): string[] {
    const args: string[] = [];

    // 无头执行入口（不启动 TUI）
    args.push('exec');

    // 跳过权限确认，允许自动化执行
    // 无头宿主无法应答交互式确认；full → mcode 内部的 bypassPermissions
    args.push('--permission', 'full');

    // 使用 stream-json 捕获完整过程（exec/session/turn/item 事件流），
    // 供 base.ts 逐行实时写入 verbose_output.txt
    args.push('--output-format', 'stream-json');

    // 会话恢复：仅当 sessionId 是真实的 mcode 会话 ID 时才附加 --session
    // 新会话（isResume=false）一律不传：框架预生成的 UUID 对 mcode 无意义，
    // 传过去会让 mcode 的 getSession(id) 失败
    if (isResume) {
      // 优先使用本次执行中捕获到的真实会话 ID：重试时框架持有的仍是
      // 预生成的 UUID，若沿用它，每次重试都会新建会话、丢失失败前的上下文
      const capturedSessionId = this.derivedSessionId && isMcodeSessionId(this.derivedSessionId)
        ? this.derivedSessionId
        : null;
      const effectiveSessionId = capturedSessionId ?? sessionId;

      if (isMcodeSessionId(effectiveSessionId)) {
        args.push('--session', effectiveSessionId);
      } else {
        // 切换后端后的残留 progress.json、脏数据等场景：优雅降级为新建会话
        console.warn(
          `[mcode] sessionId "${effectiveSessionId}" 不是 mcode 会话 ID（期望 mvs_<32位hex>），` +
          `本次按新建会话执行，无法续接原会话上下文`
        );
      }
    }

    // 提示词
    args.push(prompt);

    return args;
  }

  /**
   * 构建探测命令参数
   * 用于 429 限额恢复探测：用简单请求确认限额是否恢复
   *
   * 注意：mcode 没有「不落盘 session」开关（除非指定 --session / --continue，
   * 每次 exec 都会 createSession），因此每次探测都会新建一个会话目录
   * （一次限额事件最多探测 MAX_PROBE_ATTEMPTS 次）。这是为更快恢复
   * 限额所做的自觉取舍。
   *
   * 探测用 --output-format json（体积小，base.ts 仅扫描是否含 429），
   * 正式执行仍用 stream-json。
   */
  protected buildProbeArgs(): string[] {
    return ['exec', '--permission', 'full', '--output-format', 'json', 'reply ok'];
  }
}
