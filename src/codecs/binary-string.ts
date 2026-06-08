/**
 * The bytes ↔ binary-string bridge.
 *
 * The canonical byte type in this port is `Uint8Array` (what `encode` returns
 * and `decode` accepts). Inside the encoding-fix step, however, Python operates
 * on `bytes` objects with byte-level regexes. To port those regexes verbatim we
 * convert to a **binary string**: one JS char per byte, where
 * `s.charCodeAt(i) === bytes[i]` for every position (each char is in U+0000..
 * U+00FF). This mirrors Latin-1 round-tripping.
 *
 * NEVER pass a binary string to a Unicode/codepoint helper (normalization,
 * `codePointAt`-based logic, width, etc.). Binary strings are an internal
 * representation of raw bytes, not text.
 *
 * See docs/DESIGN.md → "Bytes boundary".
 */

/** Convert raw bytes to a binary string (one char per byte, 0x00..0xFF). */
export function bytesToBinary(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("latin1");
}

/** Convert a binary string back to raw bytes. Inverse of {@link bytesToBinary}. */
export function binaryToBytes(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
