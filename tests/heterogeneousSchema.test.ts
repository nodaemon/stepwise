import { StepWise, setTaskName, _resetState } from '../src/index';
import { JsonSchemaDef } from '../src/types';
import { validateRecursiveSchema } from '../src/utils/validator';

// Mock executor（沿用 StepWise.execPromptSchema.test.ts 的模式）
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

describe('prefixItems 元组结构校验', () => {
  beforeEach(() => {
    _resetState();
    setTaskName('HeteroSchemaTest');
  });

  describe('互斥与位置校验', () => {
    test('items 与 prefixItems 同现应抛错', async () => {
      const agent = new StepWise('T1');
      const schema: JsonSchemaDef = {
        type: 'array',
        items: { type: 'string' },
        prefixItems: [{ type: 'string' }]
      } as any;
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('items 与 prefixItems 互斥');
    });

    test('type=array 但 items 和 prefixItems 都缺应抛错', async () => {
      const agent = new StepWise('T2');
      await expect(
        agent.execPromptSchema('测试', { type: 'array' } as any, 'out.json')
      ).rejects.toThrow('必须定义 items 或 prefixItems');
    });

    test('非 array 类型带 prefixItems 应抛错', async () => {
      const agent = new StepWise('T3');
      const schema: JsonSchemaDef = {
        type: 'string',
        prefixItems: [{ type: 'string' }]
      } as any;
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('prefixItems 仅在 type="array" 时有效');
    });

    test('prefixItems 空数组应抛错', async () => {
      const agent = new StepWise('T4');
      await expect(
        agent.execPromptSchema('测试', { type: 'array', prefixItems: [] } as any, 'out.json')
      ).rejects.toThrow('prefixItems 不能为空数组');
    });

    test('分量类型错误应递归抛错且带位置', async () => {
      const agent = new StepWise('T5');
      const schema: JsonSchemaDef = {
        type: 'array',
        prefixItems: [
          { type: 'string' },
          { type: 'integer' } as any
        ]
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('schema.prefixItems[1]');
    });

    test('纯 prefixItems 元组 schema 应通过校验', async () => {
      const agent = new StepWise('T6');
      const schema: JsonSchemaDef = {
        type: 'array',
        prefixItems: [
          { type: 'string', description: '姓名' },
          { type: 'number', description: '年龄' }
        ]
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).resolves.toBeDefined();
    });
  });

  describe('R2: 元组分量不可为树节点', () => {
    test('分量带 recursive=true 应抛错', async () => {
      const agent = new StepWise('T7');
      const schema: JsonSchemaDef = {
        type: 'array',
        prefixItems: [
          {
            type: 'object',
            recursive: true,
            recursiveFields: ['children'],
            properties: {
              name: { type: 'string' },
              children: { type: 'array' }
            }
          }
        ]
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('prefixItems 分量不能定义 recursive');
    });

    test('分量带 maxDepth 应抛错', async () => {
      const agent = new StepWise('T8');
      const schema: JsonSchemaDef = {
        type: 'array',
        prefixItems: [
          {
            type: 'object',
            maxDepth: 3,
            properties: { name: { type: 'string' } }
          } as any
        ]
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('prefixItems 分量不能定义');
    });
  });

  describe('const 校验', () => {
    test('object 带 const 应抛错', async () => {
      const agent = new StepWise('T9');
      const schema: JsonSchemaDef = {
        type: 'object',
        const: 'x',
        properties: { name: { type: 'string' } }
      } as any;
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('const 仅在 type="string"|"number"|"boolean" 时有效');
    });

    test('const 值类型与 type 不匹配应抛错', async () => {
      const agent = new StepWise('T10');
      const schema: JsonSchemaDef = {
        type: 'object',
        properties: {
          name: { type: 'string', const: 123 } as any
        }
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('const 值类型必须与 type 一致');
    });

    test('string + 匹配 const 应通过校验', async () => {
      const agent = new StepWise('T11');
      const schema: JsonSchemaDef = {
        type: 'object',
        properties: {
          name: { type: 'string', const: 'root' }
        }
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).resolves.toBeDefined();
    });
  });

  describe('嵌套递归校验（R3 配套）', () => {
    test('分量内递归树定义非法（recursiveFields 为空）应抛错', async () => {
      const agent = new StepWise('T12');
      const schema: JsonSchemaDef = {
        type: 'array',
        prefixItems: [
          {
            type: 'object',
            properties: {
              subtree: {
                type: 'object',
                recursive: true,
                properties: {
                  name: { type: 'string' }
                }
              }
            }
          }
        ]
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('schema.prefixItems[0]');
    });
  });

  describe('R1: 递归字段不得定义 items/prefixItems', () => {
    test('递归字段带 prefixItems 应抛错', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        properties: {
          name: { type: 'string' },
          children: {
            type: 'array',
            prefixItems: [{ type: 'string' }]
          }
        }
      };
      expect(() => validateRecursiveSchema(schema)).toThrow('不应定义 items/prefixItems');
    });

    test('递归字段带 items 仍应抛错（现有行为不回归）', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        properties: {
          name: { type: 'string' },
          children: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      };
      expect(() => validateRecursiveSchema(schema)).toThrow('不应定义 items');
    });
  });
});
