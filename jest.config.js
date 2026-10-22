/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  /**
   * 自定义测试环境：在真实进程上挂 worker 收尾钩子。
   * 详见 tests/support/jestWorkerFastExit.ts 顶部注释——它解决的是
   * "A worker process has failed to exit gracefully" 这条收尾噪音的根因
   * （worker 自然退出时销毁 ts-jest 撑大的 V8 堆太慢，超过 jest 500ms 的退出宽限期）。
   */
  testEnvironment: '<rootDir>/tests/support/StepwiseTestEnvironment.ts',

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts'
  ],
  coverageDirectory: 'coverage',
  verbose: true,

  /**
   * 测试并发度：拉满 CPU。
   *
   * Jest 默认按 CPU 核数 - 1 起 worker，这里显式给到核数本身（'100%'），
   * 让所有测试文件尽可能并行跑完。
   *
   * 实测（本机 96 核 / 33 个测试文件，各档位取 3 次中位数）：
   *   maxWorkers=8 → 4.78s    16 → 5.12s    24 → 5.30s    33 → 5.83s
   *   48 → 5.97s   64 → 6.09s   96 → 6.26s
   * 之所以 worker 越多反而越慢：每个 worker 都是独立进程，都要付一次
   * ts-jest 编译器的启动成本，而测试文件只有 33 个，超过 33 之后只是多起进程。
   * 即 worker 数超过测试文件数就不再增加有效并行度。
   *
   * 注意：这是**测试基础设施**的并发，与 forEachParallel 的业务并发无关
   * （业务并发由用户传入的 workerConfigs 数量决定）。
   */
  maxWorkers: '100%'
};
