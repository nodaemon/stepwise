import * as fs from 'fs';
import * as path from 'path';
import { EXECUTE_LOG, LOGS_DIR, TaskType, TASK_TYPE_NAMES } from '../constants';

/**
 * 日志记录器
 */
export class Logger {
  private logDir: string;
  private taskName: string;
  private summaryLogFile: string;

  constructor(taskDir: string, taskName: string) {
    this.logDir = path.join(taskDir, LOGS_DIR);
    this.taskName = taskName;
    this.summaryLogFile = path.join(this.logDir, EXECUTE_LOG);
    this.ensureLogDir();
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDir(): void {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * 获取任务日志目录
   */
  getTaskLogDir(taskIndex: number, taskType: TaskType, parentLogPath?: string): string {
    const typeName = TASK_TYPE_NAMES[taskType];
    const logName = `${taskIndex}_${typeName}`;

    if (parentLogPath) {
      return path.join(parentLogPath, logName);
    }
    return path.join(this.logDir, logName);
  }

  /**
   * 创建任务日志目录
   */
  createTaskLogDir(taskIndex: number, taskType: TaskType, parentLogPath?: string): string {
    const taskLogDir = this.getTaskLogDir(taskIndex, taskType, parentLogPath);
    if (!fs.existsSync(taskLogDir)) {
      fs.mkdirSync(taskLogDir, { recursive: true });
    }
    return taskLogDir;
  }

  /**
   * 根据名称创建任务日志目录
   * 用于支持层级命名如: 1_task, 3_1_process, 3_1_1_process
   */
  createTaskLogDirByName(logName: string): string {
    const taskLogDir = path.join(this.logDir, logName);
    if (!fs.existsSync(taskLogDir)) {
      fs.mkdirSync(taskLogDir, { recursive: true });
    }
    return taskLogDir;
  }

  /**
   * 写入日志文件
   */
  writeLog(logPath: string, content: string): void {
    const timestamp = new Date().toISOString();
    const logContent = `[${timestamp}] ${content}\n`;
    fs.appendFileSync(logPath, logContent, 'utf-8');
  }

  /**
   * 写入任务执行日志
   */
  writeTaskLog(taskLogDir: string, filename: string, content: string): void {
    const logFile = path.join(taskLogDir, filename);
    fs.writeFileSync(logFile, content, 'utf-8');
  }

  /**
   * 写入汇总日志
   */
  writeSummaryLog(content: string): void {
    this.writeLog(this.summaryLogFile, content);
  }

  /**
   * 记录任务开始
   */
  logTaskStart(
    taskIndex: number,
    taskType: TaskType,
    sessionId: string
  ): void {
    const typeName = TASK_TYPE_NAMES[taskType];
    this.writeSummaryLog(`任务 ${taskIndex}_${typeName} 开始执行 [sessionId: ${sessionId}]`);
  }

  /**
   * 记录任务完成
   */
  logTaskComplete(
    taskIndex: number,
    taskType: TaskType,
    success: boolean,
    duration: number,
    error?: string
  ): void {
    const typeName = TASK_TYPE_NAMES[taskType];
    const status = success ? '成功' : '失败';
    const durationSec = (duration / 1000).toFixed(2);
    this.writeSummaryLog(`任务 ${taskIndex}_${typeName} ${status} [耗时: ${durationSec}s]`);
    if (error) {
      this.writeSummaryLog(`错误信息: ${error}`);
    }
  }

  /**
   * 记录任务重试
   */
  logTaskRetry(
    taskIndex: number,
    taskType: TaskType,
    attempt: number,
    error: string
  ): void {
    const typeName = TASK_TYPE_NAMES[taskType];
    this.writeSummaryLog(`任务 ${taskIndex}_${typeName} 第 ${attempt} 次重试 [错误: ${error}]`);
  }

  /**
   * 记录跳过已完成的任务
   */
  logTaskSkipped(taskIndex: number, taskType: TaskType): void {
    const typeName = TASK_TYPE_NAMES[taskType];
    this.writeSummaryLog(`任务 ${taskIndex}_${typeName} 已完成，跳过执行`);
  }
}