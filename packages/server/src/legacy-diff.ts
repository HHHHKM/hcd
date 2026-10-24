import { canonicalJson } from '../../core/src/model';
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function diffValues(before: unknown, after: unknown, path = ''): Array<{ path: string; before: unknown; after: unknown }> {
  if (canonicalJson(before) === canonicalJson(after)) return [];
  if (isObject(before) && isObject(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((key) => diffValues(before[key], after[key], `${path}/${key}`));
  }
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) return before.flatMap((item, index) => diffValues(item, after[index], `${path}/${index}`));
  return [{ path: path || '/', before: clone(before), after: clone(after) }];
}
