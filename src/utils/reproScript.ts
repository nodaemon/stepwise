/**
 * 复现脚本（command.sh）生成器
 *
 * 目标：日志目录下的 command.sh 既是可直接执行的脚本（./command.sh 或 sh command.sh），
 * 也是可直接逐行复制到终端的命令——cwd、环境变量、主命令各只出现一次，元信息降级为头部注释。
 *
 * 两条调用路径：
 * - agent 执行器（executors/base.ts）：传 presetEnv = { PAGER: 'cat' }，
 *   对齐 BaseExecutor.buildEnv() 中 PAGER 先注入、用户 env 后覆盖的优先级。
 * - shell 任务（utils/shellExecutor.ts）：不传 presetEnv，
 *   因为该路径的 spawn（/bin/sh -c）并未注入任何框架变量。
 */

import * as fs from 'fs';
import { parseEnvEntries } from './envHelper';

/**
 * shell 单引号转义
 *
 * 单引号内 $ ` \ " 均为字面量，无需额外处理；仅需转义单引号本身：
 *   it's  ->  'it'\''s'
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * 按需加引号
 *
 * 仅当参数含 shell 特殊字符（空白、引号、反引号、$、\ 等）时才加引号，
 * 否则原样输出——命令行可读性更好。
 *
 * 与 shellQuote() 共用同一套转义规则：命令行拼装（buildCommandString）与
 * 复现脚本拼装（管道前缀）都走这里，避免两处规则各写一份、日久漂移。
 */
export function quoteIfNeeded(value: string): string {
  if (/[\s'"`\$\n\r\t\\]/.test(value)) {
    return shellQuote(value);
  }
  return value;
}

/**
 * 复现脚本生成参数
 */
export interface ReproScriptOptions {
  /** 完整命令行，原样写入脚本末行；可含换行（prompt 作为参数时） */
  command: string;
  /** 工作目录，脚本中以 cd 语句还原 */
  cwd: string;
  /** 额外环境变量，格式 "KEY=VALUE"；无等号的条目会被忽略 */
  env?: string[];
  /** 框架固定注入的环境变量，先于 env 输出（对齐 buildEnv 的优先级） */
  presetEnv?: Record<string, string>;
  /**
   * 框架内的执行超时（毫秒），仅用于头部注释说明
   * 脚本本身没有超时控制，故如实标注差异而不复刻终止行为
   */
  timeout?: number;
}

/**
 * 生成 command.sh 内容
 *
 * 结构：
 *   #!/bin/sh
 *   # 头部注释（生成时间 / 工作目录 / 环境变量键名 / 可选的框架超时说明）
 *   set -e
 *   export <presetEnv...>
 *   export <env...>
 *   cd '<cwd>'
 *   <command>
 *
 * set -e 保证 cd 失败（目录被删除等）时立即退出，不在错误目录里执行命令；
 * 末行即主命令，退出码天然透传。
 */
export function buildReproScript(opts: ReproScriptOptions): string {
  const { command, cwd, env, presetEnv, timeout } = opts;
  // 复用共享解析规则：非法条目在这里被静默丢弃，与框架实际注入的变量保持一致
  const envEntries = parseEnvEntries(env).entries;

  const lines: string[] = [];

  lines.push('#!/bin/sh');
  lines.push('# StepWise 复现脚本：可直接执行（./command.sh 或 sh command.sh），也可逐行复制到终端');
  lines.push(`# 生成时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  lines.push(`# 工作目录: ${cwd}`);

  const envKeys = [
    ...Object.keys(presetEnv || {}),
    ...envEntries.map(e => e.key)
  ];
  if (envKeys.length > 0) {
    lines.push(`# 环境变量: ${envKeys.join(', ')}（值可能为敏感信息，请勿外传）`);
  } else {
    lines.push('# 环境变量: 无');
  }

  // 如实说明超时差异：框架会主动终止超时子进程，脚本本身没有超时控制
  if (typeof timeout === 'number') {
    lines.push(`# 说明: 框架内超时 ${timeout}ms 会主动终止子进程，本脚本无超时限制`);
  }

  lines.push('');
  lines.push('set -e');
  lines.push('');

  // 框架固定变量先输出，用户 env 后输出以覆盖它（对齐 buildEnv 的顺序）
  for (const [key, value] of Object.entries(presetEnv || {})) {
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  for (const entry of envEntries) {
    lines.push(`export ${entry.key}=${shellQuote(entry.value)}`);
  }

  if (envKeys.length > 0) {
    lines.push('');
  }

  lines.push(`cd ${shellQuote(cwd)}`);
  lines.push(command);

  return lines.join('\n') + '\n';
}

/**
 * 写入 command.sh
 *
 * 显式 chmod 0755：writeFileSync 的 mode 仅在创建时生效且受 umask 影响，
 * 显式设置才能保证 ./command.sh 可直接执行。
 * chmod 失败（Windows / 特殊文件系统）不能影响命令本身的执行，故吞掉异常。
 */
export function writeReproScript(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, 'utf-8');
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {
    // 权限设置失败不影响复现脚本内容，仅失去"直接执行"能力（仍可 sh command.sh 运行）
  }
}
