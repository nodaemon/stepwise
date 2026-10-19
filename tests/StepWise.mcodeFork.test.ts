/**
 * StepWise + mcode 的 fork 前置校验测试
 *
 * mcode 不支持 fork（会话 ID 由 mcode 自行分配，无法派生新会话）。
 * 关键点：失败必须发生在写入 progress（标记任务 in_progress）之前——
 * 否则任务会永久停留在 in_progress，续跑时走到同一处必然再次失败，
 * 进度状态无法自愈。
 */
import * as fs from 'fs';
import * as path from 'path';
import { StepWise, setTaskName, setAgentType, _resetState } from '../src';
import { McodeExecutor } from '../src/executors/mcode';

describe('StepWise mcode fork 前置校验', () => {
  let tempDir: string;
  let originalCwd: string;

  /** 合法的 mcode 会话 ID */
  const MCODE_SESSION_ID = 'mvs_1bb5c3c79d9f4735a4026694fcaa57ed';

  beforeEach(() => {
    _resetState();

    tempDir = path.join(__dirname, '.temp_mcode_fork_test');
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

  it('fork 请求应在执行前失败，且不调用执行器', async () => {
    setAgentType('mcode');
    setTaskName('mcode_fork_task');

    const execSpy = jest.spyOn(McodeExecutor.prototype, 'execute');
    const stepwise = new StepWise('mcode_fork_agent');

    await expect(
      stepwise.execPrompt('prompt', { sessionId: MCODE_SESSION_ID, newSession: true })
    ).rejects.toThrow(/fork 模式不受支持/);

    // 前置校验失败，执行器不应被调用
    expect(execSpy).not.toHaveBeenCalled();
    execSpy.mockRestore();
  });

  it('fork 失败后 progress 中不应残留 in_progress 任务', async () => {
    setAgentType('mcode');
    setTaskName('mcode_fork_progress_task');

    const execSpy = jest.spyOn(McodeExecutor.prototype, 'execute');
    const stepwise = new StepWise('mcode_fork_progress_agent');

    await expect(
      stepwise.execPrompt('prompt', { sessionId: MCODE_SESSION_ID, newSession: true })
    ).rejects.toThrow(/fork 模式不受支持/);
    execSpy.mockRestore();

    const progressFile = path.join(
      (stepwise as any).agentDir,
      'data',
      'progress.json'
    );

    if (fs.existsSync(progressFile)) {
      const progress = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
      const inProgress = (progress.tasks || []).filter(
        (t: any) => t.status === 'in_progress'
      );
      expect(inProgress).toEqual([]);
    }
  });
});
