/**
 * 自定义测试环境
 *
 * 唯一目的：在 **真实进程** 上安装 jest worker 的收尾加速钩子，根治
 * "A worker process has failed to exit gracefully" 这条收尾噪音。
 * 详见 ./jestWorkerFastExit.ts 顶部的完整说明。
 *
 * 为什么放在测试环境里：
 * - 测试环境模块由 jest-runner 在 worker 进程内用**真实 require** 加载，
 *   拿到的是真实 `process`；
 * - 而 `setupFiles` / `setupFilesAfterEnv` 跑在测试沙箱内，拿到的是
 *   jest-environment-node 克隆出来的 `process` 副本（没有 IPC 通道、没有监听器），
 *   在那里挂钩子挂不到真实进程上。
 *
 * 行为上与 jest-environment-node 完全一致（仅继承，未覆盖任何能力）。
 */
import {
  installWorkerFastExit,
  markTestFileStarted,
  markTestFileFinished,
} from './jestWorkerFastExit';

/** jest-environment-node 没有随包提供类型声明，这里按构造签名声明即可 */
type NodeEnvironmentCtor = new (
  config: unknown,
  context: unknown
) => {
  global: unknown;
  teardown(): Promise<void>;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const NodeEnvironment = require('jest-environment-node')
  .default as NodeEnvironmentCtor;

installWorkerFastExit();

export default class StepwiseTestEnvironment extends NodeEnvironment {
  constructor(config: unknown, context: unknown) {
    super(config, context);
    // 从这里到 teardown 之间，说明还有测试文件在跑
    markTestFileStarted();
  }

  async teardown(): Promise<void> {
    markTestFileFinished();
    await super.teardown();
  }
}
