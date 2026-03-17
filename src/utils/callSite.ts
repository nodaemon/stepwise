/**
 * 调用位置获取工具
 * 使用 Error.stack 解析调用栈（已通过 source-map-support 映射）
 */

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