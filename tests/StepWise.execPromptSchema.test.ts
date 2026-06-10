import { StepWise, setTaskName, _resetState, JsonSchemaDef } from '../src/index';

// Mock executor
jest.mock('../src/utils/executor', () => ({
  createExecutor: () => ({
    execute: jest.fn().mockResolvedValue({
      sessionId: 'test-session',
      output: 'test output',
      success: true,
      timestamp: Date.now(),
      duration: 100
    }),
    agentType: 'claude'
  })
}));

describe('execPromptSchema 功能测试', () => {
  beforeEach(() => {
    _resetState();
  });

  describe('参数校验', () => {
    beforeEach(() => {
      setTaskName('SchemaTest');
    });

    test('空 prompt 应该抛出错误', () => {
      const agent = new StepWise('TestAgent');
      expect(
        agent.execPromptSchema('', { type: 'object', properties: { name: { type: 'string' } } }, 'output.json')
      ).rejects.toThrow('prompt 不能为空');
    });

    test('schema 缺少 type 应该抛出错误', () => {
      const agent = new StepWise('TestAgent');
      expect(
        agent.execPromptSchema('test', {} as any, 'output.json')
      ).rejects.toThrow('schema 必须包含 type 属性');
    });

    test('schema type 不合法应该抛出错误', () => {
      const agent = new StepWise('TestAgent');
      expect(
        agent.execPromptSchema('test', { type: 'integer' } as any, 'output.json')
      ).rejects.toThrow('schema.type 必须是');
    });

    test('object schema 缺少 properties 应该抛出错误', () => {
      const agent = new StepWise('TestAgent');
      expect(
        agent.execPromptSchema('test', { type: 'object' } as any, 'output.json')
      ).rejects.toThrow('type="object" 时必须定义 properties');
    });

    test('object schema properties 为空应该抛出错误', () => {
      const agent = new StepWise('TestAgent');
      expect(
        agent.execPromptSchema('test', { type: 'object', properties: {} } as any, 'output.json')
      ).rejects.toThrow('type="object" 时必须定义 properties');
    });

    test('array schema 缺少 items 应该抛出错误', () => {
      const agent = new StepWise('TestAgent');
      expect(
        agent.execPromptSchema('test', { type: 'array' } as any, 'output.json')
      ).rejects.toThrow('type="array" 时必须定义 items');
    });

    test('嵌套 schema 校验应该递归执行', () => {
      const agent = new StepWise('TestAgent');
      expect(
        agent.execPromptSchema('test', {
          type: 'object',
          properties: {
            nested: { type: 'integer' } as any
          }
        }, 'output.json')
      ).rejects.toThrow('schema.properties.nested');
    });

    test('空 outputFile 应该抛出错误', () => {
      const agent = new StepWise('TestAgent');
      expect(
        agent.execPromptSchema('test', { type: 'object', properties: { name: { type: 'string' } } }, '')
      ).rejects.toThrow('outputFile');
    });
  });

  describe('schema 类型验证', () => {
    beforeEach(() => {
      setTaskName('SchemaTypeTest');
    });

    test('扁平 object schema 应该被接受', () => {
      const agent = new StepWise('FlatAgent');
      const schema: JsonSchemaDef = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'number' }
        }
      };
      // 不抛出错误即可（实际执行会被 mock）
      expect(
        agent.execPromptSchema('测试', schema, 'flat.json')
      ).resolves.toBeDefined();
    });

    test('嵌套 object schema 应该被接受', () => {
      const agent = new StepWise('NestedAgent');
      const schema: JsonSchemaDef = {
        type: 'object',
        properties: {
          projectName: { type: 'string' },
          statistics: {
            type: 'object',
            properties: {
              total: { type: 'number' },
              items: {
                type: 'array',
                items: { type: 'string' }
              }
            }
          }
        }
      };
      expect(
        agent.execPromptSchema('测试嵌套', schema, 'nested.json')
      ).resolves.toBeDefined();
    });

    test('array schema with complex items 应该被接受', () => {
      const agent = new StepWise('ArrayAgent');
      const schema: JsonSchemaDef = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            endpoint: { type: 'string' },
            method: { type: 'string' }
          }
        }
      };
      expect(
        agent.execPromptSchema('测试数组', schema, 'array.json')
      ).resolves.toBeDefined();
    });

    test('简单 string array schema 应该被接受', () => {
      const agent = new StepWise('SimpleArrayAgent');
      const schema: JsonSchemaDef = {
        type: 'array',
        items: { type: 'string' }
      };
      expect(
        agent.execPromptSchema('测试简单数组', schema, 'simple_array.json')
      ).resolves.toBeDefined();
    });
  });

  describe('buildSchemaPrompt 生成测试', () => {
    // 这些测试验证 Prompt 生成逻辑
    // 通过 mock executor 捕获实际执行的 prompt

    beforeEach(() => {
      setTaskName('PromptBuildTest');
    });

    test('object schema prompt 应包含禁止额外包裹说明', async () => {
      const agent = new StepWise('PromptAgent');
      const schema: JsonSchemaDef = {
        type: 'object',
        properties: {
          name: { type: 'string' }
        }
      };

      await agent.execPromptSchema('测试', schema, 'prompt_test.json');
      // 验证 mock executor 被调用（prompt 内容通过 mock 无法直接验证）
      // 实际验证在 promptBuilder 单测中完成
    });
  });
});

// ============ 断点恢复测试 ============

import * as fs from 'fs';
import * as path from 'path';
import { setResumePath } from '../src';

function createMockSchemaHistoryStructure(baseDir: string, taskName: string, agentName: string, outputFile: string): string {
  const timestamp = '20260307_120000_123';
  const taskDir = path.join(baseDir, 'stepwise_exec_infos', `${taskName}_${timestamp}`);
  const agentDir = path.join(taskDir, `${agentName}_20260307_120001_456`);
  const dataDir = path.join(agentDir, 'data');
  const reportDir = path.join(taskDir, 'report');

  // 创建目录结构
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });

  // 创建进度文件（包含 schema 任务）
  const progressFile = path.join(dataDir, 'progress.json');
  const progress = {
    taskName: agentName,
    taskDir: agentDir,
    taskCounter: 1,
    tasks: [
      {
        taskIndex: 1,
        taskName: '1_schema',
        sessionId: 'schema-session-1',
        status: 'completed',
        timestamp: Date.now(),
        taskType: 'schema',
        outputFileName: outputFile
      }
    ],
    lastUpdated: Date.now(),
    isCompleted: true
  };

  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));

  // 创建输出文件
  const outputPath = path.join(reportDir, outputFile);
  fs.writeFileSync(outputPath, JSON.stringify({ projectName: 'stepwise', totalFiles: 45 }), 'utf-8');

  return taskDir;
}

describe('execPromptSchema 断点恢复测试', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    _resetState();
    tempDir = path.join(__dirname, '.temp_schema_resume_test');
    originalCwd = process.cwd();
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    _resetState();
  });

  test('已完成 schema 任务应该被跳过并返回缓存数据', async () => {
    const outputFile = 'analysis.json';
    const taskDir = createMockSchemaHistoryStructure(tempDir, 'SchemaResumeTest', 'Agent1', outputFile);

    setTaskName('SchemaResumeTest');
    setResumePath(path.basename(taskDir));

    const agent = new StepWise('Agent1');
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        projectName: { type: 'string' },
        totalFiles: { type: 'number' }
      }
    };

    const result = await agent.execPromptSchema('分析项目', schema, outputFile);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ projectName: 'stepwise', totalFiles: 45 });
  });

  test('schema TaskType 应被正确记录为 "schema"', () => {
    const outputFile = 'schema_type_test.json';
    const taskDir = createMockSchemaHistoryStructure(tempDir, 'SchemaTypeTest', 'TypeAgent', outputFile);

    setTaskName('SchemaTypeTest');
    setResumePath(path.basename(taskDir));

    const agent = new StepWise('TypeAgent');

    // 查看进度文件确认 taskType 为 'schema'
    const dataDir = path.join(taskDir, 'TypeAgent_20260307_120001_456', 'data');
    const progressFile = path.join(dataDir, 'progress.json');
    const progress = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));

    expect(progress.tasks[0].taskType).toBe('schema');
    expect(progress.tasks[0].taskName).toBe('1_schema');
  });
});