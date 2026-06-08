/**
 * The "sloppy" single-byte codecs, mirroring `ftfy/bad_codecs/sloppy.py`.
 *
 * A sloppy codec fills the "holes" of a real single-byte encoding by mapping
 * each unassigned byte to the Unicode character with the same number (the
 * Latin-1 fallback). This matches the HTML5 standard and what web browsers do.
 * The generated `SLOPPY_DECODING_STRINGS` table already encodes this (Latin-1
 * base, real decode overlaid where it is not U+FFFD, byte 0x1A forced to
 * U+FFFD), so the sloppy codecs have *no holes* and never throw on decode.
 *
 * This module also exposes the *real* single-byte codecs (windows-1252,
 * iso-8859-2, macroman, cp437, latin-1, …) built from `REAL_DECODING_STRINGS` /
 * `REAL_DECODING_HOLES`; those DO throw at their holes. ftfy's encoding-fix loop
 * and `guess_bytes` reach these through the Wave-2 dispatcher.
 *
 * Leaf module: must not import `index.ts`.
 *
 * A faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import {
  REAL_DECODING_HOLES,
  REAL_DECODING_STRINGS,
  SLOPPY_DECODING_STRINGS,
} from "../generated/charmaps.js";
import { CharmapCodec } from "./charmap.js";

/**
 * Normalize an encoding name the way CPython's `encodings.normalize_encoding`
 * does: collapse every run of non-alphanumeric characters (except `.`) to a
 * single `_`, drop leading/trailing underscores, keep case. Used so that
 * `"sloppy-windows-1252"`, `"sloppy_windows_1252"`, etc. all resolve to one key.
 */
export function normalizeEncoding(encoding: string): string {
  const chars: string[] = [];
  let punct = false;
  for (const c of encoding) {
    const isAlnum = /[\p{L}\p{N}]/u.test(c);
    if (isAlnum || c === ".") {
      if (punct && chars.length > 0) chars.push("_");
      // CPython keeps only ASCII alphanumerics in the output.
      if (c.charCodeAt(0) < 128) chars.push(c);
      punct = false;
    } else {
      punct = true;
    }
  }
  return chars.join("");
}

/**
 * Real single-byte codecs (which throw at their unassigned bytes), keyed by
 * their non-normalized table name as it appears in `REAL_DECODING_STRINGS`
 * (e.g. `"windows-1252"`, `"iso-8859-2"`, `"macroman"`, `"cp437"`, `"latin-1"`).
 */
export const REAL_CODECS: ReadonlyMap<string, CharmapCodec> = (() => {
  const map = new Map<string, CharmapCodec>();
  for (const [name, table] of Object.entries(REAL_DECODING_STRINGS)) {
    const holes = REAL_DECODING_HOLES[name] ?? [];
    map.set(name, new CharmapCodec(name, table, holes));
  }
  return map;
})();

/**
 * Sloppy codecs, keyed by their *normalized* name (e.g. `"sloppy_windows_1252"`,
 * `"sloppy_cp1252"`, `"sloppy_iso_8859_3"`). Mirrors the `CODECS` dict in
 * `ftfy/bad_codecs/sloppy.py`, which is keyed by `normalize_encoding(...)`.
 * Sloppy codecs have no holes, so decode never throws.
 */
export const SLOPPY_CODECS: ReadonlyMap<string, CharmapCodec> = (() => {
  const map = new Map<string, CharmapCodec>();
  for (const [name, table] of Object.entries(SLOPPY_DECODING_STRINGS)) {
    map.set(normalizeEncoding(name), new CharmapCodec(name, table));
  }
  return map;
})();

/**
 * Look up a sloppy codec by any spelling of its name (`"sloppy-windows-1252"`,
 * `"sloppy_cp1252"`, `"Sloppy-Windows-1252"`, …). Returns `undefined` for
 * unknown names.
 *
 * Mirrors `ftfy.bad_codecs.sloppy.CODECS.get(normalize_encoding(name))` as
 * reached through Python's codecs framework: `codecs.lookup` lowercases the
 * encoding name before dispatching to the search function, so this lowercases
 * before normalizing (whereas `normalizeEncoding` itself is case-preserving,
 * matching `encodings.normalize_encoding`).
 */
export function getSloppyCodec(encoding: string): CharmapCodec | undefined {
  return SLOPPY_CODECS.get(normalizeEncoding(encoding.toLowerCase()));
}
