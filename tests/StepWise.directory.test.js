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
 * StepWise 目录结构测试
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const src_1 = require("../src");
describe('StepWise Directory Structure', () => {
    let tempDir;
    let originalCwd;
    beforeEach(() => {
        (0, src_1._resetState)();
        // 创建临时目录
        tempDir = path.join(__dirname, '.temp_directory_test');
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
    describe('TaskName 目录结构', () => {
        it('TaskName 目录应该在 stepwise_exec_infos 下', () => {
            (0, src_1.setTaskName)('MyTask');
            const agent = new src_1.StepWise('Agent1');
            const taskDir = agent.getTaskDir();
            const parentDir = path.dirname(taskDir);
            expect(path.basename(parentDir)).toBe('stepwise_exec_infos');
        });
        it('TaskName 目录名应该包含时间戳', () => {
            (0, src_1.setTaskName)('MyTask');
            const agent = new src_1.StepWise('Agent1');
            const taskDir = agent.getTaskDir();
            const dirName = path.basename(taskDir);
            // 格式: MyTask_YYYYMMDD_HHmmss_毫秒
            expect(dirName).toMatch(/^MyTask_\d{8}_\d{6}_\d{3}$/);
        });
    });
    describe('Agent 目录结构', () => {
        it('Agent 目录应该在 TaskName 目录下', () => {
            (0, src_1.setTaskName)('MyTask');
            const agent = new src_1.StepWise('Agent1');
            const agentDir = agent.getAgentDir();
            const taskDir = agent.getTaskDir();
            expect(path.dirname(agentDir)).toBe(taskDir);
        });
        it('Agent 目录名应该包含时间戳', () => {
            (0, src_1.setTaskName)('MyTask');
            const agent = new src_1.StepWise('Agent1');
            const agentDir = agent.getAgentDir();
            const dirName = path.basename(agentDir);
            // 格式: Agent1_YYYYMMDD_HHmmss_毫秒
            expect(dirName).toMatch(/^Agent1_\d{8}_\d{6}_\d{3}$/);
        });
        it('多个 Agent 应该有各自的目录', () => {
            (0, src_1.setTaskName)('MyTask');
            const agent1 = new src_1.StepWise('Agent1');
            const agent2 = new src_1.StepWise('Agent2');
            expect(agent1.getAgentDir()).not.toBe(agent2.getAgentDir());
        });
    });
    describe('report 输出路径', () => {
        it('report 目录应该在 TaskName 目录下', () => {
            (0, src_1.setTaskName)('MyTask');
            const agent = new src_1.StepWise('Agent1');
            const taskDir = agent.getTaskDir();
            const reportDir = path.join(taskDir, 'report');
            expect(fs.existsSync(reportDir)).toBe(true);
        });
    });
});
//# sourceMappingURL=StepWise.directory.test.js.map