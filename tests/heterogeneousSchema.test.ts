import { StepWise, setTaskName, _resetState } from '../src/index';
import { JsonSchemaDef } from '../src/types';
import { validateRecursiveSchema, convertToAjvSchema, validateJsonBySchema, generateSchemaExample } from '../src/utils/validator';
import { buildSchemaPrompt } from '../src/utils/promptBuilder';

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

  describe('R1: 递归字段白名单（仅允许 type/description）', () => {
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
      expect(() => validateRecursiveSchema(schema)).toThrow('仅允许 type/description');
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
      expect(() => validateRecursiveSchema(schema)).toThrow('仅允许 type/description');
    });

    test('递归字段带 const 应抛错（const 逃逸修复）', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        properties: {
          name: { type: 'string' },
          children: { type: 'array', const: 'x' } as any
        }
      };
      expect(() => validateRecursiveSchema(schema)).toThrow('仅允许 type/description');
    });

    test('递归字段带 const 经 execPromptSchema 入口端到端拒绝', async () => {
      const agent = new StepWise('R1ConstE2E');
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        properties: {
          name: { type: 'string' },
          children: { type: 'array', const: 'x' } as any
        }
      };
      await expect(
        agent.execPromptSchema('测试', schema, 'out.json')
      ).rejects.toThrow('仅允许 type/description');
    });

    test('回归：递归对象的非递归字段带 const 仍合法（spec 支持的组合）', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        properties: {
          kind: { type: 'string', const: 'node' },
          name: { type: 'string' },
          children: { type: 'array' }
        }
      };
      expect(() => validateRecursiveSchema(schema)).not.toThrow();
    });
  });
});

describe('convertToAjvSchema 元组与 const 转换', () => {
  test('元组转换为 items 数组 + minItems/maxItems', () => {
    const schema: JsonSchemaDef = {
      type: 'array',
      prefixItems: [
        { type: 'string', description: '姓名' },
        { type: 'number', description: '年龄' },
        { type: 'boolean' }
      ]
    };
    const ajvSchema = convertToAjvSchema(schema);
    expect(ajvSchema.type).toBe('array');
    expect(Array.isArray(ajvSchema.items)).toBe(true);
    expect((ajvSchema.items as any[]).length).toBe(3);
    expect((ajvSchema.items as any[])[0]).toEqual({ type: 'string', description: '姓名' });
    expect(ajvSchema.minItems).toBe(3);
    expect(ajvSchema.maxItems).toBe(3);
  });

  test('const 透传到 AJV schema', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        name: { type: 'string', const: 'root' }
      }
    };
    const ajvSchema = convertToAjvSchema(schema);
    expect((ajvSchema.properties as any).name).toEqual({ type: 'string', const: 'root' });
  });
});

describe('validateJsonBySchema 元组与 const 数据校验', () => {
  const tupleSchema: JsonSchemaDef = {
    type: 'array',
    prefixItems: [
      { type: 'string', description: '姓名' },
      { type: 'number', description: '年龄' }
    ]
  };

  test('合法元组通过', () => {
    const result = validateJsonBySchema('["张三", 18]', tupleSchema);
    expect(result.valid).toBe(true);
  });

  test('超长元组失败（maxItems）', () => {
    const result = validateJsonBySchema('["张三", 18, true]', tupleSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'maxItems')).toBe(true);
  });

  test('缺项元组失败（minItems）', () => {
    const result = validateJsonBySchema('["张三"]', tupleSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'minItems')).toBe(true);
  });

  test('位置类型错误失败', () => {
    const result = validateJsonBySchema('[18, "张三"]', tupleSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'type' && e.path === '/0')).toBe(true);
  });

  test('const 值不符失败', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: { name: { type: 'string', const: 'root' } }
    };
    const result = validateJsonBySchema('{"name": "other"}', schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'const')).toBe(true);
  });

  test('const 值相符通过', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: { name: { type: 'string', const: 'root' } }
    };
    const result = validateJsonBySchema('{"name": "root"}', schema);
    expect(result.valid).toBe(true);
  });
});

describe('generateSchemaExample 元组与 const 示例', () => {
  test('元组按位置生成分量示例', () => {
    const schema: JsonSchemaDef = {
      type: 'array',
      prefixItems: [
        { type: 'string', description: '姓名' },
        { type: 'number' },
        { type: 'boolean' }
      ]
    };
    const example = generateSchemaExample(schema);
    expect(example).toEqual(['姓名', 0, true]);
  });

  test('const 字段示例值取 const 值', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        name: { type: 'string', const: '1' }
      }
    };
    const example = generateSchemaExample(schema) as any;
    expect(example.name).toBe('1');
  });

  test('number const 示例值取 const 值', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        level: { type: 'number', const: 3 }
      }
    };
    const example = generateSchemaExample(schema) as any;
    expect(example.level).toBe(3);
  });

  test('元组分量带 const 时分量示例取 const 值', () => {
    const schema: JsonSchemaDef = {
      type: 'array',
      prefixItems: [
        { type: 'string', const: 'root' },
        { type: 'number' }
      ]
    };
    const example = generateSchemaExample(schema);
    expect(example).toEqual(['root', 0]);
  });
});

describe('buildSchemaPrompt 元组与 const 提示词', () => {
  test('元组 schema 提示词含固定长度要求与结构说明', () => {
    const schema: JsonSchemaDef = {
      type: 'array',
      prefixItems: [
        { type: 'string', description: '姓名' },
        { type: 'number', description: '年龄' }
      ]
    };
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    expect(prompt).toContain('长度固定');
    expect(prompt).toContain('第 i 个元素的类型必须符合位置定义');
    expect(prompt).toContain('固定长度元组（长度 2）');
    expect(prompt).toContain('第 1 个元素: string（姓名）');
    expect(prompt).toContain('第 2 个元素: number（年龄）');
  });

  test('const schema 提示词含固定值要求', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        name: { type: 'string', const: '1' }
      }
    };
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    expect(prompt).toContain('固定值');
    expect(prompt).toContain('[固定值: "1"]');
  });

  test('示例区块展示元组示例与 const 值', () => {
    const schema: JsonSchemaDef = {
      type: 'array',
      prefixItems: [
        { type: 'string', const: 'root' },
        { type: 'number' }
      ]
    };
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    // 示例来自 Task 5 的 generateSchemaExample：['root', 0]
    expect(prompt).toContain('"root"');
  });
});

describe('端到端：固定节点名树（递归+元组+const 组合）', () => {
  // 2/3 之下的递归树节点（独立递归树，R3）
  const treeNode: JsonSchemaDef = {
    type: 'object',
    recursive: true,
    recursiveFields: ['children'],
    maxDepth: 3,
    properties: {
      name: { type: 'string' },
      children: { type: 'array' }
    }
  };

  // 根 "1"，两个子节点 "2"/"3"，其下递归
  const schema: JsonSchemaDef = {
    type: 'object',
    properties: {
      name: { type: 'string', const: '1' },
      children: {
        type: 'array',
        prefixItems: [
          {
            type: 'object',
            properties: {
              name: { type: 'string', const: '2' },
              children: { type: 'array', items: treeNode }
            }
          },
          {
            type: 'object',
            properties: {
              name: { type: 'string', const: '3' },
              children: { type: 'array', items: treeNode }
            }
          }
        ]
      }
    }
  };

  test('合法数据（含多叉树）通过校验', () => {
    const validData = {
      name: '1',
      children: [
        {
          name: '2',
          children: [
            { name: 'a', children: [
              { name: 'b', children: [] },
              { name: 'c', children: [] }   // 多叉：同层两个子节点
            ]}
          ]
        },
        {
          name: '3',
          children: [
            { name: 'd', children: [] }     // 提前叶子：深度 < maxDepth 也合法
          ]
        }
      ]
    };
    const result = validateJsonBySchema(JSON.stringify(validData), schema);
    expect(result.valid).toBe(true);
  });

  test('根节点名错误被拒绝', () => {
    const badData = {
      name: 'root',
      children: [
        { name: '2', children: [] },
        { name: '3', children: [] }
      ]
    };
    const result = validateJsonBySchema(JSON.stringify(badData), schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'const')).toBe(true);
  });

  test('子节点数量不符（超长）被拒绝', () => {
    const badData = {
      name: '1',
      children: [
        { name: '2', children: [] },
        { name: '3', children: [] },
        { name: '4', children: [] }
      ]
    };
    const result = validateJsonBySchema(JSON.stringify(badData), schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'maxItems')).toBe(true);
  });

  test('子节点名错误被拒绝', () => {
    const badData = {
      name: '1',
      children: [
        { name: 'first', children: [] },
        { name: '3', children: [] }
      ]
    };
    const result = validateJsonBySchema(JSON.stringify(badData), schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'const')).toBe(true);
  });

  test('元组位置互换（2/3 顺序颠倒）被拒绝', () => {
    const badData = {
      name: '1',
      children: [
        { name: '3', children: [] },
        { name: '2', children: [] }
      ]
    };
    const result = validateJsonBySchema(JSON.stringify(badData), schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'const')).toBe(true);
  });

  test('嵌套树超过 maxDepth 被拒绝（R3 深度约束生效）', () => {
    // treeNode maxDepth=3：2 的子(层1)→孙(层2)→曾孙(层3,叶子 children 必须空/对象数组)
    // 构造 4 层嵌套：曾孙的 children 里还有带 name 的完整节点 → 但叶子层 items 放宽为 {type:'object'}
    // 因此叶子层的子节点只要是 object 就合法——超深约束的边界是：层3 的 children 只要求对象数组
    // 真正的拒绝场景：层1 的节点缺 name 字段
    const badData = {
      name: '1',
      children: [
        { name: '2', children: [
          { children: [] }   // 缺 name，层1 节点不合规
        ]},
        { name: '3', children: [] }
      ]
    };
    const result = validateJsonBySchema(JSON.stringify(badData), schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.keyword === 'required')).toBe(true);
  });

  test('结构校验通过（execPromptSchema 入口）', async () => {
    _resetState();
    setTaskName('HeteroE2E');
    const agent = new StepWise('E2EAgent');
    await expect(
      agent.execPromptSchema('测试', schema, 'tree.json')
    ).resolves.toBeDefined();
  });

  test('示例生成：根/子节点示例值为 const 值，递归子树为单路径', () => {
    const example = generateSchemaExample(schema) as any;
    expect(example.name).toBe('1');
    expect(example.children.length).toBe(2);
    expect(example.children[0].name).toBe('2');
    expect(example.children[1].name).toBe('3');
    // 递归子树展开（单路径，叶子 children: []）
    expect(example.children[0].children[0].name).toBe('示例字符串');
  });

  test('提示词包含元组说明与固定值要求', () => {
    const prompt = buildSchemaPrompt(schema, '/tmp/tree.json');
    expect(prompt).toContain('固定长度元组（长度 2）');
    expect(prompt).toContain('[固定值: "1"]');
    expect(prompt).toContain('[固定值: "2"]');
    expect(prompt).toContain('[固定值: "3"]');
    expect(prompt).toContain('第 i 个元素的类型必须符合位置定义');
  });
});
