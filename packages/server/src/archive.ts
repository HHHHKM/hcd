import { createHash } from 'node:crypto';
import { crc32, inflateRawSync } from 'node:zlib';

export const archiveLimits = { bytes: 30 * 1024 * 1024, files: 1000, fileBytes: 10 * 1024 * 1024, expandedBytes: 50 * 1024 * 1024 } as const;
export class ArchiveError extends Error { constructor(public code: string) { super(code); } }
function read16(bytes: Uint8Array, offset: number) { return bytes[offset]! | (bytes[offset + 1]! << 8); }
function read32(bytes: Uint8Array, offset: number) { return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0; }
const invalid = (): never => { throw new ArchiveError('IMPORT_ARCHIVE_INVALID'); };

/** Check directory and local headers before bounded inflation; never extract paths to disk. */
export function inspectArchive(bytes: Uint8Array): Record<string, Uint8Array> {
  if (!bytes.length || bytes.length > archiveLimits.bytes) throw new ArchiveError('IMPORT_TOO_LARGE_OR_UNSUPPORTED');
  try {
    const minimum = Math.max(0, bytes.length - 65_557); let end = -1;
    for (let index = bytes.length - 22; index >= minimum; index--) {
      if (read32(bytes, index) === 0x06054b50 && index + 22 + read16(bytes, index + 20) === bytes.length) { end = index; break; }
    }
    if (end < 0 || read16(bytes, end + 4) !== 0 || read16(bytes, end + 6) !== 0) invalid();
    const count = read16(bytes, end + 10); const centralSize = read32(bytes, end + 12); const centralOffset = read32(bytes, end + 16);
    if (!count || count > archiveLimits.files || read16(bytes, end + 8) !== count || centralOffset + centralSize !== end) invalid();
    let cursor = centralOffset; let total = 0;
    const paths = new Set<string>(); const ranges: Array<[number, number]> = [];
    const entries: Array<{ path: string; start: number; end: number; size: number; crc: number; method: number }> = [];
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > end || read32(bytes, cursor) !== 0x02014b50) invalid();
      const flags = read16(bytes, cursor + 8); const method = read16(bytes, cursor + 10); const crc = read32(bytes, cursor + 16);
      const compressed = read32(bytes, cursor + 20); const expanded = read32(bytes, cursor + 24);
      const nameLength = read16(bytes, cursor + 28); const extraLength = read16(bytes, cursor + 30); const commentLength = read16(bytes, cursor + 32);
      const local = read32(bytes, cursor + 42); const nameEnd = cursor + 46 + nameLength; const next = nameEnd + extraLength + commentLength;
      // This format permits UTF-8 and DEFLATE speed flags; data descriptors/ZIP64/encryption are unsupported.
      if (next > end || flags & ~0x0806 || (method !== 0 && method !== 8) || expanded > archiveLimits.fileBytes || compressed > archiveLimits.bytes || read16(bytes, cursor + 34)) invalid();
      for (let extra = nameEnd; extra < nameEnd + extraLength;) {
        if (extra + 4 > nameEnd + extraLength || read16(bytes, extra) === 1) invalid();
        extra += 4 + read16(bytes, extra + 2); if (extra > nameEnd + extraLength) invalid();
      }
      total += expanded; if (total > archiveLimits.expandedBytes) invalid();
      const path = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(cursor + 46, nameEnd));
      if (!path || path !== path.normalize('NFC') || /[\\\x00-\x1f\x7f]/.test(path) || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split('/').some((part) => part === '..' || part === '.' || !part) || paths.has(path)) invalid();
      const mode = read32(bytes, cursor + 38) >>> 16;
      if ((mode & 0xf000) && (mode & 0xf000) !== 0x8000) invalid();
      if (local + 30 > centralOffset || read32(bytes, local) !== 0x04034b50 || read16(bytes, local + 6) !== flags || read16(bytes, local + 8) !== method || read32(bytes, local + 14) !== crc || read32(bytes, local + 18) !== compressed || read32(bytes, local + 22) !== expanded || read16(bytes, local + 26) !== nameLength) invalid();
      const start = local + 30 + nameLength + read16(bytes, local + 28); const finish = start + compressed;
      if (finish > centralOffset || !Buffer.from(bytes.subarray(local + 30, local + 30 + nameLength)).equals(Buffer.from(bytes.subarray(cursor + 46, nameEnd)))) invalid();
      paths.add(path); ranges.push([local, finish]); entries.push({ path, start, end: finish, size: expanded, crc, method }); cursor = next;
    }
    if (cursor !== centralOffset + centralSize) invalid();
    ranges.sort((a, b) => a[0] - b[0]);
    if (ranges[0]![0] !== 0 || ranges.at(-1)![1] !== centralOffset || ranges.some((range, i) => i > 0 && range[0] !== ranges[i - 1]![1])) invalid();
    const files = Object.create(null) as Record<string, Uint8Array>;
    for (const entry of entries) {
      const compressed = bytes.subarray(entry.start, entry.end);
      const value = entry.method === 0 ? compressed.slice() : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size + 1) });
      if (value.length !== entry.size || crc32(value) !== entry.crc) invalid();
      files[entry.path] = value;
    }
    return files;
  } catch (error) { if (error instanceof ArchiveError) throw error; return invalid(); }
}

export function sha256(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
