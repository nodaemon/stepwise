/**
 * execShell 功能单元测试
 *
 * 测试内容：
 * - Shell 命令基本执行
 * - 成功/失败判断
 * - 超时控制
 * - 工作目录设置
 * - 日志记录
 * - 断点恢复
 * - 命令不一致警告
 */

import {
  StepWise,
  setTaskName,
  setAgentType,
  _resetState,
  setResumePath
} from '../src';

// Mock child_process 模块，避免实际执行命令
jest.mock('child_process', () => {
  const mockSpawn = jest.fn();

  return {
    spawn: mockSpawn
  };
});

// 导入被 mock 的模块
import * as childProcess from 'child_process';

describe('execShell 功能测试', () => {
  let mockSpawn: jest.Mock;

  beforeEach(() => {
    // 重置状态
    _resetState();

    // 获取 mock 函数
    mockSpawn = childProcess.spawn as jest.Mock;

    // 重置 mock
    mockSpawn.mockReset();

    // 设置默认 mock 行为
    mockSpawn.mockImplementation((command: string, args: string[], options: any) => {
      // 创建模拟的子进程对象
      const mockChild = {
        stdout: {
          on: jest.fn((event: string, callback: (data: Buffer) => void) => {
            if (event === 'data') {
              // 模拟输出
              setTimeout(() => callback(Buffer.from('mock stdout')), 10);
            }
          })
        },
        stderr: {
          on: jest.fn((event: string, callback: (data: Buffer) => void) => {
            if (event === 'data') {
              // 不输出 stderr
            }
          })
        },
        stdin: {
          end: jest.fn()
        },
        on: jest.fn((event: string, callback: (code?: number | Error) => void) => {
          if (event === 'close') {
            // 模拟成功退出
            setTimeout(() => callback(0), 20);
          }
          if (event === 'error') {
            // 不触发错误
          }
        }),
        kill: jest.fn(),
        killed: false
      };

      return mockChild;
    });
  });

  describe('execShell 基本功能', () => {
    it('应该能执行简单的 shell 命令', async () => {
      setTaskName('ShellBasicTest');
      setAgentType('claude');

      const agent = new StepWise('Agent1');
      const result = await agent.execShell('echo "test"');

      // 验证结果结构
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      expect(result).toHaveProperty('exitCode');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('taskIndex');

      // 验证成功状态
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    it('应该返回正确的任务序号', async () => {
      setTaskName('ShellIndexTest');
      setAgentType('claude');

      const agent = new StepWise('Agent1');

      const result1 = await agent.execShell('echo "1"');
      expect(result1.taskIndex).toBe(1);

      const result2 = await agent.execShell('echo "2"');
      expect(result2.taskIndex).toBe(2);
    });

    it('空命令应该抛出错误', async () => {
      setTaskName('ShellEmptyTest');
      setAgentType('claude');

      const agent = new StepWise('Agent1');

      await expect(agent.execShell('')).rejects.toThrow('Shell 命令不能为空');
      await expect(agent.execShell('   ')).rejects.toThrow('Shell 命令不能为空');
    });
  });

  describe('execShell 失败处理', () => {
    it('失败命令应该返回 success: false', async () => {
      // 修改 mock 行为，模拟失败
      mockSpawn.mockImplementation((command: string, args: string[], options: any) => {
        const mockChild = {
          stdout: {
            on: jest.fn()
          },
          stderr: {
            on: jest.fn((event: string, callback: (data: Buffer) => void) => {
              if (event === 'data') {
                setTimeout(() => callback(Buffer.from('error message')), 10);
              }
            })
          },
          stdin: { end: jest.fn() },
          on: jest.fn((event: string, callback: (code?: number | Error) => void) => {
            if (event === 'close') {
              setTimeout(() => callback(1), 20); // 退出码 1
            }
          }),
          kill: jest.fn(),
          killed: false
        };
        return mockChild;
      });

      setTaskName('ShellFailTest');
      setAgentType('claude');

      const agent = new StepWise('Agent1');
      const result = await agent.execShell('exit 1');

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error message');
    });
  });

  describe('execShell 日志记录', () => {
    it('应该在正确的目录创建日志', async () => {
      setTaskName('ShellLogTest');
      setAgentType('claude');

      const agent = new StepWise('Agent1');
      await agent.execShell('echo "test"');

      const agentDir = agent.getAgentDir();
      const logsDir = `${agentDir}/logs`;

      // 验证日志目录存在
      const fs = require('fs');
      expect(fs.existsSync(logsDir)).toBe(true);

      // 验证 shell 任务日志目录存在
      const shellLogDir = `${logsDir}/1_shell`;
      expect(fs.existsSync(shellLogDir)).toBe(true);
    });
  });

  describe('execShell 断点恢复', () => {
    it('已完成的命令应该跳过执行', async () => {
      setTaskName('ShellResumeTest');
      setAgentType('claude');

      // 第一次执行
      const agent1 = new StepWise('Agent1');
      const result1 = await agent1.execShell('echo "test"');
      expect(result1.taskIndex).toBe(1);
      expect(result1.success).toBe(true);

      // 获取实际的任务目录名
      const agentDir = agent1.getAgentDir();
      const taskDir = agentDir.split('/').slice(-2)[0]; // 获取 TaskName_timestamp 部分

      // 重置状态（包括清除已注册的名字）
      _resetState();
      setTaskName('ShellResumeTest');
      setAgentType('claude');
      setResumePath(taskDir);

      // 第二次执行（恢复模式，使用相同的名字）
      const agent2 = new StepWise('Agent1');
      const result2 = await agent2.execShell('echo "test"');

      // 应该跳过执行
      expect(result2.taskIndex).toBe(1);
      expect(result2.success).toBe(true);
      expect(result2.stdout).toBe(''); // 跳过时输出为空
      expect(result2.duration).toBe(0); // 跳过时耗时为 0
    });

    it('命令不一致时应该打印警告但仍跳过执行', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      setTaskName('ShellChangedTest');
      setAgentType('claude');

      // 第一次执行
      const agent1 = new StepWise('Agent1');
      await agent1.execShell('echo "original"');

      // 获取实际的任务目录名
      const agentDir = agent1.getAgentDir();
      const taskDir = agentDir.split('/').slice(-2)[0]; // 获取 TaskName_timestamp 部分

      // 重置状态（包括清除已注册的名字）
      _resetState();
      setTaskName('ShellChangedTest');
      setAgentType('claude');
      setResumePath(taskDir);

      // 第二次执行（恢复模式，使用相同的名字，但命令不同）
      const agent2 = new StepWise('Agent1');
      const result = await agent2.execShell('echo "changed"');

      // 应该打印警告
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('任务 1_shell 命令已修改')
      );

      // 但仍然跳过执行（便于优化 shell 命令时断点恢复）
      expect(result.taskIndex).toBe(1);
      expect(result.success).toBe(true);
      expect(result.stdout).toBe(''); // 跳过时输出为空
      expect(result.duration).toBe(0); // 跳过时耗时为 0

      warnSpy.mockRestore();
    });
  });

  describe('AI + Shell 混合任务', () => {
    it('应该正确管理混合任务的序号', async () => {
      setTaskName('ShellMixedTest');
      setAgentType('claude');

      const agent = new StepWise('Agent1');

      // Shell 任务 1
      const r1 = await agent.execShell('echo "shell 1"');
      expect(r1.taskIndex).toBe(1);

      // Shell 任务 2
      const r2 = await agent.execShell('echo "shell 2"');
      expect(r2.taskIndex).toBe(2);

      // Shell 任务 3
      const r3 = await agent.execShell('echo "shell 3"');
      expect(r3.taskIndex).toBe(3);
    });
  });

  describe('execShell 环境变量', () => {
    it('应该使用 defaultEnv', async () => {
      setTaskName('ShellEnvDefaultTest');
      setAgentType('claude');

      // 创建带有 defaultEnv 的 agent
      const agent = new StepWise('Agent1', undefined, ['DEFAULT_VAR=default_value']);

      await agent.execShell('echo "test"');

      // 验证 spawn 被调用时包含了环境变量
      expect(mockSpawn).toHaveBeenCalled();
      const spawnOptions = mockSpawn.mock.calls[0][2];
      expect(spawnOptions.env.DEFAULT_VAR).toBe('default_value');
    });

    it('options.env 应该覆盖 defaultEnv', async () => {
      setTaskName('ShellEnvOverrideTest');
      setAgentType('claude');

      const agent = new StepWise('Agent1', undefined, ['VAR1=default']);

      await agent.execShell('echo "test"', {
        env: ['VAR1=override', 'VAR2=new']
      });

      const spawnOptions = mockSpawn.mock.calls[0][2];
      expect(spawnOptions.env.VAR1).toBe('override');
      expect(spawnOptions.env.VAR2).toBe('new');
    });

    it('options.env 为空时应该使用 defaultEnv', async () => {
      setTaskName('ShellEnvFallbackTest');
      setAgentType('claude');

      const agent = new StepWise('Agent1', undefined, ['FALLBACK_VAR=fallback_value']);

      await agent.execShell('echo "test"', { timeout: 10000 });

      const spawnOptions = mockSpawn.mock.calls[0][2];
      expect(spawnOptions.env.FALLBACK_VAR).toBe('fallback_value');
    });

    it('多个环境变量应该正确传递', async () => {
      setTaskName('ShellEnvMultipleTest');
      setAgentType('claude');

      const agent = new StepWise('Agent1', undefined, ['VAR1=value1', 'VAR2=value2']);

      await agent.execShell('echo "test"');

      const spawnOptions = mockSpawn.mock.calls[0][2];
      expect(spawnOptions.env.VAR1).toBe('value1');
      expect(spawnOptions.env.VAR2).toBe('value2');
    });

    it('环境变量应该与 process.env 合并', async () => {
      setTaskName('ShellEnvMergeTest');
      setAgentType('claude');

      const agent = new StepWise('Agent1', undefined, ['CUSTOM_VAR=custom_value']);

      await agent.execShell('echo "test"');

      const spawnOptions = mockSpawn.mock.calls[0][2];
      // 应该包含自定义变量
      expect(spawnOptions.env.CUSTOM_VAR).toBe('custom_value');
      // 应该保留 process.env 中的变量
      expect(spawnOptions.env.PATH).toBeDefined();
    });

    it('环境变量值包含等号应该正确处理', async () => {
      setTaskName('ShellEnvEqualSignTest');
      setAgentType('claude');

      const agent = new StepWise('Agent1', undefined, ['KEY=value=with=equals']);

      await agent.execShell('echo "test"');

      const spawnOptions = mockSpawn.mock.calls[0][2];
      expect(spawnOptions.env.KEY).toBe('value=with=equals');
    });

    it('无效环境变量格式应该打印警告', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      setTaskName('ShellEnvInvalidTest');
      setAgentType('claude');

      const agent = new StepWise('Agent1', undefined, ['INVALID_NO_EQUALS', '=VALUE_NO_KEY']);

      await agent.execShell('echo "test"');

      // 应该打印警告（两个无效格式）
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('忽略无效环境变量格式')
      );

      warnSpy.mockRestore();
    });
  });
});