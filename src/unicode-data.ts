/**
 * Lazy-loaded Unicode name and category lookups, backing the async
 * `explain_unicode` in `index.ts`.
 *
 * The bulk data lives in the generated `generated/unicode-names.ts` table
 * (explicitly-named codepoints only, ~40–50k entries, plus a range-compressed
 * category table). Algorithmic names — CJK Unified/Compatibility Ideographs,
 * Hangul syllables, and the other `ALGORITHMIC_NAME_RANGES` — are derived at
 * runtime here exactly as CPython's `unicodedata.name()` does, so the table stays
 * small. This module is only ever reached via `await import("./unicode-data.js")`
 * on the first `explain_unicode` call, so a `fix_text`-only consumer pays zero
 * added heap.
 *
 * This is a faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import {
  ALGORITHMIC_NAME_RANGES,
  HANGUL_JAMO_L,
  HANGUL_JAMO_T,
  HANGUL_JAMO_V,
  HANGUL_N_COUNT,
  HANGUL_S_BASE,
  HANGUL_SYLLABLE_RANGE,
  HANGUL_T_COUNT,
  UNICODE_CATEGORIES,
  UNICODE_NAMES,
} from "./generated/unicode-names.js";

/**
 * Compose the algorithmic name of a Hangul syllable from the L/V/T jamo tables,
 * mirroring the Unicode "Hangul Syllable Name Generation" rule that CPython uses.
 */
function hangulSyllableName(cp: number): string {
  const sIndex = cp - HANGUL_S_BASE;
  const lIndex = Math.floor(sIndex / HANGUL_N_COUNT);
  const vIndex = Math.floor((sIndex % HANGUL_N_COUNT) / HANGUL_T_COUNT);
  const tIndex = sIndex % HANGUL_T_COUNT;
  return (
    "HANGUL SYLLABLE " +
    HANGUL_JAMO_L[lIndex] +
    HANGUL_JAMO_V[vIndex] +
    HANGUL_JAMO_T[tIndex]
  );
}

/**
 * The Unicode name of a codepoint, or `fallback` if it has none. Mirrors
 * `unicodedata.name(chr(cp), fallback)`.
 */
export function unicodeName(cp: number, fallback: string): string {
  const explicit = UNICODE_NAMES[cp];
  if (explicit !== undefined) {
    return explicit;
  }

  if (cp >= HANGUL_SYLLABLE_RANGE[0] && cp <= HANGUL_SYLLABLE_RANGE[1]) {
    return hangulSyllableName(cp);
  }

  for (const [start, end, prefix] of ALGORITHMIC_NAME_RANGES) {
    if (cp >= start && cp <= end) {
      return prefix + cp.toString(16).toUpperCase();
    }
  }

  return fallback;
}

/**
 * The general category (e.g. `"Lu"`, `"Zs"`, `"Cn"`) of a codepoint, mirroring
 * `unicodedata.category(chr(cp))`. The generated `UNICODE_CATEGORIES` table is a
 * sorted, gap-filled list of `[start, end, category]` ranges covering the whole
 * codepoint space, so a binary search always resolves.
 */
export function unicodeCategory(cp: number): string {
  let lo = 0;
  let hi = UNICODE_CATEGORIES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end, cat] = UNICODE_CATEGORIES[mid]!;
    if (cp < start) {
      hi = mid - 1;
    } else if (cp > end) {
      lo = mid + 1;
    } else {
      return cat;
    }
  }
  return "Cn";
}
