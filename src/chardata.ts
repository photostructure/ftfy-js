/**
 * This gives other modules access to the gritty details about characters and
 * the encodings that use them.
 *
 * Port of `ftfy/chardata.py`. The large data tables that Python builds from
 * `unicodedata` / hard-coded `\N{...}` literals are emitted by codegen and
 * consumed here:
 *
 * - `ENCODING_REGEX_SOURCES` (per-encoding `possible_encoding` patterns) and
 *   `UTF8_CLUES` (the mojibake-detector character classes) live in
 *   `src/generated/`.
 * - The HTML5 entity dictionary lives in `src/generated/html5-entities.ts` and
 *   is consumed by `unescape()`; `HTML_ENTITIES` is rebuilt from it at runtime
 *   here, exactly as Python's `_build_html_entities` does.
 * - `CONTROL_CHARS`, `LIGATURES`, and `WIDTH_MAP` are built at runtime here
 *   (range loops / NFKC normalization / a literal map), mirroring Python.
 *
 * Parity notes:
 *
 * - **Byte-level regexes** (`ALTERED_UTF8_RE`, `LOSSY_UTF8_RE`) are Python
 *   `bytes` patterns. They operate on **binary strings** (one JS char per byte,
 *   each in U+0000..U+00FF — see `codecs/binary-string.ts`). Each Python byte
 *   `\xNN` maps to the JS code unit `\xNN`, and the patterns are compiled
 *   **without** the `u` flag so a class like `[\x80-\xbf]` matches a single
 *   byte rather than a Unicode codepoint. Never pass real (codepoint) text to
 *   these.
 * - **Character-level tables** (`CONTROL_CHARS`, `LIGATURES`, `WIDTH_MAP`) are
 *   codepoint-keyed `Map<number, string | null>`. Any `translate()`-style
 *   application must iterate by codepoint, not by UTF-16 code unit.
 * - `possible_encoding` mirrors Python's `re.match` on `^[...]*$`. Because the
 *   newline `\n` (0x0A) lies inside `\x00-\x19`, it is a member of every
 *   encoding class, so Python's "`$` also matches before a trailing newline"
 *   rule never changes the result versus a plain JS end-anchored test. See the
 *   chardata tests for the exhaustive check.
 *
 * This is a faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import { ENCODING_REGEX_SOURCES } from "./generated/encoding-regexes.js";
import { HTML5_ENTITIES } from "./generated/html5-entities.js";
import { UTF8_CLUES } from "./generated/utf8-clues.js";
import { unescape } from "./html-entities.js";

// These are the encodings we will try to fix in ftfy, in the
// order that they should be tried.
export const CHARMAP_ENCODINGS: readonly string[] = [
  "latin-1",
  "sloppy-windows-1252",
  "sloppy-windows-1251",
  "sloppy-windows-1250",
  "sloppy-windows-1253",
  "sloppy-windows-1254",
  "sloppy-windows-1257",
  "iso-8859-2",
  "macroman",
  "cp437",
];

export const SINGLE_QUOTE_RE = /[ʼ‘-‛]/g;
export const DOUBLE_QUOTE_RE = /[“-‟]/g;

/**
 * ENCODING_REGEXES contain reasonably fast ways to detect if we could represent
 * a given string in a given encoding. The simplest one is the 'ascii' detector,
 * which of course just determines if all characters are between U+0000 and
 * U+007F.
 *
 * The pattern sources are emitted verbatim by codegen (mirroring Python's
 * `_build_regexes`); we compile them here with the `u` flag so astral
 * characters count as single codepoints.
 */
function buildRegexes(): Map<string, RegExp> {
  const encodingRegexes = new Map<string, RegExp>();
  for (const [encoding, source] of Object.entries(ENCODING_REGEX_SOURCES)) {
    encodingRegexes.set(encoding, new RegExp(source, "u"));
  }
  return encodingRegexes;
}

export const ENCODING_REGEXES: Map<string, RegExp> = buildRegexes();

/**
 * Create a dictionary based on the built-in HTML5 entity dictionary.
 *
 * Add a limited set of HTML entities that we'll also decode if they've been
 * case-folded to uppercase, such as decoding `&NTILDE;` as "Ñ". Mirrors
 * Python's `_build_html_entities`.
 */
function buildHtmlEntities(): Map<string, string> {
  const entities = new Map<string, string>();
  for (const [name, char] of Object.entries(HTML5_ENTITIES)) {
    if (name.endsWith(";")) {
      entities.set("&" + name, char);

      // Restrict the set of characters we can attempt to decode if their name
      // has been uppercased. If we tried to handle all entity names, the
      // results would be ambiguous.
      if (name === name.toLowerCase()) {
        const nameUpper = name.toUpperCase();
        const entityUpper = "&" + nameUpper;
        if (unescape(entityUpper) === entityUpper) {
          entities.set(entityUpper, char.toUpperCase());
        }
      }
    }
  }
  return entities;
}

export const HTML_ENTITY_RE = /&#?[0-9A-Za-z]{1,24};/g;
export const HTML_ENTITIES: Map<string, string> = buildHtmlEntities();

/**
 * Given text and a single-byte encoding, check whether that text could have
 * been decoded from that single-byte encoding.
 *
 * In other words, check whether it can be encoded in that encoding, possibly
 * sloppily.
 */
export function possible_encoding(text: string, encoding: string): boolean {
  const regex = ENCODING_REGEXES.get(encoding);
  if (regex === undefined) {
    throw new Error(`Unknown encoding: ${encoding}`);
  }
  // Mirror Python `re.Pattern.match`: anchored at the start. The compiled
  // source is `^[...]*$`, and these patterns carry no global/sticky state, so a
  // plain `.test()` is a faithful, stateless predicate.
  return regex.test(text);
}

/**
 * Build a translate mapping that strips likely-unintended control characters.
 * See `remove_control_chars` in `fixes.ts` for a description of these codepoint
 * ranges and why they should be removed.
 */
function buildControlCharMapping(): Map<number, null> {
  const controlChars = new Map<number, null>();

  const codepoints: number[] = [];
  for (let i = 0x00; i < 0x09; i++) codepoints.push(i);
  codepoints.push(0x0b);
  for (let i = 0x0e; i < 0x20; i++) codepoints.push(i);
  codepoints.push(0x7f);
  for (let i = 0x206a; i < 0x2070; i++) codepoints.push(i);
  codepoints.push(0xfeff);
  for (let i = 0xfff9; i < 0xfffd; i++) codepoints.push(i);

  for (const i of codepoints) {
    controlChars.set(i, null);
  }
  return controlChars;
}

export const CONTROL_CHARS: Map<number, null> = buildControlCharMapping();

// Recognize UTF-8 sequences that would be valid if it weren't for a b'\xa0'
// that some Windows-1252 program converted to a plain space.
//
// The smaller values are included on a case-by-case basis, because we don't
// want to decode likely input sequences to unlikely characters. These are the
// ones that *do* form likely characters before 0xa0:
//
//   0xc2 -> U+A0 NO-BREAK SPACE
//   0xc3 -> U+E0 LATIN SMALL LETTER A WITH GRAVE
//   0xc5 -> U+160 LATIN CAPITAL LETTER S WITH CARON
//   0xce -> U+3A0 GREEK CAPITAL LETTER PI
//   0xd0 -> U+420 CYRILLIC CAPITAL LETTER ER
//   0xd9 -> U+660 ARABIC-INDIC DIGIT ZERO
//
// In three-character sequences, we exclude some lead bytes in some cases.
//
// When the lead byte is immediately followed by 0xA0, we shouldn't accept a
// space there, because it leads to some less-likely character ranges:
//
//   0xe0 -> Samaritan script
//   0xe1 -> Mongolian script (corresponds to Latin-1 'á' which is too common)
//
// We accept 0xe2 and 0xe3, which cover many scripts. Bytes 0xe4 and higher
// point mostly to CJK characters, which we generally don't want to decode near
// Latin lowercase letters.
//
// In four-character sequences, the lead byte must be F0, because that accounts
// for almost all of the usage of high-numbered codepoints (tag characters whose
// UTF-8 starts with the byte F3 are only used in some rare new emoji sequences).
//
// This is meant to be applied to encodings of text that tests true for
// `is_bad`. Any of these could represent characters that legitimately appear
// surrounded by spaces, particularly U+C5 (Å), which is a word in multiple
// languages!
//
// We should consider checking for b'\x85' being converted to ... in the future.
// I've seen it once, but the text still wasn't recoverable.
//
// This is a Python `bytes` pattern; it runs on binary strings (one char per
// byte), so it is compiled WITHOUT the `u` flag.
//
// Python uses this both as a `.search` predicate (in the fix loop,
// `__init__.py`) and a `.sub` target (`fixes.py`). It is exported WITHOUT the
// `g` flag so `.test()`/`.exec()` carry no `lastIndex` state; a replace-all
// consumer must clone with the `g` flag (e.g.
// `new RegExp(ALTERED_UTF8_RE.source, "g")` — no `u`: binary strings).
export const ALTERED_UTF8_RE =
  /[\xc2\xc3\xc5\xce\xd0\xd9][ ]|[\xe2\xe3][ ][\x80-\x84\x86-\x9f\xa1-\xbf]|[\xe0-\xe3][\x80-\x84\x86-\x9f\xa1-\xbf][ ]|[\xf0][ ][\x80-\xbf][\x80-\xbf]|[\xf0][\x80-\xbf][ ][\x80-\xbf]|[\xf0][\x80-\xbf][\x80-\xbf][ ]/;

// This expression matches UTF-8 and CESU-8 sequences where some of the
// continuation bytes have been lost. The byte 0x1a (sometimes written as ^Z) is
// used within ftfy to represent a byte that produced the replacement character
// �. We don't know which byte it was, but we can at least decode the UTF-8
// sequence as � instead of failing to re-decode it at all.
//
// In some cases, we allow the ASCII '?' in place of �, but at most once
// per sequence.
//
// Python `bytes` pattern; runs on binary strings, compiled WITHOUT the `u`
// flag.
export const LOSSY_UTF8_RE =
  /[\xc2-\xdf][\x1a]|[\xc2-\xc3][?]|\xed[\xa0-\xaf][\x1a?]\xed[\xb0-\xbf][\x1a?\x80-\xbf]|\xed[\xa0-\xaf][\x1a?\x80-\xbf]\xed[\xb0-\xbf][\x1a?]|[\xe0-\xef][\x1a?][\x1a\x80-\xbf]|[\xe0-\xef][\x1a\x80-\xbf][\x1a?]|[\xf0-\xf4][\x1a?][\x1a\x80-\xbf][\x1a\x80-\xbf]|[\xf0-\xf4][\x1a\x80-\xbf][\x1a?][\x1a\x80-\xbf]|[\xf0-\xf4][\x1a\x80-\xbf][\x1a\x80-\xbf][\x1a?]|\x1a/g;

// This regex matches C1 control characters, which occupy some of the positions
// in the Latin-1 character map that Windows assigns to other characters instead.
//
// Python uses this both as a `.search` predicate (in the fix loop) and a `.sub`
// target. It is exported WITHOUT the `g` flag so `.test()`/`.exec()` carry no
// `lastIndex` state; a replace-all consumer must clone with the `g` flag (e.g.
// `new RegExp(C1_CONTROL_RE.source, "gu")`).
export const C1_CONTROL_RE = /[\x80-\x9f]/u;

// A translate mapping that breaks ligatures made of Latin letters. While
// ligatures may be important to the representation of other languages, in Latin
// letters they tend to represent a copy/paste error. It omits ligatures such as
// æ that are frequently used intentionally.
//
// This list additionally includes some Latin digraphs that represent two
// characters for legacy encoding reasons, not for typographical reasons.
//
// Ligatures and digraphs may also be separated by NFKC normalization, but that
// is sometimes more normalization than you want.
export const LIGATURES: Map<number, string> = new Map<number, string>([
  ["Ĳ".codePointAt(0)!, "IJ"], // Dutch ligatures
  ["ĳ".codePointAt(0)!, "ij"],
  ["ŉ".codePointAt(0)!, "ʼn"], // Afrikaans digraph meant to avoid auto-curled quote
  ["Ǳ".codePointAt(0)!, "DZ"], // Serbian/Croatian digraphs for Cyrillic conversion
  ["ǲ".codePointAt(0)!, "Dz"],
  ["ǳ".codePointAt(0)!, "dz"],
  ["Ǆ".codePointAt(0)!, "DŽ"],
  ["ǅ".codePointAt(0)!, "Dž"],
  ["ǆ".codePointAt(0)!, "dž"],
  ["Ǉ".codePointAt(0)!, "LJ"],
  ["ǈ".codePointAt(0)!, "Lj"],
  ["ǉ".codePointAt(0)!, "lj"],
  ["Ǌ".codePointAt(0)!, "NJ"],
  ["ǋ".codePointAt(0)!, "Nj"],
  ["ǌ".codePointAt(0)!, "nj"],
  ["ﬀ".codePointAt(0)!, "ff"], // Latin typographical ligatures
  ["ﬁ".codePointAt(0)!, "fi"],
  ["ﬂ".codePointAt(0)!, "fl"],
  ["ﬃ".codePointAt(0)!, "ffi"],
  ["ﬄ".codePointAt(0)!, "ffl"],
  ["ﬅ".codePointAt(0)!, "ſt"],
  ["ﬆ".codePointAt(0)!, "st"],
]);

/**
 * Build a translate mapping that replaces halfwidth and fullwidth forms with
 * their standard-width forms.
 */
function buildWidthMap(): Map<number, string> {
  // Though it's not listed as a fullwidth character, we'll want to convert
  // U+3000 IDEOGRAPHIC SPACE to U+20 SPACE on the same principle, so start with
  // that in the dictionary.
  const widthMap = new Map<number, string>([[0x3000, " "]]);
  for (let i = 0xff01; i < 0xfff0; i++) {
    const char = String.fromCodePoint(i);
    const alternate = char.normalize("NFKC");
    if (alternate !== char) {
      widthMap.set(i, alternate);
    }
  }
  return widthMap;
}

export const WIDTH_MAP: Map<number, string> = buildWidthMap();

// This regex uses UTF8_CLUES to find sequences of likely mojibake. It matches
// them with + so that several adjacent UTF-8-looking sequences get coalesced
// into one, allowing them to be fixed more efficiently and not requiring every
// individual subsequence to be detected as 'badness'.
//
// We accept spaces in place of "utf8_continuation", because spaces might have
// been intended to be U+A0 NO-BREAK SPACE.
//
// We do a lookbehind to make sure the previous character isn't a
// "utf8_continuation_strict" character, so that we don't fix just a few
// characters in a huge garble and make the situation worse.
//
// Unfortunately, the matches to this regular expression won't show their
// surrounding context, and including context would make the expression much
// less efficient. The 'badness' rules that require context, such as a preceding
// lowercase letter, will prevent some cases of inconsistent UTF-8 from being
// fixed when they don't see it.
//
// This operates on real (codepoint) text, so it is compiled WITH the `u` flag.
// The clue strings are interpolated into character classes exactly as Python's
// `.format()` does into the verbose pattern.
//
// Python uses this both as a `.search` predicate (in the fix loop) and a `.sub`
// target. It is exported WITHOUT the `g` flag so `.test()`/`.exec()` carry no
// `lastIndex` state; a replace-all consumer must clone with the `g` flag (e.g.
// `new RegExp(UTF8_DETECTOR_RE.source, "gu")`).
export const UTF8_DETECTOR_RE = new RegExp(
  `(?<![${UTF8_CLUES.utf8_continuation_strict}])` +
    `(` +
    `[${UTF8_CLUES.utf8_first_of_2}][${UTF8_CLUES.utf8_continuation}]` +
    `|` +
    `[${UTF8_CLUES.utf8_first_of_3}][${UTF8_CLUES.utf8_continuation}]{2}` +
    `|` +
    `[${UTF8_CLUES.utf8_first_of_4}][${UTF8_CLUES.utf8_continuation}]{3}` +
    `)+`,
  "u",
);
