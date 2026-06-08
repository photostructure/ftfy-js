/**
 * Functions for justifying Unicode text in a monospaced display such as a
 * terminal.
 *
 * Port of `ftfy/formatting.py`. The upstream Python delegates display-width
 * measurement to the external `wcwidth` package; this package ships zero runtime
 * dependencies, so the `wcwidth`/`wcswidth` algorithm and its interval tables are
 * ported in-tree. The tables live in `src/generated/wcwidth-tables.ts` (pinned to
 * `wcwidth==0.2.13`); see `scripts/gen_wcwidth.py` for provenance.
 *
 * This is a faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import {
  VS16_NARROW_TO_WIDE,
  WIDE_EASTASIAN,
  ZERO_WIDTH,
} from "./generated/wcwidth-tables.js";

type Interval = readonly [number, number];

/**
 * Binary search for `ucs` within a sorted, non-overlapping interval table.
 * Returns 1 if found, else 0. Ported from wcwidth's `_bisearch`.
 */
function bisearch(ucs: number, table: ReadonlyArray<Interval>): number {
  let lbound = 0;
  let ubound = table.length - 1;

  if (ucs < table[0][0] || ucs > table[ubound][1]) {
    return 0;
  }
  while (ubound >= lbound) {
    const mid = Math.floor((lbound + ubound) / 2);
    if (ucs > table[mid][1]) {
      lbound = mid + 1;
    } else if (ucs < table[mid][0]) {
      ubound = mid - 1;
    } else {
      return 1;
    }
  }
  return 0;
}

/**
 * Width of a single codepoint, ported from wcwidth's `wcwidth` (latest Unicode
 * level). Returns 0 for zero-width, 1 or 2 for printable, -1 for control or
 * otherwise non-printable.
 */
function wcwidth(ucs: number): number {
  // Small optimization: early return of 1 for printable ASCII.
  if (ucs >= 32 && ucs < 0x7f) {
    return 1;
  }
  // C0/C1 control characters are -1 for compatibility with POSIX-like calls.
  if ((ucs !== 0 && ucs < 32) || (ucs >= 0x7f && ucs < 0xa0)) {
    return -1;
  }
  // Zero width.
  if (bisearch(ucs, ZERO_WIDTH)) {
    return 0;
  }
  // 1 or 2 width.
  return 1 + bisearch(ucs, WIDE_EASTASIAN);
}

const ZERO_WIDTH_JOINER = 0x200d;
const VARIATION_SELECTOR_16 = 0xfe0f;

/**
 * Display width of a string, ported from wcwidth's `wcswidth` (v0.2.13, simple
 * per-character sum with ZWJ and VS16 handling). Returns -1 if the string
 * contains a C0/C1 control character.
 *
 * Iterates by codepoint (Python `str` iteration), so astral characters are
 * handled as single units rather than as UTF-16 surrogate pairs.
 */
function wcswidth(pwcs: string): number {
  const codepoints = Array.from(pwcs, (ch) => ch.codePointAt(0) as number);
  const end = codepoints.length;
  let width = 0;
  let idx = 0;
  let lastMeasured: number | null = null;

  while (idx < end) {
    const ucs = codepoints[idx];
    if (ucs === ZERO_WIDTH_JOINER) {
      // Zero Width Joiner: do not measure this or the next character.
      idx += 2;
      continue;
    }
    if (ucs === VARIATION_SELECTOR_16 && lastMeasured !== null) {
      // VS16 following another character: conditionally add 1 to the measured
      // width if that character is known to be converted narrow->wide by VS16.
      // The "auto" Unicode level is >= 9.0.0, so this branch always applies.
      width += bisearch(lastMeasured, VS16_NARROW_TO_WIDE);
      lastMeasured = null;
      idx += 1;
      continue;
    }
    const w = wcwidth(ucs);
    if (w < 0) {
      // Early return -1 on C0 and C1 control characters.
      return w;
    }
    if (w > 0) {
      // Track last character measured to contain a cell, so subsequent VS16
      // modifiers may be understood.
      lastMeasured = ucs;
    }
    width += w;
    idx += 1;
  }
  return width;
}

/** ANSI/terminal escape sequences, mirroring `ftfy.fixes.ANSI_RE`. */
const ANSI_RE = /\x1b\[((?:\d|;)*)([a-zA-Z])/g;

/**
 * Strip ANSI terminal escape sequences. Local mirror of
 * `ftfy.fixes.remove_terminal_escapes` so this module stays self-contained.
 */
function removeTerminalEscapes(text: string): string {
  return text.replace(ANSI_RE, "");
}

/**
 * Determine the width that a character is likely to be displayed as in a
 * monospaced terminal. The width for a printable character will always be 0, 1,
 * or 2. Nonprintable or control characters return -1, a convention from wcwidth.
 *
 * Mirrors Python's `character_width`, which takes a single-character string.
 */
export function character_width(char: string): number {
  const cp = char.length === 0 ? 0 : (char.codePointAt(0) as number);
  return wcwidth(cp);
}

/**
 * Return the number of character cells this string is likely to occupy when
 * displayed in a monospaced, modern, Unicode-aware terminal emulator (the
 * "display width").
 *
 * Returns -1 if the string contains a non-printable or control character.
 *
 * NFC-normalizes first (so Hangul jamo need no special-casing) and strips
 * terminal escapes (which have zero width when displayed as intended).
 */
export function monospaced_width(text: string): number {
  return wcswidth(removeTerminalEscapes(text.normalize("NFC")));
}

/**
 * Return `text` left-justified to a display width of at least `width` cells,
 * padding with `fillchar` (which must be a width-1 character).
 *
 * "Left" means toward the beginning of the string (cf. "left parenthesis").
 */
export function display_ljust(
  text: string,
  width: number,
  fillchar: string = " ",
): string {
  if (character_width(fillchar) !== 1) {
    throw new Error("The padding character must have display width 1");
  }
  const textWidth = monospaced_width(text);
  if (textWidth === -1) {
    // There's a control character here, so just don't add padding.
    return text;
  }
  const padding = Math.max(0, width - textWidth);
  return text + fillchar.repeat(padding);
}

/**
 * Return `text` right-justified to a display width of at least `width` cells,
 * padding with `fillchar` (which must be a width-1 character).
 *
 * "Right" means toward the end of the string (cf. "right parenthesis").
 */
export function display_rjust(
  text: string,
  width: number,
  fillchar: string = " ",
): string {
  if (character_width(fillchar) !== 1) {
    throw new Error("The padding character must have display width 1");
  }
  const textWidth = monospaced_width(text);
  if (textWidth === -1) {
    return text;
  }
  const padding = Math.max(0, width - textWidth);
  return fillchar.repeat(padding) + text;
}

/**
 * Return `text` centered to a display width of at least `width` cells, padding
 * with `fillchar` (which must be a width-1 character).
 */
export function display_center(
  text: string,
  width: number,
  fillchar: string = " ",
): string {
  if (character_width(fillchar) !== 1) {
    throw new Error("The padding character must have display width 1");
  }
  const textWidth = monospaced_width(text);
  if (textWidth === -1) {
    return text;
  }
  const padding = Math.max(0, width - textWidth);
  const leftPadding = Math.floor(padding / 2);
  const rightPadding = padding - leftPadding;
  return fillchar.repeat(leftPadding) + text + fillchar.repeat(rightPadding);
}
