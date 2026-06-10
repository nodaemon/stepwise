import {
  buildJsonSchema,
  getFirstRequiredField,
  getRequiredFields,
  checkDuplicateKeys,
  validateAgainstSchema,
  formatValidationErrors
} from '../src/utils/schemaUtils';
import { OutputFormat } from '../src/types';

describe('schemaUtils', () => {
  describe('buildJsonSchema', () => {
    it('should generate correct JSON Schema from OutputFormat', () => {
      const format: OutputFormat = {
        id: { type: 'string', description: 'User ID' },
        name: { type: 'string', description: 'User name' },
        age: { type: 'number', description: 'Age', required: false }
      };

      const schema = buildJsonSchema(format);

      expect(schema.type).toBe('array');
      expect(schema.items?.type).toBe('object');
      expect(schema.items?.properties).toEqual({
        id: { type: 'string', description: 'User ID' },
        name: { type: 'string', description: 'User name' },
        age: { type: 'number', description: 'Age' }
      });
      expect(schema.items?.required).toEqual(['id', 'name']);
    });

    it('should handle all required: false', () => {
      const format: OutputFormat = {
        optional1: { type: 'string', required: false },
        optional2: { type: 'number', required: false }
      };

      const schema = buildJsonSchema(format);

      expect(schema.items?.required).toBeUndefined();
    });
  });

  describe('getFirstRequiredField', () => {
    it('should return first required field', () => {
      const format: OutputFormat = {
        id: { type: 'string' },
        name: { type: 'string', required: false },
        age: { type: 'number' }
      };

      expect(getFirstRequiredField(format)).toBe('id');
    });

    it('should return null when no required fields', () => {
      const format: OutputFormat = {
        optional: { type: 'string', required: false }
      };

      expect(getFirstRequiredField(format)).toBeNull();
    });
  });

  describe('getRequiredFields', () => {
    it('should return all required fields', () => {
      const format: OutputFormat = {
        id: { type: 'string' },
        name: { type: 'string' },
        optional: { type: 'string', required: false }
      };

      const required = getRequiredFields(format);
      expect(required).toEqual(['id', 'name']);
    });

    it('should return empty array when no required fields', () => {
      const format: OutputFormat = {
        opt1: { type: 'string', required: false },
        opt2: { type: 'number', required: false }
      };

      expect(getRequiredFields(format)).toEqual([]);
    });
  });

  describe('checkDuplicateKeys', () => {
    it('should detect duplicates', () => {
      const data = [
        { id: 'a', name: 'First' },
        { id: 'b', name: 'Second' },
        { id: 'a', name: 'Third' }
      ];

      const result = checkDuplicateKeys(data, 'id');

      expect(result.hasDuplicates).toBe(true);
      expect(result.duplicates).toEqual(['a']);
    });

    it('should return no duplicates for unique data', () => {
      const data = [
        { id: 'a', name: 'First' },
        { id: 'b', name: 'Second' }
      ];

      const result = checkDuplicateKeys(data, 'id');

      expect(result.hasDuplicates).toBe(false);
      expect(result.duplicates).toEqual([]);
    });

    it('should handle missing keys gracefully', () => {
      const data = [
        { id: 'a', name: 'First' },
        { name: 'No ID' },
        { id: 'a', name: 'Third' }
      ];

      const result = checkDuplicateKeys(data, 'id');

      expect(result.hasDuplicates).toBe(true);
    });
  });

  describe('validateAgainstSchema', () => {
    it('should validate correct array data', () => {
      const schema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' }
          },
          required: ['id', 'name']
        }
      };

      const data = [
        { id: '1', name: 'First' },
        { id: '2', name: 'Second' }
      ];

      const result = validateAgainstSchema(data, schema);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(data);
    });

    it('should detect non-array data and include keyword', () => {
      const schema = {
        type: 'array',
        items: { type: 'object' }
      };

      const result = validateAgainstSchema({ data: [] }, schema);

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('array');
      expect(result.errors[0].keyword).toBe('type');
      expect(result.errors[0].path).toBe('');
      expect(result.errors[0].params).toBeDefined();
      // data may be undefined for root-level errors
    });

    it('should detect missing required fields and include keyword', () => {
      const schema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' }
          },
          required: ['id']
        }
      };

      const data = [{ name: 'No ID' }];

      const result = validateAgainstSchema(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.keyword === 'required')).toBe(true);
      // AJV original message is in English
      expect(result.errors.some(e => e.message.includes('required'))).toBe(true);
    });

    it('should detect type mismatches and include keyword', () => {
      const schema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            count: { type: 'number' }
          }
        }
      };

      const data = [
        { id: 123, count: 'abc' }  // Wrong types
      ];

      const result = validateAgainstSchema(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.keyword === 'type')).toBe(true);
      // AJV original message is in English
      expect(result.errors.some(e => e.message.includes('string') || e.message.includes('number'))).toBe(true);
    });

    it('should detect non-object items', () => {
      const schema = {
        type: 'array',
        items: { type: 'object' }
      };

      const data = ['string', 123, null];

      const result = validateAgainstSchema(data, schema);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(3);
      expect(result.errors.every(e => e.keyword === 'type')).toBe(true);
    });

    it('should preserve AJV instance path format', () => {
      const schema = {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' }
          },
          required: ['id']
        }
      };

      const data = [{ name: 'test' }];

      const result = validateAgainstSchema(data, schema);

      expect(result.valid).toBe(false);
      // AJV uses /0 format for paths
      expect(result.errors[0].path).toBe('/0');
    });
  });

  describe('formatValidationErrors', () => {
    it('should format errors correctly', () => {
      const errors = [
        { path: '/0/id', message: 'missing required property', keyword: 'required', params: {}, data: undefined },
        { path: '/1/name', message: 'expected string, got number', keyword: 'type', params: {}, data: 123 }
      ];

      const formatted = formatValidationErrors(errors);

      expect(formatted).toContain('/0/id: missing required property');
      expect(formatted).toContain('/1/name: expected string');
    });

    it('should handle root level errors', () => {
      const errors = [
        { path: '', message: 'expected array', keyword: 'type', params: {}, data: null }
      ];

      const formatted = formatValidationErrors(errors);

      expect(formatted).toContain('(root)');
    });
  });

  describe('convertToAjvSchema (from validator)', () => {
    // Import from validator since convertToAjvSchema is there
    const { convertToAjvSchema, validateJsonBySchema } = require('../src/utils/validator');

    it('should convert flat object schema', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          count: { type: 'number' as const }
        }
      };

      const ajvSchema = convertToAjvSchema(schema);

      expect(ajvSchema.type).toBe('object');
      expect(ajvSchema.properties).toBeDefined();
      expect(ajvSchema.properties!.name.type).toBe('string');
      expect(ajvSchema.properties!.count.type).toBe('number');
      expect(ajvSchema.required).toEqual(['name', 'count']);
    });

    it('should convert nested object schema', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          projectName: { type: 'string' as const },
          statistics: {
            type: 'object' as const,
            properties: {
              total: { type: 'number' as const },
              breakdown: {
                type: 'array' as const,
                items: {
                  type: 'object' as const,
                  properties: {
                    category: { type: 'string' as const },
                    count: { type: 'number' as const }
                  }
                }
              }
            }
          }
        }
      };

      const ajvSchema = convertToAjvSchema(schema);

      expect(ajvSchema.type).toBe('object');
      expect(ajvSchema.properties!.statistics.type).toBe('object');
      expect(ajvSchema.properties!.statistics.properties!.breakdown.type).toBe('array');
      expect(ajvSchema.properties!.statistics.properties!.breakdown.items!.type).toBe('object');
      expect(ajvSchema.properties!.statistics.properties!.breakdown.items!.properties!.category.type).toBe('string');
    });

    it('should convert array schema with complex items', () => {
      const schema = {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            endpoint: { type: 'string' as const },
            method: { type: 'string' as const }
          }
        }
      };

      const ajvSchema = convertToAjvSchema(schema);

      expect(ajvSchema.type).toBe('array');
      expect(ajvSchema.items!.type).toBe('object');
      expect(ajvSchema.items!.properties!.endpoint.type).toBe('string');
      expect(ajvSchema.items!.required).toEqual(['endpoint', 'method']);
    });

    it('should convert simple string array schema', () => {
      const schema = {
        type: 'array' as const,
        items: { type: 'string' as const }
      };

      const ajvSchema = convertToAjvSchema(schema);

      expect(ajvSchema.type).toBe('array');
      expect(ajvSchema.items!.type).toBe('string');
    });

    it('should use explicit required when provided', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          optional: { type: 'string' as const }
        },
        required: ['name']
      };

      const ajvSchema = convertToAjvSchema(schema);

      expect(ajvSchema.required).toEqual(['name']);
    });

    it('should default all fields to required when required not specified', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          a: { type: 'string' as const },
          b: { type: 'number' as const }
        }
      };

      const ajvSchema = convertToAjvSchema(schema);

      expect(ajvSchema.required).toEqual(['a', 'b']);
    });
  });

  describe('validateJsonBySchema (from validator)', () => {
    const { validateJsonBySchema } = require('../src/utils/validator');

    it('should validate a flat object successfully', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          count: { type: 'number' as const }
        }
      };

      const content = JSON.stringify({ name: 'test', count: 5 });
      const result = validateJsonBySchema(content, schema);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual({ name: 'test', count: 5 });
    });

    it('should validate a nested object successfully', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          projectName: { type: 'string' as const },
          statistics: {
            type: 'object' as const,
            properties: {
              total: { type: 'number' as const }
            }
          }
        }
      };

      const content = JSON.stringify({
        projectName: 'stepwise',
        statistics: { total: 45 }
      });
      const result = validateJsonBySchema(content, schema);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual({
        projectName: 'stepwise',
        statistics: { total: 45 }
      });
    });

    it('should validate an array successfully', () => {
      const schema = {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            endpoint: { type: 'string' as const },
            method: { type: 'string' as const }
          }
        }
      };

      const content = JSON.stringify([
        { endpoint: '/api/users', method: 'GET' },
        { endpoint: '/api/posts', method: 'POST' }
      ]);
      const result = validateJsonBySchema(content, schema);

      expect(result.valid).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should validate a simple string array', () => {
      const schema = {
        type: 'array' as const,
        items: { type: 'string' as const }
      };

      const content = JSON.stringify(['item1', 'item2', 'item3']);
      const result = validateJsonBySchema(content, schema);

      expect(result.valid).toBe(true);
      expect(result.data).toEqual(['item1', 'item2', 'item3']);
    });

    it('should fail validation when type mismatch', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          count: { type: 'number' as const }
        }
      };

      const content = JSON.stringify({ count: 'not a number' });
      const result = validateJsonBySchema(content, schema);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should fail validation when required field missing', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const },
          required: { type: 'string' as const }
        },
        required: ['name', 'required']
      };

      const content = JSON.stringify({ name: 'test' });
      const result = validateJsonBySchema(content, schema);

      expect(result.valid).toBe(false);
    });

    it('should fail validation on JSON parse error', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const }
        }
      };

      const result = validateJsonBySchema('invalid json{{{', schema);

      expect(result.valid).toBe(false);
      expect(result.errors[0].keyword).toBe('parse_error');
    });

    it('should fail validation when data wrapped in extra layer', () => {
      const schema = {
        type: 'object' as const,
        properties: {
          name: { type: 'string' as const }
        }
      };

      // AI wraps the data in { "data": { ... } }
      const content = JSON.stringify({ data: { name: 'test' } });
      const result = validateJsonBySchema(content, schema);

      expect(result.valid).toBe(false);
    });
  });
});