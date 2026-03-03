import * as path from 'path';
import * as fs from 'fs';
import {
  ExecOptions,
  ExecutionResult,
  CollectResult,
  OutputFormat,
  TaskStatus,
  TaskStatusType,
  ProgressInfo
} from './types';
import { generateUUID } from './utils/uuid';
import { Logger } from './utils/logger';
import { ClaudeExecutor, createExecutor } from './utils/executor';
import {
  ensureDir,
  saveJsonFile,
  loadJsonFile,
  appendJsonArray,
  fileExists
} from './utils/fileHelper';
import {
  buildCollectPrompt,
  buildReportPrompt,
  buildFullPrompt,
  replaceVariables
} from './utils/promptBuilder';
import {
  EXEC_INFO_DIR,
  DATA_DIR,
  PROGRESS_FILE,
  SESSIONS_DIR,
  COLLECT_DIR,
  REPORT_DIR,
  TaskType,
  TASK_TYPE_NAMES
} from './constants';

/**
 * StepWise 主类
 * 实现复杂代码任务处理流程的接口
 */
export class StepWise {
  private taskName: string = 'default';
  private taskDir: string = '';
  private resumePath: string = '';
  private debugMode: boolean = false;
  private taskCounter: number = 0;
  private executionIndex: number = 0;  // 恢复模式下用于匹配历史任务序号
  private currentSessionId: string = '';
  private logger: Logger | null = null;
  private executor: ClaudeExecutor;
  private progress: ProgressInfo | null = null;

  constructor() {
    this.executor = createExecutor();
  }

  /**
   * 设置任务名称
   * 基于任务名称加时间生成任务目录
   */
  setTaskName(taskName: string): void {
    this.taskName = taskName;
  }

  /**
   * 设置恢复路径
   * 从指定任务目录恢复执行
   */
  setResumePath(resumePath: string): void {
    this.resumePath = resumePath;
  }

  /**
   * 启用/禁用调试模式
   * 调试模式打开后，所有收集任务执行完成以后只返回第一个数据
   */
  enableDebugMode(enabled: boolean = true): void {
    this.debugMode = enabled;
  }

  /**
   * 检查调试模式是否启用
   */
  isDebugMode(): boolean {
    return this.debugMode;
  }

  /**
   * 初始化任务目录
   */
  private initTaskDir(): void {
    if (this.resumePath) {
      // 恢复模式
      const resumeDir = path.resolve(process.cwd(), EXEC_INFO_DIR, this.resumePath);
      if (fs.existsSync(resumeDir)) {
        this.taskDir = resumeDir;
        this.logger = new Logger(this.taskDir, this.taskName);
        this.loadProgress();
      } else {
        throw new Error(`恢复路径不存在: ${resumeDir}`);
      }
    } else {
      // 新任务
      const timestamp = this.formatTimestamp(new Date());
      const dirName = `${this.taskName}_${timestamp}`;
      this.taskDir = path.resolve(process.cwd(), EXEC_INFO_DIR, dirName);

      // 确保目录存在
      ensureDir(this.taskDir);
      ensureDir(path.join(this.taskDir, DATA_DIR));
      ensureDir(path.join(this.taskDir, DATA_DIR, SESSIONS_DIR));

      this.logger = new Logger(this.taskDir, this.taskName);
      this.progress = {
        taskName: this.taskName,
        taskDir: this.taskDir,
        taskCounter: 0,
        tasks: [],
        lastUpdated: Date.now()
      };
      this.saveProgress();
    }
  }

  /**
   * 格式化时间戳
   */
  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}_${month}_${day}_${hour}_${minute}_${second}`;
  }

  /**
   * 确保任务目录已初始化
   */
  private ensureInitialized(): void {
    if (!this.taskDir || !this.logger) {
      this.initTaskDir();
    }
  }

  /**
   * 保存进度
   */
  private saveProgress(): void {
    if (!this.progress) return;
    const progressFile = path.join(this.taskDir, DATA_DIR, PROGRESS_FILE);
    saveJsonFile(progressFile, this.progress);
  }

  /**
   * 加载进度
   */
  private loadProgress(): void {
    const progressFile = path.join(this.taskDir, DATA_DIR, PROGRESS_FILE);
    this.progress = loadJsonFile<ProgressInfo>(progressFile);
    if (this.progress) {
      // 恢复模式：executionIndex 从 0 开始，每次调用 getNextTaskIndex 时递增
      // taskCounter 设置为历史最大序号，用于后续新任务继续编号
      if (this.progress.tasks.length > 0) {
        const maxIndex = Math.max(...this.progress.tasks.map(t => t.taskIndex));
        this.taskCounter = maxIndex;
      } else {
        this.taskCounter = 0;
      }
      // executionIndex 初始化为 0，调用时从 1 开始匹配
      this.executionIndex = 0;
    }
  }

  /**
   * 获取下一个任务序号
   * 恢复模式下按调用顺序递增，从 1 开始匹配历史任务序号
   */
  private getNextTaskIndex(taskType: TaskType): number {
    // 恢复模式下，按调用顺序递增匹配历史记录
    if (this.resumePath && this.progress) {
      // 从 1 开始递增，匹配历史任务序号
      this.executionIndex++;

      // 检查该序号的历史状态
      const task = this.progress.tasks.find(t => t.taskIndex === this.executionIndex);

      if (task) {
        // 检查类型是否匹配
        if (task.taskType !== taskType) {
          console.warn(`[StepWise] 警告: 任务 ${this.executionIndex} 类型不匹配 - 历史: ${task.taskType}, 当前: ${taskType}`);
        }
        // 返回历史序号，让 isTaskCompleted 判断是否跳过
        return this.executionIndex;
      }

      // 没有历史记录，说明是新任务
      this.taskCounter = this.executionIndex;
      this.progress.taskCounter = this.executionIndex;
      this.progress.lastUpdated = Date.now();
      this.saveProgress();
      return this.executionIndex;
    }

    // 新任务模式，正常递增
    this.taskCounter++;
    if (this.progress) {
      this.progress.taskCounter = this.taskCounter;
      this.progress.lastUpdated = Date.now();
      this.saveProgress();
    }
    return this.taskCounter;
  }

  /**
   * 记录任务开始（状态为 in_progress）
   */
  private recordTaskStart(
    taskIndex: number,
    taskName: string,
    sessionId: string,
    taskType: TaskType,
    outputFileName?: string
  ): void {
    this.recordTaskStatus(taskIndex, taskName, sessionId, taskType, 'in_progress', outputFileName);
  }

  /**
   * 记录任务完成
   */
  private recordTaskComplete(
    taskIndex: number,
    taskName: string,
    sessionId: string,
    taskType: TaskType,
    outputFileName?: string
  ): void {
    this.recordTaskStatus(taskIndex, taskName, sessionId, taskType, 'completed', outputFileName);
  }

  /**
   * 获取当前日志目录名称
   */
  private getLogName(taskIndex: number, taskType: TaskType): string {
    const typeName = TASK_TYPE_NAMES[taskType];
    return `${taskIndex}_${typeName}`;
  }

  /**
   * 获取收集类任务的输出目录
   * 格式: collect/序号_类型名/
   */
  private getCollectOutputDir(taskIndex: number, taskType: TaskType): string {
    const typeName = TASK_TYPE_NAMES[taskType];
    const dir = path.join(this.taskDir, COLLECT_DIR, `${taskIndex}_${typeName}`);
    ensureDir(dir);
    return dir;
  }

  /**
   * 获取报告任务的输出目录
   * 格式: report/
   */
  private getReportOutputDir(): string {
    const dir = path.join(this.taskDir, REPORT_DIR);
    ensureDir(dir);
    return dir;
  }

  /**
   * 获取收集类任务的完整输出路径
   */
  private getCollectOutputPath(taskIndex: number, taskType: TaskType, outputFileName: string): string {
    const dir = this.getCollectOutputDir(taskIndex, taskType);
    return path.join(dir, outputFileName);
  }

  /**
   * 获取报告任务的完整输出路径
   */
  private getReportOutputPath(outputFileName: string): string {
    const dir = this.getReportOutputDir();
    return path.join(dir, outputFileName);
  }

  /**
   * 记录任务状态
   */
  private recordTaskStatus(
    taskIndex: number,
    taskName: string,
    sessionId: string,
    taskType: TaskType,
    status: TaskStatusType,
    outputFileName?: string
  ): void {
    if (!this.progress) return;

    // 查找是否已存在该任务的记录
    const existingIndex = this.progress.tasks.findIndex(
      (t) => t.taskIndex === taskIndex && t.taskType === taskType
    );

    const taskStatus: TaskStatus = {
      taskIndex,
      taskName,
      sessionId,
      status,
      timestamp: Date.now(),
      taskType,
      outputFileName
    };

    if (existingIndex >= 0) {
      // 更新现有记录
      this.progress.tasks[existingIndex] = taskStatus;
    } else {
      // 添加新记录
      this.progress.tasks.push(taskStatus);
    }

    this.saveProgress();
  }

  /**
   * 检查任务是否已完成
   */
  private isTaskCompleted(taskIndex: number, taskType: TaskType): boolean {
    if (!this.progress) return false;
    const task = this.progress.tasks.find(
      (t) => t.taskIndex === taskIndex
    );
    // 只有当类型匹配且状态为 completed 时才返回 true
    return task?.taskType === taskType && task?.status === 'completed';
  }

  /**
   * 检查任务是否正在进行中
   */
  private isTaskInProgress(taskIndex: number, taskType: TaskType): boolean {
    if (!this.progress) return false;
    const task = this.progress.tasks.find(
      (t) => t.taskIndex === taskIndex
    );
    // 只有当类型匹配且状态为 in_progress 时才返回 true
    return task?.taskType === taskType && task?.status === 'in_progress';
  }

  /**
   * 清理未完成任务的相关文件
   */
  private cleanupInProgressTask(taskIndex: number, taskType: TaskType): void {
    if (!this.progress) return;

    const task = this.progress.tasks.find(
      (t) => t.taskIndex === taskIndex
    );

    if (!task) return;

    // 删除任务日志目录
    const typeName = TASK_TYPE_NAMES[taskType];
    const logDirName = `${taskIndex}_${typeName}`;
    const logDir = path.join(this.taskDir, 'logs', logDirName);
    if (fs.existsSync(logDir)) {
      fs.rmSync(logDir, { recursive: true, force: true });
    }

    // 删除收集类任务的输出文件
    if (taskType === 'collect' || taskType === 'process_collect') {
      if (task.outputFileName) {
        const outputPath = this.getCollectOutputPath(taskIndex, taskType, task.outputFileName);
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      }
    } else if (taskType === 'report') {
      if (task.outputFileName) {
        const outputPath = this.getReportOutputPath(task.outputFileName);
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      }
    }
  }

  /**
   * 获取已完成任务的 sessionId
   */
  private getCompletedSessionId(taskIndex: number, taskType: TaskType): string | undefined {
    if (!this.progress) return undefined;
    const task = this.progress.tasks.find(
      (t) =>
        t.taskIndex === taskIndex &&
        t.taskType === taskType &&
        t.status === 'completed'
    );
    return task?.sessionId;
  }

  /**
   * 创建任务日志目录
   */
  private createTaskLogDir(taskIndex: number, taskType: TaskType): string {
    if (!this.logger) return '';
    const logName = this.getLogName(taskIndex, taskType);
    return this.logger.createTaskLogDirByName(logName);
  }

  /**
   * 执行普通任务
   */
  async execPrompt(prompt: string, options?: ExecOptions): Promise<ExecutionResult> {
    this.ensureInitialized();

    const taskType: TaskType = 'task';
    const taskIndex = this.getNextTaskIndex(taskType);

    // 检查是否需要恢复
    if (this.resumePath && this.isTaskCompleted(taskIndex, taskType)) {
      const sessionId = this.getCompletedSessionId(taskIndex, taskType);
      this.logger?.logTaskSkipped(taskIndex, taskType);
      return {
        sessionId: sessionId || '',
        output: '',
        success: true,
        timestamp: Date.now(),
        duration: 0
      };
    }

    // 检查是否有 in_progress 的任务需要重新执行
    if (this.resumePath && this.isTaskInProgress(taskIndex, taskType)) {
      this.cleanupInProgressTask(taskIndex, taskType);
    }

    const sessionId = options?.sessionId || generateUUID();
    const taskLogDir = this.createTaskLogDir(taskIndex, taskType);

    // 记录任务开始
    this.logger?.logTaskStart(taskIndex, taskType, sessionId, prompt);

    // 保存提示词
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', prompt);
    }

    // 记录任务状态为 in_progress
    this.recordTaskStart(taskIndex, `${taskIndex}_task`, sessionId, taskType);

    // 执行任务
    const result = await this.executor.execute(prompt, {
      cwd: options?.cwd,
      sessionId: sessionId,
      useResume: !!options?.sessionId,
      taskLogDir,
      logger: this.logger!,
      taskIndex,
      taskType
    });

    // 保存输出
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'output.txt', result.output);
      if (result.error) {
        this.logger?.writeTaskLog(taskLogDir, 'error.txt', result.error);
      }
    }

    // 记录任务完成
    this.logger?.logTaskComplete(taskIndex, taskType, result.success, result.duration, result.error);

    // 更新任务状态为 completed
    if (result.success) {
      this.recordTaskComplete(taskIndex, `${taskIndex}_task`, sessionId, taskType);
    }

    return result;
  }

  /**
   * 执行收集任务
   */
  async execCollectPrompt(
    prompt: string,
    outputFormat: OutputFormat,
    outputFileName: string,
    options?: ExecOptions
  ): Promise<CollectResult> {
    this.ensureInitialized();

    const taskType: TaskType = 'collect';
    const taskIndex = this.getNextTaskIndex(taskType);

    // 检查是否需要恢复
    if (this.resumePath && this.isTaskCompleted(taskIndex, taskType)) {
      const sessionId = this.getCompletedSessionId(taskIndex, taskType);
      this.logger?.logTaskSkipped(taskIndex, taskType);
      const outputPath = this.getCollectOutputPath(taskIndex, taskType, outputFileName);
      const data = loadJsonFile<Record<string, any>[]>(outputPath) || [];
      return {
        sessionId: sessionId || '',
        output: '',
        success: true,
        timestamp: Date.now(),
        duration: 0,
        data: this.debugMode && data.length > 0 ? [data[0]] : data
      };
    }

    // 检查是否有 in_progress 的任务需要重新执行
    if (this.resumePath && this.isTaskInProgress(taskIndex, taskType)) {
      this.cleanupInProgressTask(taskIndex, taskType);
    }

    const sessionId = options?.sessionId || generateUUID();
    const taskLogDir = this.createTaskLogDir(taskIndex, taskType);
    const outputPath = this.getCollectOutputPath(taskIndex, taskType, outputFileName);

    // 构建完整提示词（使用绝对路径确保写入位置正确）
    const extraPrompt = buildCollectPrompt(outputFormat, outputPath);
    const fullPrompt = buildFullPrompt(prompt, extraPrompt);

    // 记录任务开始
    this.logger?.logTaskStart(taskIndex, taskType, sessionId, fullPrompt);

    // 保存提示词
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', fullPrompt);
    }

    // 记录任务状态为 in_progress
    this.recordTaskStart(taskIndex, `${taskIndex}_collect`, sessionId, taskType, outputFileName);

    // 执行任务
    const result = await this.executor.execute(fullPrompt, {
      cwd: options?.cwd,
      sessionId: sessionId,
      useResume: !!options?.sessionId,
      taskLogDir,
      logger: this.logger!,
      taskIndex,
      taskType
    });

    // 保存输出
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'output.txt', result.output);
      if (result.error) {
        this.logger?.writeTaskLog(taskLogDir, 'error.txt', result.error);
      }
    }

    // 读取收集的数据
    let data: Record<string, any>[] = [];
    if (result.success && fileExists(outputPath)) {
      data = loadJsonFile<Record<string, any>[]>(outputPath) || [];
    }

    // 记录任务完成
    this.logger?.logTaskComplete(taskIndex, taskType, result.success, result.duration, result.error);

    // 更新任务状态为 completed
    if (result.success) {
      this.recordTaskComplete(taskIndex, `${taskIndex}_collect`, sessionId, taskType, outputFileName);
    }

    return {
      ...result,
      data: this.debugMode && data.length > 0 ? [data[0]] : data
    };
  }

  /**
   * 保存收集的数据到磁盘
   */
  saveCollectData(data: Record<string, any>[], fileName: string = 'collect_data.json'): void {
    this.ensureInitialized();
    const outputPath = path.join(this.taskDir, fileName);
    appendJsonArray(outputPath, data);
  }

  /**
   * 从磁盘加载收集的数据
   */
  loadCollectData(fileName: string = 'collect_data.json'): Record<string, any>[] {
    this.ensureInitialized();
    const filePath = path.join(this.taskDir, fileName);
    const data = loadJsonFile<Record<string, any>[]>(filePath);
    return data || [];
  }

  /**
   * 执行处理任务
   */
  async execProcessData(
    prompt: string,
    data: Record<string, any>,
    options?: ExecOptions
  ): Promise<ExecutionResult> {
    this.ensureInitialized();

    const taskType: TaskType = 'process';
    const taskIndex = this.getNextTaskIndex(taskType);

    // 替换变量
    const processedPrompt = replaceVariables(prompt, data);

    const sessionId = options?.sessionId || generateUUID();
    const taskLogDir = this.createTaskLogDir(taskIndex, taskType);

    // 记录任务开始
    this.logger?.logTaskStart(taskIndex, taskType, sessionId, processedPrompt);

    // 保存提示词和数据
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', processedPrompt);
      this.logger?.writeTaskLog(taskLogDir, 'input_data.json', JSON.stringify(data, null, 2));
    }

    // 记录任务状态为 in_progress
    this.recordTaskStart(taskIndex, `${taskIndex}_process`, sessionId, taskType);

    // 执行任务
    const result = await this.executor.execute(processedPrompt, {
      cwd: options?.cwd,
      sessionId: sessionId,
      useResume: !!options?.sessionId,
      taskLogDir,
      logger: this.logger!,
      taskIndex,
      taskType
    });

    // 保存输出
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'output.txt', result.output);
      if (result.error) {
        this.logger?.writeTaskLog(taskLogDir, 'error.txt', result.error);
      }
    }

    // 记录任务完成
    this.logger?.logTaskComplete(taskIndex, taskType, result.success, result.duration, result.error);

    // 更新任务状态为 completed
    if (result.success) {
      this.recordTaskComplete(taskIndex, `${taskIndex}_process`, sessionId, taskType);
    }

    return result;
  }

  /**
   * 执行处理任务并收集结果
   */
  async execProcessDataAndCollect(
    prompt: string,
    data: Record<string, any>,
    outputFormat: OutputFormat,
    outputFileName: string,
    options?: ExecOptions
  ): Promise<CollectResult> {
    this.ensureInitialized();

    const taskType: TaskType = 'process_collect';
    const taskIndex = this.getNextTaskIndex(taskType);

    // 替换变量
    const processedPrompt = replaceVariables(prompt, data);

    const sessionId = options?.sessionId || generateUUID();
    const taskLogDir = this.createTaskLogDir(taskIndex, taskType);
    const outputPath = this.getCollectOutputPath(taskIndex, taskType, outputFileName);

    // 构建完整提示词（使用绝对路径确保写入位置正确）
    const extraPrompt = buildCollectPrompt(outputFormat, outputPath);
    const fullPrompt = buildFullPrompt(processedPrompt, extraPrompt);

    // 记录任务开始
    this.logger?.logTaskStart(taskIndex, taskType, sessionId, fullPrompt);

    // 保存提示词和数据
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', fullPrompt);
      this.logger?.writeTaskLog(taskLogDir, 'input_data.json', JSON.stringify(data, null, 2));
    }

    // 记录任务状态为 in_progress
    this.recordTaskStart(taskIndex, `${taskIndex}_process_and_collect`, sessionId, taskType, outputFileName);

    // 执行任务
    const result = await this.executor.execute(fullPrompt, {
      cwd: options?.cwd,
      sessionId: sessionId,
      useResume: !!options?.sessionId,
      taskLogDir,
      logger: this.logger!,
      taskIndex,
      taskType
    });

    // 保存输出
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'output.txt', result.output);
      if (result.error) {
        this.logger?.writeTaskLog(taskLogDir, 'error.txt', result.error);
      }
    }

    // 读取收集的数据
    let collectedData: Record<string, any>[] = [];
    if (result.success && fileExists(outputPath)) {
      collectedData = loadJsonFile<Record<string, any>[]>(outputPath) || [];
    }

    // 记录任务完成
    this.logger?.logTaskComplete(taskIndex, taskType, result.success, result.duration, result.error);

    // 更新任务状态为 completed
    if (result.success) {
      this.recordTaskComplete(taskIndex, `${taskIndex}_process_and_collect`, sessionId, taskType, outputFileName);
    }

    return {
      ...result,
      data: this.debugMode && collectedData.length > 0 ? [collectedData[0]] : collectedData
    };
  }

  /**
   * 执行报告任务
   */
  async execReport(
    prompt: string,
    outputFormat: OutputFormat,
    outputFileName: string,
    options?: ExecOptions
  ): Promise<CollectResult> {
    this.ensureInitialized();

    const taskType: TaskType = 'report';
    const taskIndex = this.getNextTaskIndex(taskType);

    // 检查是否需要恢复
    if (this.resumePath && this.isTaskCompleted(taskIndex, taskType)) {
      const sessionId = this.getCompletedSessionId(taskIndex, taskType);
      this.logger?.logTaskSkipped(taskIndex, taskType);
      const outputPath = this.getReportOutputPath(outputFileName);
      const data = loadJsonFile<Record<string, any>[]>(outputPath) || [];
      return {
        sessionId: sessionId || '',
        output: '',
        success: true,
        timestamp: Date.now(),
        duration: 0,
        data: this.debugMode && data.length > 0 ? [data[0]] : data
      };
    }

    // 检查是否有 in_progress 的任务需要重新执行
    if (this.resumePath && this.isTaskInProgress(taskIndex, taskType)) {
      this.cleanupInProgressTask(taskIndex, taskType);
    }

    const sessionId = options?.sessionId || generateUUID();
    const taskLogDir = this.createTaskLogDir(taskIndex, taskType);
    const outputPath = this.getReportOutputPath(outputFileName);

    // 构建完整提示词（使用绝对路径确保写入位置正确）
    const extraPrompt = buildReportPrompt(outputFormat, outputPath);
    const fullPrompt = buildFullPrompt(prompt, extraPrompt);

    // 记录任务开始
    this.logger?.logTaskStart(taskIndex, taskType, sessionId, fullPrompt);

    // 保存提示词
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', fullPrompt);
    }

    // 记录任务状态为 in_progress
    this.recordTaskStart(taskIndex, `${taskIndex}_report`, sessionId, taskType, outputFileName);

    // 执行任务
    const result = await this.executor.execute(fullPrompt, {
      cwd: options?.cwd,
      sessionId: sessionId,
      useResume: !!options?.sessionId,
      taskLogDir,
      logger: this.logger!,
      taskIndex,
      taskType
    });

    // 保存输出
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'output.txt', result.output);
      if (result.error) {
        this.logger?.writeTaskLog(taskLogDir, 'error.txt', result.error);
      }
    }

    // 读取报告数据
    let data: Record<string, any>[] = [];
    if (result.success && fileExists(outputPath)) {
      data = loadJsonFile<Record<string, any>[]>(outputPath) || [];
    }

    // 记录任务完成
    this.logger?.logTaskComplete(taskIndex, taskType, result.success, result.duration, result.error);

    // 更新任务状态为 completed
    if (result.success) {
      this.recordTaskComplete(taskIndex, `${taskIndex}_report`, sessionId, taskType, outputFileName);
    }

    return {
      ...result,
      data: this.debugMode && data.length > 0 ? [data[0]] : data
    };
  }

  /**
   * 获取任务目录
   */
  getTaskDir(): string {
    this.ensureInitialized();
    return this.taskDir;
  }

  /**
   * 获取当前任务计数
   */
  getTaskCounter(): number {
    return this.taskCounter;
  }
}