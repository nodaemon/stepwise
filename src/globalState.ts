/**
 * 全局状态管理模块
 * 内部维护 taskName、resumePath、debugMode、已注册的名字列表
 */
import * as path from 'path';
import * as fs from 'fs';
import { appendJsonArray, loadJsonFile } from './utils/fileHelper';

/** 全局状态 */
interface GlobalState {
  /** 任务名称 */
  taskName: string;
  /** 恢复路径 */
  resumePath: string;
  /** 调试模式 */
  debugMode: boolean;
  /** 已注册的 StepWise 名字列表 */
  registeredNames: Set<string>;
  /** 任务目录时间戳（第一个 StepWise 创建时设置） */
  taskDirTimestamp: string;
  /** 是否已打印启动信息 */
  hasPrintedStartup: boolean;
}

/** 全局状态实例 */
const globalState: GlobalState = {
  taskName: '',
  resumePath: '',
  debugMode: false,
  registeredNames: new Set<string>(),
  taskDirTimestamp: '',
  hasPrintedStartup: false
};

/**
 * 设置任务名称
 * 基于任务名称加时间生成任务目录
 */
export function setTaskName(taskName: string): void {
  if (!taskName || taskName.trim() === '') {
    console.error('[错误] TaskName 不能为空');
    process.exit(1);
  }

  const trimmedName = taskName.trim();

  // 检查名字是否重复（TaskName 和 StepWise Name 全局不能重复）
  if (globalState.registeredNames.has(trimmedName)) {
    console.error(`[错误] 名字重复: "${trimmedName}"`);
    console.error('已存在重复的名字，请使用不同的名字区分');
    process.exit(1);
  }

  // 注册 TaskName
  globalState.registeredNames.add(trimmedName);
  globalState.taskName = trimmedName;
}

/**
 * 设置恢复路径
 * 从指定任务目录恢复执行
 */
export function setResumePath(resumePath: string): void {
  globalState.resumePath = resumePath.trim();
}

/**
 * 启用/禁用调试模式
 * 调试模式打开后，所有收集任务执行完成以后，在返回给用户前只返回第一个数据
 */
export function enableDebugMode(enabled: boolean = true): void {
  globalState.debugMode = enabled;
}

/**
 * 保存收集的数据到磁盘（存储在当前工作目录cwd）
 */
export function saveCollectData(data: Record<string, any>[], fileName: string = 'collect_data.json'): void {
  const outputPath = path.join(process.cwd(), fileName);
  appendJsonArray(outputPath, data);
}

/**
 * 从磁盘加载收集的数据（从当前工作目录cwd读取）
 */
export function loadCollectData(fileName: string = 'collect_data.json'): Record<string, any>[] {
  const filePath = path.join(process.cwd(), fileName);
  const data = loadJsonFile<Record<string, any>[]>(filePath);
  return data || [];
}

// ========== 内部函数（不对外导出，供 StepWise 类使用） ==========

/**
 * 获取任务名称
 * @internal
 */
export function _getTaskName(): string {
  return globalState.taskName;
}

/**
 * 获取恢复路径
 * @internal
 */
export function _getResumePath(): string {
  return globalState.resumePath;
}

/**
 * 获取调试模式状态
 * @internal
 */
export function _isDebugMode(): boolean {
  return globalState.debugMode;
}

/**
 * 注册 StepWise 名字
 * @returns true 表示注册成功，false 表示名字已存在
 * @internal
 */
export function _registerName(name: string): boolean {
  if (globalState.registeredNames.has(name)) {
    return false;
  }
  globalState.registeredNames.add(name);
  return true;
}

/**
 * 检查名字是否已注册
 * @internal
 */
export function _isNameRegistered(name: string): boolean {
  return globalState.registeredNames.has(name);
}

/**
 * 设置任务目录时间戳
 * @internal
 */
export function _setTaskDirTimestamp(timestamp: string): void {
  globalState.taskDirTimestamp = timestamp;
}

/**
 * 获取任务目录时间戳
 * @internal
 */
export function _getTaskDirTimestamp(): string {
  return globalState.taskDirTimestamp;
}

/**
 * 检查是否已打印启动信息
 * @internal
 */
export function _hasPrintedStartup(): boolean {
  return globalState.hasPrintedStartup;
}

/**
 * 标记已打印启动信息
 * @internal
 */
export function _markPrintedStartup(): void {
  globalState.hasPrintedStartup = true;
}

/**
 * 重置全局状态（仅用于测试）
 * @internal
 */
export function _resetState(): void {
  globalState.taskName = '';
  globalState.resumePath = '';
  globalState.debugMode = false;
  globalState.registeredNames.clear();
  globalState.taskDirTimestamp = '';
  globalState.hasPrintedStartup = false;
}
