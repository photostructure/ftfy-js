// Tests for the index.ts public surface not covered by the ported upstream
// suites: explain_unicode (the async sync-divergence), decode_escapes (standalone
// fixer), apply_plan errors, the fix_text/fix_text_segment doctests, and fix_file.

import { describe, expect, test, vi } from "vitest";

import { decode_escapes } from "../../src/fixes.js";
import {
  apply_plan,
  explain_unicode,
  fix_and_explain,
  fix_encoding_and_explain,
  fix_file,
  fix_text,
} from "../../src/index.js";
import { unicodeName } from "../../src/unicode-data.js";

describe("fix_text doctests", () => {
  test("upstream fix_text docstring examples", () => {
    expect(fix_text("âœ” No problems")).toBe("✔ No problems");
    expect(fix_text("&macr;\\_(ã\x83\x84)_/&macr;")).toBe("¯\\_(ツ)_/¯");
    // NOTE: the upstream docstring shows "...", but real Python (NFC default,
    // not NFKC) leaves the HORIZONTAL ELLIPSIS as "…". Verified against
    // python-ftfy 6.3.1; the docstring example is stale.
    expect(fix_text("Broken text&hellip; it&#x2019;s ﬂubberiﬁc!")).toBe(
      "Broken text… it's flubberific!",
    );
    expect(fix_text("ＬＯＵＤ　ＮＯＩＳＥＳ")).toBe("LOUD NOISES");
  });
});

describe("fix_encoding_and_explain doctests", () => {
  test("sÃ³ → só", () => {
    expect(fix_encoding_and_explain("sÃ³")).toEqual({
      text: "só",
      explanation: [
        ["encode", "latin-1"],
        ["decode", "utf-8"],
      ],
    });
  });

  test("voilÃ le travail (restore_byte_a0)", () => {
    const result = fix_encoding_and_explain("voilÃ le travail");
    expect(result.text).toBe("voilà le travail");
    expect(result.explanation).toEqual([
      ["encode", "latin-1"],
      ["transcode", "restore_byte_a0"],
      ["decode", "utf-8"],
    ]);
  });
});

describe("decode_escapes", () => {
  test("decodes \\u, \\x, \\U escapes amid literal Unicode", () => {
    const factoid = "\\u20a1 is the currency symbol for the colón.";
    expect(decode_escapes(factoid)).toBe(
      "₡ is the currency symbol for the colón.",
    );
  });

  test("single-char and octal escapes", () => {
    expect(decode_escapes("a\\tb\\nc")).toBe("a\tb\nc");
    expect(decode_escapes("\\101\\102")).toBe("AB"); // octal
    expect(decode_escapes("\\x41")).toBe("A");
  });
});

describe("apply_plan", () => {
  test("round-trips a fix_and_explain plan (docstring example)", () => {
    const mojibake = "schÃ¶n";
    const { explanation: plan } = fix_and_explain(mojibake);
    expect(apply_plan(mojibake, plan!)).toBe("schön");
  });

  test("rejects an unknown apply/transcode function", () => {
    expect(() => apply_plan("x", [["apply", "no_such_fixer"]])).toThrow(
      /Unknown function to apply: no_such_fixer/,
    );
  });

  test("rejects an unknown plan step", () => {
    expect(() => apply_plan("x", [["frobnicate", "whatever"]])).toThrow(
      /Unknown plan step: frobnicate/,
    );
  });

  test("rejects a 'normalize' step, like Python's apply_plan", () => {
    // fix_and_explain CAN emit a normalize step, but Python's apply_plan
    // raises ValueError("Unknown plan step: normalize") on it (verified
    // against 6.3.1). No corpus case generates one; user plans must match.
    expect(() => apply_plan("x", [["normalize", "NFC"]])).toThrow(
      /Unknown plan step: normalize/,
    );
  });
});

describe("fix_text segmentation", () => {
  test("does not infinite-loop when max_decode_length is smaller than an astral char", () => {
    // Regression: pos + max_decode_length landing inside a surrogate pair
    // must round UP (Python counts codepoints, so it can never split one).
    expect(fix_text("😀ok", null, { max_decode_length: 1 })).toBe("😀ok");
  });

  test("segments by code units without corrupting astral characters", () => {
    const text = "a😀b😀c";
    expect(fix_text(text, null, { max_decode_length: 2 })).toBe(text);
  });
});

describe("explain_unicode (async)", () => {
  test("prints the kaomoji breakdown from the upstream doctest", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      lines.push(line);
    });
    try {
      await explain_unicode("(╯°□°)╯︵ ┻━┻");
    } finally {
      spy.mockRestore();
    }
    expect(lines).toEqual([
      "U+0028  (       [Ps] LEFT PARENTHESIS",
      "U+256F  ╯       [So] BOX DRAWINGS LIGHT ARC UP AND LEFT",
      "U+00B0  °       [So] DEGREE SIGN",
      "U+25A1  □       [So] WHITE SQUARE",
      "U+00B0  °       [So] DEGREE SIGN",
      "U+0029  )       [Pe] RIGHT PARENTHESIS",
      "U+256F  ╯       [So] BOX DRAWINGS LIGHT ARC UP AND LEFT",
      "U+FE35  ︵      [Ps] PRESENTATION FORM FOR VERTICAL LEFT PARENTHESIS",
      "U+0020          [Zs] SPACE",
      "U+253B  ┻       [So] BOX DRAWINGS HEAVY UP AND HORIZONTAL",
      "U+2501  ━       [So] BOX DRAWINGS HEAVY HORIZONTAL",
      "U+253B  ┻       [So] BOX DRAWINGS HEAVY UP AND HORIZONTAL",
    ]);
  });
});

describe("unicode-data algorithmic names", () => {
  test("CJK Unified Ideograph (derived)", () => {
    // U+4E00 → CJK UNIFIED IDEOGRAPH-4E00
    expect(unicodeName(0x4e00, "<unknown>")).toBe("CJK UNIFIED IDEOGRAPH-4E00");
  });

  test("Hangul syllable (composed from jamo)", () => {
    // U+AC00 (가) → HANGUL SYLLABLE GA
    expect(unicodeName(0xac00, "<unknown>")).toBe("HANGUL SYLLABLE GA");
    // U+D55C (한) → HANGUL SYLLABLE HAN
    expect(unicodeName(0xd55c, "<unknown>")).toBe("HANGUL SYLLABLE HAN");
  });

  test("explicitly-named codepoint", () => {
    expect(unicodeName(0x41, "<unknown>")).toBe("LATIN CAPITAL LETTER A");
  });

  test("unassigned codepoint falls back", () => {
    expect(unicodeName(0x0378, "<unknown>")).toBe("<unknown>");
  });
});

describe("fix_file", () => {
  test("fixes each line and persists the unescape_html flip across lines", () => {
    const lines = ["&amp;\n", "<html>\n", "&amp;\n"];
    const out = [...fix_file(lines)];
    // Once a '<' is seen, unescape_html stays off for subsequent lines, so the
    // trailing &amp; is preserved (matching fix_text on the whole document).
    expect(out).toEqual(["&\n", "<html>\n", "&amp;\n"]);
  });

  test("decodes raw bytes with an explicit encoding", () => {
    // 0xe9 is é in latin-1; decode it and fix the (already-clean) line.
    const bytes = Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x0a]); // "café\n"
    const out = [...fix_file([bytes], "latin-1")];
    expect(out).toEqual(["café\n"]);
  });
});
