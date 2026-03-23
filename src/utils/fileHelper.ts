import * as fs from 'fs';
import * as path from 'path';

/**
 * 确保目录存在
 */
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 保存 JSON 文件
 */
export function saveJsonFile(filePath: string, data: any): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 加载 JSON 文件
 */
export function loadJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.warn(`[fileHelper] JSON 解析失败: ${filePath}\n错误: ${errorMsg}`);
    return null;
  }
}

/**
 * 追加合并 JSON 数组
 * @param filePath 目标文件路径
 * @param newData 新数据数组
 * @returns 合并后的数组
 */
export function appendJsonArray(
  filePath: string,
  newData: Record<string, any>[]
): Record<string, any>[] {
  let existingData: Record<string, any>[] = [];

  // 读取现有数据
  if (fs.existsSync(filePath)) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      existingData = JSON.parse(content);
      if (!Array.isArray(existingData)) {
        existingData = [];
      }
    } catch {
      existingData = [];
    }
  }

  // 合并数据
  const combinedData = [...existingData, ...newData];

  saveJsonFile(filePath, combinedData);
  return combinedData;
}

/**
 * 检查文件是否存在
 */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}