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
 * @param outputFileName 输出文件名
 * @returns 额外提示词
 */
export function buildCollectPrompt(
  outputFormat: OutputFormat,
  outputFileName: string
): string {
  const keyDescriptions = outputFormat.keys
    .map((key) => `- ${key.name}: ${key.description} (类型: ${key.type})`)
    .join('\n');

  const requirements: string[] = [
    '1. 输出 JSON 数组格式',
    '2. 如果文件已存在，追加新数据到文件中',
    '3. 确保 JSON 格式正确',
    '4. 请直接将数据写入文件，不需要在回复中展示完整数据'
  ];

  if (outputFormat.primaryKey) {
    requirements.push(`5. 对于 ${outputFormat.primaryKey} 相同的数据需要去重，保留最新的数据`);
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
 * @param outputFileName 输出文件名
 * @returns 额外提示词
 */
export function buildReportPrompt(
  outputFormat: OutputFormat,
  outputFileName: string
): string {
  const keyDescriptions = outputFormat.keys
    .map((key) => `- ${key.name}: ${key.description} (类型: ${key.type})`)
    .join('\n');

  const requirements: string[] = [
    '1. 输出 JSON 数组格式',
    '2. 如果文件已存在，追加新数据到文件中',
    '3. 确保 JSON 格式正确',
    '4. 请直接将数据写入文件，不需要在回复中展示完整数据',
    '5. 报告内容应简洁、准确、有参考价值'
  ];

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
 * 构建完整的提示词
 * @param originalPrompt 原始提示词
 * @param extraPrompt 额外提示词
 * @returns 完整提示词
 */
export function buildFullPrompt(originalPrompt: string, extraPrompt: string): string {
  return `${originalPrompt}\n\n---\n\n${extraPrompt}`;
}