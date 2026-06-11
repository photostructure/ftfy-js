// Focused tests for the codegen output under src/generated/.
//
// These guard the *semantics* downstream code relies on (table shapes, decode
// invariants, regex-assembly compatibility under the `u` flag, name derivation).
// Byte-for-byte parity with python-ftfy is guarded separately by the CI no-diff
// check that re-runs `python3 scripts/gen_all.py`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  REAL_DECODING_HOLES,
  REAL_DECODING_STRINGS,
  SLOPPY_DECODING_STRINGS,
} from "../src/generated/charmaps.js";
import {
  ENCODING_CHARLISTS,
  ENCODING_REGEX_SOURCES,
} from "../src/generated/encoding-regexes.js";
import { HTML5_ENTITIES } from "../src/generated/html5-entities.js";
import { MOJIBAKE_CATEGORIES } from "../src/generated/mojibake-categories.js";
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
} from "../src/generated/unicode-names.js";
import { UTF8_CLUES } from "../src/generated/utf8-clues.js";

describe("charmaps", () => {
  test("every decode table is exactly 256 entries", () => {
    for (const [name, table] of Object.entries(REAL_DECODING_STRINGS)) {
      expect(table.length, name).toBe(256);
    }
    for (const [name, table] of Object.entries(SLOPPY_DECODING_STRINGS)) {
      expect(table.length, name).toBe(256);
    }
  });

  test("latin-1 is the identity map", () => {
    for (let i = 0; i < 256; i++) {
      expect(REAL_DECODING_STRINGS["latin-1"].charCodeAt(i)).toBe(i);
    }
  });

  test("real windows-1252 has holes at 0x81/8D/8F/90/9D", () => {
    expect(REAL_DECODING_HOLES["windows-1252"]).toEqual([
      0x81, 0x8d, 0x8f, 0x90, 0x9d,
    ]);
  });

  test("sloppy codecs fill holes with Latin-1 and force 0x1A -> U+FFFD", () => {
    const sloppy = SLOPPY_DECODING_STRINGS["sloppy-windows-1252"];
    // Hole 0x81 falls back to the Latin-1 codepoint U+0081.
    expect(sloppy.charCodeAt(0x81)).toBe(0x81);
    // Byte 0x1A always maps to the replacement character.
    expect(sloppy.charCodeAt(0x1a)).toBe(0xfffd);
    // No holes are recorded for sloppy tables.
    expect(REAL_DECODING_HOLES["sloppy-windows-1252"]).toBeUndefined();
  });

  test("all 24 registered sloppy codecs are present", () => {
    expect(Object.keys(SLOPPY_DECODING_STRINGS)).toHaveLength(24);
  });

  test("hole indices snapshot", () => {
    expect(REAL_DECODING_HOLES).toMatchSnapshot();
  });
});

describe("encoding-regexes", () => {
  test("ascii comes first and matches only ASCII", () => {
    expect(Object.keys(ENCODING_REGEX_SOURCES)[0]).toBe("ascii");
    const ascii = new RegExp(ENCODING_REGEX_SOURCES["ascii"], "u");
    expect(ascii.test("hello")).toBe(true);
    expect(ascii.test("héllo")).toBe(false);
  });

  test("every source compiles under the u flag", () => {
    for (const [name, src] of Object.entries(ENCODING_REGEX_SOURCES)) {
      expect(() => new RegExp(src, "u"), name).not.toThrow();
    }
  });

  test("latin-1 regex accepts all 256 Latin-1 characters (test_possible_encoding)", () => {
    const re = new RegExp(ENCODING_REGEX_SOURCES["latin-1"], "u");
    let all = "";
    for (let i = 0; i < 256; i++) all += String.fromCharCode(i);
    expect(re.test(all)).toBe(true);
  });

  test("charlists exist for the 10 CHARMAP_ENCODINGS (no ascii)", () => {
    expect(ENCODING_CHARLISTS["ascii"]).toBeUndefined();
    expect(Object.keys(ENCODING_CHARLISTS)).toHaveLength(10);
    // Each charlist is 128 high bytes (0x80..0xFF) plus byte 0x1A.
    expect(ENCODING_CHARLISTS["latin-1"].length).toBe(129);
  });
});

describe("utf8-clues / mojibake-categories", () => {
  test("clue and category key sets", () => {
    expect(Object.keys(UTF8_CLUES)).toMatchSnapshot();
    expect(Object.keys(MOJIBAKE_CATEGORIES)).toMatchSnapshot();
  });

  test("c1 category is the C1 control range U+0080-U+009F", () => {
    const c1 = MOJIBAKE_CATEGORIES["c1"];
    expect(c1.length).toBe(3);
    expect(c1.charCodeAt(0)).toBe(0x80);
    expect(c1[1]).toBe("-");
    expect(c1.charCodeAt(2)).toBe(0x9f);
  });

  test("every clue/category body is a valid u-flag character class", () => {
    for (const [k, v] of Object.entries(UTF8_CLUES)) {
      expect(() => new RegExp(`[${v}]`, "u"), k).not.toThrow();
    }
    for (const [k, v] of Object.entries(MOJIBAKE_CATEGORIES)) {
      expect(() => new RegExp(`[${v}]`, "u"), k).not.toThrow();
    }
  });
});

describe("html5-entities", () => {
  test("verbatim CPython html5 dict", () => {
    expect(Object.keys(HTML5_ENTITIES)).toHaveLength(2231);
    expect(HTML5_ENTITIES["amp;"]).toBe("&");
    expect(HTML5_ENTITIES["lt"]).toBe("<"); // legacy non-semicolon form
    expect(HTML5_ENTITIES["acE;"]).toBe("∾̳"); // two-codepoint value
  });
});

describe("unicode-names", () => {
  test("explicit names, with algorithmic ranges excluded", () => {
    expect(UNICODE_NAMES[0x41]).toBe("LATIN CAPITAL LETTER A");
    expect(UNICODE_NAMES[0x20ac]).toBe("EURO SIGN");
    // CJK ideographs are derived, not stored.
    expect(UNICODE_NAMES[0x4e00]).toBeUndefined();
  });

  function nameFromRanges(cp: number): string | undefined {
    for (const [start, end, prefix] of ALGORITHMIC_NAME_RANGES) {
      if (cp >= start && cp <= end)
        return prefix + cp.toString(16).toUpperCase();
    }
    return undefined;
  }

  function hangulName(cp: number): string {
    const i = cp - HANGUL_S_BASE;
    const l = Math.floor(i / HANGUL_N_COUNT);
    const v = Math.floor((i % HANGUL_N_COUNT) / HANGUL_T_COUNT);
    const t = i % HANGUL_T_COUNT;
    return (
      "HANGUL SYLLABLE " +
      HANGUL_JAMO_L[l] +
      HANGUL_JAMO_V[v] +
      HANGUL_JAMO_T[t]
    );
  }

  test("algorithmic CJK names reconstruct", () => {
    expect(nameFromRanges(0x4e00)).toBe("CJK UNIFIED IDEOGRAPH-4E00");
    expect(nameFromRanges(0xf900)).toBe("CJK COMPATIBILITY IDEOGRAPH-F900");
  });

  test("Hangul syllable names reconstruct", () => {
    expect(HANGUL_SYLLABLE_RANGE).toEqual([0xac00, 0xd7a3]);
    expect(hangulName(0xac00)).toBe("HANGUL SYLLABLE GA");
    expect(hangulName(0xd55c)).toBe("HANGUL SYLLABLE HAN");
  });

  function category(cp: number): string {
    // Linear scan is fine for a test; the runtime will binary-search.
    for (const [start, end, cat] of UNICODE_CATEGORIES) {
      if (cp >= start && cp <= end) return cat;
    }
    return "Cn";
  }

  test("category ranges cover the codepoint space", () => {
    expect(category(0x41)).toBe("Lu"); // A
    expect(category(0x61)).toBe("Ll"); // a
    expect(category(0x20ac)).toBe("Sc"); // EURO SIGN
    expect(category(0x4e00)).toBe("Lo"); // CJK ideograph
    // Ranges are contiguous and ordered with no gaps.
    expect(UNICODE_CATEGORIES[0][0]).toBe(0);
    expect(UNICODE_CATEGORIES[UNICODE_CATEGORIES.length - 1][1]).toBe(0x10ffff);
    for (let i = 1; i < UNICODE_CATEGORIES.length; i++) {
      expect(UNICODE_CATEGORIES[i][0]).toBe(UNICODE_CATEGORIES[i - 1][1] + 1);
    }
  });
});

describe("Unicode-version drift guards", () => {
  // The codegen ran under CPython's unidata 15.0.0 (recorded in every generated
  // header). Node's bundled ICU is independent and may be *newer* — the two are
  // deliberately allowed to differ (see docs/DESIGN.md), but each side has a
  // pinned baseline so a silent bump surfaces as a known signal rather than a
  // mystery test failure. Bumping a baseline is a deliberate act that must
  // accompany a re-validation of the affected tables.

  // The unidata version the committed tables were generated against.
  const CODEGEN_UNIDATA_BASELINE = "15.0.0";

  // The Node ICU/Unicode version this port has been validated against. ftfy
  // leans on Node's normalize()/category data only in a few spots
  // (NFKC width folding, control-char classification); a newer ICU has so far
  // stayed compatible. If Node ships an ICU that changes those, this fails so
  // the port is re-checked rather than drifting silently.
  const NODE_UNICODE_BASELINE = "17.0";

  /** Read `unicodedata.unidata_version: X` out of a generated file's header. */
  function generatedUnidataVersion(relPath: string): string {
    const file = fileURLToPath(new URL(`../${relPath}`, import.meta.url));
    const header = readFileSync(file, "utf8").slice(0, 600);
    const m = header.match(/unidata_version:\s*([0-9.]+)/);
    if (!m) throw new Error(`no unidata_version header in ${relPath}`);
    return m[1];
  }

  test("every generated table records the same codegen unidata baseline", () => {
    const files = [
      "src/generated/charmaps.ts",
      "src/generated/encoding-regexes.ts",
      "src/generated/html5-entities.ts",
      "src/generated/mojibake-categories.ts",
      "src/generated/unicode-names.ts",
      "src/generated/utf8-clues.ts",
      "src/generated/wcwidth-tables.ts",
    ];
    for (const f of files) {
      expect(generatedUnidataVersion(f), f).toBe(CODEGEN_UNIDATA_BASELINE);
    }
  });

  test("Node's bundled Unicode version matches the validated baseline", () => {
    // process.versions.unicode is e.g. "17.0". If this fails, a newer Node/ICU
    // is in use: re-run the full suite, confirm the NFKC/category-dependent
    // paths still match python-ftfy, then bump NODE_UNICODE_BASELINE.
    expect(process.versions.unicode).toBe(NODE_UNICODE_BASELINE);
  });
});
