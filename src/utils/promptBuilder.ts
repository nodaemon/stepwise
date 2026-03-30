import { OutputFormat, PropertyDef } from '../types';
import { buildJsonSchema, getFirstRequiredField } from './schemaUtils';

/**
 * 根据字段类型生成示例值
 * @param type 字段类型
 * @returns JSON 格式的示例值字符串
 */
function getExampleValue(type: string): string {
  switch (type) {
    case 'string':
      return '"示例文本"';
    case 'number':
      return '123';
    case 'boolean':
      return 'true';
    case 'object':
      return '{}';
    case 'array':
      return '[]';
    default:
      return '""';
  }
}

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
 * 构建数组输出任务的公共提示词
 * @param outputFormat 输出格式（直接是 Record<string, PropertyDef>）
 * @param outputFileName 输出文件名（应为绝对路径）
 * @param cwd Claude 命令执行的工作目录
 * @param introText 开头引导文案
 * @returns 额外提示词
 */
function buildArrayOutputPrompt(
  outputFormat: OutputFormat,
  outputFileName: string,
  cwd: string | undefined,
  introText: string
): string {
  // 生成 JSON Schema
  const schema = buildJsonSchema(outputFormat);
  const dedupeKey = getFirstRequiredField(outputFormat);

  // 生成示例
  const exampleItem = Object.entries(outputFormat)
    .map(([name, def]) => {
      const exampleValue = getExampleValue(def.type);
      return `    "${name}": ${exampleValue}`;
    })
    .join(',\n');

  // 生成字段说明
  const keyDescriptions = Object.entries(outputFormat)
    .map(([name, def]) => {
      const required = def.required !== false ? '(必填)' : '(可选)';
      return `  "${name}": <${def.description || name}> ${required}`;
    })
    .join(',\n');

  const requirements: string[] = [
    '1. 必须输出 JSON 对象数组格式（见下方 JSON Schema）',
    '2. 如果文件已存在，读取现有数组，将新数据追加到数组末尾，然后写入完整的数组',
    '3. 确保 JSON 格式正确，数组必须是合法的 JSON',
    '4. 请直接将数据写入文件，不需要在回复中展示完整数据',
    '5. 写入完成后使用 Read 工具验证文件内容是否为合法的 JSON 数组'
  ];

  // 当 cwd 和 process.cwd() 不一致时，添加明确说明
  const dirWarning = getDirWarning(cwd, outputFileName);
  if (dirWarning) {
    requirements.push(dirWarning);
  }

  // 去重要求
  if (dedupeKey) {
    requirements.push(`6. "${dedupeKey}" 字段值不能重复，如果发现重复请保留最新数据`);
  }

  return `
${introText}，并写入到 ${outputFileName} 文件中：

## 输出格式（JSON Schema）

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

## 示例数据

\`\`\`json
[
  {
${exampleItem}
  }
]
\`\`\`

每个对象的字段说明：
{
${keyDescriptions}
}

## 禁止的格式

**特别注意：不要使用嵌套结构！**

以下格式是错误的，绝对不要输出：
- ❌ 嵌套对象：\`{"data": [...]}\`、\`{"items": [...]}\`、\`{"results": [...]}\`
- ❌ 单个对象：\`{"name": "xxx"}\`
- ❌ 多个 JSON 拼接：\`{}\\n{}\`
- ❌ 带 markdown 代码块标记

**正确做法**：直接输出数组 \`[{...}, {...}]\`，不要包裹在任何对象中

## 要求

${requirements.join('\n')}
`;
}

/**
 * 构建收集任务的额外提示词
 * @param outputFormat 输出格式（直接是 Record<string, PropertyDef>）
 * @param outputFileName 输出文件名（应为绝对路径）
 * @param cwd Claude 命令执行的工作目录
 * @returns 额外提示词
 */
export function buildCollectPrompt(
  outputFormat: OutputFormat,
  outputFileName: string,
  cwd?: string
): string {
  return buildArrayOutputPrompt(outputFormat, outputFileName, cwd, '请按照以下格式输出数据');
}

/**
 * 构建报告任务的额外提示词
 * @param outputFormat 输出格式（直接是 Record<string, PropertyDef>）
 * @param outputFileName 输出文件名（应为绝对路径）
 * @param cwd Claude 命令执行的工作目录
 * @returns 额外提示词
 */
export function buildReportPrompt(
  outputFormat: OutputFormat,
  outputFileName: string,
  cwd?: string
): string {
  return buildArrayOutputPrompt(outputFormat, outputFileName, cwd, '请按照以下格式输出报告数据');
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
 * 构建 postCheck 任务的额外提示词
 * @param outputFileName 输出文件名（应为绝对路径）
 * @param postCheckPrompt 检查问题提示词（已处理变量替换）
 * @param cwd Claude 命令执行的工作目录
 * @returns 额外提示词
 */
export function buildPostCheckPrompt(
  outputFileName: string,
  postCheckPrompt: string,
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

检查问题：${postCheckPrompt}

输出格式：
{
  "result": true 或 false
}

要求：
${requirements.join('\n')}
`;
}

/**
 * 构建文件缺失修复提示词
 * @param outputPath 预期的输出文件路径
 * @param expectedFormat 期望的 JSON 格式类型
 * @returns 修复提示词
 */
export function buildFileMissingPrompt(
  outputPath: string,
  expectedFormat: 'array' | 'object'
): string {
  const formatExample = expectedFormat === 'array'
    ? '[\n  { "field1": "value1", "field2": "value2" },\n  { "field1": "value3", "field2": "value4" }\n]'
    : '{ "result": true }';

  return `预期的输出文件不存在，请将结果写入正确路径：

## 问题
文件 ${outputPath} 不存在。你需要将结果数据写入到这个路径。

## 正确格式示例
\`\`\`json
${formatExample}
\`\`\`

## 写入要求
1. 将结果写入文件 ${outputPath}
2. 确保输出为标准 JSON 格式
3. 不要使用嵌套结构
4. 写入完成后使用 Read 工具验证文件内容`;
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

/**
 * 构建总结任务的提示词
 * @param skillsDir 技能文件存储目录
 * @returns 总结提示词
 */
export function buildSummarizePrompt(skillsDir: string): string {
  return `请回顾当前会话中的所有工作，总结有价值的技能和经验。

## 重要原则

**质量优于数量**：如果没有真正有价值的经验需要总结，直接回复"本次会话无需总结"并结束，不要强行创建无意义的 Skill 文件。过多低质量的 Skill 文件反而会干扰后续工作。

## 什么值得总结

只有以下情况才值得创建 Skill 文件：
1. **错误处理和解决方案**：经过多次尝试才解决的复杂问题、发现的非显而易见的错误模式
2. **通用工作流程**：可复用且非显而易见的操作步骤、项目特定的最佳实践
3. **项目特定知识**：容易遗忘或踩坑的项目配置、约定等

## 什么不值得总结

- 简单操作或一次成功的任务
- 通用编程知识（除非有项目特定的坑点）
- 常规的代码编写过程
- 没有遇到任何问题的顺利流程

## 输出要求

将识别出的每个技能保存为独立的 Skill 文件：
- 存储路径：${skillsDir}/[skill_name]/SKILL.md
- 命名规范：使用英文小写和下划线，如 \`handle_api_retry\`、\`setup_test_env\`

## SKILL.md 文件格式（内容用中文）

\`\`\`markdown
# [技能名称]

## 描述
[一句话描述该技能解决的问题]

## 使用场景
- 场景1：[描述]
- 场景2：[描述]

## 执行步骤
1. [第一步]
2. [第二步]
3. ...
\`\`\`

## 更新策略

如果 \`${skillsDir}\` 目录下已存在类似的 Skill 文件，请更新现有文件而不是创建新的。更新时合并新的经验和步骤。

请现在开始回顾会话内容，如果没有值得总结的内容请直接说明，否则生成 Skill 文件。`;
}