// Acceptance tests ported from python-ftfy's tests/test_characters.py.
//
// These pin the character-level fixers (fix_surrogates, remove_control_chars),
// the encoding-fix entry points (fix_encoding, fix_text), and fix_and_explain's
// plan output. Test bodies are kept as close to the Python originals as
// TypeScript allows.

import { describe, expect, test } from "vitest";

import { possible_encoding } from "../src/chardata.js";
import { fix_surrogates, remove_control_chars } from "../src/fixes.js";
import { fix_and_explain, fix_encoding, fix_text } from "../src/index.js";

describe("test_characters", () => {
  test("test_possible_encoding", () => {
    for (let codept = 0; codept < 256; codept++) {
      const char = String.fromCodePoint(codept);
      expect(possible_encoding(char, "latin-1")).toBe(true);
    }
  });

  test("test_byte_order_mark", () => {
    expect(fix_encoding("ï»¿")).toBe("﻿");
  });

  test("test_control_chars", () => {
    const text =
      "﻿Sometimes, ￼bad ideas \x7f￺like these characters￻ " +
      "⁪get standardized.\r\n";
    const fixed =
      "Sometimes, bad ideas like these characters get standardized.\r\n";
    expect(remove_control_chars(text)).toBe(fixed);
  });

  test("test_welsh_flag", () => {
    // ftfy used to remove "tag characters", but they have been repurposed in
    // the "Flag of England/Scotland/Wales" emoji sequences.
    const text = "This flag has a dragon on it 🏴󠁧󠁢󠁷󠁬󠁳󠁿";
    expect(remove_control_chars(text)).toBe(text);
  });

  test("test_ohio_flag", () => {
    // The "Flag of Ohio" emoji sequence (tag characters) must pass through
    // unchanged.
    const text =
      "#superman #ohio 🏴\u{e0075}\u{e0073}\u{e006f}\u{e0068}\u{e007f} #cleveland #usa 🇺🇸";
    expect(fix_text(text)).toBe(text);
  });

  test("test_surrogates", () => {
    // Inputs are *lone* surrogate code units (a high/low pair written as two
    // separate \u escapes), which the fixer recombines into one codepoint.
    expect(fix_surrogates("\udbff\udfff")).toBe("\u{10ffff}");
    expect(fix_surrogates("\ud800\udc00")).toBe("\u{10000}");
  });

  test("test_color_escapes", () => {
    const { text: fixed, explanation: plan } =
      fix_and_explain("\x01\x1b[36;44mfoo");
    expect(fixed).toBe("foo");
    expect(plan).toEqual([
      ["apply", "remove_terminal_escapes"],
      ["apply", "remove_control_chars"],
    ]);
  });
});
