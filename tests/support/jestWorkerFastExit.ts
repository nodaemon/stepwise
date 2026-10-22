/**
 * Jest worker 收尾加速
 *
 * ## 为什么需要它
 *
 * jest-worker 结束一个 worker 时，会给子进程发一条「结束」指令；子进程移除自己的
 * `message` 监听器后**自然退出**（等事件循环排空，由 Node 正常收尾）。
 *
 * 但每个 worker 都是通过 ts-jest 编译并加载了大量模块的独立进程，进程退出时还要
 * 销毁因此膨胀起来的 V8 堆和进程地址空间。实测这一步约 490ms，而 jest-worker 内部
 * 给 worker 的退出宽限期 `FORCE_EXIT_DELAY` 只有 500ms。一旦略微超出，jest 就会
 * 强杀该 worker 并打印：
 *
 *   A worker process has failed to exit gracefully and has been force exited.
 *
 * 这与测试结果无关，纯粹是收尾噪音；而且**并发退出的 worker 越多，这一步越慢**，
 * 所以 worker 数量一多（机器核数很多时 jest 默认按核数-1 起 worker）就必然出现。
 *
 * ## 做法
 *
 * jest 移除 `message` 监听器，就是「worker 即将退出」的明确信号。此刻主动
 * `process.exit(0)`，跳过耗时的堆销毁：实测退出耗时从 ~580ms 降到 ~290ms，
 * 稳稳落在 jest 的 500ms 宽限期内，警告消失。
 *
 * ## 安全边界
 *
 * - 触发时机在所有测试文件跑完之后，测试结果早已回传父进程，不影响任何断言。
 * - 退出前会等 stdout/stderr 的待写数据写完，避免丢日志。
 * - 仍有测试在跑时（例如 watch 模式被打断）不做任何干预，保持原有行为。
 *
 * ## 注意
 *
 * 本模块必须由**沙箱之外**的代码加载（测试环境模块），否则拿到的 `process` 是
 * jest-environment-node 克隆出来的副本，钩子挂不到真实进程上。
 */

/** 挂在真实进程上的状态：同一 worker 进程内跨测试文件共享 */
interface WorkerFastExitState {
  /** 收尾钩子是否已安装（同一 worker 进程内只装一次） */
  installed: boolean;
  /** 正在执行的测试文件数（>0 表示还有测试在跑，此时不能贸然退出） */
  busy: number;
}

type ProcessWithWorkerState = NodeJS.Process & {
  __stepwiseJestWorkerFastExitState?: WorkerFastExitState;
};

/** 取真实进程上的状态（不存在则创建） */
function getState(): WorkerFastExitState {
  const proc = process as ProcessWithWorkerState;
  if (!proc.__stepwiseJestWorkerFastExitState) {
    proc.__stepwiseJestWorkerFastExitState = { installed: false, busy: 0 };
  }
  return proc.__stepwiseJestWorkerFastExitState;
}

/** stdout/stderr 中尚未写出的字节数 */
function pendingOutputBytes(): number {
  const out = process.stdout as NodeJS.WriteStream & { writableLength?: number };
  const err = process.stderr as NodeJS.WriteStream & { writableLength?: number };
  return (out?.writableLength ?? 0) + (err?.writableLength ?? 0);
}

/** 立即退出，跳过耗时的 V8 堆销毁；有待写数据时先等写完 */
function fastExit(): void {
  if (pendingOutputBytes() === 0) {
    process.exit(0);
    return;
  }
  // 还有待写数据：等写完再退，最多等 100ms
  const timer = setTimeout(() => process.exit(0), 100);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  const onDrain = (): void => {
    if (pendingOutputBytes() === 0) {
      clearTimeout(timer);
      process.exit(0);
    }
  };
  process.stdout.once('drain', onDrain);
  process.stderr.once('drain', onDrain);
}

/**
 * 在真实进程上安装 worker 收尾钩子。同一进程内重复调用只会生效一次。
 */
export function installWorkerFastExit(): void {
  const proc = process as ProcessWithWorkerState;
  const state = getState();
  if (state.installed) {
    return;
  }
  state.installed = true;

  proc.on('removeListener', (event: string | symbol): void => {
    // 只关心 jest 摘掉 IPC 消息监听器这件事
    if (event !== 'message') {
      return;
    }
    // 还有别的 message 监听器在，说明不是收尾
    if (proc.listenerCount('message') > 0) {
      return;
    }
    // 下一轮再确认一次：避免把「临时移除又装回」误判成收尾
    setImmediate(() => {
      if (proc.listenerCount('message') > 0) {
        return;
      }
      // 仍有测试在跑（如 watch 模式被打断）：交给原有的自然退出流程
      if (state.busy > 0) {
        return;
      }
      fastExit();
    });
  });
}

/** 标记一个测试文件开始执行（用于判断是否可以安全地提前退出 worker） */
export function markTestFileStarted(): void {
  getState().busy += 1;
}

/** 标记一个测试文件执行完毕 */
export function markTestFileFinished(): void {
  const state = getState();
  state.busy = Math.max(0, state.busy - 1);
}
