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
      expect(() => setTaskName('')).toThrow('[setTaskName] TaskName 不能为空');
    });

    it('重复名字应该报错并退出', () => {
      // 先注册一个名字
      _registerName('ExistingName');

      expect(() => setTaskName('ExistingName')).toThrow(
        /\[setTaskName\] 名字重复.*ExistingName/s
      );
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

    it('绝对路径应该正确保存和加载', () => {
      const originalCwd = process.cwd();

      // 切换到一个与目标文件无关的目录，验证绝对路径不依赖 cwd
      const otherDir = path.join(__dirname, '.temp_other_cwd');
      fs.mkdirSync(otherDir, { recursive: true });
      process.chdir(otherDir);

      const absFile = path.join(testDir, 'sub_abs', 'abs_data.json');
      const testData: Record<string, any>[] = [{ id: 1, name: 'absolute' }];

      saveCollectData(testData, absFile);
      const loaded = loadCollectData(absFile);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].name).toBe('absolute');
      // 确认文件确实落在绝对路径位置，而非被拼接到 cwd 下
      expect(fs.existsSync(absFile)).toBe(true);
      // 若被错误地相对 cwd 拼接，会在 otherDir 下出现同名子路径
      expect(fs.existsSync(path.join(otherDir, 'sub_abs', 'abs_data.json'))).toBe(false);

      process.chdir(originalCwd);
      if (fs.existsSync(otherDir)) {
        fs.rmSync(otherDir, { recursive: true, force: true });
      }
    });

    it('绝对路径加载不存在的文件应该返回空数组', () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);

      const absFile = path.join(testDir, 'not_exist_abs.json');
      const loaded = loadCollectData(absFile);
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
