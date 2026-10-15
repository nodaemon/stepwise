/**
 * 环境变量条目解析工具
 *
 * "KEY=VALUE" 字符串数组的解析规则是框架的一致性契约，三处消费方必须共用同一实现：
 * - BaseExecutor.buildEnv()：注入 agent 子进程环境
 * - ShellExecutor.runCommand()：注入 shell 子进程环境（并对非法条目告警）
 * - buildReproScript()：写入 command.sh，必须与前两者解析结果一致，
 *   否则复现脚本的执行效果会与框架内执行产生偏差
 */

/**
 * 单个合法环境变量条目
 */
export interface EnvEntry {
  /** 变量名 */
  key: string;
  /** 变量值（可能为空字符串） */
  value: string;
}

/**
 * 解析结果
 */
export interface ParsedEnv {
  /** 合法条目，顺序与传入数组一致 */
  entries: EnvEntry[];
  /** 被丢弃的非法条目原文，供调用方告警 */
  invalid: string[];
}

/**
 * 解析 "KEY=VALUE" 环境变量数组
 *
 * 判定规则：等号下标必须 > 0
 * - "KEY=VALUE" / "KEY="  → 合法（"KEY=" 值为空字符串）
 * - "KEY"（无等号）        → 非法，丢弃
 * - "=VALUE"（键名为空）   → 非法，丢弃
 *
 * 值中可包含 "="：只按第一个等号切分，其余部分原样保留。
 */
export function parseEnvEntries(env?: string[]): ParsedEnv {
  const entries: EnvEntry[] = [];
  const invalid: string[] = [];

  if (!env || env.length === 0) {
    return { entries, invalid };
  }

  for (const envStr of env) {
    const equalIndex = envStr.indexOf('=');
    if (equalIndex > 0) {
      entries.push({
        key: envStr.substring(0, equalIndex),
        value: envStr.substring(equalIndex + 1)
      });
    } else {
      invalid.push(envStr);
    }
  }

  return { entries, invalid };
}
