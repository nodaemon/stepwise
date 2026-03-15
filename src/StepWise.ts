import * as path from 'path';
import * as fs from 'fs';
import {
  ExecOptions,
  ExecutionResult,
  CollectResult,
  CheckResult,
  OutputFormat,
  TaskStatus,
  TaskStatusType,
  ProgressInfo,
  SummarizeOptions,
  SummarizeResult
} from './types';
import { generateUUID } from './utils/uuid';
import { Logger } from './utils/logger';
import { ClaudeExecutor, createExecutor } from './utils/executor';
import {
  ensureDir,
  saveJsonFile,
  loadJsonFile,
  fileExists
} from './utils/fileHelper';
import {
  validateJsonArray,
  validateJsonObject,
  buildFixPrompt,
  ValidationResult
} from './utils/validator';
import {
  buildCollectPrompt,
  buildReportPrompt,
  buildCheckPrompt,
  buildFullPrompt,
  replaceVariables,
  buildSummarizePrompt
} from './utils/promptBuilder';
import {
  EXEC_INFO_DIR,
  DATA_DIR,
  PROGRESS_FILE,
  COLLECT_DIR,
  LOGS_DIR,
  REPORT_DIR,
  TaskType,
  TASK_TYPE_NAMES
} from './constants';
import {
  _getTaskName,
  _getResumePath,
  _isDebugMode,
  _shouldSkipSummarize,
  _registerName,
  _setTaskDirTimestamp,
  _getTaskDirTimestamp
} from './globalState';

/**
 * StepWise 主类
 * 实现复杂代码任务处理流程的接口
 */
export class StepWise {
  private name: string;
  private agentDir: string = '';
  private taskDir: string = '';
  private taskCounter: number = 0;
  private executionIndex: number = 0;  // 恢复模式下用于匹配历史任务序号
  /** 当前会话ID，用于默认复用上一个任务的session */
  private currentSessionId: string = '';
  private logger: Logger | null = null;
  private executor: ClaudeExecutor;
  private progress: ProgressInfo | null = null;
  /** 默认工作目录，当 options.cwd 未指定时使用 */
  private defaultCwd?: string;
  /** 默认环境变量数组，格式为 "KEY=VALUE" */
  private defaultEnv?: string[];
  /** Worker 标识（用于 forEachParallel 并发处理） */
  private workerId?: string;

  constructor(name: string, defaultCwd?: string, defaultEnv?: string[], workerId?: string) {
    // 检查 TaskName 是否设置
    const taskName = _getTaskName();
    if (!taskName) {
      console.error('[错误] TaskName 未设置');
      console.error('请先调用 setTaskName("your_task_name") 设置任务名称');
      process.exit(1);
    }

    // 检查名字是否重复
    if (!_registerName(name)) {
      console.error(`[错误] StepWise 名字重复: "${name}"`);
      console.error('已存在重复的 StepWise 名字，请使用不同的名字区分');
      process.exit(1);
    }

    this.name = name;
    this.defaultCwd = defaultCwd;
    this.defaultEnv = defaultEnv;
    this.workerId = workerId;
    this.executor = createExecutor();

    // 初始化目录
    this.initDirectories();

    // 打印 StepWise 启动信息
    console.log(`StepWise [${name}] 已就绪`);
  }

  /**
   * 生成包含毫秒的时间戳
   * 格式：{YYYYMMDD}_{HHmmss}_{毫秒}
   */
  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${year}${month}${day}_${hour}${minute}${second}_${ms}`;
  }

  /**
   * 初始化目录结构
   */
  private initDirectories(): void {
    const taskName = _getTaskName();
    const resumePath = _getResumePath();

    if (resumePath) {
      // 恢复模式
      const taskDirFullPath = path.resolve(process.cwd(), EXEC_INFO_DIR, resumePath);
      if (!fs.existsSync(taskDirFullPath)) {
        console.error('[错误] 无法恢复任务');
        console.error(`找不到任务目录: ${resumePath}`);
        console.error('建议: 去掉 setResumePath() 调用，从头开始执行');
        process.exit(1);
      }

      this.taskDir = taskDirFullPath;

      // 根据 agentName 查找对应的 Agent 目录
      const agentDir = this.findAgentDir(taskDirFullPath, this.name);
      if (agentDir) {
        // 找到已有目录，恢复模式
        this.agentDir = agentDir;
        this.logger = new Logger(this.agentDir, this.name);
        this.loadProgress();
      } else {
        // 找不到目录，说明该 Agent 从未开始过，创建新目录
        const timestamp = this.formatTimestamp(new Date());
        const agentDirName = this.workerId
          ? `${this.name}_${this.workerId}_${timestamp}`
          : `${this.name}_${timestamp}`;
        this.agentDir = path.join(this.taskDir, agentDirName);

        // 创建 Agent 目录结构
        ensureDir(this.agentDir);
        ensureDir(path.join(this.agentDir, DATA_DIR));
        ensureDir(path.join(this.agentDir, LOGS_DIR));
        ensureDir(path.join(this.agentDir, COLLECT_DIR));

        this.logger = new Logger(this.agentDir, this.name);

        // 初始化空的 progress
        this.progress = {
          taskName: this.name,
          taskDir: this.agentDir,
          taskCounter: 0,
          tasks: [],
          lastUpdated: Date.now()
        };
        this.taskCounter = 0;

        console.log(`[StepWise] Agent "${this.name}" 首次执行，已创建新目录`);
      }
    } else {
      // 新任务模式
      let timestamp = _getTaskDirTimestamp();

      if (!timestamp) {
        // 第一个 StepWise 创建时生成任务目录时间戳
        timestamp = this.formatTimestamp(new Date());
        _setTaskDirTimestamp(timestamp);
      }

      const taskDirName = `${taskName}_${timestamp}`;
      this.taskDir = path.resolve(process.cwd(), EXEC_INFO_DIR, taskDirName);

      // Agent 目录使用新的时间戳
      const agentTimestamp = this.formatTimestamp(new Date());
      const agentDirName = this.workerId
        ? `${this.name}_${this.workerId}_${agentTimestamp}`
        : `${this.name}_${agentTimestamp}`;
      this.agentDir = path.join(this.taskDir, agentDirName);

      // 确保目录存在
      ensureDir(this.taskDir);
      ensureDir(path.join(this.taskDir, REPORT_DIR));
      ensureDir(this.agentDir);
      ensureDir(path.join(this.agentDir, DATA_DIR));
      ensureDir(path.join(this.agentDir, LOGS_DIR));
      ensureDir(path.join(this.agentDir, COLLECT_DIR));

      this.logger = new Logger(this.agentDir, this.name);
      this.progress = {
        taskName: this.name,
        taskDir: this.agentDir,
        taskCounter: 0,
        tasks: [],
        lastUpdated: Date.now()
      };
      this.saveProgress();
    }
  }

  /**
   * 根据 agentName 查找对应的 Agent 目录
   * 支持 workerId 模式：{agentName}_{workerId}_{timestamp}
   */
  private findAgentDir(taskDir: string, agentName: string): string | null {
    const entries = fs.readdirSync(taskDir, { withFileTypes: true });

    // 如果有 workerId，优先匹配 {agentName}_{workerId}_* 格式
    if (this.workerId) {
      const prefix = `${agentName}_${this.workerId}_`;
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith(prefix)) {
          return path.join(taskDir, entry.name);
        }
      }
      // 没有 workerId 的匹配，返回 null（说明该 worker 之前没有执行过）
      return null;
    }

    // 没有 workerId，匹配传统格式 {agentName}_*
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(agentName + '_')) {
        return path.join(taskDir, entry.name);
      }
    }
    return null;
  }

  /**
   * 获取当前的 session id
   */
  getCurrentSessionId(): string {
    return this.currentSessionId;
  }

  /**
   * 获取有效的 cwd
   * 优先级：options.cwd > defaultCwd > process.cwd()
   */
  private getEffectiveCwd(cwd?: string): string | undefined {
    return cwd ?? this.defaultCwd;
  }

  /**
   * 获取有效的环境变量数组
   * 优先级：options.env > defaultEnv
   */
  private getEffectiveEnv(env?: string[]): string[] | undefined {
    return env ?? this.defaultEnv;
  }

  /**
   * 获取或创建 session id
   */
  private getOrCreateSessionId(newSession?: boolean): string {
    if (newSession || !this.currentSessionId) {
      this.currentSessionId = generateUUID();
    }
    return this.currentSessionId;
  }

  /**
   * 获取或创建 session id（带自动总结）
   * 如果 newSession=true 且存在 currentSessionId，先总结前一个 session
   */
  private async getOrCreateSessionIdWithSummarize(newSession?: boolean, cwd?: string, env?: string[]): Promise<string> {
    if (newSession && this.currentSessionId && !_isDebugMode() && !_shouldSkipSummarize()) {
      // 找到当前 session 的最后一个任务
      const lastTask = this.getLastTaskOfSession(this.currentSessionId);
      // 在创建新 session 之前，总结前一个 session
      await this.summarizeInternal(this.currentSessionId, cwd, env, lastTask);
    }
    return this.getOrCreateSessionId(newSession);
  }

  /**
   * 获取指定 session 的最后一个任务
   */
  private getLastTaskOfSession(sessionId: string): { taskIndex: number; taskType: TaskType } | null {
    if (!this.progress) return null;

    const sessionTasks = this.progress.tasks.filter(t => t.sessionId === sessionId);
    if (sessionTasks.length === 0) return null;

    // 找到 taskIndex 最大的任务
    const lastTask = sessionTasks.reduce((max, task) =>
      task.taskIndex > max.taskIndex ? task : max
    );

    return { taskIndex: lastTask.taskIndex, taskType: lastTask.taskType };
  }

  /**
   * 内部总结方法
   * 日志写入到 session 最后一个任务的目录中
   */
  private async summarizeInternal(
    sessionId: string,
    cwd?: string,
    env?: string[],
    lastTask?: { taskIndex: number; taskType: TaskType } | null
  ): Promise<void> {
    // 获取技能文件目录
    const skillsDir = this.getSkillsDir(cwd);

    // 构建总结提示词
    const summarizePrompt = buildSummarizePrompt(skillsDir);

    // 确定日志目录：使用 session 最后一个任务的目录
    let logDir: string;
    if (lastTask) {
      // 使用最后一个任务的目录
      logDir = this.createTaskLogDir(lastTask.taskIndex, lastTask.taskType);
    } else {
      // 没有任务记录时，使用默认目录
      const timestamp = this.formatTimestamp(new Date());
      const logDirName = `summarize_${timestamp}`;
      logDir = this.logger?.createTaskLogDirByName(logDirName) || '';
    }

    if (!logDir) return;

    this.logger?.logTaskStart(lastTask?.taskIndex || 0, 'summarize', sessionId);

    if (logDir) {
      this.logger?.writeTaskLog(logDir, 'summarize_prompt.txt', summarizePrompt);
    }

    try {
      // 使用 --resume 模式执行总结
      await this.executor.execute(summarizePrompt, {
        cwd: cwd,
        env: env,
        sessionId: sessionId,
        useResume: true,
        taskLogDir: logDir,
        logger: this.logger!,
        taskIndex: lastTask?.taskIndex || 0,
        taskType: 'summarize'
      });

      this.logger?.logTaskComplete(lastTask?.taskIndex || 0, 'summarize', true, 0);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger?.logTaskComplete(lastTask?.taskIndex || 0, 'summarize', false, 0, errorMsg);
      // 总结失败不影响主流程，只记录日志
    }
  }

  /**
   * 获取技能文件目录
   */
  private getSkillsDir(cwd?: string): string {
    const baseDir = cwd || process.cwd();
    return path.join(baseDir, '.claude', 'skills');
  }

  /**
   * 查找生成的 Skill 文件
   */
  private findGeneratedSkillFiles(cwd?: string): string[] {
    const skillsDir = this.getSkillsDir(cwd);

    if (!fs.existsSync(skillsDir)) {
      return [];
    }

    const skillFiles: string[] = [];

    const scanDir = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name === 'SKILL.md') {
          skillFiles.push(fullPath);
        }
      }
    };

    scanDir(skillsDir);
    return skillFiles;
  }

  /**
   * 保存进度
   */
  private saveProgress(): void {
    if (!this.progress) return;
    const progressFile = path.join(this.agentDir, DATA_DIR, PROGRESS_FILE);
    saveJsonFile(progressFile, this.progress);
  }

  /**
   * 加载进度
   */
  private loadProgress(): void {
    const progressFile = path.join(this.agentDir, DATA_DIR, PROGRESS_FILE);
    this.progress = loadJsonFile<ProgressInfo>(progressFile);
    if (this.progress) {
      if (this.progress.tasks.length > 0) {
        const maxIndex = Math.max(...this.progress.tasks.map(t => t.taskIndex));
        this.taskCounter = maxIndex;
      } else {
        this.taskCounter = 0;
      }
      this.executionIndex = 0;
    } else {
      // progress.json 损坏或不存在时的处理
      if (fs.existsSync(progressFile)) {
        console.warn(`[StepWise] 警告: progress.json 文件损坏，已重置进度`);
        console.warn(`文件路径: ${progressFile}`);
      }
      // 初始化空的 progress
      this.progress = {
        taskName: this.name,
        taskDir: this.agentDir,
        taskCounter: 0,
        tasks: [],
        lastUpdated: Date.now()
      };
      this.taskCounter = 0;
      this.executionIndex = 0;
    }
  }

  /**
   * 获取下一个任务序号
   */
  private getNextTaskIndex(taskType: TaskType): number {
    const resumePath = _getResumePath();

    if (resumePath && this.progress) {
      this.executionIndex++;
      const task = this.progress.tasks.find(t => t.taskIndex === this.executionIndex);

      if (task) {
        if (task.taskType !== taskType) {
          console.warn(`[StepWise] 警告: 任务 ${this.executionIndex} 类型不匹配 - 历史: ${task.taskType}, 当前: ${taskType}`);
        }
        return this.executionIndex;
      }

      this.taskCounter = this.executionIndex;
      this.progress.taskCounter = this.executionIndex;
      this.progress.lastUpdated = Date.now();
      this.saveProgress();
      return this.executionIndex;
    }

    this.taskCounter++;
    if (this.progress) {
      this.progress.taskCounter = this.taskCounter;
      this.progress.lastUpdated = Date.now();
      this.saveProgress();
    }
    return this.taskCounter;
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
    outputFileName?: string,
    checkResult?: boolean
  ): void {
    if (!this.progress) return;

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
      outputFileName,
      checkResult
    };

    if (existingIndex >= 0) {
      this.progress.tasks[existingIndex] = taskStatus;
    } else {
      this.progress.tasks.push(taskStatus);
    }

    this.saveProgress();
  }

  /**
   * 记录任务开始
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
    outputFileName?: string,
    checkResult?: boolean
  ): void {
    this.recordTaskStatus(taskIndex, taskName, sessionId, taskType, 'completed', outputFileName, checkResult);
  }

  /**
   * 获取当前日志目录名称
   */
  private getLogName(taskIndex: number, taskType: TaskType): string {
    const typeName = TASK_TYPE_NAMES[taskType];
    return `${taskIndex}_${typeName}`;
  }

  /**
   * 判断是否应该使用 resume 模式
   */
  private shouldUseResume(taskIndex: number, newSession?: boolean): boolean {
    if (newSession) {
      return false;
    }

    const resumePath = _getResumePath();
    if (resumePath && this.progress) {
      const hasPreviousCompleted = this.progress.tasks.some(
        t => t.taskIndex < taskIndex && t.status === 'completed'
      );
      return hasPreviousCompleted;
    }

    return taskIndex > 1;
  }

  /**
   * 获取收集类任务的输出目录
   */
  private getCollectOutputDir(taskIndex: number, taskType: TaskType): string {
    const typeName = TASK_TYPE_NAMES[taskType];
    const dir = path.join(this.agentDir, COLLECT_DIR, `${taskIndex}_${typeName}`);
    ensureDir(dir);
    return dir;
  }

  /**
   * 获取报告任务的输出目录（在 TaskName 目录下）
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
   * 检查任务是否已完成
   */
  private isTaskCompleted(taskIndex: number, taskType: TaskType): boolean {
    if (!this.progress) return false;
    const task = this.progress.tasks.find(
      (t) => t.taskIndex === taskIndex
    );
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

    const typeName = TASK_TYPE_NAMES[taskType];
    const logDirName = `${taskIndex}_${typeName}`;
    const logDir = path.join(this.agentDir, LOGS_DIR, logDirName);
    if (fs.existsSync(logDir)) {
      fs.rmSync(logDir, { recursive: true, force: true });
    }

    if (taskType === 'collect' || taskType === 'process_collect' || taskType === 'check') {
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
   * 获取任务状态信息
   */
  private getTaskStatus(taskIndex: number, taskType: TaskType): TaskStatus | undefined {
    if (!this.progress) return undefined;
    return this.progress.tasks.find(t => t.taskIndex === taskIndex && t.taskType === taskType);
  }

  /**
   * 获取任务的 sessionId（不管状态）
   */
  private getTaskSessionId(taskIndex: number): string | undefined {
    if (!this.progress) return undefined;
    const task = this.progress.tasks.find(t => t.taskIndex === taskIndex);
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
   * 处理 prompt 中的变量替换
   */
  private processPrompt(prompt: string, options?: ExecOptions): string {
    if (options?.data) {
      return replaceVariables(prompt, options.data);
    }
    return prompt;
  }

  /**
   * 验证 prompt 不为空
   */
  private validatePrompt(prompt: string): void {
    if (!prompt || prompt.trim() === '') {
      throw new Error('错误: prompt 不能为空');
    }
  }

  /**
   * 验证 OutputFormat 参数
   */
  private validateOutputFormat(outputFormat: OutputFormat | undefined, methodName: string): void {
    if (!outputFormat) {
      throw new Error(`[StepWise.${methodName}] outputFormat 参数不能为空`);
    }
    if (!outputFormat.keys || !Array.isArray(outputFormat.keys) || outputFormat.keys.length === 0) {
      throw new Error(`[StepWise.${methodName}] outputFormat.keys 不能为空数组`);
    }
    for (const key of outputFormat.keys) {
      if (!key.name || typeof key.name !== 'string') {
        throw new Error(`[StepWise.${methodName}] outputFormat.keys 中的每个元素必须包含有效的 name 属性`);
      }
    }
  }

  /**
   * 验证输出文件名参数
   */
  private validateOutputFileName(outputFileName: string | undefined, methodName: string): void {
    if (!outputFileName || outputFileName.trim() === '') {
      throw new Error(`[StepWise.${methodName}] outputFileName 参数不能为空`);
    }
    if (outputFileName.includes('..') || outputFileName.includes('/') || outputFileName.includes('\\')) {
      throw new Error(`[StepWise.${methodName}] outputFileName 包含非法字符`);
    }
  }

  /**
   * 写入任务日志
   */
  private writeTaskLogs(taskLogDir: string, result: ExecutionResult): void {
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'output.txt', result.output);
      if (result.error) {
        this.logger?.writeTaskLog(taskLogDir, 'error.txt', result.error);
      }
    }
  }

  /**
   * 带校验和自动重试的 JSON 文件读取
   *
   * 执行流程：
   * 1. 如果校验被禁用或文件不存在，直接返回 loadJsonFile 结果
   * 2. 读取文件内容并执行校验
   * 3. 校验通过则返回数据
   * 4. 校验失败则生成修复提示词，让 AI 修复 JSON 文件
   * 5. 重复步骤 2-4，直到成功或达到最大重试次数
   * 6. 重试耗尽后返回 null（不抛异常，保持向后兼容）
   *
   * @param outputPath JSON 文件路径
   * @param execOptions 执行选项，包含 validateOptions 配置
   * @param context 执行上下文（cwd、env、日志目录等）
   * @param validateConfig 校验配置，包含校验函数和期望格式
   */
  private async readJsonWithValidation<T>(
    outputPath: string,
    execOptions: ExecOptions | undefined,
    context: {
      cwd: string | undefined;
      env: string[] | undefined;
      taskLogDir: string;
      taskIndex: number;
      taskType: TaskType;
    },
    validateConfig: {
      /** 校验函数：解析内容并返回校验结果 */
      validate: (content: string) => ValidationResult<T>;
      /** 期望的 JSON 格式类型，用于生成修复提示词 */
      expectedFormat: 'array' | 'object';
    }
  ): Promise<T | null> {
    // 解析校验配置
    const validationEnabled = execOptions?.validateOptions?.enabled !== false;
    const maxRetryAttempts = execOptions?.validateOptions?.maxRetries ?? 3;

    // 禁用校验或文件不存在时，使用原有逻辑
    if (!validationEnabled || !fs.existsSync(outputPath)) {
      return loadJsonFile<T>(outputPath);
    }

    // 校验循环：attempt 从 1 开始，表示第几次尝试
    for (let attempt = 1; attempt <= maxRetryAttempts + 1; attempt++) {
      // 步骤 1: 读取并校验文件内容
      const fileContent = fs.readFileSync(outputPath, 'utf-8');
      const validationResult = validateConfig.validate(fileContent);

      // 步骤 2: 校验通过，返回数据
      if (validationResult.valid) {
        return validationResult.data!;
      }

      // 步骤 3: 校验失败，记录日志
      this.logger?.logValidationFailed(context.taskIndex, attempt, validationResult.errors);

      // 步骤 4: 检查是否还能重试
      if (attempt > maxRetryAttempts) {
        // 重试耗尽，记录错误并返回 null
        const errorSummary = validationResult.errors.map(e => `  - ${e.message}`).join('\n');
        console.error(`[StepWise] JSON 校验失败，已重试 ${maxRetryAttempts} 次\n错误信息:\n${errorSummary}`);
        return null;
      }

      // 步骤 5: 生成修复提示词并执行
      console.log(`[StepWise] 校验失败，第 ${attempt} 次重试...`);
      const fixPrompt = buildFixPrompt(validationResult.errors, outputPath, validateConfig.expectedFormat);

      await this.executor.execute(fixPrompt, {
        cwd: context.cwd,
        env: context.env,
        sessionId: this.currentSessionId,
        useResume: true,
        taskLogDir: context.taskLogDir,
        logger: this.logger!,
        taskIndex: context.taskIndex,
        taskType: context.taskType
      });

      // 循环继续，重新读取并校验修复后的文件
    }

    // 理论上不会到达这里，但 TypeScript 需要返回值
    return null;
  }

  /**
   * 执行 checkPrompt
   */
  private async executeCheckPromptInternal(
    checkPrompt: string,
    cwd: string | undefined,
    env: string[] | undefined,
    sessionId: string,
    taskLogDir: string,
    taskIndex: number
  ): Promise<void> {
    const processedCheckPrompt = this.processPrompt(checkPrompt);

    // 写入 checkPrompt 日志
    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'check_prompt.txt', processedCheckPrompt);
    }

    await this.executor.execute(processedCheckPrompt, {
      cwd,
      env,
      sessionId,
      useResume: true,
      taskLogDir,
      logger: this.logger!,
      taskIndex,
      taskType: 'check'
    });
  }

  /**
   * 应用调试模式提示
   */
  private applyDebugModeHint(extraPrompt: string, debugMode: boolean): string {
    if (debugMode) {
      return '\n\n【调试模式】' + extraPrompt + '\n\n注意： 当前处于调试模式，请只收集 **1 条** 数据即可。';
    }
    return extraPrompt;
  }

  /**
   * 过滤调试模式数据
   */
  private filterDebugData(data: Record<string, any>[], debugMode: boolean): Record<string, any>[] {
    return debugMode && data.length > 0 ? [data[0]] : data;
  }

  /**
   * 执行普通任务
   */
  async execPrompt(prompt: string, options?: ExecOptions): Promise<ExecutionResult> {
    this.validatePrompt(prompt);

    const effectiveCwd = this.getEffectiveCwd(options?.cwd);
    const effectiveEnv = this.getEffectiveEnv(options?.env);
    const resumePath = _getResumePath();
    const taskType: TaskType = 'task';
    const taskIndex = this.getNextTaskIndex(taskType);

    // 处理变量替换
    const processedPrompt = this.processPrompt(prompt, options);

    // 检查是否需要恢复
    if (resumePath && this.isTaskCompleted(taskIndex, taskType)) {
      const sessionId = this.getCompletedSessionId(taskIndex, taskType);
      // 重要：恢复 sessionId 到 currentSessionId，确保后续任务能复用
      if (sessionId) {
        this.currentSessionId = sessionId;
      }
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
    if (resumePath && this.isTaskInProgress(taskIndex, taskType)) {
      // 恢复 sessionId，确保重新执行时能复用原来的 session
      const sessionId = this.getTaskSessionId(taskIndex);
      if (sessionId) {
        this.currentSessionId = sessionId;
      }
      this.cleanupInProgressTask(taskIndex, taskType);
    }

    const sessionId = await this.getOrCreateSessionIdWithSummarize(options?.newSession, effectiveCwd, effectiveEnv);
    const taskLogDir = this.createTaskLogDir(taskIndex, taskType);
    const useResume = this.shouldUseResume(taskIndex, options?.newSession);

    this.logger?.logTaskStart(taskIndex, taskType, sessionId);

    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', processedPrompt);
    }

    this.recordTaskStart(taskIndex, `${taskIndex}_task`, sessionId, taskType);

    const result = await this.executor.execute(processedPrompt, {
      cwd: effectiveCwd,
      env: effectiveEnv,
      sessionId: sessionId,
      useResume,
      taskLogDir,
      logger: this.logger!,
      taskIndex,
      taskType
    });

    this.writeTaskLogs(taskLogDir, result);

    this.logger?.logTaskComplete(taskIndex, taskType, result.success, result.duration, result.error);

    if (result.success) {
      if (options?.checkPrompt && !_isDebugMode()) {
        await this.executeCheckPromptInternal(options.checkPrompt, effectiveCwd, effectiveEnv, sessionId, taskLogDir, taskIndex);
      }
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
    options?: ExecOptions
  ): Promise<CollectResult> {
    this.validatePrompt(prompt);
    this.validateOutputFormat(outputFormat, 'execCollectPrompt');

    const effectiveCwd = this.getEffectiveCwd(options?.cwd);
    const effectiveEnv = this.getEffectiveEnv(options?.env);
    const resumePath = _getResumePath();
    const debugMode = _isDebugMode();
    const taskType: TaskType = 'collect';
    const taskIndex = this.getNextTaskIndex(taskType);

    // 生成默认输出文件名
    const outputFileName = `collect_${taskIndex}.json`;

    // 处理变量替换
    const processedPrompt = this.processPrompt(prompt, options);

    // 检查是否需要恢复
    if (resumePath && this.isTaskCompleted(taskIndex, taskType)) {
      const sessionId = this.getCompletedSessionId(taskIndex, taskType);
      // 重要：恢复 sessionId 到 currentSessionId，确保后续任务能复用
      if (sessionId) {
        this.currentSessionId = sessionId;
      }
      this.logger?.logTaskSkipped(taskIndex, taskType);
      const outputPath = this.getCollectOutputPath(taskIndex, taskType, outputFileName);
      const data = loadJsonFile<Record<string, any>[]>(outputPath) || [];
      return {
        sessionId: sessionId || '',
        output: '',
        success: true,
        timestamp: Date.now(),
        duration: 0,
        data: this.filterDebugData(data, debugMode)
      };
    }

    // 检查是否有 in_progress 的任务需要重新执行
    if (resumePath && this.isTaskInProgress(taskIndex, taskType)) {
      // 恢复 sessionId，确保重新执行时能复用原来的 session
      const sessionId = this.getTaskSessionId(taskIndex);
      if (sessionId) {
        this.currentSessionId = sessionId;
      }
      this.cleanupInProgressTask(taskIndex, taskType);
    }

    const sessionId = await this.getOrCreateSessionIdWithSummarize(options?.newSession, effectiveCwd, effectiveEnv);
    const taskLogDir = this.createTaskLogDir(taskIndex, taskType);
    const outputPath = this.getCollectOutputPath(taskIndex, taskType, outputFileName);
    const useResume = this.shouldUseResume(taskIndex, options?.newSession);

    // 构建完整提示词
    const extraPrompt = this.applyDebugModeHint(
      buildCollectPrompt(outputFormat, outputPath, effectiveCwd),
      debugMode
    );

    const fullPrompt = buildFullPrompt(processedPrompt, extraPrompt);

    this.logger?.logTaskStart(taskIndex, taskType, sessionId);

    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', fullPrompt);
    }

    this.recordTaskStart(taskIndex, `${taskIndex}_collect`, sessionId, taskType, outputFileName);

    const result = await this.executor.execute(fullPrompt, {
      cwd: effectiveCwd,
      env: effectiveEnv,
      sessionId: sessionId,
      useResume,
      taskLogDir,
      logger: this.logger!,
      taskIndex,
      taskType
    });

    this.writeTaskLogs(taskLogDir, result);

    // 在读取 JSON 之前执行 checkPrompt
    if (result.success && options?.checkPrompt && !_isDebugMode()) {
      await this.executeCheckPromptInternal(options.checkPrompt, effectiveCwd, effectiveEnv, sessionId, taskLogDir, taskIndex);
    }

    let data: Record<string, any>[] = [];
    if (result.success && fileExists(outputPath)) {
      data = await this.readJsonWithValidation<Record<string, any>[]>(
        outputPath,
        options,
        { cwd: effectiveCwd, env: effectiveEnv, taskLogDir, taskIndex, taskType },
        {
          validate: (content) => validateJsonArray(content, { format: outputFormat, validateFields: true }),
          expectedFormat: 'array'
        }
      ) || [];
    }

    this.logger?.logTaskComplete(taskIndex, taskType, result.success, result.duration, result.error);

    if (result.success) {
      this.recordTaskComplete(taskIndex, `${taskIndex}_collect`, sessionId, taskType, outputFileName);
    }

    return {
      ...result,
      data: this.filterDebugData(data, debugMode)
    };
  }

  /**
   * 执行检查任务
   * 输出文件名固定为 check_result.json， 存放在 Agent 的 check 目录
   */
  async execCheckPrompt(
    prompt: string,
    options?: ExecOptions
  ): Promise<CheckResult> {
    this.validatePrompt(prompt);

    const effectiveCwd = this.getEffectiveCwd(options?.cwd);
    const effectiveEnv = this.getEffectiveEnv(options?.env);
    const resumePath = _getResumePath();
    const taskType: TaskType = 'check';
    const taskIndex = this.getNextTaskIndex(taskType);

    // 固定的输出文件名
    const outputFileName = 'check_result.json';

    // 处理变量替换
    const processedPrompt = this.processPrompt(prompt, options);

    // 检查是否需要恢复
    if (resumePath && this.isTaskCompleted(taskIndex, taskType)) {
      const sessionId = this.getCompletedSessionId(taskIndex, taskType);
      // 恢复 sessionId，确保后续任务能复用
      if (sessionId) {
        this.currentSessionId = sessionId;
      }
      this.logger?.logTaskSkipped(taskIndex, taskType);

      // 优先从 progress.json 读取 checkResult
      const taskStatus = this.getTaskStatus(taskIndex, taskType);
      let checkResult = taskStatus?.checkResult;

      // 向后兼容：如果 progress.json 中没有，尝试从文件读取
      if (checkResult === undefined) {
        const outputPath = this.getCollectOutputPath(taskIndex, taskType, outputFileName);
        const checkData = loadJsonFile<{ result: boolean }>(outputPath);
        checkResult = checkData?.result ?? false;
      }

      return {
        sessionId: sessionId || '',
        output: '',
        success: true,
        timestamp: Date.now(),
        duration: 0,
        result: checkResult
      };
    }

    // 检查是否有 in_progress 的任务需要重新执行
    if (resumePath && this.isTaskInProgress(taskIndex, taskType)) {
      // 恢复 sessionId，确保重新执行时能复用原来的 session
      const sessionId = this.getTaskSessionId(taskIndex);
      if (sessionId) {
        this.currentSessionId = sessionId;
      }
      this.cleanupInProgressTask(taskIndex, taskType);
    }

    const sessionId = await this.getOrCreateSessionIdWithSummarize(options?.newSession, effectiveCwd, effectiveEnv);
    const taskLogDir = this.createTaskLogDir(taskIndex, taskType);
    const outputPath = this.getCollectOutputPath(taskIndex, taskType, outputFileName);
    const useResume = this.shouldUseResume(taskIndex, options?.newSession);

    // 构建完整提示词
    const extraPrompt = buildCheckPrompt(outputPath, processedPrompt, effectiveCwd);
    const fullPrompt = buildFullPrompt(processedPrompt, extraPrompt);

    this.logger?.logTaskStart(taskIndex, taskType, sessionId);

    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', fullPrompt);
    }

    this.recordTaskStart(taskIndex, `${taskIndex}_check`, sessionId, taskType, outputFileName);

    const result = await this.executor.execute(fullPrompt, {
      cwd: effectiveCwd,
      env: effectiveEnv,
      sessionId: sessionId,
      useResume,
      taskLogDir,
      logger: this.logger!,
      taskIndex,
      taskType
    });

    this.writeTaskLogs(taskLogDir, result);

    // 在读取 check result JSON 之前执行 checkPrompt
    if (result.success && options?.checkPrompt && !_isDebugMode()) {
      await this.executeCheckPromptInternal(options.checkPrompt, effectiveCwd, effectiveEnv, sessionId, taskLogDir, taskIndex);
    }

    let checkResult = false;
    if (result.success && fileExists(outputPath)) {
      const checkData = await this.readJsonWithValidation<{ result: boolean }>(
        outputPath,
        options,
        { cwd: effectiveCwd, env: effectiveEnv, taskLogDir, taskIndex, taskType },
        {
          validate: (content) => validateJsonObject(content, {
            requiredFields: [{ name: 'result', type: 'boolean' }]
          }),
          expectedFormat: 'object'
        }
      );
      checkResult = checkData?.result ?? false;
    }

    this.logger?.logTaskComplete(taskIndex, taskType, result.success, result.duration, result.error);

    if (result.success) {
      this.recordTaskComplete(taskIndex, `${taskIndex}_check`, sessionId, taskType, outputFileName, checkResult);
    }

    return {
      ...result,
      result: checkResult
    };
  }

  /**
   * 执行报告任务
   * 输出到 TaskName 目录的 report/ 子目录
   */
  async execReport(
    prompt: string,
    outputFormat: OutputFormat,
    outputFileName: string,
    options?: ExecOptions
  ): Promise<CollectResult> {
    this.validatePrompt(prompt);
    this.validateOutputFormat(outputFormat, 'execReport');
    this.validateOutputFileName(outputFileName, 'execReport');

    const effectiveCwd = this.getEffectiveCwd(options?.cwd);
    const effectiveEnv = this.getEffectiveEnv(options?.env);
    const resumePath = _getResumePath();
    const debugMode = _isDebugMode();
    const taskType: TaskType = 'report';
    const taskIndex = this.getNextTaskIndex(taskType);

    // 处理变量替换
    const processedPrompt = this.processPrompt(prompt, options);

    // 检查是否需要恢复
    if (resumePath && this.isTaskCompleted(taskIndex, taskType)) {
      const sessionId = this.getCompletedSessionId(taskIndex, taskType);
      // 重要：恢复 sessionId 到 currentSessionId，确保后续任务能复用
      if (sessionId) {
        this.currentSessionId = sessionId;
      }
      this.logger?.logTaskSkipped(taskIndex, taskType);
      const outputPath = this.getReportOutputPath(outputFileName);
      const data = loadJsonFile<Record<string, any>[]>(outputPath) || [];
      return {
        sessionId: sessionId || '',
        output: '',
        success: true,
        timestamp: Date.now(),
        duration: 0,
        data: this.filterDebugData(data, debugMode)
      };
    }

    // 检查是否有 in_progress 的任务需要重新执行
    if (resumePath && this.isTaskInProgress(taskIndex, taskType)) {
      // 恢复 sessionId，确保重新执行时能复用原来的 session
      const sessionId = this.getTaskSessionId(taskIndex);
      if (sessionId) {
        this.currentSessionId = sessionId;
      }
      this.cleanupInProgressTask(taskIndex, taskType);
    }

    const sessionId = await this.getOrCreateSessionIdWithSummarize(options?.newSession, effectiveCwd, effectiveEnv);
    const taskLogDir = this.createTaskLogDir(taskIndex, taskType);
    const outputPath = this.getReportOutputPath(outputFileName);
    const useResume = this.shouldUseResume(taskIndex, options?.newSession);

    // 构建完整提示词
    const extraPrompt = this.applyDebugModeHint(
      buildReportPrompt(outputFormat, outputPath, effectiveCwd),
      debugMode
    );

    const fullPrompt = buildFullPrompt(processedPrompt, extraPrompt);

    this.logger?.logTaskStart(taskIndex, taskType, sessionId);

    if (taskLogDir) {
      this.logger?.writeTaskLog(taskLogDir, 'prompt.txt', fullPrompt);
    }

    this.recordTaskStart(taskIndex, `${taskIndex}_report`, sessionId, taskType, outputFileName);

    const result = await this.executor.execute(fullPrompt, {
      cwd: effectiveCwd,
      env: effectiveEnv,
      sessionId: sessionId,
      useResume,
      taskLogDir,
      logger: this.logger!,
      taskIndex,
      taskType
    });

    this.writeTaskLogs(taskLogDir, result);

    // 在读取 JSON 之前执行 checkPrompt
    if (result.success && options?.checkPrompt && !_isDebugMode()) {
      await this.executeCheckPromptInternal(options.checkPrompt, effectiveCwd, effectiveEnv, sessionId, taskLogDir, taskIndex);
    }

    let data: Record<string, any>[] = [];
    if (result.success && fileExists(outputPath)) {
      data = await this.readJsonWithValidation<Record<string, any>[]>(
        outputPath,
        options,
        { cwd: effectiveCwd, env: effectiveEnv, taskLogDir, taskIndex, taskType },
        {
          validate: (content) => validateJsonArray(content, { format: outputFormat, validateFields: true }),
          expectedFormat: 'array'
        }
      ) || [];
    }

    this.logger?.logTaskComplete(taskIndex, taskType, result.success, result.duration, result.error);

    if (result.success) {
      this.recordTaskComplete(taskIndex, `${taskIndex}_report`, sessionId, taskType, outputFileName);
    }

    return {
      ...result,
      data: this.filterDebugData(data, debugMode)
    };
  }

  /**
   * 获取 Agent 目录
   */
  getAgentDir(): string {
    return this.agentDir;
  }

  /**
   * 获取任务目录
   */
  getTaskDir(): string {
    return this.taskDir;
  }

  /**
   * 获取当前任务计数
   */
  getTaskCounter(): number {
    return this.taskCounter;
  }

  /**
   * 用户主动调用的总结方法
   * 用于在最后一个任务完成后，总结当前 session
   */
  async summarize(options?: SummarizeOptions): Promise<SummarizeResult> {
    if (!this.currentSessionId) {
      throw new Error('错误: 没有活动的 session，无法总结');
    }

    const effectiveCwd = this.getEffectiveCwd(options?.cwd);
    const effectiveEnv = this.getEffectiveEnv(options?.env);
    const startTime = Date.now();
    const sessionId = this.currentSessionId;

    // 获取任务序号（总结不增加 taskIndex）
    const taskIndex = this.taskCounter + 1;
    const timestamp = this.formatTimestamp(new Date());
    const logDirName = `summarize_${timestamp}`;

    // 创建日志目录
    const logDir = this.logger?.createTaskLogDirByName(logDirName) || '';

    // 获取技能文件目录
    const skillsDir = this.getSkillsDir(effectiveCwd);

    // 构建总结提示词（支持自定义）
    const summarizePrompt = options?.customPrompt
      ? options.customPrompt
      : buildSummarizePrompt(skillsDir);

    this.logger?.logTaskStart(taskIndex, 'summarize', sessionId);

    if (logDir) {
      this.logger?.writeTaskLog(logDir, 'prompt.txt', summarizePrompt);
    }

    let result: ExecutionResult;
    try {
      await this.executor.execute(summarizePrompt, {
        cwd: effectiveCwd,
        env: effectiveEnv,
        sessionId: sessionId,
        useResume: true,
        taskLogDir: logDir,
        logger: this.logger!,
        taskIndex,
        taskType: 'summarize'
      });

      result = {
        sessionId,
        output: '',
        success: true,
        timestamp: Date.now(),
        duration: Date.now() - startTime
      };

      this.logger?.logTaskComplete(taskIndex, 'summarize', true, result.duration);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      result = {
        sessionId,
        output: '',
        success: false,
        error: errorMsg,
        timestamp: Date.now(),
        duration: Date.now() - startTime
      };

      if (logDir) {
        this.logger?.writeTaskLog(logDir, 'error.txt', errorMsg);
      }

      this.logger?.logTaskComplete(taskIndex, 'summarize', false, result.duration, errorMsg);
    }

    // 查找生成的 Skill 文件
    const skillFiles = this.findGeneratedSkillFiles(effectiveCwd);

    return {
      ...result,
      skillFiles
    };
  }
}
