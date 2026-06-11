/**
 * The individual fixes that `fix_text` can perform, and the functions named in
 * "explanations" such as the output of `fix_and_explain`.
 *
 * Port of `ftfy/fixes.py`. The 12 string→string fixers plus the byte-level
 * fixers (`restore_byte_a0`, `replace_lossy_sequences`) that operate on **binary
 * strings** (one JS char per byte, U+0000..U+00FF — see `codecs/binary-string`),
 * so Python's `bytes` regexes port verbatim. There are also two standalone
 * helpers that ftfy never runs automatically but exposes as more robust versions
 * of stdlib functions: `decode_escapes` and `unescape_html`.
 *
 * Parity notes:
 *
 * - `fix_surrogates` uses `SURROGATE_RE`/`SURROGATE_PAIR_RE` compiled **without**
 *   the `u` flag so they match lone surrogate code *units*;
 *   `convert_surrogate_pair` uses `charCodeAt`.
 * - `remove_control_chars`, `fix_latin_ligatures`, and `fix_character_width` are
 *   `str.translate` ports — they iterate **by codepoint** over the codepoint-keyed
 *   maps `CONTROL_CHARS`/`LIGATURES`/`WIDTH_MAP`, never by UTF-16 code unit.
 * - `decode_inconsistent_utf8` calls back into `index.ts`'s `fix_encoding`; the
 *   module namespace is imported lazily inside the callback to break the
 *   `fixes ↔ index` import cycle (Python uses a late `import ftfy`).
 * - The byte fixers are typed `(bin: string) => string`; never feed binary
 *   strings to Unicode helpers.
 *
 * This is a faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import { is_bad } from "./badness.js";
import {
  ALTERED_UTF8_RE,
  C1_CONTROL_RE,
  CONTROL_CHARS,
  DOUBLE_QUOTE_RE,
  HTML_ENTITIES,
  HTML_ENTITY_RE,
  LIGATURES,
  LOSSY_UTF8_RE,
  SINGLE_QUOTE_RE,
  UTF8_DETECTOR_RE,
  WIDTH_MAP,
} from "./chardata.js";
import { decode, encode } from "./codecs/index.js";
import { registerFixers } from "./config.js";
import { unescape as htmlUnescape } from "./html-entities.js";
// The `fixes ↔ index` import cycle is broken the ESM way: import the module
// *namespace* and only *call* `ftfyIndex.fix_encoding` lazily (inside the
// `decode_inconsistent_utf8` callback, never at module-eval time). ESM live
// bindings guarantee the namespace is populated by the time the callback runs.
// Mirrors Python's late `import ftfy` inside `decode_inconsistent_utf8`.
import * as ftfyIndex from "./index.js";

/**
 * Apply a Python `str.translate`-style mapping (a codepoint-keyed map of
 * replacements, where a `null` value deletes the codepoint), iterating **by
 * codepoint** so astral characters are handled as single units.
 */
function translate(text: string, mapping: Map<number, string | null>): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (mapping.has(cp)) {
      const replacement = mapping.get(cp);
      if (replacement != null) {
        out += replacement;
      }
      // `null` (or `undefined` from a delete entry) drops the character.
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Replace one matched HTML entity with the character it represents, if possible.
 * Port of `_unescape_fixup`.
 */
function unescapeFixup(text: string): string {
  if (HTML_ENTITIES.has(text)) {
    return HTML_ENTITIES.get(text)!;
  } else if (text.startsWith("&#")) {
    const unescaped = htmlUnescape(text);
    // If html.unescape only decoded part of the string, that's not what we
    // want. The semicolon should be consumed.
    if (unescaped.includes(";")) {
      return text;
    } else {
      return unescaped;
    }
  } else {
    return text;
  }
}

/**
 * Decode HTML entities and character references, including some nonstandard ones
 * written in all-caps.
 *
 * We decode the escape sequences that appear in the `html.entities.html5`
 * dictionary, as long as they are the unambiguous ones that end in semicolons.
 * We also decode all-caps versions of Latin letters and common symbols.
 *
 * Port of `unescape_html`.
 */
export function unescape_html(text: string): string {
  // HTML_ENTITY_RE is exported with the `g` flag (it is only ever a replace-all
  // target), so `.replace` consumes/resets its lastIndex per call.
  return text.replace(HTML_ENTITY_RE, (m) => unescapeFixup(m));
}

const ANSI_RE = /\x1b\[((?:\d|;)*)([a-zA-Z])/g;

/**
 * Strip out "ANSI" terminal escape sequences, such as those that produce colored
 * text on Unix.
 *
 * Port of `remove_terminal_escapes`.
 */
export function remove_terminal_escapes(text: string): string {
  return text.replace(ANSI_RE, "");
}

/**
 * Replace curly quotation marks with straight equivalents.
 *
 * Port of `uncurl_quotes`. SINGLE_QUOTE_RE/DOUBLE_QUOTE_RE are exported with the
 * `g` flag, matching Python's `.sub` (replace-all) usage.
 */
export function uncurl_quotes(text: string): string {
  return text.replace(DOUBLE_QUOTE_RE, '"').replace(SINGLE_QUOTE_RE, "'");
}

/**
 * Replace single-character ligatures of Latin letters, such as 'ﬁ', with the
 * characters that they contain, as in 'fi'.
 *
 * Port of `fix_latin_ligatures` (`text.translate(LIGATURES)`).
 */
export function fix_latin_ligatures(text: string): string {
  return translate(text, LIGATURES);
}

/**
 * Replace halfwidth/fullwidth Latin, katakana, and Hangul characters with their
 * standard forms (and the ideographic space U+3000 with an ASCII space).
 *
 * Port of `fix_character_width` (`text.translate(WIDTH_MAP)`).
 */
export function fix_character_width(text: string): string {
  return translate(text, WIDTH_MAP);
}

/**
 * Convert all line breaks to Unix style (`\n`): CRLF, CR, LINE SEPARATOR
 * (U+2028), PARAGRAPH SEPARATOR (U+2029), and NEXT LINE (U+0085).
 *
 * Port of `fix_line_breaks`. Uses `replaceAll` so every occurrence is converted,
 * matching Python `str.replace` (which replaces all).
 */
export function fix_line_breaks(text: string): string {
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\u2028", "\n")
    .replaceAll("\u2029", "\n")
    .replaceAll("\u0085", "\n");
}

// Match lone surrogate code units / surrogate pairs. Compiled WITHOUT the `u`
// flag so the character classes match individual UTF-16 code units rather than
// codepoints (a `u`-flagged class would reject lone surrogates).
//
// Python operates on codepoints, so after `convert_surrogate_pair` turns a valid
// pair into a single astral codepoint, Python's `SURROGATE_RE` no longer matches
// it. JS strings are UTF-16, so that same astral codepoint is *still* stored as a
// surrogate pair — a naive `[\ud800-\udfff]` would re-match its halves and
// clobber the character we just rebuilt. To preserve parity, the FFFD step
// targets only *lone* (unpaired) surrogates: a high surrogate not followed by a
// low, or a low surrogate not preceded by a high.
const SURROGATE_RE = /[\ud800-\udfff]/;
const LONE_SURROGATE_RE_G =
  /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const SURROGATE_PAIR_RE_G = /[\ud800-\udbff][\udc00-\udfff]/g;

/**
 * Convert a surrogate pair to the single codepoint it represents. Port of
 * `convert_surrogate_pair`; uses `charCodeAt` (code units), not `codePointAt`.
 */
function convertSurrogatePair(pair: string): string {
  const codept =
    0x10000 +
    (pair.charCodeAt(0) - 0xd800) * 0x400 +
    (pair.charCodeAt(1) - 0xdc00);
  return String.fromCodePoint(codept);
}

/**
 * Replace 16-bit surrogate codepoints with the characters they represent (when
 * properly paired), or with U+FFFD otherwise.
 *
 * Port of `fix_surrogates`.
 */
export function fix_surrogates(text: string): string {
  if (SURROGATE_RE.test(text)) {
    text = text.replace(SURROGATE_PAIR_RE_G, (m) => convertSurrogatePair(m));
    text = text.replace(LONE_SURROGATE_RE_G, "\ufffd");
  }
  return text;
}

/**
 * Remove various control characters that you probably didn't intend to be in
 * your text (see the codepoint ranges built into `CONTROL_CHARS`).
 *
 * Port of `remove_control_chars` (`text.translate(CONTROL_CHARS)`).
 */
export function remove_control_chars(text: string): string {
  return translate(text, CONTROL_CHARS);
}

/**
 * Remove a byte-order mark that was accidentally decoded as if it were part of
 * the text. Port of `remove_bom` (`text.lstrip(chr(0xFEFF))`).
 */
export function remove_bom(text: string): string {
  let i = 0;
  while (i < text.length && text.charCodeAt(i) === 0xfeff) {
    i++;
  }
  return text.slice(i);
}

// A regex matching the valid escape sequences in Python string literals,
// mirroring `ESCAPE_SEQUENCE_RE`. Compiled without `u`; the `.` here matches any
// character except newline, exactly like Python's non-DOTALL `.`.
const ESCAPE_SEQUENCE_RE =
  /(\\U[\s\S]{8}|\\u[\s\S]{4}|\\x[\s\S]{2}|\\[0-7]{1,3}|\\N\{[^}]+\}|\\[\\'"abfnrtv])/g;

const SINGLE_CHAR_ESCAPES: Record<string, string> = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\x07",
  b: "\x08",
  f: "\x0c",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\x0b",
};

/**
 * Decode a single backslash escape sequence the way CPython's "unicode-escape"
 * codec does, for the sequences `ESCAPE_SEQUENCE_RE` can match. `\N{...}` (named
 * characters) is intentionally not supported: it requires the full Unicode name
 * table, ftfy never runs this fixer automatically, and no upstream test pins it.
 */
function decodeEscapeSequence(seq: string): string {
  const marker = seq[1]!;
  if (marker === "U" || marker === "u" || marker === "x") {
    return String.fromCodePoint(Number.parseInt(seq.slice(2), 16));
  }
  if (marker >= "0" && marker <= "7") {
    return String.fromCharCode(Number.parseInt(seq.slice(1), 8) & 0xff);
  }
  if (marker === "N") {
    throw new Error(
      "decode_escapes: \\N{...} named escapes are not supported in this port",
    );
  }
  const single = SINGLE_CHAR_ESCAPES[marker];
  if (single !== undefined) {
    return single;
  }
  // Unreachable for inputs that matched ESCAPE_SEQUENCE_RE.
  return seq;
}

/**
 * Decode backslashed escape sequences, including `\x`, `\u`, and `\U` character
 * references, even in the presence of other Unicode.
 *
 * This function has to be called specifically; ftfy does not run it
 * automatically. Port of `decode_escapes`.
 */
export function decode_escapes(text: string): string {
  return text.replace(ESCAPE_SEQUENCE_RE, (m) => decodeEscapeSequence(m));
}

// Restore byte A0 (NO-BREAK SPACE) that a Windows-1252 program turned into an
// ASCII space, but make exceptions so " Ã " decodes "à " (a separate word), and
// for the Portuguese contractions "às/àquele/àquela/àquilo". Python `bytes`
// pattern → runs on a binary string, compiled WITHOUT the `u` flag.
const A_GRAVE_WORD_RE_G = /\xc3 (?! |quele|quela|quilo|s )/g;

// Clone of ALTERED_UTF8_RE with the `g` flag for replace-all. No `u` flag —
// these are binary strings (see chardata.ts).
const ALTERED_UTF8_RE_G = new RegExp(ALTERED_UTF8_RE.source, "g");

/**
 * Put back the byte A0 in sequences that would convincingly decode as UTF-8 if a
 * stray space (byte 0x20) were a non-breaking space (byte 0xA0). Operates on a
 * **binary string**. Port of `restore_byte_a0`.
 */
export function restore_byte_a0(byts: string): string {
  byts = byts.replace(A_GRAVE_WORD_RE_G, "\xc3\xa0 ");
  return byts.replace(ALTERED_UTF8_RE_G, (m) => m.replaceAll("\x20", "\xa0"));
}

// The binary string for the UTF-8 encoding of U+FFFD (EF BF BD).
const UTF8_FFFD_BINARY = "\xef\xbf\xbd";

/**
 * Replace lossy UTF-8 sequences (where continuation bytes have been replaced by
 * byte 0x1A or '?') with the UTF-8 encoding of U+FFFD. Operates on a **binary
 * string**. Port of `replace_lossy_sequences`.
 *
 * LOSSY_UTF8_RE is already exported with the `g` flag (and no `u` flag).
 */
export function replace_lossy_sequences(byts: string): string {
  return byts.replace(LOSSY_UTF8_RE, UTF8_FFFD_BINARY);
}

// Clone of UTF8_DETECTOR_RE with the `g` flag for replace-all (and `u`, since it
// operates on real codepoint text).
const UTF8_DETECTOR_RE_G = new RegExp(UTF8_DETECTOR_RE.source, "gu");

/**
 * Fix text from one encoding embedded within text from a different one, by
 * detecting distinctly-UTF-8-looking sequences and re-running `fix_encoding` on
 * just those substrings.
 *
 * Port of `decode_inconsistent_utf8`. Imports `index.ts` lazily (require) inside
 * the callback to break the `fixes ↔ index` import cycle, mirroring Python's late
 * `import ftfy`.
 */
export function decode_inconsistent_utf8(text: string): string {
  return text.replace(UTF8_DETECTOR_RE_G, (substr) => {
    // Require the match to be shorter, so this doesn't recurse infinitely. Use
    // codepoint length (Array.from) to mirror Python `len`.
    if (Array.from(substr).length < Array.from(text).length && is_bad(substr)) {
      return ftfyIndex.fix_encoding(substr);
    }
    return substr;
  });
}

// Clone of C1_CONTROL_RE with the `g` flag for replace-all (`u` ok — real text).
const C1_CONTROL_RE_G = new RegExp(C1_CONTROL_RE.source, "gu");

/**
 * Convert a single C1 control character to its Windows-1252 equivalent, the way
 * `_c1_fixer` does: `match.encode("latin-1").decode("sloppy-windows-1252")`.
 */
function c1Fixer(ch: string): string {
  return decode(encode(ch, "latin-1"), "sloppy-windows-1252");
}

/**
 * If text still contains C1 control characters, treat them as their Windows-1252
 * equivalents (matching what Web browsers do). Port of `fix_c1_controls`.
 */
export function fix_c1_controls(text: string): string {
  return text.replace(C1_CONTROL_RE_G, (m) => c1Fixer(m));
}

// Wire the real fixer implementations into the FIXERS registry that config.ts
// owns. This is the seam that breaks the cycle: config.ts never imports fixes.ts,
// and index.ts imports fixes.ts so this registration runs before any FIXERS
// lookup. The byte-level fixers (`restore_byte_a0`, `replace_lossy_sequences`)
// take/return binary strings; the rest take/return Unicode strings — both shapes
// satisfy the registry's `(string) => string` FixerFn type.
registerFixers({
  unescape_html,
  remove_terminal_escapes,
  restore_byte_a0,
  replace_lossy_sequences,
  decode_inconsistent_utf8,
  fix_c1_controls,
  fix_latin_ligatures,
  fix_character_width,
  uncurl_quotes,
  fix_line_breaks,
  fix_surrogates,
  remove_control_chars,
});
