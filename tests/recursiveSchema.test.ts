import {
  validateRecursiveSchema,
  unrollRecursiveSchema,
  convertToAjvSchema,
  generateSchemaExample,
  validateJsonBySchema,
  buildSchemaFixPrompt
} from '../src/utils/validator';
import { buildSchemaPrompt } from '../src/utils/promptBuilder';
import { JsonSchemaDef } from '../src/types';
import { SchemaValidationError } from '../src/utils/schemaUtils';

describe('recursiveSchema 递归树形结构', () => {
  // ============ validateRecursiveSchema 测试 ============
  describe('validateRecursiveSchema', () => {
    describe('规则 1: recursive 仅在 type=object 时有效', () => {
      it('type=array + recursive=true 应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'array',
          recursive: true,
          items: { type: 'object' }
        };
        expect(() => validateRecursiveSchema(schema)).toThrow('recursive 仅在 type="object" 时有效');
      });

      it('type=string + recursive=true 应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'string',
          recursive: true
        };
        expect(() => validateRecursiveSchema(schema)).toThrow('recursive 仅在 type="object" 时有效');
      });

      it('type=object + recursive=true 不应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };
        expect(() => validateRecursiveSchema(schema)).not.toThrow();
      });
    });

    describe('规则 2: recursiveFields 需要 recursive=true', () => {
      it('有 recursiveFields 但无 recursive 应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursiveFields: ['children'],
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };
        expect(() => validateRecursiveSchema(schema)).toThrow('recursiveFields 需要 recursive=true');
      });

      it('recursive=false + recursiveFields 应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: false,
          recursiveFields: ['children'],
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };
        expect(() => validateRecursiveSchema(schema)).toThrow('recursiveFields 需要 recursive=true');
      });
    });

    describe('规则 3: maxDepth 需要 recursive=true', () => {
      it('有 maxDepth 但无 recursive 应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          maxDepth: 5,
          properties: {
            name: { type: 'string' }
          }
        };
        expect(() => validateRecursiveSchema(schema)).toThrow('maxDepth 需要 recursive=true');
      });
    });

    describe('规则 4: recursiveFields 必须是 array 类型', () => {
      it('recursiveFields 字段为 string 类型应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['name'],
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };
        expect(() => validateRecursiveSchema(schema)).toThrow('必须是 type="array"');
      });

      it('recursiveFields 字段不存在于 properties 应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['nonexistent'],
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };
        expect(() => validateRecursiveSchema(schema)).toThrow('不在 properties 中');
      });
    });

    describe('规则 5: recursiveFields 不应定义 items', () => {
      it('recursiveFields 字段定义了 items 应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          properties: {
            name: { type: 'string' },
            children: {
              type: 'array',
              items: { type: 'string' }  // 不应定义 items
            }
          }
        };
        expect(() => validateRecursiveSchema(schema)).toThrow('不应定义 items');
      });
    });

    describe('规则 6: maxDepth 范围 1~10', () => {
      it('maxDepth=0 应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          maxDepth: 0,
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };
        expect(() => validateRecursiveSchema(schema)).toThrow('maxDepth 必须在 1~10 范围内');
      });

      it('maxDepth=15 应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          maxDepth: 15,
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };
        expect(() => validateRecursiveSchema(schema)).toThrow('maxDepth 必须在 1~10 范围内');
      });

      it('maxDepth=1 不应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          maxDepth: 1,
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };
        expect(() => validateRecursiveSchema(schema)).not.toThrow();
      });

      it('maxDepth=10 不应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          maxDepth: 10,
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };
        expect(() => validateRecursiveSchema(schema)).not.toThrow();
      });
    });

    describe('额外约束: recursive=true 时必须指定 recursiveFields', () => {
      it('recursive=true 但 recursiveFields 为空应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };
        expect(() => validateRecursiveSchema(schema)).toThrow('必须指定至少一个 recursiveFields');
      });
    });

    describe('非递归 schema 不应抛错', () => {
      it('没有 recursive 字段的普通 schema 不应抛错', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          properties: {
            name: { type: 'string' },
            count: { type: 'number' }
          }
        };
        expect(() => validateRecursiveSchema(schema)).not.toThrow();
      });

      it('基础类型 schema 不应抛错', () => {
        const schema: JsonSchemaDef = { type: 'string' };
        expect(() => validateRecursiveSchema(schema)).not.toThrow();
      });
    });
  });

  // ============ unrollRecursiveSchema 测试 ============
  describe('unrollRecursiveSchema', () => {
    describe('maxDepth=2 (两层展开)', () => {
      it('应展开两层，叶子层 children.items 为 { type: object }', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          maxDepth: 2,
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };

        const ajvSchema = unrollRecursiveSchema(schema) as any;

        // 第 1 层：name (string) + children (array with nested items)
        expect(ajvSchema.type).toBe('object');
        expect(ajvSchema.properties.name.type).toBe('string');
        expect(ajvSchema.properties.children.type).toBe('array');

        // 第 2 层（叶子层）：name (string) + children.items = { type: 'object' }
        const layer2 = ajvSchema.properties.children.items;
        expect(layer2.type).toBe('object');
        expect(layer2.properties.name.type).toBe('string');
        expect(layer2.properties.children.type).toBe('array');
        expect(layer2.properties.children.items.type).toBe('object');
      });
    });

    describe('maxDepth=1 (单层，无嵌套)', () => {
      it('应只有一层，children.items 直接为 { type: object }', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          maxDepth: 1,
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };

        const ajvSchema = unrollRecursiveSchema(schema) as any;

        expect(ajvSchema.type).toBe('object');
        expect(ajvSchema.properties.name.type).toBe('string');
        expect(ajvSchema.properties.children.type).toBe('array');
        // 叶子层：children.items 为宽松的 { type: 'object' }
        expect(ajvSchema.properties.children.items.type).toBe('object');
      });
    });

    describe('maxDepth=3 (默认深度)', () => {
      it('应展开三层', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };

        const ajvSchema = unrollRecursiveSchema(schema) as any;

        // 第 1 层
        expect(ajvSchema.properties.children.items.type).toBe('object');
        // 第 2 层
        const layer2 = ajvSchema.properties.children.items.properties.children.items;
        expect(layer2.type).toBe('object');
        // 第 3 层（叶子层）
        const layer3 = layer2.properties.children.items;
        expect(layer3.type).toBe('object'); // 叶子层的 children.items
      });
    });

    describe('多个递归字段', () => {
      it('children 和 subItems 同时递归', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children', 'subItems'],
          maxDepth: 2,
          properties: {
            name: { type: 'string' },
            children: { type: 'array' },
            subItems: { type: 'array' }
          }
        };

        const ajvSchema = unrollRecursiveSchema(schema) as any;

        // 第 1 层：两个字段都展开为下一层节点
        expect(ajvSchema.properties.children.items.type).toBe('object');
        expect(ajvSchema.properties.subItems.items.type).toBe('object');

        // 第 2 层（叶子层）：两个字段的 items 都为 { type: 'object' }
        const childrenLayer2 = ajvSchema.properties.children.items;
        expect(childrenLayer2.properties.children.items.type).toBe('object');
        expect(childrenLayer2.properties.subItems.items.type).toBe('object');
      });
    });

    describe('嵌套非递归属性保留', () => {
      it('非递归的 object/array 属性应完整保留', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          maxDepth: 2,
          properties: {
            name: { type: 'string' },
            metadata: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                value: { type: 'string' }
              }
            },
            children: { type: 'array' }
          }
        };

        const ajvSchema = unrollRecursiveSchema(schema) as any;

        // metadata 应完整保留（非递归属性）
        expect(ajvSchema.properties.metadata.type).toBe('object');
        expect(ajvSchema.properties.metadata.properties.key.type).toBe('string');
        expect(ajvSchema.properties.metadata.properties.value.type).toBe('string');
      });
    });

    describe('convertToAjvSchema 自动委托', () => {
      it('非递归 schema 仍使用原有逻辑', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          properties: {
            name: { type: 'string' },
            count: { type: 'number' }
          }
        };

        const ajvSchema = convertToAjvSchema(schema) as any;

        expect(ajvSchema.type).toBe('object');
        expect(ajvSchema.properties.name.type).toBe('string');
        expect(ajvSchema.required).toEqual(['name', 'count']);
      });

      it('递归 schema 自动委托给 unrollRecursiveSchema', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          maxDepth: 2,
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };

        const ajvSchema = convertToAjvSchema(schema) as any;

        // 叶子层 children.items 为 { type: 'object' }
        expect(ajvSchema.properties.children.items.properties.children.items.type).toBe('object');
      });
    });
  });

  // ============ generateSchemaExample 递归测试 ============
  describe('generateSchemaExample (递归)', () => {
    describe('maxDepth=2 示例', () => {
      it('应生成两层嵌套，叶子节点 children=[]', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          maxDepth: 2,
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };

        const example = generateSchemaExample(schema) as Record<string, unknown>;

        expect(example.name).toBe('示例字符串');
        const children = example.children as Record<string, unknown>[];
        expect(children.length).toBe(1);
        // 第 2 层（叶子层）
        expect(children[0].name).toBe('示例字符串');
        expect(children[0].children).toEqual([]);
      });
    });

    describe('maxDepth=1 示例', () => {
      it('应生成单层，children=[]（叶子）', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children'],
          maxDepth: 1,
          properties: {
            name: { type: 'string' },
            children: { type: 'array' }
          }
        };

        const example = generateSchemaExample(schema) as Record<string, unknown>;

        expect(example.name).toBe('示例字符串');
        expect(example.children).toEqual([]);
      });
    });

    describe('多个递归字段示例', () => {
      it('children 和 subItems 都应嵌套，叶子层为空数组', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          recursive: true,
          recursiveFields: ['children', 'subItems'],
          maxDepth: 2,
          properties: {
            name: { type: 'string' },
            children: { type: 'array' },
            subItems: { type: 'array' }
          }
        };

        const example = generateSchemaExample(schema) as Record<string, unknown>;

        expect(example.name).toBe('示例字符串');
        const children = example.children as Record<string, unknown>[];
        const subItems = example.subItems as Record<string, unknown>[];
        expect(children.length).toBe(1);
        expect(subItems.length).toBe(1);
        // 叶子层：两个递归字段都是空数组
        expect(children[0].children).toEqual([]);
        expect(children[0].subItems).toEqual([]);
        expect(subItems[0].children).toEqual([]);
        expect(subItems[0].subItems).toEqual([]);
      });
    });

    describe('非递归 schema 示例不变', () => {
      it('普通 object 示例应与原有逻辑一致', () => {
        const schema: JsonSchemaDef = {
          type: 'object',
          properties: {
            name: { type: 'string' },
            count: { type: 'number' }
          }
        };

        const example = generateSchemaExample(schema);

        expect(example).toEqual({
          name: '示例字符串',
          count: 0
        });
      });
    });
  });

  // ============ validateJsonBySchema 递归校验测试 ============
  describe('validateJsonBySchema (递归)', () => {
    it('校验两层递归结构成功', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        maxDepth: 2,
        properties: {
          name: { type: 'string' },
          children: { type: 'array' }
        }
      };

      const content = JSON.stringify({
        name: 'root',
        children: [
          { name: 'child1', children: [] },
          { name: 'child2', children: [] }
        ]
      });

      const result = validateJsonBySchema(content, schema);
      expect(result.valid).toBe(true);
    });

    it('叶子层允许任意对象（宽松校验）', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        maxDepth: 2,
        properties: {
          name: { type: 'string' },
          children: { type: 'array' }
        }
      };

      // 第 2 层（叶子层）允许包含额外字段，因为 items 放宽为 { type: 'object' }
      const content = JSON.stringify({
        name: 'root',
        children: [
          { name: 'child1', children: [] }
        ]
      });

      const result = validateJsonBySchema(content, schema);
      expect(result.valid).toBe(true);
    });

    it('叶子层 children 非对象（如 string）应失败', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        maxDepth: 2,
        properties: {
          name: { type: 'string' },
          children: { type: 'array' }
        }
      };

      // 叶子层 children 数组中包含非对象元素
      const content = JSON.stringify({
        name: 'root',
        children: [
          { name: 'child1', children: ['string_item'] }
        ]
      });

      const result = validateJsonBySchema(content, schema);
      expect(result.valid).toBe(false);
    });

    it('叶子节点 children 为非数组应失败', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        maxDepth: 2,
        properties: {
          name: { type: 'string' },
          children: { type: 'array' }
        }
      };

      const content = JSON.stringify({
        name: 'root',
        children: [
          { name: 'child1', children: 'not an array' }
        ]
      });

      const result = validateJsonBySchema(content, schema);
      expect(result.valid).toBe(false);
    });
  });

  // ============ buildSchemaFixPrompt 递归测试 ============
  describe('buildSchemaFixPrompt (递归)', () => {
    it('递归 schema 的 fix prompt 应包含树形结构说明', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        maxDepth: 3,
        properties: {
          name: { type: 'string' },
          children: { type: 'array' }
        }
      };

      const errors: SchemaValidationError[] = [
        { path: '/children/0', message: 'should be object', keyword: 'type', params: {}, data: 'string' }
      ];

      const prompt = buildSchemaFixPrompt(errors, '/path/to/file.json', schema);

      expect(prompt).toContain('递归树形结构');
      expect(prompt).toContain('最大深度为 3 层');
      expect(prompt).toContain('叶子节点');
      expect(prompt).toContain('空数组');
    });

    it('非递归 schema 的 fix prompt 不应包含递归说明', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        properties: {
          name: { type: 'string' }
        }
      };

      const errors: SchemaValidationError[] = [
        { path: '/name', message: 'should be string', keyword: 'type', params: {}, data: 123 }
      ];

      const prompt = buildSchemaFixPrompt(errors, '/path/to/file.json', schema);

      expect(prompt).not.toContain('递归树形结构');
    });
  });

  // ============ buildSchemaPrompt 递归测试 ============
  describe('buildSchemaPrompt (递归)', () => {
    it('递归 schema prompt 应包含深度限制和叶子节点约束', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        maxDepth: 3,
        properties: {
          name: { type: 'string' },
          children: { type: 'array' }
        }
      };

      const prompt = buildSchemaPrompt(schema, '/path/to/output.json');

      expect(prompt).toContain('递归树形结构');
      expect(prompt).toContain('最大深度为 3 层');
      expect(prompt).toContain('叶子节点');
      expect(prompt).toContain('空数组');
    });

    it('递归 schema prompt 应标注递归字段', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        recursive: true,
        recursiveFields: ['children'],
        maxDepth: 2,
        properties: {
          name: { type: 'string' },
          children: { type: 'array' }
        }
      };

      const prompt = buildSchemaPrompt(schema, '/path/to/output.json');

      expect(prompt).toContain('递归字段（树形结构）');
      expect(prompt).toContain('children');
    });

    it('非递归 schema prompt 不应包含递归说明', () => {
      const schema: JsonSchemaDef = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'number' }
        }
      };

      const prompt = buildSchemaPrompt(schema, '/path/to/output.json');

      expect(prompt).not.toContain('递归树形结构');
      expect(prompt).not.toContain('递归字段');
      expect(prompt).not.toContain('叶子节点');
    });
  });
});
