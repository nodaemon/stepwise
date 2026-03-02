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
  } catch {
    return null;
  }
}

/**
 * 追加合并 JSON 数组并去重
 * @param filePath 目标文件路径
 * @param newData 新数据数组
 * @param primaryKey 主键，用于去重
 * @returns 合并后的数组
 */
export function appendJsonArray(
  filePath: string,
  newData: Record<string, any>[],
  primaryKey?: string
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

  // 去重
  if (primaryKey) {
    const seen = new Map<string, Record<string, any>>();
    // 从后往前遍历，保留最新的数据
    for (let i = combinedData.length - 1; i >= 0; i--) {
      const item = combinedData[i];
      const keyValue = item[primaryKey];
      if (keyValue !== undefined && !seen.has(String(keyValue))) {
        seen.set(String(keyValue), item);
      }
    }
    const uniqueData = Array.from(seen.values()).reverse();
    saveJsonFile(filePath, uniqueData);
    return uniqueData;
  }

  saveJsonFile(filePath, combinedData);
  return combinedData;
}

/**
 * 检查文件是否存在
 */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}