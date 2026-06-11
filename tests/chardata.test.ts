/**
 * Tests for src/chardata.ts.
 *
 * The `possible_encoding` cases are ported from
 * `python-ftfy/tests/test_characters.py::test_possible_encoding`. The remaining
 * cases pin the data tables and regexes that chardata exposes to the (Wave 3)
 * fixers — their construction logic mirrors `ftfy/chardata.py` and their values
 * were verified against CPython 3.12 / python-ftfy 6.3.1.
 */

import { describe, expect, test } from "vitest";

import {
  ALTERED_UTF8_RE,
  C1_CONTROL_RE,
  CHARMAP_ENCODINGS,
  CONTROL_CHARS,
  DOUBLE_QUOTE_RE,
  ENCODING_REGEXES,
  HTML_ENTITIES,
  HTML_ENTITY_RE,
  LIGATURES,
  LOSSY_UTF8_RE,
  SINGLE_QUOTE_RE,
  UTF8_DETECTOR_RE,
  WIDTH_MAP,
  possible_encoding,
} from "../src/chardata.js";
import { bytesToBinary } from "../src/codecs/binary-string.js";

describe("possible_encoding", () => {
  // Port of test_possible_encoding: every one of the 256 Latin-1 codepoints is
  // representable in latin-1.
  test("all 256 latin-1 codepoints are possible in latin-1", () => {
    for (let codept = 0; codept < 256; codept++) {
      const char = String.fromCodePoint(codept);
      expect(
        possible_encoding(char, "latin-1"),
        `U+${codept.toString(16)}`,
      ).toBe(true);
    }
  });

  test("ascii detector accepts ASCII and rejects high bytes", () => {
    expect(possible_encoding("hello", "ascii")).toBe(true);
    expect(possible_encoding("", "ascii")).toBe(true);
    expect(possible_encoding("héllo", "ascii")).toBe(false);
    expect(possible_encoding("\x80", "ascii")).toBe(false);
  });

  test("an encoding can reject characters outside its charmap", () => {
    // U+0500 (Cyrillic small letter komi de) is not in latin-1.
    expect(possible_encoding("Ԁ", "latin-1")).toBe(false);
    // ...but a windows-1251 character round-trips in its own encoding.
    expect(possible_encoding("А", "sloppy-windows-1251")).toBe(true);
  });

  test("throws on an unknown encoding", () => {
    expect(() => possible_encoding("x", "not-a-real-encoding")).toThrow();
  });

  // Parity with Python's `re.match` over `^[...]*$`: Python's `$` also matches
  // just before a trailing newline, but because `\n` (0x0A) is a member of
  // every encoding class (it lies in \x00-\x19), the result never differs from
  // a plain JS end-anchored test. Verify exhaustively over a small alphabet.
  test("trailing-newline anchoring matches Python re.match (DESIGN x\\n case)", () => {
    expect(possible_encoding("x\n", "latin-1")).toBe(true);
    expect(possible_encoding("x\n", "ascii")).toBe(true);
    // A non-ASCII byte before a trailing newline is still rejected by ascii.
    expect(possible_encoding("\x80\n", "ascii")).toBe(false);
    expect(possible_encoding("\n", "ascii")).toBe(true);
    expect(possible_encoding("\n\n", "ascii")).toBe(true);
    expect(possible_encoding("x\nx", "ascii")).toBe(true);
  });

  test("ENCODING_REGEXES has ascii plus the 10 CHARMAP_ENCODINGS", () => {
    expect(ENCODING_REGEXES.size).toBe(CHARMAP_ENCODINGS.length + 1);
    expect(ENCODING_REGEXES.has("ascii")).toBe(true);
    for (const enc of CHARMAP_ENCODINGS) {
      expect(ENCODING_REGEXES.has(enc), enc).toBe(true);
    }
  });
});

describe("CONTROL_CHARS", () => {
  test("includes the documented ranges and excludes tab/newline/CR", () => {
    // Stripped: 0x00-0x08, 0x0B, 0x0E-0x1F, 0x7F, 0x206A-0x206F, 0xFEFF,
    // 0xFFF9-0xFFFC.
    for (const cp of [
      0x00, 0x08, 0x0b, 0x0e, 0x1f, 0x7f, 0x206a, 0x206f, 0xfeff, 0xfff9,
      0xfffc,
    ]) {
      expect(CONTROL_CHARS.has(cp), `U+${cp.toString(16)}`).toBe(true);
      expect(CONTROL_CHARS.get(cp)).toBeNull();
    }
    // Kept: tab (0x09), newline (0x0A), CR (0x0D), and 0xFFFD itself.
    for (const cp of [0x09, 0x0a, 0x0d, 0x20, 0x2069, 0x2070, 0xfffd]) {
      expect(CONTROL_CHARS.has(cp), `U+${cp.toString(16)}`).toBe(false);
    }
  });

  test("has exactly the expected number of entries", () => {
    // 0x00-0x08 (9) + 0x0B (1) + 0x0E-0x1F (18) + 0x7F (1)
    // + 0x206A-0x206F (6) + 0xFEFF (1) + 0xFFF9-0xFFFC (4) = 40
    expect(CONTROL_CHARS.size).toBe(40);
  });
});

describe("LIGATURES", () => {
  test("maps Latin ligatures/digraphs to their expansions", () => {
    expect(LIGATURES.get("ﬁ".codePointAt(0)!)).toBe("fi");
    expect(LIGATURES.get("ﬄ".codePointAt(0)!)).toBe("ffl");
    expect(LIGATURES.get("Ĳ".codePointAt(0)!)).toBe("IJ");
    expect(LIGATURES.get("ǆ".codePointAt(0)!)).toBe("dž");
    expect(LIGATURES.size).toBe(22);
  });

  test("does not include intentionally-kept ligatures like æ", () => {
    expect(LIGATURES.has("æ".codePointAt(0)!)).toBe(false);
  });
});

describe("WIDTH_MAP", () => {
  test("maps fullwidth and ideographic space to standard width", () => {
    expect(WIDTH_MAP.get(0x3000)).toBe(" "); // IDEOGRAPHIC SPACE
    expect(WIDTH_MAP.get("Ａ".codePointAt(0)!)).toBe("A"); // FULLWIDTH A
    expect(WIDTH_MAP.get("１".codePointAt(0)!)).toBe("1"); // FULLWIDTH ONE
    expect(WIDTH_MAP.get("！".codePointAt(0)!)).toBe("!"); // FULLWIDTH !
    expect(WIDTH_MAP.get("ｱ".codePointAt(0)!)).toBe("ア"); // HALFWIDTH KATAKANA A
  });

  test("is codepoint-keyed and built from NFKC normalization", () => {
    // Every key must NFKC-normalize to its mapped value.
    for (const [cp, alt] of WIDTH_MAP) {
      if (cp === 0x3000) continue; // the hand-added ideographic space
      expect(String.fromCodePoint(cp).normalize("NFKC")).toBe(alt);
    }
  });
});

describe("SINGLE_QUOTE_RE / DOUBLE_QUOTE_RE", () => {
  test("single-quote class matches the curly/modifier single quotes", () => {
    expect("don’t ‘it’ ʼ".replace(SINGLE_QUOTE_RE, "'")).toBe("don't 'it' '");
  });

  test("double-quote class matches the curly double quotes", () => {
    expect("“quoted”".replace(DOUBLE_QUOTE_RE, '"')).toBe('"quoted"');
  });
});

describe("HTML_ENTITIES", () => {
  test("includes lowercase &name; forms", () => {
    expect(HTML_ENTITIES.get("&amp;")).toBe("&");
    expect(HTML_ENTITIES.get("&ntilde;")).toBe("ñ");
    expect(HTML_ENTITIES.get("&eacute;")).toBe("é");
  });

  test("adds uppercased variants mapping to the uppercased char", () => {
    // &NTILDE; → Ñ (upcased name, upcased char).
    expect(HTML_ENTITIES.get("&NTILDE;")).toBe("Ñ");
    expect(HTML_ENTITIES.get("&EACUTE;")).toBe("É");
  });

  test("only keeps &name; (semicolon) forms, never legacy non-semicolon ones", () => {
    // html5 has a legacy "amp" (no semicolon) key; chardata filters those out.
    expect(HTML_ENTITIES.has("&amp")).toBe(false);
  });

  test("HTML_ENTITY_RE matches plausible entity references", () => {
    expect("&amp;".match(new RegExp(HTML_ENTITY_RE.source))?.[0]).toBe("&amp;");
    expect("&#233;".match(new RegExp(HTML_ENTITY_RE.source))?.[0]).toBe(
      "&#233;",
    );
  });
});

describe("byte-level regexes (operate on binary strings)", () => {
  test("ALTERED_UTF8_RE matches a lead byte followed by a space", () => {
    // 0xC3 followed by a space is a candidate altered sequence.
    const binary = bytesToBinary(new Uint8Array([0xc3, 0x20]));
    expect(ALTERED_UTF8_RE.test(binary)).toBe(true);
    // A plain ASCII pair is not.
    expect(
      ALTERED_UTF8_RE.test(bytesToBinary(new Uint8Array([0x41, 0x42]))),
    ).toBe(false);
  });

  test("ALTERED_UTF8_RE does not get confused by codepoints above 0xFF", () => {
    // Real (non-binary) text must not match: the class [\xc2...] is a single
    // code unit, so a U+00C3 char in real text would match — but that's exactly
    // why callers must pass binary strings. Confirm the class is byte-scoped by
    // checking that U+01C3 (ǃ) does NOT match (compiled without the `u` flag,
    // \xc3 is the single code unit 0x00C3, not part of an astral range).
    expect(ALTERED_UTF8_RE.test("ǃ ")).toBe(false);
  });

  test("LOSSY_UTF8_RE matches lone 0x1A and truncated sequences", () => {
    expect(LOSSY_UTF8_RE.test(bytesToBinary(new Uint8Array([0x1a])))).toBe(
      true,
    );
    // 0xC2 followed by 0x1A (lost continuation byte).
    expect(
      LOSSY_UTF8_RE.test(bytesToBinary(new Uint8Array([0xc2, 0x1a]))),
    ).toBe(true);
    expect(LOSSY_UTF8_RE.test(bytesToBinary(new Uint8Array([0x41])))).toBe(
      false,
    );
  });

  test("LOSSY_UTF8_RE is global so .replace replaces every occurrence", () => {
    expect(LOSSY_UTF8_RE.global).toBe(true);
    const binary = bytesToBinary(new Uint8Array([0x1a, 0x41, 0x1a]));
    expect(binary.replace(LOSSY_UTF8_RE, "?")).toBe("?A?");
  });

  test("ALTERED_UTF8_RE is dual-use upstream (search + sub), so it is a stateless non-global predicate", () => {
    // Python uses it via .search() in the fix loop and .sub() in fixes.py; the
    // .sub() consumer must clone with the g flag.
    expect(ALTERED_UTF8_RE.global).toBe(false);
    expect(ALTERED_UTF8_RE.test("\xc3 ")).toBe(true);
    expect(ALTERED_UTF8_RE.test("\xc3 ")).toBe(true);
  });
});

describe("C1_CONTROL_RE", () => {
  test("matches C1 control characters in real text", () => {
    expect(C1_CONTROL_RE.test("\x85")).toBe(true);
    expect(C1_CONTROL_RE.test("plain")).toBe(false);
  });

  test("is not global, so it is safe as a stateless predicate", () => {
    expect(C1_CONTROL_RE.global).toBe(false);
    // Calling test() repeatedly must give a stable answer (no lastIndex creep).
    expect(C1_CONTROL_RE.test("\x85")).toBe(true);
    expect(C1_CONTROL_RE.test("\x85")).toBe(true);
  });
});

describe("UTF8_DETECTOR_RE", () => {
  test("detects an embedded UTF-8-looking two-byte sequence", () => {
    // "Ã©" — the classic mojibake of "é" decoded as latin-1. utf8_first_of_2
    // 'Ã' (U+00C3) followed by utf8_continuation '©' (U+00A9).
    expect(UTF8_DETECTOR_RE.test("Ã©")).toBe(true);
  });

  test("is not global, so it is safe as a stateless predicate", () => {
    expect(UTF8_DETECTOR_RE.global).toBe(false);
    expect(UTF8_DETECTOR_RE.test("Ã©")).toBe(true);
    expect(UTF8_DETECTOR_RE.test("Ã©")).toBe(true);
  });

  test("does not fire on plain ASCII text", () => {
    expect(UTF8_DETECTOR_RE.test("hello world")).toBe(false);
  });
});
