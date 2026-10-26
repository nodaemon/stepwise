/**
 * 执行器超时路径的终止测试
 *
 * 场景：agent 子进程「任务已完成但 event loop 卡住无法退出」，
 * 且忽略 SIGTERM。超时后必须做到：
 * - 子进程一定退出（SIGKILL 不可捕获，是最终保障）
 * - 重试若干次后系统里不残留该子进程
 * - stdin 临时文件不残留
 *
 * 注意：子进程派生的孙进程不在清理范围内（框架只保证直接子进程退出），
 * 本用例的假 agent 不派生孙进程。
 *
 * 用真实的 BaseExecutor + 真实子进程验证，不 mock。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BaseExecutor } from '../src/executors/base';

/** 进程存活判定依赖 /proc，仅在 Linux 上跑 */
const describeLinux = process.platform === 'linux' ? describe : describe.skip;

/**
 * 假 agent：读完 stdin 后打印 Claude 风格的 result 块（= 任务已完成），
 * 然后忽略 SIGTERM 并挂住定时器 ⇒ 模拟 event loop 卡死、进程退不出来。
 */
const FAKE_AGENT_SRC = `
const fs = require('fs');
process.on('SIGTERM', () => {});
let buf = '';
process.stdin.on('data', (d) => { buf += d.toString(); });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    type: 'result',
    subtype: 'success',
    result: '任务已完成：产出物已写盘'
  }) + '\\n');
  fs.writeFileSync(process.argv[2], JSON.stringify({ pid: process.pid }));
  setInterval(() => {}, 1000);
});
`;

/** 走真实 BaseExecutor 的假执行器 */
class FakeExecutor extends BaseExecutor {
  readonly agentType = 'claude' as const;

  constructor(
    private readonly agentScript: string,
    private readonly pidFile: string
  ) {
    super();
  }

  protected getCommand(): string {
    return process.execPath;
  }

  protected buildArgs(): string[] {
    return [this.agentScript, this.pidFile];
  }

  protected buildProbeArgs(): string[] {
    return [this.agentScript, this.pidFile];
  }

  protected usesNDJsonOutput(): boolean {
    return true;
  }
}

/** 统计命令行里含指定标记的存活进程数 */
function countProcessesByCmdline(marker: string): number {
  let count = 0;
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf-8');
      if (cmdline.includes(marker)) count++;
    } catch {
      // 进程可能已退出
    }
  }
  return count;
}

/** 进程是否存活（僵尸算已死） */
function isAlive(pid: number): boolean {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
    const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
    return state !== 'Z';
  } catch {
    return false;
  }
}

/** 轮询等待条件成立 */
async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return predicate();
}

describeLinux('执行器超时后的子进程终止', () => {
  let tmpDir: string;
  let logDir: string;
  let agentScript: string;
  let pidFile: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepwise-timeout-'));
    logDir = path.join(tmpDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    agentScript = path.join(tmpDir, 'fake-agent.js');
    pidFile = path.join(tmpDir, 'pids.json');

    fs.writeFileSync(agentScript, FAKE_AGENT_SRC, 'utf-8');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('忽略 SIGTERM 的子进程也会被 SIGKILL 杀掉，不留残留', async () => {
    const executor = new FakeExecutor(agentScript, pidFile);

    // 超时后抛错（错误消息格式与改动前保持一致）
    await expect(
      executor.execute('做一个任务', {
        cwd: tmpDir,
        timeout: 1000,
        taskLogDir: logDir,
        taskIndex: 0,
        taskType: 'task'
      })
    ).rejects.toThrow(/timed out after 1000ms/);

    // SIGKILL 在超时后的宽限期才发出，等它生效
    expect(
      await waitFor(() => countProcessesByCmdline(agentScript) === 0, 15000)
    ).toBe(true);
    expect(countProcessesByCmdline(agentScript)).toBe(0);

    // 最后一次尝试记录的 pid 确实没了
    if (fs.existsSync(pidFile)) {
      const pids = JSON.parse(fs.readFileSync(pidFile, 'utf-8')) as { pid: number };
      expect(isAlive(pids.pid)).toBe(false);
    }

    // stdin 临时文件不残留
    const stdinFile = path.join(logDir, '.stdin_prompt');
    expect(await waitFor(() => !fs.existsSync(stdinFile), 5000)).toBe(true);
  }, 60000);
});
