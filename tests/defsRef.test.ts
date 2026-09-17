import { JsonSchemaDef, OutputFormat } from '../src/types';
import { expandRefs, buildSchemaPrompt } from '../src/utils/promptBuilder';
import { buildJsonSchema, validateAgainstSchema } from '../src/utils/schemaUtils';
import { convertToAjvSchema, validateJsonBySchema, validateRefsAndDefs, generateSchemaExample, buildSchemaFixPrompt } from '../src/utils/validator';
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

describe('递归示例单节点化', () => {
  const schema: JsonSchemaDef = {
    type: 'object',
    recursive: true,
    recursiveFields: ['children'],
    maxDepth: 8,
    properties: {
      id: { type: 'string', description: '节点编号' },
      detail: { type: 'string', description: '工作内容' },
      children: { type: 'array' }
    }
  };

  test('单节点：递归字段为占位数组而非按 maxDepth 展开', () => {
    const example = generateSchemaExample(schema) as any;
    expect(example.id).toBe('节点编号');
    // 占位：空数组（单节点形态）
    expect(example.children).toEqual([]);
  });

  test('示例体积不随 maxDepth 增长', () => {
    const s1 = { ...schema, maxDepth: 2 };
    const s2 = { ...schema, maxDepth: 8 };
    const len1 = JSON.stringify(generateSchemaExample(s1)).length;
    const len2 = JSON.stringify(generateSchemaExample(s2)).length;
    expect(len1).toBe(len2);
  });

  test('多个递归字段都是占位数组', () => {
    const multi: JsonSchemaDef = {
      type: 'object',
      recursive: true,
      recursiveFields: ['children', 'subItems'],
      maxDepth: 5,
      properties: {
        name: { type: 'string' },
        children: { type: 'array' },
        subItems: { type: 'array' }
      }
    };
    const example = generateSchemaExample(multi) as any;
    expect(example.children).toEqual([]);
    expect(example.subItems).toEqual([]);
  });

  test('buildSchemaFixPrompt 的示例同样单节点化', () => {
    const errors = [{ path: '/children/0', message: 'should be object', keyword: 'type', params: {}, data: 'x' }];
    const prompt = buildSchemaFixPrompt(errors, '/f.json', schema);
    // 不含多层嵌套示例（maxDepth=8 若展开会非常长）
    expect(prompt.length).toBeLessThan(2500);
  });
});

describe('buildSchemaFixPrompt 与主 prompt 对齐（紧凑 + $defs/$ref 渲染）', () => {
  const errors = [{ path: '/wbs/0/id', message: 'must be string', keyword: 'type', params: {}, data: 1 }];

  test('defs schema：渲染标准 $defs/$ref 形态并含回查引导语', () => {
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
    const prompt = buildSchemaFixPrompt(errors, '/f.json', schema);
    expect(prompt).toContain('"$defs"');
    expect(prompt).toContain('"$ref":"#/$defs/TreeNode"');
    // 不泄漏 ref/defs 简写键
    expect(prompt).not.toContain('"ref"');
    expect(prompt).not.toContain('"defs"');
    // 回查引导语（修复要求第 6 条）
    expect(prompt).toContain('按名称回查上方 $defs');
  });

  test('无 defs schema：不含回查引导语，schema 为紧凑 JSON', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: {
        name: { type: 'string', description: '名称' },
        count: { type: 'number' }
      }
    };
    const prompt = buildSchemaFixPrompt(errors, '/f.json', schema);
    expect(prompt).not.toContain('按名称回查');
    // 紧凑：无缩进换行形态
    expect(prompt).toContain(JSON.stringify(schema));
    expect(prompt).not.toContain(JSON.stringify(schema, null, 2));
    // 示例同为紧凑格式
    expect(prompt).not.toMatch(/\n\s+"name"/);
  });
});

describe('expandRefs 去重视图', () => {
  test('$defs 组件只渲染一次，引用点为 $ref 标记', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      description: '模块全景',
      defs: {
        Dependency: {
          type: 'object',
          properties: { module: { type: 'string' }, kind: { type: 'string' } }
        }
      },
      properties: {
        deps: { type: 'array', items: { ref: '#/$defs/Dependency' } },
        devDeps: { type: 'array', items: { ref: '#/$defs/Dependency' } },
        peerDeps: { type: 'array', items: { ref: '#/$defs/Dependency' } }
      }
    };
    const rendered = expandRefs(schema);
    const parsed = JSON.parse(rendered);
    // $defs 出现且仅一次
    expect(parsed.$defs.Dependency).toBeDefined();
    // 引用点为 $ref
    expect(parsed.properties.deps.items.$ref).toBe('#/$defs/Dependency');
    // 组件全文只出现一次（去重生效）
    const occurrences = (rendered.match(/"Dependency":/g) || []).length;
    expect(occurrences).toBe(1);
  });

  test('不含 defs 的 schema 渲染为紧凑 JSON（与原行为一致）', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      properties: { name: { type: 'string' } }
    };
    expect(expandRefs(schema)).toBe(JSON.stringify(schema));
  });

  test('buildSchemaPrompt 对含 defs 的 schema 渲染 $defs 引导语', () => {
    const schema: JsonSchemaDef = {
      type: 'object',
      defs: {
        Dep: { type: 'object', properties: { module: { type: 'string' } } }
      },
      properties: {
        deps: { type: 'array', items: { ref: '#/$defs/Dep' } }
      }
    };
    const prompt = buildSchemaPrompt(schema, '/tmp/out.json');
    expect(prompt).toContain('$defs');
    expect(prompt).toContain('$ref');
    expect(prompt).toContain('按名称回查');
  });
});

describe('端到端：defs 定义递归节点 + 多处 ref 引用', () => {
  beforeEach(() => {
    _resetState();
    setTaskName('DefsRefE2E');
  });

  test('用户场景：wbs/riskTree 引用同一递归 TreeNode，构建期不抛错且 prompt 含 $defs', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = new StepWise('DefsRefE2EAgent');

    const schema: JsonSchemaDef = {
      type: 'object',
      description: 'WBS 分析',
      defs: {
        TreeNode: {
          type: 'object',
          description: '树节点',
          properties: {
            id: { type: 'string', description: '节点编号' },
            detail: { type: 'string', description: '工作内容' },
            children: { type: 'array', description: '子节点', items: { ref: '#/$defs/TreeNode' } }
          }
        }
      },
      properties: {
        wbs: { type: 'array', description: '工作树', items: { ref: '#/$defs/TreeNode' } },
        riskTree: { ref: '#/$defs/TreeNode', description: '风险树' }
      }
    };

    // 构建期校验通过（执行被 mock，不真正跑 agent）
    const prompt = buildSchemaPrompt(schema, '/tmp/e2e.json');
    expect(prompt).toContain('$defs');
    expect(prompt).toContain('TreeNode');

    // 去重生效：TreeNode 组件全文只出现一次
    const rendered = expandRefs(schema);
    expect((rendered.match(/"TreeNode":/g) || []).length).toBe(1);

    warnSpy.mockRestore();
  });

  test('AJV 校验该 schema 的真实数据（合法/违规路径）', () => {
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

    const ok = { wbs: [{ id: '1', children: [{ id: '1.1', children: [] }] }] };
    expect(validateJsonBySchema(JSON.stringify(ok), schema).valid).toBe(true);

    const bad = { wbs: [{ id: 1, children: [] }] };
    const badResult = validateJsonBySchema(JSON.stringify(bad), schema);
    expect(badResult.valid).toBe(false);
    // 错误路径指向引用展开位置
    expect(badResult.errors[0].path).toBe('/wbs/0/id');
  });
});
