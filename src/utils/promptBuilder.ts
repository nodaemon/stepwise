import { OutputFormat } from '../types';

/**
 * 替换提示词中的变量
 * @param prompt 提示词模板
 * @param data 数据对象
 * @returns 替换后的提示词
 */
export function replaceVariables(prompt: string, data: Record<string, any>): string {
  return prompt.replace(/\$(\w+)/g, (match, key) => {
    if (key in data) {
      const value = data[key];
      if (typeof value === 'object') {
        return JSON.stringify(value, null, 2);
      }
      return String(value);
    }
    return match;
  });
}

/**
 * 构建收集任务的额外提示词
 * @param outputFormat 输出格式
 * @param outputFileName 输出文件名（应为绝对路径）
 * @param cwd Claude 命令执行的工作目录
 * @returns 额外提示词
 */
export function buildCollectPrompt(
  outputFormat: OutputFormat,
  outputFileName: string,
  cwd?: string
): string {
  const keyDescriptions = outputFormat.keys
    .map((key) => `- ${key.name}: ${key.description} (类型: ${key.type})`)
    .join('\n');

  const requirements: string[] = [
    '1. 输出 JSON 数组格式',
    '2. 如果文件已存在，追加新数据到文件中',
    '3. 确保 JSON 格式正确',
    '4. 请直接将数据写入文件，不需要在回复中展示完整数据',
    '5. 写入完成后验证json文件格式的正确性'
  ];

  // 当 cwd 和 process.cwd() 不一致时，添加明确说明
  const dirWarning = getDirWarning(cwd, outputFileName);
  if (dirWarning) {
    requirements.push(dirWarning);
  }

  if (outputFormat.primaryKey) {
    requirements.push(`6. 对于 ${outputFormat.primaryKey} 相同的数据需要去重，保留最新的数据`);
  }

  return `
请按照以下格式输出数据，并写入到 ${outputFileName} 文件中：

输出格式说明：
${keyDescriptions}

要求：
${requirements.join('\n')}
`;
}

/**
 * 构建报告任务的额外提示词
 * @param outputFormat 输出格式
 * @param outputFileName 输出文件名（应为绝对路径）
 * @param cwd Claude 命令执行的工作目录
 * @returns 额外提示词
 */
export function buildReportPrompt(
  outputFormat: OutputFormat,
  outputFileName: string,
  cwd?: string
): string {
  const keyDescriptions = outputFormat.keys
    .map((key) => `- ${key.name}: ${key.description} (类型: ${key.type})`)
    .join('\n');

  const requirements: string[] = [
    '1. 输出 JSON 数组格式',
    '2. 如果文件已存在，追加新数据到文件中',
    '3. 确保 JSON 格式正确',
    '4. 请直接将数据写入文件，不需要在回复中展示完整数据',
    '5. 写入完成后验证json文件格式的正确性'
  ];

  // 当 cwd 和 process.cwd() 不一致时，添加明确说明
  const dirWarning = getDirWarning(cwd, outputFileName);
  if (dirWarning) {
    requirements.push(dirWarning);
  }

  if (outputFormat.primaryKey) {
    requirements.push(`6. 对于 ${outputFormat.primaryKey} 相同的数据需要去重，保留最新的数据`);
  }

  return `
请按照以下格式输出报告数据，并写入到 ${outputFileName} 文件中：

输出格式说明：
${keyDescriptions}

要求：
${requirements.join('\n')}
`;
}

/**
 * 获取目录警告信息
 * 当 cwd 和输出文件所在目录不一致时，生成明确提示
 */
function getDirWarning(cwd?: string, outputFileName?: string): string | null {
  if (!cwd || !outputFileName) return null;

  // 判断输出文件是否在 cwd 目录下
  const isInCwd = outputFileName.startsWith(cwd);
  const processCwd = process.cwd();
  const isInProcessCwd = outputFileName.startsWith(processCwd);

  // 如果 cwd 和 process.cwd() 不一致，且文件路径是基于 process.cwd() 的
  if (cwd !== processCwd && isInProcessCwd && !isInCwd) {
    return `5. 注意：虽然 Claude 命令在 "${cwd}" 目录下执行，但输出文件必须写入到 "${outputFileName}"，我需要在其他目录中使用！`;
  }

  return null;
}

/**
 * 构建检查任务的额外提示词
 * @param outputFileName 输出文件名（应为绝对路径）
 * @param checkQuestion 检查问题描述
 * @param cwd Claude 命令执行的工作目录
 * @returns 额外提示词
 */
export function buildCheckPrompt(
  outputFileName: string,
  checkQuestion: string,
  cwd?: string
): string {
  const requirements: string[] = [
    '1. 输出 JSON 格式',
    '2. 如果文件已存在，覆盖文件内容',
    '3. 确保 JSON 格式正确',
    '4. 请直接将结果写入文件，不需要在回复中展示'
  ];

  // 当 cwd 和 process.cwd() 不一致时，添加明确说明
  const dirWarning = getDirWarning(cwd, outputFileName);
  if (dirWarning) {
    requirements.push(dirWarning);
  }

  return `
请检查以下问题，并将结果写入到 ${outputFileName} 文件中：

检查问题：${checkQuestion}

输出格式：
{
  "result": true 或 false
}

要求：
${requirements.join('\n')}
`;
}

/**
 * 构建完整的提示词
 * @param originalPrompt 原始提示词
 * @param extraPrompt 额外提示词
 * @returns 完整提示词
 */
export function buildFullPrompt(originalPrompt: string, extraPrompt: string): string {
  return `${originalPrompt}\n\n---\n\n${extraPrompt}`;
}