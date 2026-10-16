import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { OutputFormat, PropertyDef, JsonSchemaDef } from '../types';
import { buildJsonSchema, getFirstRequiredField, expandRefs } from './schemaUtils';
import { generateSchemaExample } from './validator';

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
${JSON.stringify(schema)}
\`\`\`

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

/**
 * 构建自检复盘提示词
 *
 * 该提示词运行在一个**全新会话**中：审查者没有参与被审查的执行，也没有相关记忆，
 * 只能依据传入的三个证据文件作判断。因此措辞不能出现「回顾你刚才的工作」这类
 * 依赖记忆的表述，必须显式声明「你没有任何记忆」，把判断锚定回文件。
 *
 * @param params 工作流名称、步骤标识与三个证据文件、报告的绝对路径
 * @returns 完整提示词
 */
export function buildSelfCheckPrompt(params: {
  taskName: string;
  stepLabel: string;
  taskIndex: number;
  promptFilePath: string;
  outputFilePath: string;
  traceFilePath: string;
  reportPath: string;
}): string {
  const { taskName, stepLabel, taskIndex, promptFilePath, outputFilePath, traceFilePath, reportPath } = params;

  return `你是一位独立的质量审查者。下面是一个 AI 工作流中刚执行完的一步任务，以及它的完整执行记录。

你没有参与这次执行，也没有任何关于它的记忆。请**仅依据下面三个文件**作出判断，不要依据任何推测。

## 待审步骤

- 工作流名称：${taskName}
- 步骤类型：${stepLabel}（任务序号 ${taskIndex}）

## 输入文件（必须读取后才能作答）

1. 本步骤收到的完整提示词：${promptFilePath}
2. 本步骤的最终输出：${outputFilePath}
3. 本步骤的完整执行轨迹（思考过程 / 工具调用 / 工具返回）：${traceFilePath}

读取方式：

- 文件 1、文件 2 体积小，请完整读取
- 文件 3 可能很大：先用 Grep 定位关键片段（如 \`[Thinking]\`、以 \`[\` 开头的工具调用段、\`[Tool Result]\`），需要更多上下文时再用 Read 的 offset/limit 分段读取
- 若文件 3 为空或不存在，说明该步骤没有留下可用的过程记录：此时只依据文件 1 和文件 2 判断，并在报告中注明「执行轨迹不可用，维度四未审查」

**文件里没有的信息，一律视为「无法确认」，不要推测。**

## 复盘原则

只写你在证据中确实看到的问题。四个维度都可能没有问题——没问题的维度整节省略，连标题都不要写。

不要为了填满四个维度而编造内容。找不到证据支撑的判断，直接不写。四个维度都没有问题时，只写一行：\`本次执行未发现需要改进的问题。\`

## 维度一：目标是否清晰明确

**计入标准**：任务目标存在歧义、可被合理理解为两种以上做法；或验收标准缺失，导致执行者必须自行猜测「做到什么程度算完成」。

**不计入**：换个说法会更好听；风格偏好；对框架自动生成的指令有意见（见下方「不要计入的问题」）。

**证据要求**：从文件 1 逐字引用能证明存在歧义的那句话。

## 维度二：输入信息是否缺失

**计入标准**：为了完成任务，执行者不得不**自己假设**某个信息，而这个假设影响了最终产出。

**不计入**：「再多给点上下文会更好」这类泛泛之谈；执行者实际没有用到的信息。

**证据要求**：指出文件 1 中**没有**说明该信息的位置，并引用文件 3 中执行者绕开这个空缺的做法（说明这个空缺真实存在）。

## 维度三：输入信息是否冗余

**计入标准**：文件 1 中存在与本次目标无关、重复、或互相冲突的内容，且它实际消耗了注意力或误导了判断。

**不计入**：内容虽长但确实被用到的部分；框架自动注入的内容（见下方）。

**证据要求**：从文件 1 逐字引用你认为冗余的片段。

## 维度四：工具调用与思考是否走了弯路

**计入标准**：文件 3 中真实发生过的返工——走错方向后回头、反复读取同一文件、工具选错、命令失败后重试、因前一步理解错误而连锁返工。

**不计入**：正常的信息收集过程；一次成功就直接完成的操作。

**证据要求**：引用**连续片段**（通常是一个工具调用加上它的返回），让人能看出「这里本可以不走弯路」。孤立地引用一个失败结果无法证明存在弯路。

**建议要求**：每条弯路都要给出**下次遇到同类情况可以直接照做的具体动作**，而不是「下次小心一点」。

## 不要计入的问题

以下内容由框架自动生成，**不是**工作流编写者的问题，请勿写进报告：

- 文件 1 中由 \`---\` 分隔线隔开的框架注入段落（文件访问白名单、输出格式 / JSON Schema、调试模式说明等）
- 工具返回内容被截断

## 证据要求（硬性）

每一条结论都必须附带从上述文件中**逐字复制**的原文片段，放在代码块里，并注明来自哪个文件。

无法定位到原文的判断，说明你无法确认，不要写进报告。

## 禁止事项

- 不要修改任何代码或数据文件，本次只做复盘
- 不要输出与本次执行无关的通用最佳实践（例如「应该注意代码质量」）
- 不要复述任务内容，不要撰写总结段落

## 输出

将报告写入：${reportPath}

报告使用 Markdown，首行为标题 \`# 自检复盘：${stepLabel}（任务 ${taskIndex}）\`，
按需包含下列小节，每条问题按下述格式书写：

\`\`\`markdown
## 目标清晰度

### [严重级：高 | 中 | 低] 一句话问题标题
- **现象**：实际发生了什么
- **证据**（来自 提示词 / 输出 / 执行轨迹）：
  \`\`\`
  逐字引用的原文片段
  \`\`\`
- **影响**：这个问题会如何影响结果
- **建议**：工作流编写者可以怎样改进提示词（维度一/二/三）
           或下次同类任务可以怎样做得更好（维度四）
\`\`\`

四个维度都没有问题时，文件中只写一行 \`本次执行未发现需要改进的问题。\`

完成后回复一句简短的完成说明即可。`;
}

/**
 * 规范化路径数组
 * 仅手动处理 ~（os.homedir()），其余交给 path.resolve()
 * 设置时校验：不合法路径仅警告跳过，不抛异常
 */
export function normalizePaths(paths: string[], cwd?: string): string[] {
  if (!paths || paths.length === 0) return [];

  const result: string[] = [];
  const seen = new Set<string>();

  for (let p of paths) {
    if (!p || p.trim() === '') continue;

    // 仅 ~ 需要手动处理（shell 语法，path.resolve 不识别）
    if (p.startsWith('~')) {
      p = path.join(os.homedir(), p.slice(1));
    }

    // path.resolve 一步处理：相对路径、..、./ → 绝对路径
    const resolved = path.resolve(cwd || process.cwd(), p);

    // 存在时解析符号链接，不存在时直接使用
    const normalized = fs.existsSync(resolved)
      ? fs.realpathSync(resolved)
      : resolved;

    // 校验绝对路径
    if (!path.isAbsolute(normalized)) {
      console.warn(`[StepWise] 路径校验失败: "${p}" → "${normalized}"，已跳过`);
      continue;
    }

    // 去重
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

/**
 * 合并全局和步骤级别的路径配置
 * 步骤指定 → 覆盖全局；未指定 → 继承全局
 */
export function mergePaths(
  global?: string[],
  step?: string[]
): string[] | undefined {
  if (step !== undefined) return step;
  return global;
}

/**
 * 构建文件访问限制的提示词（中文）
 * 只有配置了限制时才生成提示词
 */
export function buildFileAccessPrompt(
  allowRead?: string[],
  allowWrite?: string[]
): string | null {
  if (allowRead === undefined && allowWrite === undefined) return null;

  const lines: string[] = [];
  lines.push('[严格文件访问策略 - 必须遵守]');
  lines.push('');

  if (allowRead !== undefined && allowRead.length > 0) {
    lines.push('允许读取的目录（只能读取以下路径中的文件）:');
    for (const dir of allowRead) {
      lines.push(`  - ${dir}`);
    }
    lines.push('');
  }

  if (allowWrite !== undefined && allowWrite.length > 0) {
    lines.push('允许写入的目录（只能写入/创建/修改以下路径中的文件）:');
    for (const dir of allowWrite) {
      lines.push(`  - ${dir}`);
    }
    lines.push('');
  }

  lines.push('重要约束:');
  if (allowRead !== undefined) {
    if (allowRead.length > 0) {
      lines.push('- 禁止读取上述目录以外的任何文件');
    } else {
      lines.push('- 禁止读取任何文件（读取权限被完全限制）');
    }
  }
  if (allowWrite !== undefined) {
    if (allowWrite.length > 0) {
      lines.push('- 禁止在上述目录以外写入、创建、修改或删除任何文件');
      lines.push('- 包括所有文件操作：编辑文件、创建新文件、移动文件、以及通过 shell 命令写入文件等');
    } else {
      lines.push('- 禁止写入、创建、修改或删除任何文件（写入权限被完全限制）');
    }
  }
  lines.push('- 如果你需要访问这些目录以外的文件，请说明原因但不要尝试操作');

  return lines.join('\n');
}

// ============ Schema 输出提示词相关函数 ============

// expandRefs 实现在 schemaUtils.ts（validator.ts 也要用，避免 promptBuilder → validator 循环依赖）；此处 re-export 保持原 import 路径兼容
export { expandRefs };

/**
 * 递归检测 schema 树中是否存在 prefixItems 元组定义
 */
function schemaHasTuple(schema: JsonSchemaDef): boolean {
  if (schema.type === 'array' && schema.prefixItems) {
    return true;
  }
  if (schema.type === 'object' && schema.properties) {
    const recursiveFields = schema.recursive ? (schema.recursiveFields || []) : [];
    for (const [name, propDef] of Object.entries(schema.properties)) {
      if (recursiveFields.includes(name)) {
        continue; // 递归字段的结构由框架填充，不需要检查
      }
      if (schemaHasTuple(propDef)) {
        return true;
      }
    }
  }
  if (schema.type === 'array' && schema.items) {
    return schemaHasTuple(schema.items);
  }
  return false;
}

/**
 * 递归检测 schema 树中是否存在 const 固定值定义
 * 跳过递归字段（与 schemaHasTuple 对称）：递归字段的结构由框架填充，
 * 其上的 const 会被白名单校验拦截（validateRecursiveSchema 规则 5），不产生运行时约束
 */
function schemaHasConst(schema: JsonSchemaDef): boolean {
  if (schema.const !== undefined) {
    return true;
  }
  if (schema.type === 'object' && schema.properties) {
    const recursiveFields = schema.recursive ? (schema.recursiveFields || []) : [];
    for (const [name, propDef] of Object.entries(schema.properties)) {
      if (recursiveFields.includes(name)) {
        continue;
      }
      if (schemaHasConst(propDef)) {
        return true;
      }
    }
  }
  if (schema.type === 'array' && schema.items) {
    return schemaHasConst(schema.items);
  }
  if (schema.type === 'array' && schema.prefixItems) {
    return schema.prefixItems.some(c => schemaHasConst(c));
  }
  return false;
}

/**
 * 构建 Schema 输出任务的提示词
 *
 * @param schema JsonSchemaDef 定义
 * @param outputFileName 输出文件路径（应为绝对路径）
 * @param cwd Claude 命令执行的工作目录
 * @returns Schema 输出提示词
 */
export function buildSchemaPrompt(
  schema: JsonSchemaDef,
  outputFileName: string,
  cwd?: string
): string {
  const formatExample = generateSchemaExample(schema);

  const requirements: string[] = [
    '1. 输出必须严格符合下方定义的 JSON Schema 结构',
    '2. 直接输出 Schema 定义的结构，不要额外包裹（如 { "data": xxx }）',
    '3. 确保 JSON 格式正确',
    '4. 请直接将数据写入文件，不需要在回复中展示完整数据',
    '5. 写入完成后使用 Read 工具验证文件内容'
  ];

  // 递归树形结构特定要求
  if (schema.recursive) {
    const maxDepth = schema.maxDepth ?? 3;
    const recursiveFields = schema.recursiveFields || [];
    requirements.push(`6. 这是一个递归树形结构，最大深度为 ${maxDepth} 层`);
    requirements.push(`7. 叶子节点（最深层）的递归字段（${recursiveFields.join(', ')}）必须为空数组`);
  } else {
    // 根据 schema.type 添加特定说明
    if (schema.type === 'object') {
      requirements.push('6. 输出单个 JSON 对象，包含所有定义的字段');
    } else if (schema.type === 'array') {
      requirements.push('6. 输出 JSON 数组，每个元素符合 items 定义的结构');
    }
  }

  // 元组特定要求（递归进入任意嵌套层级检测）
  // 序号衔接：前面递归/类型特定要求已占用 6（递归时还有 7），从当前长度 + 1 继续
  let nextReqIndex = requirements.length + 1;
  if (schemaHasTuple(schema)) {
    requirements.push(`${nextReqIndex}. 输出中的元组数组（标注"固定长度元组"的字段）长度固定，第 i 个元素的类型必须符合位置定义`);
    nextReqIndex++;
  }
  if (schemaHasConst(schema)) {
    requirements.push(`${nextReqIndex}. 标注了固定值的字段，输出必须严格等于该固定值`);
    nextReqIndex++;
  }

  // defs 存在时追加 $ref 回查引导（序号顺延）
  if (schema.defs) {
    requirements.push(`${nextReqIndex}. "$ref" 引用按名称回查上方 $defs 中的公共子结构定义，输出时按其结构展开，不要在输出中重复定义这些结构`);
    nextReqIndex++;
  }

  const dirWarning = getDirWarning(cwd, outputFileName);
  if (dirWarning) {
    requirements.push(dirWarning);
  }

  // 生成禁止格式示例（根据 schema.type）
  const forbiddenExamples = schema.type === 'object'
    ? '- ❌ { "data": { ... } }\n- ❌ { "result": { ... } }'
    : '- ❌ { "items": [...] }\n- ❌ { "results": [...] }';

  // defs 存在时走去重渲染（$defs 一次 + 引用点 $ref 标记）
  const schemaJson = expandRefs(schema);

  return `
请按照以下 Schema 结构输出数据，并写入到 ${outputFileName} 文件中：

## 输出 Schema

\`\`\`json
${schemaJson}
\`\`\`

## 正确格式示例

\`\`\`json
${JSON.stringify(formatExample)}
\`\`\`

## 禁止的格式

**特别注意：直接输出 Schema 定义的结构，不要额外包裹！**

以下是错误的格式：
${forbiddenExamples}
- ❌ 带 markdown 代码块标记的文件内容

**正确做法**：直接输出符合 Schema 的 JSON 结构

## 要求

${requirements.join('\n')}
`;
}

/**
 * 生成 Schema 结构的文本描述（递归）
 * 当 schema 包含 recursive: true 时，标注递归字段
 */
function generateSchemaDescription(schema: JsonSchemaDef, indent: string = ''): string {
  const lines: string[] = [];

  if (schema.description) {
    lines.push(`${indent}描述: ${schema.description}`);
  }

  lines.push(`${indent}类型: ${schema.type}`);

  if (schema.recursive) {
    const maxDepth = schema.maxDepth ?? 3;
    const fieldsStr = (schema.recursiveFields || []).join(', ');
    lines.push(`${indent}⚡ 递归树形结构（最大深度 ${maxDepth} 层，递归字段: ${fieldsStr}）`);
  }

  if (schema.type === 'object' && schema.properties) {
    lines.push(`${indent}字段:`);
    const recursiveFields = schema.recursiveFields || [];
    for (const [name, propDef] of Object.entries(schema.properties)) {
      const isRequired = schema.required?.includes(name) ?? true;
      const isRecursive = recursiveFields.includes(name);
      const recursiveTag = isRecursive ? ' 递归字段（树形结构）' : '';
      // 递归字段的结构由框架填充，其上的 const 非法（白名单校验拦截），不渲染固定值标签
      const constTag = !isRecursive && propDef.const !== undefined ? ` [固定值: ${JSON.stringify(propDef.const)}]` : '';
      lines.push(`${indent}  - ${name} (${propDef.type})${isRequired ? ' [必填]' : ' [可选]'}${recursiveTag}${constTag}`);
      if ((propDef.type === 'object' || propDef.type === 'array') && !isRecursive) {
        lines.push(generateSchemaDescription(propDef, `${indent}    `));
      }
    }
  }

  if (schema.type === 'array' && schema.items) {
    lines.push(`${indent}数组元素结构:`);
    lines.push(generateSchemaDescription(schema.items, `${indent}  `));
  }

  if (schema.type === 'array' && schema.prefixItems) {
    lines.push(`${indent}固定长度元组（长度 ${schema.prefixItems.length}）:`);
    schema.prefixItems.forEach((component, idx) => {
      const descTag = component.description ? `（${component.description}）` : '';
      const constTag = component.const !== undefined ? ` [固定值: ${JSON.stringify(component.const)}]` : '';
      lines.push(`${indent}  第 ${idx + 1} 个元素: ${component.type}${descTag}${constTag}`);
      if (component.type === 'object' || component.type === 'array') {
        lines.push(generateSchemaDescription(component, `${indent}    `));
      }
    });
  }

  return lines.join('\n');
}
