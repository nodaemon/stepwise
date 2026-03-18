/**
 * 自动降级执行器测试
 * 测试场景：使用 OpenCode 收集 doc 目录文件名，检测到 ruleset 问题后自动切换到内部执行器
 */

import 'source-map-support/register';
import * as fs from 'fs';
import * as path from 'path';
import {
  setAgentType,
  setTaskName,
  StepWise,
  registerTaskCallback,
  getFallbackState
} from '../src';

async function main(): Promise<void> {
  console.log('========================================');
  console.log('自动降级执行器测试');
  console.log('========================================\n');

  // 设置使用 OpenCode（会使用 FallbackExecutor）
  setAgentType('opencode');
  console.log('[配置] 使用 OpenCode（自动降级模式）');

  // 设置任务名称
  setTaskName('AutoFallbackTest');
  console.log('[配置] 任务名称: AutoFallbackTest\n');

  // 注册内部执行器回调（作为降级备选）
  registerTaskCallback(async (prompt, options) => {
    console.log('\n[内部执行器] 收到任务');
    
    const outputFile = path.join(process.cwd(), 'collect_test.txt');
    
    // 解析提示词，执行任务
    if (prompt.includes('doc 目录') || prompt.includes('doc目录')) {
      const docPath = path.join(process.cwd(), 'doc');
      if (fs.existsSync(docPath)) {
        const files = fs.readdirSync(docPath);
        fs.writeFileSync(outputFile, files.join('\n'), 'utf-8');
        console.log(`[内部执行器] 已写入文件: ${outputFile}`);
        
        return {
          sessionId: 'internal_fallback_session',
          output: `已收集 doc 目录下的 ${files.length} 个文件: ${files.join(', ')}`,
          success: true,
          timestamp: Date.now(),
          duration: 50
        };
      }
    }
    
    return {
      sessionId: 'internal_fallback_session',
      output: '任务执行完成',
      success: true,
      timestamp: Date.now(),
      duration: 10
    };
  });
  console.log('[配置] 已注册内部执行器回调\n');

  // 创建 Agent
  const agent = new StepWise('FallbackAgent');

  // 执行任务
  console.log('[执行] 收集 doc 目录下的文件名...\n');
  const result = await agent.execPrompt(
    '列出 doc 目录下所有文件名，每行一个，写入到 collect_test.txt'
  );

  console.log('\n========================================');
  console.log('执行结果');
  console.log('========================================');
  console.log(`执行状态: ${result.success ? '成功' : '失败'}`);
  console.log(`会话 ID: ${result.sessionId}`);
  console.log(`执行耗时: ${result.duration}ms`);
  console.log(`输出: ${result.output}`);

  if (result.error) {
    console.log(`错误信息: ${result.error}`);
  }

  // 显示降级状态
  const fallbackState = getFallbackState();
  console.log(`\n降级状态: ${fallbackState.useInternal ? '已降级到内部执行器' : '使用 OpenCode'}`);
  if (fallbackState.reason) {
    console.log(`降级原因: ${fallbackState.reason}`);
  }

  // 验证文件是否生成
  const outputFile = path.join(process.cwd(), 'collect_test.txt');
  if (fs.existsSync(outputFile)) {
    const content = fs.readFileSync(outputFile, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    console.log(`\n输出文件: ${outputFile}`);
    console.log(`文件行数: ${lines.length}`);
    console.log(`文件内容:`);
    lines.forEach((line, i) => console.log(`  ${i + 1}. ${line}`));
  } else {
    console.log(`\n文件未生成: ${outputFile}`);
  }

  console.log('\n测试完成!');
}

main().catch((error) => {
  console.error('测试执行失败:', error);
  process.exit(1);
});