/**
 * Tests for the `utf-8-variants` codec in `src/codecs/utf8-variants.ts`.
 *
 * Ports the upstream cases that exercise the variants decoder directly:
 *   - `test_encodings.py::test_cesu8` — the CESU-8 astral char + Java null
 *     reference vector (the `search_function`/alias half belongs to the
 *     dispatcher TPP and is not duplicated here).
 *   - `test_encodings.py::test_russian_crash` — the `errors="replace"` path must
 *     not crash (the `guess_bytes` half belongs elsewhere).
 *   - `test_bytes.py::test_incomplete_sequences` — byte-split equivalence:
 *     feeding the input split at every boundary yields identical output.
 *   - `test_bytes.py::test_guess_bytes_null` — the `C0 80` null vector (decode
 *     half only).
 *
 * Plus unit coverage of each decode branch (CESU-8 surrogate pair, Java null,
 * Hangul-vs-CESU disambiguation, isolated-surrogate throw).
 */

import { describe, expect, it, test } from "vitest";

import { DecodeError } from "../../src/codecs/errors.js";
import {
  IncrementalDecoder,
  utf8VariantsDecode,
} from "../../src/codecs/utf8-variants.js";

const u8 = (...bytes: number[]): Uint8Array => Uint8Array.from(bytes);

/** Encode an ASCII/Latin-1-ish string to its byte values (test helper). */
function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** Concatenate byte chunks. */
function cat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("test_cesu8 (ported from test_encodings.py)", () => {
  // b"\xed\xa6\x9d\xed\xbd\xb7 is an unassigned character, and \xc0\x80 is null"
  const TEST_BYTES = cat(
    u8(0xed, 0xa6, 0x9d, 0xed, 0xbd, 0xb7),
    ascii(" is an unassigned character, and "),
    u8(0xc0, 0x80),
    ascii(" is null"),
  );
  const TEST_TEXT = "\u{77777} is an unassigned character, and \u0000 is null";

  it("decodes the CESU-8 astral char and the Java null", () => {
    expect(utf8VariantsDecode(TEST_BYTES)).toBe(TEST_TEXT);
  });
});

describe("decode branches", () => {
  it("decodes a CESU-8 surrogate pair to U+10000", () => {
    expect(utf8VariantsDecode(u8(0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80))).toBe(
      "\u{10000}",
    );
  });

  it("decodes the CESU-8 astral char U+77777", () => {
    const s = utf8VariantsDecode(u8(0xed, 0xa6, 0x9d, 0xed, 0xbd, 0xb7));
    expect(s).toBe("\u{77777}");
    expect(s.codePointAt(0)).toBe(0x77777);
  });

  it("decodes a lone Java null C0 80 to U+0000", () => {
    expect(utf8VariantsDecode(u8(0xc0, 0x80))).toBe("\u0000");
  });

  it("interleaves Java nulls with ASCII (test_guess_bytes_null vector)", () => {
    // b"null\xc0\x80separated"
    const bytes = cat(ascii("null"), u8(0xc0, 0x80), ascii("separated"));
    expect(utf8VariantsDecode(bytes)).toBe("null\u0000separated");
  });

  it("decodes ED 9F BF as Hangul-area U+D7FF, not CESU-8", () => {
    // 0xED with a second byte below 0xA0 is a normal three-byte sequence.
    const s = utf8VariantsDecode(u8(0xed, 0x9f, 0xbf));
    expect(s.codePointAt(0)).toBe(0xd7ff);
  });

  it("passes ordinary UTF-8 straight through", () => {
    // "Renée € 😀" — note the 😀 is a *real* 4-byte sequence, not CESU-8.
    const bytes = cat(
      ascii("Ren"),
      u8(0xc3, 0xa9),
      ascii("e "),
      u8(0xe2, 0x82, 0xac),
      ascii(" "),
      u8(0xf0, 0x9f, 0x98, 0x80),
    );
    expect(utf8VariantsDecode(bytes)).toBe("Renée € 😀");
  });
});

describe("strict mode throws DecodeError on malformed input", () => {
  it("throws on an isolated high surrogate not part of a CESU-8 pair", () => {
    // ED A0 80 followed by ASCII: the surrogate is not paired -> strict throw.
    let caught: unknown;
    try {
      utf8VariantsDecode(u8(0xed, 0xa0, 0x80, 0x41));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DecodeError);
    const err = caught as DecodeError;
    expect(err.encoding).toBe("utf-8");
    expect(err.start).toBe(0);
    expect(err.end).toBe(1);
    expect(err.reason).toBe("invalid continuation byte");
  });

  it("throws on a final truncated Java null lead (lone C0)", () => {
    expect(() => utf8VariantsDecode(u8(0xc0))).toThrow(DecodeError);
  });
});

describe("test_russian_crash (errors=replace must not crash)", () => {
  // b"\xe8\xed\xe2\xe5\xed\xf2\xe0\xf0\xe8\xe7\xe0\xf6\xe8\xff "
  const RUSSIAN = u8(
    0xe8,
    0xed,
    0xe2,
    0xe5,
    0xed,
    0xf2,
    0xe0,
    0xf0,
    0xe8,
    0xe7,
    0xe0,
    0xf6,
    0xe8,
    0xff,
    0x20,
  );

  it("decodes in replace mode without throwing", () => {
    const dec = new IncrementalDecoder("replace");
    let got = "";
    expect(() => {
      got = dec.decode(RUSSIAN, true);
    }).not.toThrow();
    // Matches CPython's b.decode('utf-8','replace'): 14 U+FFFD then a space.
    expect(got).toBe("�".repeat(14) + " ");
  });

  it("strict mode on the same bytes DOES throw", () => {
    expect(() => utf8VariantsDecode(RUSSIAN)).toThrow(DecodeError);
  });

  // Valid prefixes before a malformed span must be kept, not replaced.
  // Expected values from CPython: bytes(...).decode("utf-8", "replace").
  it.each<[string, Uint8Array, string]>([
    ["A ff", u8(0x41, 0xff), "A�"],
    ["A e2 28", u8(0x41, 0xe2, 0x28), "A�("],
    ["A e2 82 28", u8(0x41, 0xe2, 0x82, 0x28), "A�("],
    ["e2 82 28 A", u8(0xe2, 0x82, 0x28, 0x41), "�(A"],
    ["A ed a0 80 (lone surrogate)", u8(0x41, 0xed, 0xa0, 0x80), "A���"],
  ])("replace mode keeps valid prefixes: %s", (_desc, bytes, expected) => {
    const dec = new IncrementalDecoder("replace");
    expect(dec.decode(bytes, true)).toBe(expected);
  });
});

describe("test_incomplete_sequences (byte-split equivalence)", () => {
  // b"surrogates: \xed\xa0\x80\xed\xb0\x80 / null: \xc0\x80"
  const TEST_BYTES = cat(
    ascii("surrogates: "),
    u8(0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80),
    ascii(" / null: "),
    u8(0xc0, 0x80),
  );
  const TEST_STRING = "surrogates: \u{10000} / null: \u0000";

  it("decodes the whole input in one shot", () => {
    expect(utf8VariantsDecode(TEST_BYTES)).toBe(TEST_STRING);
  });

  // Feed in two pieces split at every BYTE boundary; the result must match no
  // matter where the break falls. (Python splits at codepoint count; bytes is a
  // superset, so we split at every byte index.)
  test.each(Array.from({ length: TEST_BYTES.length + 1 }, (_v, i) => i))(
    "split at byte %i yields identical output",
    (splitPoint) => {
      const left = TEST_BYTES.subarray(0, splitPoint);
      const right = TEST_BYTES.subarray(splitPoint);

      const dec = new IncrementalDecoder();
      let got = dec.decode(left, false);
      got += dec.decode(right, true);
      expect(got).toBe(TEST_STRING);
    },
  );
});

describe("IncrementalDecoder streaming semantics", () => {
  it("buffers a split CESU-8 pair across chunks", () => {
    const dec = new IncrementalDecoder();
    // First three bytes are the high surrogate; nothing decodable yet.
    expect(dec.decode(u8(0xed, 0xa0, 0x80), false)).toBe("");
    expect(dec.decode(u8(0xed, 0xb0, 0x80), true)).toBe("\u{10000}");
  });

  it("buffers a split Java null across chunks", () => {
    const dec = new IncrementalDecoder();
    expect(dec.decode(u8(0xc0), false)).toBe("");
    expect(dec.decode(u8(0x80), true)).toBe("\u0000");
  });

  it("reset clears the buffer", () => {
    const dec = new IncrementalDecoder();
    dec.decode(u8(0xed, 0xa0, 0x80), false);
    dec.reset();
    expect(dec.decode(u8(), true)).toBe("");
  });

  it("buffers a lone 0xED before a trailing newline (Python $ semantics)", () => {
    // CPython's non-MULTILINE `$` matches before a trailing \n, so b"\xed\n"
    // non-final is treated as a possibly-truncated surrogate and BUFFERED, not
    // rejected. A naive JS `$` would throw here. On the final flush the buffered
    // ED 0A is invalid UTF-8, so it then throws (matching CPython).
    const dec = new IncrementalDecoder();
    expect(dec.decode(u8(0xed, 0x0a), false)).toBe("");
    expect(() => dec.decode(u8(), true)).toThrow(DecodeError);
  });
});
