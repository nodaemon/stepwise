"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 全局状态管理测试
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const src_1 = require("../src");
describe('GlobalState', () => {
    beforeEach(() => {
        (0, src_1._resetState)();
    });
    describe('setTaskName', () => {
        it('应该正确设置任务名称', () => {
            (0, src_1.setTaskName)('TestTask');
            expect((0, src_1._getTaskName)()).toBe('TestTask');
        });
        it('应该去除名称首尾空格', () => {
            (0, src_1.setTaskName)('  TestTask  ');
            expect((0, src_1._getTaskName)()).toBe('TestTask');
        });
        it('空名称应该报错并退出', () => {
            const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
            const mockError = jest.spyOn(console, 'error').mockImplementation(() => { });
            expect(() => (0, src_1.setTaskName)('')).toThrow('exit');
            expect(mockError).toHaveBeenCalledWith('[错误] TaskName 不能为空');
            mockExit.mockRestore();
            mockError.mockRestore();
        });
        it('重复名字应该报错并退出', () => {
            // 先注册一个名字
            (0, src_1._registerName)('ExistingName');
            const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
            const mockError = jest.spyOn(console, 'error').mockImplementation(() => { });
            expect(() => (0, src_1.setTaskName)('ExistingName')).toThrow('exit');
            expect(mockError).toHaveBeenCalledWith('[错误] 名字重复: "ExistingName"');
            mockExit.mockRestore();
            mockError.mockRestore();
        });
    });
    describe('setResumePath', () => {
        it('应该正确设置恢复路径', () => {
            (0, src_1.setResumePath)('MyTask_20260307_120000_123');
            expect((0, src_1._getResumePath)()).toBe('MyTask_20260307_120000_123');
        });
        it('应该去除路径首尾空格', () => {
            (0, src_1.setResumePath)('  MyTask_20260307_120000_123  ');
            expect((0, src_1._getResumePath)()).toBe('MyTask_20260307_120000_123');
        });
    });
    describe('enableDebugMode', () => {
        it('默认应该关闭调试模式', () => {
            expect((0, src_1._isDebugMode)()).toBe(false);
        });
        it('应该能启用调试模式', () => {
            (0, src_1.enableDebugMode)(true);
            expect((0, src_1._isDebugMode)()).toBe(true);
        });
        it('应该能禁用调试模式', () => {
            (0, src_1.enableDebugMode)(true);
            (0, src_1.enableDebugMode)(false);
            expect((0, src_1._isDebugMode)()).toBe(false);
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
            const testData = [{ name: 'default' }];
            (0, src_1.saveCollectData)(testData);
            const loaded = (0, src_1.loadCollectData)();
            expect(loaded).toHaveLength(1);
            expect(loaded[0].name).toBe('default');
            process.chdir(originalCwd);
        });
        it('追加数据应该正确合并', () => {
            const originalCwd = process.cwd();
            process.chdir(testDir);
            const data1 = [{ id: 1, name: 'first' }];
            const data2 = [{ id: 2, name: 'second' }];
            (0, src_1.saveCollectData)(data1, 'append.json');
            (0, src_1.saveCollectData)(data2, 'append.json');
            const loaded = (0, src_1.loadCollectData)('append.json');
            expect(loaded).toHaveLength(2);
            process.chdir(originalCwd);
        });
        it('加载不存在的文件应该返回空数组', () => {
            const originalCwd = process.cwd();
            process.chdir(testDir);
            const loaded = (0, src_1.loadCollectData)('not_exist.json');
            expect(loaded).toEqual([]);
            process.chdir(originalCwd);
        });
    });
    describe('名字注册', () => {
        it('应该能注册新名字', () => {
            const result = (0, src_1._registerName)('NewName');
            expect(result).toBe(true);
        });
        it('重复注册应该返回 false', () => {
            (0, src_1._registerName)('DuplicateName');
            const result = (0, src_1._registerName)('DuplicateName');
            expect(result).toBe(false);
        });
    });
});
//# sourceMappingURL=globalState.test.js.map