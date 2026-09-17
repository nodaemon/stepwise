import { JsonSchemaDef, OutputFormat } from '../src/types';
import { buildSchemaPrompt } from '../src/utils/promptBuilder';
import { buildJsonSchema, validateAgainstSchema } from '../src/utils/schemaUtils';
import { convertToAjvSchema, validateJsonBySchema, validateRefsAndDefs } from '../src/utils/validator';
import { StepWise } from '../src/StepWise';
import { setTaskName, _resetState } from '../src/globalState';

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

describe('buildJsonSchema 支持 PropertyDef ref/defs', () => {
  test('ref 映射为 $ref，defs 映射为 $defs', () => {
    const format: OutputFormat = {
      deps: { type: 'array', ref: '#/$defs/Dep' },
      name: { type: 'string' }
    };
    const schema: any = buildJsonSchema(format as any);
    // buildJsonSchema 本身不做 defs 承载——defs 挂在 OutputFormat 顶层无法表达，
    // 约定：OutputFormat 路径的 defs 定义在首个字段的 defs 上（或直接使用 JsonSchemaDef 路径）
    // 此处只断言 ref 透传
    expect(schema.items.properties.deps.$ref).toBe('#/$defs/Dep');
  });

  test('字段携带 defs 时合并进产物 $defs，AJV 可校验', () => {
    const format: OutputFormat = {
      deps: {
        type: 'array',
        ref: '#/$defs/Dep',
        defs: { Dep: { type: 'object', properties: { module: { type: 'string' } } } }
      } as any,
      name: { type: 'string' }
    };
    const schema: any = buildJsonSchema(format as any);
    expect(schema.$defs.Dep).toBeDefined();
    expect(schema.items.properties.deps.$ref).toBe('#/$defs/Dep');

    const ok = [{ deps: [{ module: 'a' }], name: 'x' }];
    expect(validateAgainstSchema(ok, schema).valid).toBe(true);
    const bad = [{ deps: [{ module: 1 }], name: 'x' }];
    expect(validateAgainstSchema(bad, schema).valid).toBe(false);
  });
});

describe('validateRefsAndDefs 构建期校验', () => {
  test('ref 字段带白名单外字段应抛异常', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: { Dep: { type: 'object', properties: { m: { type: 'string' } } } },
      properties: {
        deps: { type: 'array', ref: '#/$defs/Dep', items: { type: 'string' } } as any
      }
    };
    expect(() => validateRefsAndDefs(schema)).toThrow('仅允许 ref + description');
  });

  test('ref 指向不存在的 defs 应抛异常', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: { deps: { type: 'array', items: { ref: '#/$defs/NoExist' } } }
    };
    expect(() => validateRefsAndDefs(schema)).toThrow('NoExist');
  });

  test('组件间循环引用应抛异常并附引用链', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: {
        A: { type: 'object', properties: { b: { ref: '#/$defs/B' } } },
        B: { type: 'object', properties: { a: { ref: '#/$defs/A' } } }
      },
      properties: { x: { ref: '#/$defs/A' } }
    };
    expect(() => validateRefsAndDefs(schema)).toThrow('A -> B -> A');
  });

  test('$defs 内自引用递归合法（不抛异常）', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: {
        TreeNode: {
          type: 'object',
          properties: { children: { type: 'array', items: { ref: '#/$defs/TreeNode' } } }
        }
      },
      properties: { wbs: { type: 'array', items: { ref: '#/$defs/TreeNode' } } }
    };
    expect(() => validateRefsAndDefs(schema)).not.toThrow();
  });

  test('recursive 机制与 ref 在同一字段混用应抛异常', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      recursive: true,
      recursiveFields: ['children'],
      properties: {
        name: { type: 'string' },
        children: { type: 'array', ref: '#/$defs/X' } as any
      },
      defs: { X: { type: 'object', properties: { a: { type: 'string' } } } }
    };
    expect(() => validateRefsAndDefs(schema)).toThrow('recursive');
  });

  test('嵌套层 defs 被忽略并 console.warn', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        inner: {
          type: 'object',
          defs: { X: { type: 'object', properties: { a: { type: 'string' } } } },
          properties: { a: { type: 'string' } }
        }
      }
    };
    expect(() => validateRefsAndDefs(schema)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('defs'));
    warnSpy.mockRestore();
  });

  test('execPromptSchema 入口触发 validateRefsAndDefs（混用抛错端到端）', async () => {
    _resetState();
    setTaskName('DefsRefGateTest');
    const agent = new StepWise('DefsRefGateAgent');
    const schema: JsonSchemaDef = {
      type: 'object',
      recursive: true,
      recursiveFields: ['children'],
      properties: {
        name: { type: 'string' },
        children: { type: 'array', ref: '#/$defs/X' } as any
      },
      defs: { X: { type: 'object', properties: { a: { type: 'string' } } } }
    };
    await expect(agent.execPromptSchema('test', schema, 'out.json')).rejects.toThrow('recursive');
  });

  test('execPromptSchema 入口：ref 指向不存在组件端到端（穿透到 validateRefsAndDefs）', async () => {
    _resetState();
    setTaskName('DefsRefGateTest2');
    const agent = new StepWise('DefsRefGateAgent2');
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        deps: { type: 'array', items: { ref: '#/$defs/NoExist' } }
      }
    };
    await expect(agent.execPromptSchema('test', schema, 'out.json')).rejects.toThrow('NoExist');
  });
});

describe('buildSchemaPrompt 瘦身', () => {
  const schema: JsonSchemaDef = {
    type: 'object',
    description: '模块分析',
    properties: {
      name: { type: 'string', description: '模块名' },
      count: { type: 'number', description: '数量' }
    }
  };

  test('不再包含「结构说明」小节', () => {
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    expect(prompt).not.toContain('## 结构说明');
    expect(prompt).not.toContain('类型: object');
  });

  test('schema JSON 为紧凑格式（无缩进换行）', () => {
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    expect(prompt).toContain(JSON.stringify(schema));
    expect(prompt).not.toContain(JSON.stringify(schema, null, 2));
  });

  test('体积显著下降（同 schema 紧凑+删说明 < 原实现的 60%）', () => {
    // 经验断言：防回归阈值，非精确值
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    expect(prompt.length).toBeLessThan(1200);
  });
});
