import { JsonSchemaDef } from '../src/types';
import { buildJsonSchema } from '../src/utils/schemaUtils';
import { convertToAjvSchema } from '../src/utils/validator';
import { validateJsonBySchema } from '../src/utils/validator';
import { OutputFormat } from '../src/types';

describe('defs/ref 类型扩展', () => {
  test('JsonSchemaDef 接受 defs 和 ref 字段（编译期）', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: {
        Dependency: { type: 'object', properties: { module: { type: 'string' } } }
      },
      properties: {
        deps: { type: 'array', items: { ref: '#/$defs/Dependency' } }
      }
    };
    expect(schema.defs).toBeDefined();
    expect(schema.properties?.deps.items?.ref).toBe('#/$defs/Dependency');
  });

  test('PropertyDef 接受 defs 和 ref 字段（编译期）', () => {
    const format: OutputFormat = {
      deps: { type: 'array', ref: '#/$defs/Dependency' }
    };
    expect(format.deps.ref).toBe('#/$defs/Dependency');
  });

  test('convertToAjvSchema 将 ref/defs 映射为标准 $ref/$defs 且 AJV 可编译校验', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: {
        Dependency: {
          type: 'object',
          properties: { module: { type: 'string' }, circular: { type: 'boolean' } }
        }
      },
      properties: {
        deps: { type: 'array', items: { ref: '#/$defs/Dependency' } }
      }
    };
    const ajvSchema = convertToAjvSchema(schema) as any;
    expect(ajvSchema.$defs).toBeDefined();
    expect(ajvSchema.$defs.Dependency).toBeDefined();
    expect(ajvSchema.properties.deps.items.$ref).toBe('#/$defs/Dependency');

    // AJV 端到端
    const ok = { deps: [{ module: 'a', circular: false }] };
    const bad = { deps: [{ module: 'a', circular: 'no' }] };
    const good = validateJsonBySchema(JSON.stringify(ok), schema);
    const badResult = validateJsonBySchema(JSON.stringify(bad), schema);
    expect(good.valid).toBe(true);
    expect(badResult.valid).toBe(false);
  });

  test('$defs 内自引用递归被 AJV 惰性支持', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: {
        TreeNode: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            children: { type: 'array', items: { ref: '#/$defs/TreeNode' } }
          }
        }
      },
      properties: {
        wbs: { type: 'array', items: { ref: '#/$defs/TreeNode' } }
      }
    };
    const deep = { wbs: [{ id: '1', children: [{ id: '1.1', children: [{ id: '1.1.1', children: [] }] }] }] };
    const result = validateJsonBySchema(JSON.stringify(deep), schema);
    expect(result.valid).toBe(true);
  });

  test('buildJsonSchema 支持 PropertyDef 的 ref/defs', () => {
    const format: OutputFormat = {
      deps: { type: 'array', ref: '#/$defs/Dep' },
      name: { type: 'string' }
    };
    // buildJsonSchema 的 ref 支持在 Task 3 实现；本测试先锁定类型层不报错
    const schema = buildJsonSchema(format);
    expect(schema).toBeDefined();
  });
});
