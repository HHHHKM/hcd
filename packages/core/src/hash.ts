import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalJson } from './model';

export function hashOf(value: unknown): string {
  return Array.from(sha256(utf8ToBytes(canonicalJson(value))), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export { canonicalJson } from './model';
