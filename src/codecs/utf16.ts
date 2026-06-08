/**
 * UTF-16 decoding with byte-order-mark detection.
 *
 * Only used by `guess_bytes`, which tries UTF-16 first because a BOM
 * (`b"\xfe\xff"` or `b"\xff\xfe"`) "looks like nothing else". This mirrors
 * Python's `bstring.decode("utf-16")`: a leading BOM selects big- or
 * little-endian and is consumed; the remaining 16-bit code units are decoded,
 * combining surrogate pairs.
 *
 * Strict, like every decoder in this port: it THROWS {@link DecodeError} on a
 * trailing odd byte ("truncated data"), a high surrogate at end of input
 * ("unexpected end of data"), a high surrogate not followed by a low surrogate
 * ("illegal UTF-16 surrogate"), and a lone low surrogate ("illegal encoding").
 * Error positions are relative to the start of the byte buffer, matching
 * CPython (which counts the consumed BOM, so the first data byte is position 2).
 *
 * Leaf module: must not import `index.ts`.
 *
 * A faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import { DecodeError } from "./errors.js";

/** True when the buffer begins with a UTF-16 byte order mark. */
export function hasUtf16Bom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 2 &&
    ((bytes[0] === 0xfe && bytes[1] === 0xff) ||
      (bytes[0] === 0xff && bytes[1] === 0xfe))
  );
}

/**
 * Decode UTF-16 with BOM detection, like Python's `decode("utf-16")`.
 *
 * Requires a BOM to pick endianness; a buffer with no BOM is decoded as
 * little-endian, matching CPython's platform-independent default for the
 * `"utf-16"` codec on the platforms ftfy targets. (In practice `guess_bytes`
 * only calls this when a BOM is present.)
 */
export function utf16Decode(bytes: Uint8Array): string {
  let pos = 0;
  let littleEndian = true;
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    littleEndian = false;
    pos = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    littleEndian = true;
    pos = 2;
  }

  const label = littleEndian ? "utf-16-le" : "utf-16-be";
  const unit = (i: number): number =>
    littleEndian
      ? bytes[i]! | (bytes[i + 1]! << 8)
      : (bytes[i]! << 8) | bytes[i + 1]!;

  let out = "";
  while (pos < bytes.length) {
    if (pos + 1 >= bytes.length) {
      // One byte left over: truncated 16-bit code unit.
      throw new DecodeError(label, bytes, pos, pos + 1, "truncated data");
    }
    const w = unit(pos);
    if (w >= 0xd800 && w <= 0xdbff) {
      // High surrogate: must be followed by a low surrogate.
      if (pos + 3 >= bytes.length) {
        throw new DecodeError(
          label,
          bytes,
          pos,
          bytes.length,
          "unexpected end of data",
        );
      }
      const w2 = unit(pos + 2);
      if (w2 >= 0xdc00 && w2 <= 0xdfff) {
        const cp = 0x10000 + (((w - 0xd800) << 10) | (w2 - 0xdc00));
        out += String.fromCodePoint(cp);
        pos += 4;
      } else {
        throw new DecodeError(
          label,
          bytes,
          pos,
          pos + 2,
          "illegal UTF-16 surrogate",
        );
      }
    } else if (w >= 0xdc00 && w <= 0xdfff) {
      // Lone low surrogate.
      throw new DecodeError(label, bytes, pos, pos + 2, "illegal encoding");
    } else {
      out += String.fromCharCode(w);
      pos += 2;
    }
  }
  return out;
}
