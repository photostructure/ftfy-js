/**
 * Generic single-byte "charmap" codec engine, mirroring CPython's
 * `codecs.charmap_decode` / `codecs.charmap_encode` / `codecs.charmap_build`.
 *
 * A charmap codec is defined by a 256-character *decoding table*: byte `b`
 * decodes to `decodingTable[b]`. Some byte positions are "holes" — bytes that
 * the real encoding leaves unassigned. Strict decoding MUST throw at a hole
 * (the encoding-fix loop relies on the throw), so the engine takes an explicit
 * set of hole positions; the placeholder character stored at a hole position in
 * the table is never returned.
 *
 * The *encode* map is built by iterating the decoding table 0..255 and mapping
 * `char -> byte`, last-write-wins — exactly what `codecs.charmap_build` does.
 *
 * This is a leaf module: it must not import `index.ts`. Errors come from
 * `./errors.js`; the bytes/binary bridge from `./binary-string.js`.
 *
 * A faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import { DecodeError, EncodeError } from "./errors.js";

/**
 * CPython's charmap codec reports errors with the literal encoding label
 * `"charmap"` (not the human-readable encoding name).
 */
const CHARMAP_LABEL = "charmap";

/** CPython's reason text for an unmapped byte / character in a charmap codec. */
const UNDEFINED_REASON = "character maps to <undefined>";

/**
 * Build the encode map (codepoint -> byte) for a decoding table, exactly like
 * `codecs.charmap_build`: iterate 0..255 and assign `table[i] -> i`, so later
 * positions overwrite earlier ones (last-write-wins).
 *
 * `holes` lists byte positions that are unassigned in the *real* encoding. Our
 * generated real tables store a Latin-1 placeholder character at those
 * positions (so the table is exactly 256 chars), but those placeholders are NOT
 * encodable — CPython's table has `None` there. Hole positions are therefore
 * skipped, so the placeholder codepoint never gains a spurious encode entry.
 * Sloppy tables (which have no holes) pass an empty set and round-trip fully.
 *
 * The table is iterated by code unit, but every entry in our generated tables
 * is a single BMP character, so code unit == codepoint here.
 */
export function buildEncodeMap(
  decodingTable: string,
  holes: ReadonlySet<number> = new Set(),
): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < 256; i++) {
    if (holes.has(i)) continue;
    map.set(decodingTable.charCodeAt(i), i);
  }
  return map;
}

/**
 * Decode raw bytes with a single-byte charmap.
 *
 * Throws {@link DecodeError} (with the CPython `"charmap"` label) at the first
 * byte whose position is listed in `holes`. The position/byte are kept as
 * structured fields; the message is pre-formatted to match CPython.
 */
export function charmapDecode(
  bytes: Uint8Array,
  decodingTable: string,
  holes: ReadonlySet<number>,
): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (holes.has(b)) {
      throw new DecodeError(CHARMAP_LABEL, bytes, i, i + 1, UNDEFINED_REASON);
    }
    out += decodingTable[b];
  }
  return out;
}

/**
 * Encode a string with a single-byte charmap.
 *
 * Iterates by codepoint (so astral characters are handled as a unit and report
 * the correct position). Throws {@link EncodeError} (with the CPython
 * `"charmap"` label) at the first character that has no byte in `encodeMap`.
 */
export function charmapEncode(
  text: string,
  encodeMap: ReadonlyMap<number, number>,
): Uint8Array {
  const out: number[] = [];
  // Track Python codepoint positions, not UTF-16 code units.
  let pos = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const byte = encodeMap.get(cp);
    if (byte === undefined) {
      throw new EncodeError(
        CHARMAP_LABEL,
        text,
        pos,
        pos + 1,
        UNDEFINED_REASON,
      );
    }
    out.push(byte);
    pos += 1;
  }
  return Uint8Array.from(out);
}

/**
 * A built charmap codec: the decoding table, the set of hole positions, and the
 * lazily-built encode map. Bundles {@link charmapDecode}/{@link charmapEncode}
 * so callers (the Wave-2 dispatcher, `guess_bytes`) can decode/encode by name.
 */
export class CharmapCodec {
  readonly name: string;
  readonly decodingTable: string;
  readonly holes: ReadonlySet<number>;
  #encodeMap: Map<number, number> | undefined;

  constructor(
    name: string,
    decodingTable: string,
    holes: Iterable<number> = [],
  ) {
    this.name = name;
    this.decodingTable = decodingTable;
    this.holes = new Set(holes);
  }

  decode(bytes: Uint8Array): string {
    return charmapDecode(bytes, this.decodingTable, this.holes);
  }

  encode(text: string): Uint8Array {
    this.#encodeMap ??= buildEncodeMap(this.decodingTable, this.holes);
    return charmapEncode(text, this.#encodeMap);
  }

  /** The encode map, built on first use. */
  encodeMap(): ReadonlyMap<number, number> {
    this.#encodeMap ??= buildEncodeMap(this.decodingTable, this.holes);
    return this.#encodeMap;
  }
}
