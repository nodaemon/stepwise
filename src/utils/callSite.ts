/**
 * 调用位置获取工具
 * 使用 Error.stack 解析调用栈（已通过 source-map-support 映射）
 */

import * as path from 'path';

// 获取 stepwise 包的根目录（callSite.ts 所在目录的上级）
const STEPWISE_ROOT = path.resolve(__dirname, '..', '..');

/**
 * 检查文件路径是否在 stepwise 包内
 */
function isStepwiseInternal(filePath: string): boolean {
  const absolutePath = path.resolve(filePath);
  return absolutePath.startsWith(STEPWISE_ROOT);
}

/**
 * 获取用户代码的调用位置
 * 跳过所有 stepwise 包内部的栈帧，返回第一个外部调用位置
 * @returns 格式为 "文件名:行号" 的字符串
 */
export function getUserCallSite(): string {
  const stack = new Error().stack;
  if (!stack) return 'unknown:0';

  const lines = stack.split('\n');

  for (let i = 3; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/\((.+):(\d+):\d+\)/) || line.match(/at (.+):(\d+):\d+/);

    if (match) {
      const filePath = match[1];
      const lineNum = match[2];
      const fileName = filePath.split('/').pop() || filePath;

      // 检查是否在 stepwise 包内
      if (!isStepwiseInternal(filePath)) {
        return `${fileName}:${lineNum}`;
      }
    }
  }

  // 如果找不到外部调用，回退到原有逻辑
  return getCallSite(2);
}

/**
 * 获取调用者的文件名和行号
 * @param skipFrames 跳过的栈帧数，默认 0
 * @returns 格式为 "文件名:行号" 的字符串
 */
export function getCallSite(skipFrames: number = 0): string {
  const stack = new Error().stack;
  if (!stack) return 'unknown:0';

  const lines = stack.split('\n');
  // 栈帧结构：
  // 0: Error
  // 1: getCallSite
  // 2: trackPerformance (装饰器)
  // 3: 实际调用者
  const targetIndex = 3 + skipFrames;

  if (targetIndex >= lines.length) return 'unknown:0';

  const line = lines[targetIndex];

  // 尝试匹配不同的栈帧格式
  // 格式1: "    at Object.method (file:line:col)"
  // 格式2: "    at file:line:col"
  const match = line.match(/\((.+):(\d+):\d+\)/) || line.match(/at (.+):(\d+):\d+/);

  if (match) {
    const filePath = match[1];
    const lineNum = match[2];
    // 只取文件名，不包含完整路径
    const fileName = filePath.split('/').pop() || filePath;
    return `${fileName}:${lineNum}`;
  }

  return 'unknown:0';
}