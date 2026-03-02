import * as path from 'path';
import * as fs from 'fs';
import {
  ExecOptions,
  ExecutionResult,
  CollectResult,
  OutputFormat,
  TaskStatus,
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
  TaskType,
  TASK_TYPE_NAMES
} from './constants';

/**
 * AgentTeam 主类
 * 实现复杂代码任务处理流程的接口
 */
export class AgentTeam {
  private taskName: string = 'default';
  private taskDir: string = '';
  private resumePath: string = '';
  private debugMode: boolean = false;
  private taskCounter: number = 0;
  private currentSessionId: string = '';
  private logger: Logger | null = null;
  private executor: ClaudeExecutor;
  private progress: ProgressInfo | null = null;
  /** 当前日志层级路径，用于支持嵌套任务 */
  private logLevelPath: number[] = [];

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
        lastUpdated: Date.now(),
        logLevelPath: []
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
      this.taskCounter = this.progress.taskCounter;
      this.logLevelPath = this.progress.logLevelPath || [];
    }
  }

  /**
   * 获取下一个任务序号
   */
  private getNextTaskIndex(): number {
    this.taskCounter++;
    if (this.progress) {
      this.progress.taskCounter = this.taskCounter;
      this.progress.lastUpdated = Date.now();
      this.saveProgress();
    }
    return this.taskCounter;
  }

  /**
   * 获取当前日志层级名称
   * 例如: "1_task", "2_collect", "3_1_process", "3_1_1_process"
   */
  private getLogName(taskType: TaskType): string {
    const typeName = TASK_TYPE_NAMES[taskType];
    if (this.logLevelPath.length === 0) {
      return `${this.taskCounter}_${typeName}`;
    }
    const prefix = this.logLevelPath.join('_');
    return `${prefix}_${this.taskCounter}_${typeName}`;
  }

  /**
   * 进入子任务层级
   * 在执行处理任务前调用，用于生成嵌套日志目录
   */
  enterSubLevel(): void {
    this.logLevelPath.push(this.taskCounter);
    this.taskCounter = 0; // 重置子层级计数器
    if (this.progress) {
      this.progress.logLevelPath = [...this.logLevelPath];
      this.progress.taskCounter = this.taskCounter;
      this.saveProgress();
    }
  }

  /**
   * 退出子任务层级
   * 在处理任务完成后调用
   */
  exitSubLevel(): void {
    if (this.logLevelPath.length > 0) {
      this.taskCounter = this.logLevelPath.pop() || 0;
      if (this.progress) {
        this.progress.logLevelPath = [...this.logLevelPath];
        this.progress.taskCounter = this.taskCounter;
        this.saveProgress();
      }
    }
  }

  /**
   * 记录任务状态
   */
  private recordTaskStatus(
    taskIndex: number,
    taskName: string,
    sessionId: string,
    taskType: TaskType,
    completed: boolean,
    outputFileName?: string
  ): void {
    if (!this.progress) return;

    const taskStatus: TaskStatus = {
      taskIndex,
      taskName,
      sessionId,
      completed,
      timestamp: Date.now(),
      taskType,
      outputFileName,
      logLevelPath: [...this.logLevelPath]
    };

    this.progress.tasks.push(taskStatus);
    this.saveProgress();
  }

  /**
   * 检查任务是否已完成
   */
  private isTaskCompleted(taskIndex: number, taskType: TaskType): boolean {
    if (!this.progress) return false;
    return this.progress.tasks.some(
      (t) =>
        t.taskIndex === taskIndex &&
        t.taskType === taskType &&
        t.completed &&
        // 比较层级路径是否一致
        JSON.stringify(t.logLevelPath) === JSON.stringify(this.logLevelPath)
    );
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
        t.completed &&
        JSON.stringify(t.logLevelPath) === JSON.stringify(this.logLevelPath)
    );
    return task?.sessionId;
  }

  /**
   * 创建任务日志目录
   */
  private createTaskLogDir(taskType: TaskType): string {
    if (!this.logger) return '';
    const logName = this.getLogName(taskType);
    return this.logger.createTaskLogDirByName(logName);
  }

  /**
   * 执行普通任务
   */
  async execPrompt(prompt: string, options?: ExecOptions): Promise<ExecutionResult> {
    this.ensureInitialized();

    const taskIndex = this.getNextTaskIndex();
    const taskType: TaskType = 'task';

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

    const sessionId = options?.sessionId || generateUUID();
    const taskLogDir = this.createTaskLogDir(taskType);

    // 记录任务开始
    this.logger?.logTaskStart(taskIndex, taskType, sessionId, prompt);

    // 保存提示词
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', prompt);
    }

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

    // 记录状态
    this.recordTaskStatus(taskIndex, `${taskIndex}_task`, sessionId, taskType, result.success);

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

    const taskIndex = this.getNextTaskIndex();
    const taskType: TaskType = 'collect';

    // 检查是否需要恢复
    if (this.resumePath && this.isTaskCompleted(taskIndex, taskType)) {
      const sessionId = this.getCompletedSessionId(taskIndex, taskType);
      this.logger?.logTaskSkipped(taskIndex, taskType);
      const data = this.loadCollectData(outputFileName);
      return {
        sessionId: sessionId || '',
        output: '',
        success: true,
        timestamp: Date.now(),
        duration: 0,
        data: this.debugMode && data.length > 0 ? [data[0]] : data
      };
    }

    const sessionId = options?.sessionId || generateUUID();
    const taskLogDir = this.createTaskLogDir(taskType);
    const outputPath = path.join(this.taskDir, outputFileName);

    // 构建完整提示词
    const extraPrompt = buildCollectPrompt(outputFormat, outputFileName);
    const fullPrompt = buildFullPrompt(prompt, extraPrompt);

    // 记录任务开始
    this.logger?.logTaskStart(taskIndex, taskType, sessionId, fullPrompt);

    // 保存提示词
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', fullPrompt);
    }

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
      data = this.loadCollectData(outputFileName);
    }

    // 记录任务完成
    this.logger?.logTaskComplete(taskIndex, taskType, result.success, result.duration, result.error);

    // 记录状态
    this.recordTaskStatus(
      taskIndex,
      `${taskIndex}_collect`,
      sessionId,
      taskType,
      result.success,
      outputFileName
    );

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

    const taskIndex = this.getNextTaskIndex();
    const taskType: TaskType = 'process';

    // 替换变量
    const processedPrompt = replaceVariables(prompt, data);

    const sessionId = options?.sessionId || generateUUID();
    const taskLogDir = this.createTaskLogDir(taskType);

    // 记录任务开始
    this.logger?.logTaskStart(taskIndex, taskType, sessionId, processedPrompt);

    // 保存提示词和数据
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', processedPrompt);
      this.logger?.writeTaskLog(taskLogDir, 'input_data.json', JSON.stringify(data, null, 2));
    }

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

    // 记录状态
    this.recordTaskStatus(taskIndex, `${taskIndex}_process`, sessionId, taskType, result.success);

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

    const taskIndex = this.getNextTaskIndex();
    const taskType: TaskType = 'process_collect';

    // 替换变量
    const processedPrompt = replaceVariables(prompt, data);

    // 构建完整提示词
    const extraPrompt = buildCollectPrompt(outputFormat, outputFileName);
    const fullPrompt = buildFullPrompt(processedPrompt, extraPrompt);

    const sessionId = options?.sessionId || generateUUID();
    const taskLogDir = this.createTaskLogDir(taskType);
    const outputPath = path.join(this.taskDir, outputFileName);

    // 记录任务开始
    this.logger?.logTaskStart(taskIndex, taskType, sessionId, fullPrompt);

    // 保存提示词和数据
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', fullPrompt);
      this.logger?.writeTaskLog(taskLogDir, 'input_data.json', JSON.stringify(data, null, 2));
    }

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
      collectedData = this.loadCollectData(outputFileName);
    }

    // 记录任务完成
    this.logger?.logTaskComplete(taskIndex, taskType, result.success, result.duration, result.error);

    // 记录状态
    this.recordTaskStatus(
      taskIndex,
      `${taskIndex}_process_and_collect`,
      sessionId,
      taskType,
      result.success,
      outputFileName
    );

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

    const taskIndex = this.getNextTaskIndex();
    const taskType: TaskType = 'report';

    // 检查是否需要恢复
    if (this.resumePath && this.isTaskCompleted(taskIndex, taskType)) {
      const sessionId = this.getCompletedSessionId(taskIndex, taskType);
      this.logger?.logTaskSkipped(taskIndex, taskType);
      const data = this.loadCollectData(outputFileName);
      return {
        sessionId: sessionId || '',
        output: '',
        success: true,
        timestamp: Date.now(),
        duration: 0,
        data: this.debugMode && data.length > 0 ? [data[0]] : data
      };
    }

    const sessionId = options?.sessionId || generateUUID();
    const taskLogDir = this.createTaskLogDir(taskType);
    const outputPath = path.join(this.taskDir, outputFileName);

    // 构建完整提示词
    const extraPrompt = buildReportPrompt(outputFormat, outputFileName);
    const fullPrompt = buildFullPrompt(prompt, extraPrompt);

    // 记录任务开始
    this.logger?.logTaskStart(taskIndex, taskType, sessionId, fullPrompt);

    // 保存提示词
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', fullPrompt);
    }

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
      data = this.loadCollectData(outputFileName);
    }

    // 记录任务完成
    this.logger?.logTaskComplete(taskIndex, taskType, result.success, result.duration, result.error);

    // 记录状态
    this.recordTaskStatus(
      taskIndex,
      `${taskIndex}_report`,
      sessionId,
      taskType,
      result.success,
      outputFileName
    );

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