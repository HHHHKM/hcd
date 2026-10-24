import { canonicalJson, canonicalizeInline, plainText, type Inline, type TextRun } from './model';

export type TextMarks = Omit<TextRun, 't'>;
export type Unit = { text: string; marks: TextMarks };
export type Hunk = { start: number; end: number; insert: Unit[] };
export type MergeResult<T extends Inline | string = Inline | string> = {
  status: 'clean' | 'duplicate' | 'merged' | 'conflict';
  value?: T;
  conflicts?: Array<[Hunk, Hunk]>;
};
const stringTokenLists = new WeakSet<Unit[]>();

const han = /\p{Script=Han}/u;
const hira = /\p{Script=Hiragana}/u;
const kata = /\p{Script=Katakana}/u;
const hangul = /\p{Script=Hangul}/u;
const word = /^[\p{L}\p{N}_]$/u;

function isSingleTokenChar(char: string): boolean {
  return han.test(char) || hira.test(char) || kata.test(char) || hangul.test(char);
}

function marksOf(run: TextRun): TextMarks {
  const { t: _t, ...marks } = run;
  return marks;
}

function unitKey(unit: Unit): string {
  return `${unit.text}\u0000${canonicalJson(unit.marks)}`;
}

export function tokenize(value: Inline | string): Unit[] {
  if (typeof value === 'string') {
    const units = tokenizeString(value);
    stringTokenLists.add(units);
    return units;
  }
  const units: Unit[] = [];
  for (const run of canonicalizeInline(value)) {
    if ('br' in run) {
      units.push({ text: '\n', marks: {} });
      continue;
    }
    const chars = Array.from(run.t);
    let index = 0;
    const marks = marksOf(run);
    while (index < chars.length) {
      const first = chars[index]!;
      if (isSingleTokenChar(first) || /\s/u.test(first) || !word.test(first)) {
        units.push({ text: first, marks: { ...marks } });
        index += 1;
        continue;
      }
      let text = first;
      index += 1;
      while (index < chars.length && word.test(chars[index]!) && !isSingleTokenChar(chars[index]!)) {
        text += chars[index]!;
        index += 1;
      }
      units.push({ text, marks: { ...marks } });
    }
  }
  return units;
}

function tokenizeString(value: string): Unit[] {
  const units: Unit[] = [];
  const chars = Array.from(value);
  let i = 0;
  while (i < chars.length) {
    const first = chars[i]!;
    if (first === '\n' || /\s/u.test(first) || isSingleTokenChar(first) || !word.test(first)) {
      units.push({ text: first, marks: {} });
      i += 1;
      continue;
    }
    let text = first;
    i += 1;
    while (i < chars.length && word.test(chars[i]!) && !isSingleTokenChar(chars[i]!)) {
      text += chars[i]!;
      i += 1;
    }
    units.push({ text, marks: {} });
  }
  return units;
}

export function detokenize(units: Unit[], asString = stringTokenLists.has(units)): Inline | string {
  if (asString) return units.map((unit) => unit.text).join('');
  const inline: Inline = [];
  for (const unit of units) {
    if (unit.text === '\n' && Object.keys(unit.marks).length === 0) {
      inline.push({ br: true });
      continue;
    }
    const previous = inline.at(-1);
    const run: TextRun = { t: unit.text, ...unit.marks };
    if (previous && !('br' in previous) && canonicalJson(marksOf(previous)) === canonicalJson(unit.marks)) previous.t += run.t;
    else inline.push(run);
  }
  return canonicalizeInline(inline);
}

function sameUnit(a: Unit, b: Unit): boolean { return unitKey(a) === unitKey(b); }
function sameHunk(a: Hunk, b: Hunk): boolean { return a.start === b.start && a.end === b.end && a.insert.length === b.insert.length && a.insert.every((unit, i) => sameUnit(unit, b.insert[i]!)); }

type Edit = { kind: 'equal' | 'delete' | 'insert'; unit: Unit };

/** Myers O(ND) shortest edit script. Ties choose deletion before insertion. */
function myers(base: Unit[], next: Unit[]): Edit[] {
  const n = base.length;
  const m = next.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Array<number>(2 * max + 3).fill(-1);
  v[offset + 1] = 0;
  const trace: number[][] = [];
  let distance = 0;
  outer: for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
        ? v[offset + k + 1]!
        : v[offset + k - 1]! + 1;
      let nextX = x;
      let nextY = nextX - k;
      while (nextX < n && nextY < m && sameUnit(base[nextX]!, next[nextY]!)) { nextX += 1; nextY += 1; }
      v[offset + k] = nextX;
      if (nextX >= n && nextY >= m) { distance = d; break outer; }
    }
  }
  const reversed: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = distance; d >= 0; d -= 1) {
    const previous = trace[d]!;
    const k = x - y;
    const previousK = k === -d || (k !== d && previous[offset + k - 1]! < previous[offset + k + 1]!) ? k + 1 : k - 1;
    const previousX = previous[offset + previousK]!;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      reversed.push({ kind: 'equal', unit: base[x - 1]! });
      x -= 1;
      y -= 1;
    }
    if (d === 0) break;
    if (x === previousX) {
      reversed.push({ kind: 'insert', unit: next[y - 1]! });
      y -= 1;
    } else {
      reversed.push({ kind: 'delete', unit: base[x - 1]! });
      x -= 1;
    }
  }
  return reversed.reverse();
}

export function diffHunks(base: Unit[], next: Unit[]): Hunk[] {
  const hunks: Hunk[] = [];
  let baseIndex = 0;
  let active: Hunk | undefined;
  const close = () => { if (active) { hunks.push(active); active = undefined; } };
  for (const edit of myers(base, next)) {
    if (edit.kind === 'equal') { close(); baseIndex += 1; continue; }
    if (!active) active = { start: baseIndex, end: baseIndex, insert: [] };
    if (edit.kind === 'delete') { active.end += 1; baseIndex += 1; }
    else active.insert.push(edit.unit);
  }
  close();
  return hunks;
}

function applyHunks(base: Unit[], hunks: Hunk[]): Unit[] {
  const result = base.slice();
  [...hunks].sort((a, b) => b.start - a.start || b.end - a.end).forEach((hunk) => result.splice(hunk.start, hunk.end - hunk.start, ...hunk.insert));
  return result;
}

function equalValue(a: Inline | string, b: Inline | string): boolean {
  if (typeof a === 'string' || typeof b === 'string') return String(a) === String(b);
  return canonicalJson(canonicalizeInline(a)) === canonicalJson(canonicalizeInline(b));
}

function mergeValue(base: Inline | string, current: Inline | string, incoming: Inline | string): Inline | string {
  const stringMode = typeof base === 'string' && typeof current === 'string' && typeof incoming === 'string';
  const currentHunks = diffHunks(tokenize(base), tokenize(current));
  const incomingHunks = diffHunks(tokenize(base), tokenize(incoming));
  const conflicts: Array<[Hunk, Hunk]> = [];
  for (const first of currentHunks) for (const second of incomingHunks) {
    if (sameHunk(first, second)) continue;
    if (first.start <= second.end && second.start <= first.end) conflicts.push([first, second]);
  }
  if (conflicts.length) return { __conflict: conflicts } as unknown as Inline;
  const combined = [...currentHunks];
  for (const hunk of incomingHunks) if (!combined.some((existing) => sameHunk(existing, hunk))) combined.push(hunk);
  combined.sort((a, b) => a.start - b.start || a.end - b.end);
  const value = applyHunks(tokenize(base), combined);
  return stringMode ? detokenize(value, true) : detokenize(value);
}

export function mergeText<T extends Inline | string>(base: T, current: T, incoming: T): MergeResult<T> {
  if (equalValue(incoming, base)) return { status: 'clean', value: current };
  if (equalValue(current, base)) return { status: 'clean', value: incoming };
  if (equalValue(current, incoming)) return { status: 'duplicate', value: current };
  const merged = mergeValue(base, current, incoming) as Inline | string | { __conflict: Array<[Hunk, Hunk]> };
  if (typeof merged === 'object' && '__conflict' in merged) return { status: 'conflict', conflicts: merged.__conflict };
  return { status: 'merged', value: merged as T };
}

export function textValue(value: Inline | string): string { return typeof value === 'string' ? value : plainText(value); }
