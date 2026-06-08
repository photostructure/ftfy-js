/**
 * A faithful port of CPython's `html/__init__.py` `unescape()` and its charref
 * machinery (`_charref`, `_replace_charref`, `_invalid_charrefs`,
 * `_invalid_codepoints`).
 *
 * We port CPython directly rather than depend on the npm `entities` package,
 * which diverges from CPython on several edge cases that python-ftfy's tests
 * pin (e.g. invalid codepoints decoding to "", out-of-range decoding to U+FFFD,
 * and the longest-prefix-without-semicolon named-entity loop).
 *
 * The html5 entity dictionary is consumed from the generated table
 * `src/generated/html5-entities.ts` (CPython's `html.entities.html5`, verbatim).
 *
 * See docs/DESIGN.md → "html.unescape exactness".
 *
 * This is a faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import { HTML5_ENTITIES } from "./generated/html5-entities.js";

// see https://html.spec.whatwg.org/multipage/parsing.html#numeric-character-reference-end-state

/**
 * Numeric character references in the C1 range (and a couple of others) that
 * the HTML5 standard maps to specific replacement characters instead of the
 * literal codepoint. Mirrors CPython's `html._invalid_charrefs`.
 */
const _invalid_charrefs: Map<number, string> = new Map<number, string>([
  [0x00, "�"], // REPLACEMENT CHARACTER
  [0x0d, "\r"], //     CARRIAGE RETURN
  [0x80, "€"], // EURO SIGN
  [0x81, "\x81"], //   <control>
  [0x82, "‚"], // SINGLE LOW-9 QUOTATION MARK
  [0x83, "ƒ"], // LATIN SMALL LETTER F WITH HOOK
  [0x84, "„"], // DOUBLE LOW-9 QUOTATION MARK
  [0x85, "…"], // HORIZONTAL ELLIPSIS
  [0x86, "†"], // DAGGER
  [0x87, "‡"], // DOUBLE DAGGER
  [0x88, "ˆ"], // MODIFIER LETTER CIRCUMFLEX ACCENT
  [0x89, "‰"], // PER MILLE SIGN
  [0x8a, "Š"], // LATIN CAPITAL LETTER S WITH CARON
  [0x8b, "‹"], // SINGLE LEFT-POINTING ANGLE QUOTATION MARK
  [0x8c, "Œ"], // LATIN CAPITAL LIGATURE OE
  [0x8d, "\x8d"], //   <control>
  [0x8e, "Ž"], // LATIN CAPITAL LETTER Z WITH CARON
  [0x8f, "\x8f"], //   <control>
  [0x90, "\x90"], //   <control>
  [0x91, "‘"], // LEFT SINGLE QUOTATION MARK
  [0x92, "’"], // RIGHT SINGLE QUOTATION MARK
  [0x93, "“"], // LEFT DOUBLE QUOTATION MARK
  [0x94, "”"], // RIGHT DOUBLE QUOTATION MARK
  [0x95, "•"], // BULLET
  [0x96, "–"], // EN DASH
  [0x97, "—"], // EM DASH
  [0x98, "˜"], // SMALL TILDE
  [0x99, "™"], // TRADE MARK SIGN
  [0x9a, "š"], // LATIN SMALL LETTER S WITH CARON
  [0x9b, "›"], // SINGLE RIGHT-POINTING ANGLE QUOTATION MARK
  [0x9c, "œ"], // LATIN SMALL LIGATURE OE
  [0x9d, "\x9d"], //   <control>
  [0x9e, "ž"], // LATIN SMALL LETTER Z WITH CARON
  [0x9f, "Ÿ"], // LATIN CAPITAL LETTER Y WITH DIAERESIS
]);

/**
 * Codepoints that the HTML5 standard treats as invalid in a numeric character
 * reference; these decode to the empty string. Mirrors CPython's
 * `html._invalid_codepoints`.
 */
const _invalid_codepoints: Set<number> = new Set<number>([
  // 0x0001 to 0x0008
  0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8,
  // 0x000E to 0x001F
  0xe, 0xf, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a,
  0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
  // 0x007F to 0x009F
  0x7f, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b,
  0x8c, 0x8d, 0x8e, 0x8f, 0x90, 0x91, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
  0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f,
  // 0xFDD0 to 0xFDEF
  0xfdd0, 0xfdd1, 0xfdd2, 0xfdd3, 0xfdd4, 0xfdd5, 0xfdd6, 0xfdd7, 0xfdd8, 0xfdd9,
  0xfdda, 0xfddb, 0xfddc, 0xfddd, 0xfdde, 0xfddf, 0xfde0, 0xfde1, 0xfde2, 0xfde3,
  0xfde4, 0xfde5, 0xfde6, 0xfde7, 0xfde8, 0xfde9, 0xfdea, 0xfdeb, 0xfdec, 0xfded,
  0xfdee, 0xfdef,
  // others
  0xb, 0xfffe, 0xffff, 0x1fffe, 0x1ffff, 0x2fffe, 0x2ffff, 0x3fffe, 0x3ffff,
  0x4fffe, 0x4ffff, 0x5fffe, 0x5ffff, 0x6fffe, 0x6ffff, 0x7fffe, 0x7ffff,
  0x8fffe, 0x8ffff, 0x9fffe, 0x9ffff, 0xafffe, 0xaffff, 0xbfffe, 0xbffff,
  0xcfffe, 0xcffff, 0xdfffe, 0xdffff, 0xefffe, 0xeffff, 0xffffe, 0xfffff,
  0x10fffe, 0x10ffff,
]);

/**
 * The body of CPython's `_replace_charref`. `ref` is the regex's capture
 * group 1 (the charref body after the leading `&`, e.g. `#62;`, `#x3e`, or
 * `amp;`). Returns the replacement text for that single reference.
 */
function _replace_charref(ref: string): string {
  if (ref[0] === "#") {
    // numeric charref
    let num: number;
    if (ref[1] === "x" || ref[1] === "X") {
      // int(s[2:].rstrip(';'), 16)
      num = Number.parseInt(ref.slice(2).replace(/;+$/, ""), 16);
    } else {
      // int(s[1:].rstrip(';'))
      num = Number.parseInt(ref.slice(1).replace(/;+$/, ""), 10);
    }
    const invalid: string | undefined = _invalid_charrefs.get(num);
    if (invalid !== undefined) {
      return invalid;
    }
    if ((num >= 0xd800 && num <= 0xdfff) || num > 0x10ffff) {
      return "�";
    }
    if (_invalid_codepoints.has(num)) {
      return "";
    }
    return String.fromCodePoint(num);
  } else {
    // named charref
    if (Object.hasOwn(HTML5_ENTITIES, ref)) {
      return HTML5_ENTITIES[ref] as string;
    }
    // find the longest matching name (as defined by the standard)
    //
    // Python: for x in range(len(s)-1, 1, -1): if s[:x] in _html5: ...
    // Entity-reference bodies are ASCII per the _charref grammar, so UTF-16
    // code-unit slicing here matches Python's codepoint slicing.
    for (let x = ref.length - 1; x > 1; x--) {
      const prefix: string = ref.slice(0, x);
      if (Object.hasOwn(HTML5_ENTITIES, prefix)) {
        return (HTML5_ENTITIES[prefix] as string) + ref.slice(x);
      }
    }
    return "&" + ref;
  }
}

/**
 * CPython's `_charref` pattern. Compiled WITHOUT the `u` flag, matching
 * Python's `re` semantics on the BMP; charref bodies are ASCII in practice.
 * Made global so {@link unescape} can replace every occurrence.
 */
const _charref: RegExp =
  /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/g;

/**
 * Convert all named and numeric character references (e.g. `&gt;`, `&#62;`,
 * `&x3e;`) in the string `s` to the corresponding unicode characters.
 *
 * This function uses the rules defined by the HTML 5 standard for both valid
 * and invalid character references, and the list of HTML 5 named character
 * references defined in `html.entities.html5`.
 *
 * Faithful port of CPython's `html.unescape`.
 */
export function unescape(s: string): string {
  if (!s.includes("&")) {
    return s;
  }
  // `_charref` is global; `.replace` consumes/resets lastIndex per call, so it
  // is safe to reuse across calls without manual reset.
  return s.replace(_charref, (_match, group1: string) =>
    _replace_charref(group1),
  );
}
