/**
 * 全局状态管理测试
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  setTaskName,
  setResumePath,
  enableDebugMode,
  saveCollectData,
  loadCollectData,
  _getTaskName,
  _getResumePath,
  _isDebugMode,
  _registerName,
  _resetState
} from '../src';

describe('GlobalState', () => {
  beforeEach(() => {
    _resetState();
  });

  describe('setTaskName', () => {
    it('应该正确设置任务名称', () => {
      setTaskName('TestTask');
      expect(_getTaskName()).toBe('TestTask');
    });

    it('应该去除名称首尾空格', () => {
      setTaskName('  TestTask  ');
      expect(_getTaskName()).toBe('TestTask');
    });

    it('空名称应该报错并退出', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => setTaskName('')).toThrow('exit');
      expect(mockError).toHaveBeenCalledWith('[错误] TaskName 不能为空');

      mockExit.mockRestore();
      mockError.mockRestore();
    });

    it('重复名字应该报错并退出', () => {
      // 先注册一个名字
      _registerName('ExistingName');

      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => setTaskName('ExistingName')).toThrow('exit');
      expect(mockError).toHaveBeenCalledWith('[错误] 名字重复: "ExistingName"');

      mockExit.mockRestore();
      mockError.mockRestore();
    });
  });

  describe('setResumePath', () => {
    it('应该正确设置恢复路径', () => {
      setResumePath('MyTask_20260307_120000_123');
      expect(_getResumePath()).toBe('MyTask_20260307_120000_123');
    });

    it('应该去除路径首尾空格', () => {
      setResumePath('  MyTask_20260307_120000_123  ');
      expect(_getResumePath()).toBe('MyTask_20260307_120000_123');
    });
  });

  describe('enableDebugMode', () => {
    it('默认应该关闭调试模式', () => {
      expect(_isDebugMode()).toBe(false);
    });

    it('应该能启用调试模式', () => {
      enableDebugMode(true);
      expect(_isDebugMode()).toBe(true);
    });

    it('应该能禁用调试模式', () => {
      enableDebugMode(true);
      enableDebugMode(false);
      expect(_isDebugMode()).toBe(false);
    });

    it('不传参数时默认启用', () => {
      enableDebugMode();
      expect(_isDebugMode()).toBe(true);
    });
  });

  describe('saveCollectData & loadCollectData', () => {
    const testDir = path.join(__dirname, '.temp_collect_test');

    beforeEach(() => {
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('应该正确保存和加载数据', () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);

      const testData: Record<string, any>[] = [{ name: 'default' }];
      saveCollectData(testData);
      const loaded = loadCollectData();

      expect(loaded).toHaveLength(1);
      expect(loaded[0].name).toBe('default');

      process.chdir(originalCwd);
    });

    it('追加数据应该正确合并', () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);

      const data1 = [{ id: 1, name: 'first' }];
      const data2 = [{ id: 2, name: 'second' }];

      saveCollectData(data1, 'append.json');
      saveCollectData(data2, 'append.json');
      const loaded = loadCollectData('append.json');

      expect(loaded).toHaveLength(2);

      process.chdir(originalCwd);
    });

    it('加载不存在的文件应该返回空数组', () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);

      const loaded = loadCollectData('not_exist.json');
      expect(loaded).toEqual([]);

      process.chdir(originalCwd);
    });
  });

  describe('名字注册', () => {
    it('应该能注册新名字', () => {
      const result = _registerName('NewName');
      expect(result).toBe(true);
    });

    it('重复注册应该返回 false', () => {
      _registerName('DuplicateName');
      const result = _registerName('DuplicateName');
      expect(result).toBe(false);
    });
  });
});
