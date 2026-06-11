/**
 * Tests for src/badness.ts, ported from ftfy/badness.py and the JSON corpus.
 *
 * Expected values were generated from python-ftfy 6.3.1 by running:
 *   cd /home/mrm/src/python-ftfy && uv run python3 -c "
 *     from ftfy.badness import badness, is_bad
 *     # ... test cases ...
 *   "
 *
 * The upstream test suite exercises badness() indirectly through the JSON
 * corpus (test_examples_in_json.py), which requires the full fix pipeline.
 * These unit tests pin the BADNESS_RE assembly and the two public functions
 * directly against representative mojibake and clean strings.
 */

import { describe, expect, test } from "vitest";

import { badness, is_bad } from "../src/badness.js";

// ---------------------------------------------------------------------------
// badness() — clean text should return 0
// ---------------------------------------------------------------------------
describe("badness: clean text", () => {
  test.each<[string, string]>([
    ["empty string", ""],
    ["ASCII text", "Hello, world!"],
    ["French", "Bonjour, comment allez-vous?"],
    ["German", "Schöne Grüße aus München"],
    ["Spanish", "El niño está jugando con él"],
    ["Russian", "Привет, мир! Это тест."],
    ["Greek", "Καλημέρα κόσμε"],
    ["Chinese", "你好世界"],
    ["Japanese", "こんにちは世界"],
    ["Arabic", "مرحبا بالعالم"],
    ["café résumé naïve", "café résumé naïve"],
    ["normal quotes", 'He said "hello" to her'],
    // U+FEFF is JS \s but NOT Python \s — must not trigger {python_s}[À][€]
    ["BOM + upper_accented + currency", "﻿\xc4€"],
  ])("badness(%j) === 0", (_desc, text) => {
    expect(badness(text)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// badness() — mojibake text, concrete expected counts from Python 6.3.1
// ---------------------------------------------------------------------------
describe("badness: mojibake text", () => {
  test.each<[string, string, number]>([
    // C1 control characters (U+0080–U+009F) are always bad
    ["c1 U+0080 at start", "\x80text", 1],
    ["c1 U+009F alone", "\x9f", 1],
    ["c1 U+0081 mid-string", "a\x81b", 1],
    ["three consecutive c1 chars", "\x80\x81\x82", 3],

    // bad category — broken bar U+00A6 alone never triggers; requires context
    ["broken bar alone", "\xa6", 0],

    // lower_accented + bad
    ["é (lower_accented) + currency-sign (bad)", "\xe9\xa4", 1],
    ["é (lower_accented) + broken-bar (bad)", "\xe9\xa6", 1],

    // bad + lower_accented
    ["currency-sign (bad) + é (lower_accented)", "\xa4\xe9", 1],

    // lower_accented + upper_accented
    ["é (lower_accented) + À (upper_accented)", "\xe9\xc0", 1],

    // \\s + upper_accented + currency
    ["space + À (upper_accented) + ¢ (currency)", " \xc0\xa2", 1],

    // {python_s}: Python \s includes \x85 and \x1c-\x1f, which JS \s lacks
    ["U+0085 NEL + Ä (upper_accented) + € (currency)", "\x85\xc4€", 1],
    ["U+001C FS + Ä (upper_accented) + € (currency)", "\x1c\xc4€", 1],

    // {python_w}: Python \w is Unicode-aware; JS \w is ASCII-only.
    // [accented][start/end punctuation]\w with a non-ASCII word char after.
    ["é + « + é (non-ASCII \\w)", "\xe9\xab\xe9", 1],
    ["é + « + x (ASCII \\w)", "\xe9\xabx", 1],
    ["À + » + 中 (CJK \\w)", "\xc0\xbb中", 1],
    ["é + « + β (Greek \\w)", "\xe9\xabβ", 1],

    // Ligature œ/Œ followed by non-Latin
    ["œ followed by period (non-Latin)", "œ.", 1],
    ["Œ followed by period (non-Latin)", "Œ.", 1],

    // Ligature at end of string — [Œœ][^A-Za-z] needs a following char
    ["œ at end of string (no following char)", "helloœ", 0],

    // Ligature followed by Latin letter — NOT mojibake
    ["œ followed by a (Latin)", "œa", 0],
    ["Œ followed by A (Latin)", "ŒA", 0],

    // Box + kaomoji
    ["│ (box) + Ò (kaomoji)", "│\xd2", 1],

    // Degree sign after upper_accented
    ["À (upper_accented) + degree sign", "\xc0\xb0", 1],

    // Windows-1252 specific patterns
    ["Â + NBSP (Windows-1252 mojibake)", "Â\xa0", 1],
    ["â€œ (common Windows-1252 sequence)", "â€œ", 1],
    ["× + superscript-2", "×²", 1],
    ["× + superscript-3", "×³", 1],

    // Arabic words mojibake — requires 4-char match [ØÙ]...[ØÙ]...
    ["Ø\\xa0Ù\\xa0 (4-char Arabic mojibake)", "Ø\xa0Ù\xa0", 1],
    ["Ø\\xa0 only (2 chars — not enough)", "Ø\xa0", 0],

    // South Asian alphabet patterns
    ["à + superscript-2 (South Asian)", "à²", 1],

    // MacRoman patterns
    ["√ + ± (MacRoman mojibake)", "√±", 1],
    ["≈ + ° (MacRoman mojibake)", "≈°", 1],

    // Windows-1251 Cyrillic patterns
    ["вЂ (Windows-1251 → U+2000 range)", "вЂ", 1],
    ["В + c1 + В (3-char Cyrillic sequence)", "В\x80В", 1],

    // Windows-1253 Greek patterns
    ["β€™ (Windows-1253 → U+2000 range)", "β€™", 1],
    ["Β + c1 + Β (3-char Greek sequence)", "Β\x80Β", 1],

    // Windows-1257 Baltic pattern
    ["ā€ (Windows-1257 mojibake)", "ā€", 1],

    // Ã/Â + space at start of string
    ["Ã + space at start of string", "Ã hello", 1],
    ["Â + space at start of string", "Â hello", 1],

    // Multiple matches — counts accumulate
    ["â€œhelloâ€\\x9d (typical Windows-1252 quote wrap)", "â€œhelloâ€\x9d", 3],
    ["Arabic word ÙØ£Ø±Ø¬Ø§Ø¡ as mojibake", "Ø£Ù„Ø±Ø¬Ø§Ø¡", 4],
  ])("badness(%j) === %d", (_desc, text, expected) => {
    expect(badness(text)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// is_bad() — mirrors badness() > 0, but stops at first match
// ---------------------------------------------------------------------------
describe("is_bad", () => {
  test.each<[string, string, boolean]>([
    // Clean text
    ["empty string", "", false],
    ["ASCII", "Hello, world!", false],
    ["German", "Schöne Grüße aus München", false],
    ["Russian", "Привет мир", false],

    // Mojibake
    ["c1 control", "\x80", true],
    ["Windows-1252 Â+NBSP", "Â\xa0", true],
    ["typical Windows-1252 wrap", "â€œhelloâ€\x9d", true],
    ["Ø-pattern Arabic", "Ø\xa0Ù\xa0", true],
    ["MacRoman √±", "√±", true],
    ["вЂ sequence", "вЂ", true],
  ])("is_bad(%j) === %s", (_desc, text, expected) => {
    expect(is_bad(text)).toBe(expected);
  });

  test("is_bad returns false for empty string", () => {
    expect(is_bad("")).toBe(false);
  });

  test("is_bad is consistent with badness > 0", () => {
    const texts = [
      "",
      "Hello world",
      "\x80",
      "Â\xa0",
      "café",
      "\xe9\xa4",
      "вЂ",
      "â€œhelloâ€\x9d",
    ];
    for (const text of texts) {
      expect(is_bad(text)).toBe(badness(text) > 0);
    }
  });
});

// ---------------------------------------------------------------------------
// Regex state isolation — verify that repeated calls don't corrupt lastIndex
// ---------------------------------------------------------------------------
describe("regex state isolation", () => {
  test("badness can be called multiple times on the same string", () => {
    const text = "\x80\x81\x82";
    expect(badness(text)).toBe(3);
    expect(badness(text)).toBe(3);
    expect(badness(text)).toBe(3);
  });

  test("is_bad can be called multiple times on the same string", () => {
    const text = "Â\xa0";
    expect(is_bad(text)).toBe(true);
    expect(is_bad(text)).toBe(true);
    expect(is_bad(text)).toBe(true);
  });

  test("alternating calls do not interfere", () => {
    const bad = "вЂ";
    const clean = "Hello, world!";
    for (let i = 0; i < 5; i++) {
      expect(is_bad(bad)).toBe(true);
      expect(is_bad(clean)).toBe(false);
      expect(badness(bad)).toBe(1);
      expect(badness(clean)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// BADNESS_RE source — verify it compiles cleanly with the u flag
// ---------------------------------------------------------------------------
describe("BADNESS_RE assembly", () => {
  test("re-importing badness/is_bad does not throw at module load", () => {
    // If the regex failed to compile, the import itself would have thrown.
    expect(typeof badness).toBe("function");
    expect(typeof is_bad).toBe("function");
  });
});
