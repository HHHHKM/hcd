/** BUILD_SPEC §20.5: a PAT contains 160 bits encoded as 32 lowercase base32 characters. */
export const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
export const PERSONAL_ACCESS_TOKEN_PREFIX = 'hcd_pat_';
export const PERSONAL_ACCESS_TOKEN_BYTES = 20;
export const PERSONAL_ACCESS_TOKEN_PATTERN = new RegExp(`^${PERSONAL_ACCESS_TOKEN_PREFIX}[${BASE32_ALPHABET}]{32}$`);

export function base32(bytes: Uint8Array): string {
  let out = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; out += BASE32_ALPHABET[(value >>> bits) & 31]; }
  }
  if (bits) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function personalAccessToken(bytes: Uint8Array): string {
  if (bytes.length !== PERSONAL_ACCESS_TOKEN_BYTES) throw new Error('A personal access token requires exactly 20 bytes.');
  return `${PERSONAL_ACCESS_TOKEN_PREFIX}${base32(bytes)}`;
}
