/**
 * Heuristic that detects likely mojibake.
 *
 * Port of `ftfy/badness.py`. Assembles `BADNESS_RE` from the generated
 * `MOJIBAKE_CATEGORIES` clue strings (mirroring Python's verbose-regex
 * `.format()`), strips verbose-mode whitespace/comments, and exposes:
 *
 *   - `badness(text)` — count of non-overlapping matches (like `re.findall`)
 *   - `is_bad(text)` — boolean early-exit (like `re.search`)
 *
 * Public names are snake_case, matching the Python API.
 *
 * This is a faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import { MOJIBAKE_CATEGORIES as CAT } from "./generated/mojibake-categories.js";

// ---------------------------------------------------------------------------
// BADNESS_RE assembly
//
// Python source uses re.VERBOSE (whitespace and # comments are ignored) and
// `.format(**MOJIBAKE_CATEGORIES)` to interpolate the category strings.
// We replicate that literally: write the same verbose template with {key}
// placeholders replaced by the generated category strings, then strip
// verbose-mode whitespace and comments before compiling.
//
// Critical notes:
//   - The `u` flag is required so character-class ranges (e.g. ═-╬, А-Я) are
//     interpreted as Unicode codepoints, not UTF-16 code units.
//   - The `g` flag is required for the `matchAll` / exec-loop findall equivalent.
//   - `^` in the template matches start of *string* (no `m` flag), mirroring
//     Python's re.search / re.findall without re.MULTILINE.
//   - The regex is rebuilt fresh each call to `badness`/`is_bad` — see the
//     note at the bottom of this file about `lastIndex` state.
// ---------------------------------------------------------------------------

/** Strip verbose-mode whitespace and `# comment` lines from a regex source. */
function stripVerbose(src: string): string {
  // Process character by character to correctly handle:
  //   - # comments only outside character classes
  //   - Spaces/tabs/newlines outside character classes
  //   - Everything inside [...] is kept verbatim
  let result = "";
  let inClass = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inClass) {
      result += ch;
      if (ch === "]") inClass = false;
      i++;
    } else {
      if (ch === "[") {
        inClass = true;
        result += ch;
        i++;
      } else if (ch === "#") {
        // Skip to end of line
        while (i < src.length && src[i] !== "\n") i++;
      } else if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        // Skip whitespace outside classes
        i++;
      } else {
        result += ch;
        i++;
      }
    }
  }
  return result;
}

// Python's `\w` and `\s` are Unicode-aware; JS `\w` is ASCII-only (even with
// the `u` flag) and JS `\s` differs at the edges (it lacks \x1c-\x1f and \x85,
// and adds ﻿). These property classes are exhaustively verified (all
// codepoints to U+10FFFF) to equal CPython's `\w`/`\s` under unidata 15.0.0.
const PYTHON_W = String.raw`[\p{L}\p{N}_]`;
const PYTHON_S = String.raw`[\t-\r\x1c-\x1f\x85\p{Z}]`;

// The verbose regex template from badness.py, with {key} placeholders for
// MOJIBAKE_CATEGORIES.  Whitespace and #-comments are stripped at build time
// by `stripVerbose`; the result is compiled with the `u` flag.
//
// NOTE: Inside the template, `\xa0`, `\xad`, `\x9f`, etc. are raw string
// escapes that JS regex understands directly once verbose whitespace is
// stripped.  We use String.raw to avoid double-escaping. Python's `\s`/`\w`
// appear as {python_s}/{python_w} (see above).
const BADNESS_RE_VERBOSE = String.raw`
    [{c1}]
    |
    [{bad}{lower_accented}{upper_accented}{box}{start_punctuation}{end_punctuation}{currency}{numeric}{law}][{bad}]
    |
    [a-zA-Z][{lower_common}{upper_common}][{bad}]
    |
    [{bad}][{lower_accented}{upper_accented}{box}{start_punctuation}{end_punctuation}{currency}{numeric}{law}]
    |
    [{lower_accented}{lower_common}{box}{end_punctuation}{currency}{numeric}][{upper_accented}]
    |
    [{box}{end_punctuation}{currency}{numeric}][{lower_accented}]
    |
    [{lower_accented}{box}{end_punctuation}][{currency}]
    |
    {python_s}[{upper_accented}][{currency}]
    |
    [{upper_accented}{box}][{numeric}{law}]
    |
    [{lower_accented}{upper_accented}{box}{currency}{end_punctuation}][{start_punctuation}][{numeric}]
    |
    [{lower_accented}{upper_accented}{currency}{numeric}{box}{law}][{end_punctuation}][{start_punctuation}]
    |
    [{currency}{numeric}{box}][{start_punctuation}]
    |
    [a-z][{upper_accented}][{start_punctuation}{currency}]
    |
    [{box}][{kaomoji}]
    |
    [{lower_accented}{upper_accented}{currency}{numeric}{start_punctuation}{end_punctuation}{law}][{box}]
    |
    [{box}][{end_punctuation}]
    |
    [{lower_accented}{upper_accented}][{start_punctuation}{end_punctuation}]{python_w}
    |
    [Œœ][^A-Za-z]
    |
    [{upper_accented}]°
    |
    [ÂÃÎÐ][€œŠš¢£Ÿž\xa0\xad®©°·»{start_punctuation}{end_punctuation}–—´]
    |
    ×[²³]
    |
    [ØÙ][{common}{currency}{bad}{numeric}{start_punctuation}ŸŠ®°µ»][ØÙ][{common}{currency}{bad}{numeric}{start_punctuation}ŸŠ®°µ»]
    |
    à[²µ¹¼½¾]
    |
    √[±∂†≠®™´≤≥¥µø]
    |
    ≈[°¢]
    |
    ‚Ä[ìîïòôúùû†°¢π]
    |
    ‚[âó][àä°ê]
    |
    вЂ
    |
    [ВГРС][{c1}{bad}{start_punctuation}{end_punctuation}{currency}°µ][ВГРС]
    |
    ГўВЂВ.[A-Za-z ]
    |
    Ã[\xa0¡]
    |
    [a-z]\s?[ÃÂ][ ]
    |
    ^[ÃÂ][ ]
    |
    [a-z.,?!{end_punctuation}]Â[ {start_punctuation}{end_punctuation}]
    |
    β€[™\xa0Ά\xad®°]
    |
    [ΒΓΞΟ][{c1}{bad}{start_punctuation}{end_punctuation}{currency}°][ΒΓΞΟ]
    |
    ā€
`.replace(/\{(\w+)\}/g, (_m, key: string) => {
  if (key === "python_w") return PYTHON_W;
  if (key === "python_s") return PYTHON_S;
  if (!(key in CAT)) throw new Error(`Unknown MOJIBAKE_CATEGORIES key: ${key}`);
  return CAT[key];
});

const BADNESS_RE_SOURCE = stripVerbose(BADNESS_RE_VERBOSE);

/**
 * Get the 'badness' of a sequence of text, counting the number of unlikely
 * character sequences. A badness greater than 0 indicates that some of it
 * seems to be mojibake.
 *
 * Port of `ftfy.badness.badness`.
 */
export function badness(text: string): number {
  // We must use a fresh RegExp per call (or reset lastIndex) because the `g`
  // flag makes the instance stateful.  Building from source is cheap — the
  // string is a module-level constant.
  const re = new RegExp(BADNESS_RE_SOURCE, "gu");
  return (text.match(re) ?? []).length;
}

/**
 * Returns true iff the given text looks like it contains mojibake.
 *
 * This can be faster than `badness`, because it returns when the first match
 * is found to a regex instead of counting matches. Note that as strings get
 * longer, they have a higher chance of returning True for `is_bad(string)`.
 *
 * Port of `ftfy.badness.is_bad`.
 */
export function is_bad(text: string): boolean {
  const re = new RegExp(BADNESS_RE_SOURCE, "gu");
  return re.test(text);
}
