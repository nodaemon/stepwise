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
 * StepWise 恢复功能测试
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const src_1 = require("../src");
/**
 * 创建模拟的历史任务目录结构
 */
function createMockHistoryStructure(baseDir, taskName, agentName) {
    const timestamp = '20260307_120000_123';
    const taskDir = path.join(baseDir, 'stepwise_exec_infos', `${taskName}_${timestamp}`);
    const agentDir = path.join(taskDir, `${agentName}_20260307_120001_4566`);
    const dataDir = path.join(agentDir, 'data');
    // 创建目录结构
    fs.mkdirSync(dataDir, { recursive: true });
    // 创建进度文件
    const progressFile = path.join(dataDir, 'progress.json');
    const progress = {
        taskName: agentName,
        taskDir: agentDir,
        taskCounter: 2,
        tasks: [
            {
                taskIndex: 1,
                taskName: '1_task',
                sessionId: 'session-1',
                status: 'completed',
                timestamp: Date.now(),
                taskType: 'task'
            },
            {
                taskIndex: 2,
                taskName: '2_collect',
                sessionId: 'session-2',
                status: 'completed',
                timestamp: Date.now(),
                taskType: 'collect',
                outputFileName: 'collect_2.json'
            }
        ],
        lastUpdated: Date.now()
    };
    fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
    return taskDir;
}
describe('StepWise Resume', () => {
    let tempDir;
    let originalCwd;
    beforeEach(() => {
        (0, src_1._resetState)();
        // 创建临时目录
        tempDir = path.join(__dirname, '.temp_resume_test');
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
        (0, src_1._resetState)();
    });
    describe('恢复成功', () => {
        it('应该能找到存在的 Agent 目录', () => {
            const taskDir = createMockHistoryStructure(tempDir, 'TestTask', 'Agent1');
            (0, src_1.setTaskName)('TestTask');
            (0, src_1.setResumePath)(path.basename(taskDir));
            const agent = new src_1.StepWise('Agent1');
            expect(agent.getAgentDir()).toContain('Agent1');
        });
        it('应该能加载历史进度', () => {
            const taskDir = createMockHistoryStructure(tempDir, 'TestTask', 'Agent1');
            (0, src_1.setTaskName)('TestTask');
            (0, src_1.setResumePath)(path.basename(taskDir));
            const agent = new src_1.StepWise('Agent1');
            // 任务计数器应该从历史记录中恢复
            expect(agent.getTaskCounter()).toBe(2);
        });
    });
    describe('恢复失败错误', () => {
        it('找不到 Agent 目录时应该报错退出', () => {
            const taskDir = createMockHistoryStructure(tempDir, 'TestTask', 'OtherAgent');
            const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
            const mockError = jest.spyOn(console, 'error').mockImplementation(() => { });
            (0, src_1.setTaskName)('TestTask');
            (0, src_1.setResumePath)(path.basename(taskDir));
            // 尝试使用不存在的 Agent 名
            expect(() => new src_1.StepWise('NonExistentAgent')).toThrow('exit');
            const errorCalls = mockError.mock.calls.map(call => call[0]);
            const errorMessage = errorCalls.join('\n');
            expect(errorMessage).toContain('[错误] 无法恢复任务');
            expect(errorMessage).toContain('找不到Agent 目录');
            mockExit.mockRestore();
            mockError.mockRestore();
        });
        it('找不到任务目录时应该报错退出', () => {
            const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
            const mockError = jest.spyOn(console, 'error').mockImplementation(() => { });
            (0, src_1.setTaskName)('TestTask');
            (0, src_1.setResumePath)('NonExistentTask_20260307_120000_123');
            expect(() => new src_1.StepWise('Agent1')).toThrow('exit');
            const errorCalls = mockError.mock.calls.map(call => call[0]);
            const errorMessage = errorCalls.join('\n');
            expect(errorMessage).toContain('[错误] 无法恢复任务');
            mockExit.mockRestore();
            mockError.mockRestore();
        });
    });
});
//# sourceMappingURL=StepWise.resume.test.js.map