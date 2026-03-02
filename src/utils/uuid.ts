import { v4 as uuidv4 } from 'uuid';

/**
 * 生成 UUID v4
 */
export function generateUUID(): string {
  return uuidv4();
}