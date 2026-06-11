/**
 * The codec dispatcher — the single entry point the encoding-fix loop,
 * `guess_bytes`, and `apply_plan` call to decode/encode by encoding name.
 *
 * This is the TypeScript counterpart of how `python-ftfy` consumes
 * `bytes.decode(name)` / `str.encode(name)`: Python registers the "bad codecs"
 * (`ftfy/bad_codecs/__init__.py`'s `search_function`) with the standard codecs
 * API, then leans on `codecs.lookup` to resolve every name — built-in
 * (`utf-8`, `latin-1`, `windows-1252`, …) and bad-codec (`utf-8-variants`,
 * `sloppy-windows-1252`, …) alike. This module folds both layers into one
 * `decode`/`encode` pair routed to the leaf engines.
 *
 * **Strict is the backbone.** `decode` THROWS `DecodeError` on any
 * malformed/truncated/overlong/surrogate input — the fix loop rejects candidate
 * encodings by catching that throw. There is no silent-`U+FFFD` mode and no
 * `errors` argument here; the single `"replace"` path used by
 * `test_russian_crash` goes through the variants `IncrementalDecoder` directly,
 * not through this dispatcher.
 *
 * **Name resolution mirrors CPython + ftfy.** CPython's `codecs.lookup`
 * lowercases and `normalize_encoding`-folds a name (every run of non-alphanumeric
 * characters except `.` becomes a single `_`) before any search function sees it,
 * so `"UTF-8"`, `"utf_8"`, and `"utf 8"` all collapse to the same codec. On top of
 * that, ftfy's `search_function` adds the bad-codec aliases — the
 * `utf-8-variants` family (`cesu8`, `java-utf8`, …) and the `sloppy-*` charmaps.
 *
 * A faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import { CharmapCodec } from "./charmap.js";
import { DecodeError, EncodeError } from "./errors.js";
import { getSloppyCodec, normalizeEncoding, REAL_CODECS } from "./sloppy.js";
import { utf16Decode, utf16Encode } from "./utf16.js";
import { utf8VariantsDecode } from "./utf8-variants.js";
import { utf8Decode, utf8Encode } from "./utf8.js";

export { DecodeError, EncodeError } from "./errors.js";
export { normalizeEncoding } from "./sloppy.js";

/**
 * Aliases for `utf-8-variants`, ported verbatim from `UTF8_VAR_NAMES` in
 * `ftfy/bad_codecs/__init__.py`. These are already in CPython's normalized form
 * (hyphens turned into underscores), so they are compared against the result of
 * {@link normalizeEncoding} (which is applied after lowercasing).
 */
const UTF8_VAR_NAMES: ReadonlySet<string> = new Set([
  "utf_8_variants",
  "utf8_variants",
  "utf_8_variant",
  "utf8_variant",
  "utf_8_var",
  "utf8_var",
  "cesu_8",
  "cesu8",
  "java_utf_8",
  "java_utf8",
]);

/**
 * The real single-byte charmap codecs, keyed by their CPython-normalized name so
 * the dispatcher can find `windows-1252` from `"Windows-1252"`/`"windows_1252"`.
 * Built from `REAL_CODECS` (keyed by table name, e.g. `"windows-1252"`).
 *
 * `latin-1`/`iso-8859-1` both normalize to distinct strings but name the same
 * Latin-1 codec, so both are mapped to the `latin-1` real codec explicitly.
 */
/**
 * CPython alias spellings (already normalized) for the shipped charmap
 * encodings, derived from `encodings.aliases` by resolving every alias with
 * `codecs.lookup` and keeping the ones that land on a codec this port ships.
 * Python resolves all of these, so the dispatcher must too (the CLI's `-e`
 * passes user-supplied names straight through).
 */
const STDLIB_CHARMAP_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "windows-1250": ["cp1250", "1250", "windows_1250"],
  "windows-1251": ["cp1251", "1251", "windows_1251"],
  "windows-1252": ["cp1252", "1252", "windows_1252"],
  "windows-1253": ["cp1253", "1253", "windows_1253"],
  "windows-1254": ["cp1254", "1254", "windows_1254"],
  "windows-1257": ["cp1257", "1257", "windows_1257"],
  "iso-8859-2": [
    "csisolatin2",
    "iso_8859_2",
    "iso_8859_2_1987",
    "iso_ir_101",
    "l2",
    "latin2",
  ],
  macroman: ["mac_roman", "macintosh"],
  cp437: ["437", "cspc8codepage437", "ibm437"],
  "latin-1": [
    "latin_1",
    "latin",
    "latin1",
    "l1",
    "iso8859",
    "iso8859_1",
    "iso_8859_1",
    "iso_8859_1_1987",
    "iso_ir_100",
    "csisolatin1",
    "8859",
    "cp819",
    "ibm819",
  ],
};

const REAL_BY_NORM: ReadonlyMap<string, CharmapCodec> = (() => {
  const map = new Map<string, CharmapCodec>();
  for (const codec of REAL_CODECS.values()) {
    map.set(normalizeEncoding(codec.name), codec);
  }
  for (const [name, aliases] of Object.entries(STDLIB_CHARMAP_ALIASES)) {
    const codec = REAL_CODECS.get(name);
    if (codec === undefined) {
      throw new Error(`alias table names unknown real codec: ${name}`);
    }
    for (const alias of aliases) map.set(alias, codec);
  }
  return map;
})();

/** ASCII strict decode: every byte must be < 0x80, else throw like CPython. */
function asciiDecode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b >= 0x80) {
      throw new DecodeError(
        "ascii",
        bytes,
        i,
        i + 1,
        "ordinal not in range(128)",
      );
    }
    out += String.fromCharCode(b);
  }
  return out;
}

/**
 * Strict range-limited encode shared by ascii (limit 0x80) and latin-1 (limit
 * 0x100). Like CPython, a *run* of consecutive unencodable characters is
 * reported as one error span (`"characters in position 0-1"`), and positions
 * are Python codepoints.
 */
function rangeEncode(
  text: string,
  encoding: string,
  limit: number,
  reason: string,
): Uint8Array {
  const out: number[] = [];
  const cps: number[] = [];
  for (const ch of text) cps.push(ch.codePointAt(0)!);
  for (let pos = 0; pos < cps.length; pos++) {
    const cp = cps[pos]!;
    if (cp >= limit) {
      let end = pos + 1;
      while (end < cps.length && cps[end]! >= limit) end++;
      throw new EncodeError(encoding, text, pos, end, reason);
    }
    out.push(cp);
  }
  return Uint8Array.from(out);
}

/** ASCII strict encode: every codepoint must be < 0x80, else throw like CPython. */
function asciiEncode(text: string): Uint8Array {
  return rangeEncode(text, "ascii", 0x80, "ordinal not in range(128)");
}

/**
 * Latin-1 strict encode. CPython's latin-1 codec is not a charmap codec: its
 * encode error says `"ordinal not in range(256)"` (not the charmap
 * `"character maps to <undefined>"`), so it gets a dedicated path.
 */
function latin1Encode(text: string): Uint8Array {
  return rangeEncode(text, "latin-1", 0x100, "ordinal not in range(256)");
}

/**
 * Describes which engine handles a resolved encoding name. The `codec` slot
 * carries the matched {@link CharmapCodec} for charmap/sloppy kinds, so two names
 * resolving to the same engine compare equal by identity (this is what
 * `test_cesu8`'s "same codec" assertion checks).
 */
export type ResolvedCodec =
  | { readonly kind: "ascii" }
  | { readonly kind: "utf-8" }
  | { readonly kind: "utf-8-variants" }
  | { readonly kind: "utf-16" }
  | { readonly kind: "charmap"; readonly codec: CharmapCodec };

// Singleton tags so identity comparison works for the engine-only kinds.
const ASCII: ResolvedCodec = { kind: "ascii" };
const UTF8: ResolvedCodec = { kind: "utf-8" };
const UTF8_VARIANTS: ResolvedCodec = { kind: "utf-8-variants" };
const UTF16: ResolvedCodec = { kind: "utf-16" };

/**
 * One `ResolvedCodec` wrapper per `CharmapCodec` instance, so identity holds
 * across spellings for charmap kinds too (`resolveEncoding("cp1252") ===
 * resolveEncoding("windows-1252")`), matching the engine-only singletons.
 */
const CHARMAP_WRAPPERS = new Map<CharmapCodec, ResolvedCodec>();

function charmapResolved(codec: CharmapCodec): ResolvedCodec {
  let wrapper = CHARMAP_WRAPPERS.get(codec);
  if (wrapper === undefined) {
    wrapper = { kind: "charmap", codec };
    CHARMAP_WRAPPERS.set(codec, wrapper);
  }
  return wrapper;
}

/** Cache of resolved codecs, keyed by the *raw* (un-normalized) name, mirroring
 * `_CACHE` in `ftfy/bad_codecs/__init__.py` (which also keys on the raw name). */
const CACHE = new Map<string, ResolvedCodec | undefined>();

/**
 * Resolve an encoding name to the engine that handles it, or `undefined` if no
 * engine matches. Mirrors `search_function` plus the stdlib encodings ftfy needs:
 * lowercase + normalize, then try the variants aliases, the `sloppy_*` charmaps,
 * the always-present `utf-8`/`utf-16`/`ascii`, and finally the real single-byte
 * charmaps (including `latin-1`/`iso-8859-1` and the `INCOMPLETE_ENCODINGS` set).
 */
export function resolveEncoding(encoding: string): ResolvedCodec | undefined {
  if (CACHE.has(encoding)) return CACHE.get(encoding);

  const norm = normalizeEncoding(encoding.toLowerCase());
  let resolved: ResolvedCodec | undefined;

  if (UTF8_VAR_NAMES.has(norm)) {
    resolved = UTF8_VARIANTS;
  } else if (norm.startsWith("sloppy_")) {
    const codec = getSloppyCodec(encoding);
    resolved = codec ? charmapResolved(codec) : undefined;
  } else if (
    norm === "utf_8" ||
    norm === "utf8" ||
    norm === "u8" ||
    norm === "cp65001"
  ) {
    resolved = UTF8;
  } else if (norm === "utf_16" || norm === "utf16" || norm === "u16") {
    resolved = UTF16;
  } else if (norm === "ascii" || norm === "us_ascii" || norm === "646") {
    resolved = ASCII;
  } else {
    const codec = REAL_BY_NORM.get(norm);
    resolved = codec ? charmapResolved(codec) : undefined;
  }

  CACHE.set(encoding, resolved);
  return resolved;
}

/**
 * The error CPython raises for an encoding name with no registered codec:
 * `LookupError: unknown encoding: NAME`.
 */
export class UnknownEncodingError extends Error {
  override readonly name = "UnknownEncodingError";
  readonly encoding: string;
  constructor(encoding: string) {
    super(`unknown encoding: ${encoding}`);
    this.encoding = encoding;
  }
}

function requireCodec(encoding: string): ResolvedCodec {
  const resolved = resolveEncoding(encoding);
  if (resolved === undefined) throw new UnknownEncodingError(encoding);
  return resolved;
}

/**
 * Decode raw bytes with the named encoding, the counterpart of Python's
 * `bytes.decode(encoding)`. Strict: THROWS {@link DecodeError} on any
 * malformed/truncated/overlong/surrogate input. THROWS
 * {@link UnknownEncodingError} for an unregistered encoding name.
 */
export function decode(bytes: Uint8Array, encoding: string): string {
  const resolved = requireCodec(encoding);
  switch (resolved.kind) {
    case "ascii":
      return asciiDecode(bytes);
    case "utf-8":
      return utf8Decode(bytes);
    case "utf-8-variants":
      return utf8VariantsDecode(bytes);
    case "utf-16":
      return utf16Decode(bytes);
    case "charmap":
      return resolved.codec.decode(bytes);
  }
}

/**
 * Encode a string with the named encoding, the counterpart of Python's
 * `str.encode(encoding)`. Strict: THROWS {@link EncodeError} for characters the
 * encoding cannot represent (charmap holes, lone surrogates in UTF-8). THROWS
 * {@link UnknownEncodingError} for an unregistered encoding name.
 *
 */
export function encode(text: string, encoding: string): Uint8Array {
  const resolved = requireCodec(encoding);
  switch (resolved.kind) {
    case "ascii":
      return asciiEncode(text);
    case "utf-8":
    case "utf-8-variants":
      // The variants encoder is documented as identical to UTF-8.
      return utf8Encode(text);
    case "utf-16":
      return utf16Encode(text);
    case "charmap":
      // CPython's latin-1 is not a charmap codec; its error message differs.
      return resolved.codec.name === "latin-1"
        ? latin1Encode(text)
        : resolved.codec.encode(text);
  }
}

/**
 * Port of `ftfy.bad_codecs.search_function`, exposed so the upstream
 * `test_encodings.py::test_cesu8` assertion ports: two spellings of a bad-codec
 * name (`"cesu8"` / `"cesu-8"`) must resolve to the *same* codec. Returns the
 * {@link ResolvedCodec} for a name handled by the dispatcher, or `undefined`
 * otherwise. Identity holds across spellings because engine-only kinds are
 * singletons and charmap kinds carry the shared {@link CharmapCodec} instance.
 *
 * Unlike Python's `search_function` (which only knows the *bad* codecs and
 * returns `None` for built-ins), this also resolves the stdlib encodings ftfy
 * needs, since this module is the whole codecs layer for the port.
 */
export function search_function(encoding: string): ResolvedCodec | undefined {
  return resolveEncoding(encoding);
}
