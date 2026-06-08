/**
 * Ports `python-ftfy/tests/test_encodings.py` plus the charmap/sloppy
 * decode-error parts of `tests/test_bytes.py`, exercising the leaf codec
 * modules directly (the Wave-2 dispatcher and `guess_bytes` are not imported
 * here). The UTF-8 incremental-buffering parts of `test_bytes.py` belong to the
 * strict-utf8-decoder agent and are intentionally NOT duplicated.
 */

import { describe, expect, test } from "vitest";

import {
  buildEncodeMap,
  charmapDecode,
  charmapEncode,
  CharmapCodec,
} from "../src/codecs/charmap.js";
import { DecodeError, EncodeError } from "../src/codecs/errors.js";
import {
  getSloppyCodec,
  normalizeEncoding,
  REAL_CODECS,
  SLOPPY_CODECS,
} from "../src/codecs/sloppy.js";
import { hasUtf16Bom, utf16Decode } from "../src/codecs/utf16.js";

/** Hex string -> Uint8Array, for compact reference vectors. */
function hex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

describe("sloppy-windows-1252 round-trip (test_bytes.py TEST_STRINGS)", () => {
  const codec = getSloppyCodec("sloppy-windows-1252")!;

  test("the codec is registered under several spellings", () => {
    expect(codec).toBeInstanceOf(CharmapCodec);
    expect(getSloppyCodec("sloppy_windows_1252")).toBe(codec);
    expect(getSloppyCodec("Sloppy-Windows-1252")).toBe(codec);
    expect(getSloppyCodec("sloppy-cp1252")).toBeInstanceOf(CharmapCodec);
  });

  test.each([
    ["Renée\nFleming", "52656ee9650a466c656d696e67"],
    ["Noël\nCoward", "4e6feb6c0a436f77617264"],
    ["Señor\nCardgage", "5365f16f720a4361726467616765"],
    ["€ • £ • ¥", "80209520a3209520a5"],
    ["¿Qué?", "bf5175e93f"],
  ] as const)("encode/decode %j", (string, expectedHex) => {
    const encoded = codec.encode(string);
    expect(Buffer.from(encoded).toString("hex")).toBe(expectedHex);
    expect(codec.decode(encoded)).toBe(string);
  });

  test("sloppy codecs have no holes and never throw on decode", () => {
    // Every byte 0..255 decodes (Latin-1 fallback at the real encoding's holes).
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(() => codec.decode(all)).not.toThrow();
    expect(codec.decode(all)).toHaveLength(256);
  });
});

describe("utf-16 BOM detection (guess_bytes path)", () => {
  test("hasUtf16Bom recognizes both byte orders", () => {
    expect(hasUtf16Bom(hex("feff"))).toBe(true);
    expect(hasUtf16Bom(hex("fffe"))).toBe(true);
    expect(hasUtf16Bom(hex("0041"))).toBe(false);
    expect(hasUtf16Bom(new Uint8Array([0xff]))).toBe(false);
  });

  test("decodes little-endian BOM data", () => {
    expect(utf16Decode(hex("fffe520065006e00e90065000a0046006c0065006d0069006e006700"))).toBe(
      "Renée\nFleming",
    );
    expect(utf16Decode(hex("fffebf0051007500e9003f00"))).toBe("¿Qué?");
  });

  test("decodes big-endian BOM data", () => {
    expect(utf16Decode(hex("feff0052006500e9"))).toBe("Reé");
  });

  test("combines surrogate pairs (astral char)", () => {
    expect(utf16Decode(hex("fffe3dd800de"))).toBe("😀");
  });

  test("a bare BOM decodes to the empty string", () => {
    expect(utf16Decode(hex("feff"))).toBe("");
    expect(utf16Decode(hex("fffe"))).toBe("");
  });

  test("throws on a trailing odd byte (truncated data)", () => {
    try {
      utf16Decode(hex("fffe52"));
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DecodeError);
      const de = e as DecodeError;
      expect(de.reason).toBe("truncated data");
      expect(de.start).toBe(2);
      expect(de.end).toBe(3);
    }
  });

  test("throws on a high surrogate at end of data", () => {
    try {
      utf16Decode(hex("fffe00d8"));
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DecodeError);
      expect((e as DecodeError).reason).toBe("unexpected end of data");
    }
  });

  test("throws on a high surrogate not followed by a low surrogate", () => {
    try {
      utf16Decode(hex("fffe00d80000"));
      throw new Error("expected throw");
    } catch (e) {
      expect((e as DecodeError).reason).toBe("illegal UTF-16 surrogate");
    }
  });

  test("throws on a lone low surrogate", () => {
    try {
      utf16Decode(hex("fffe00dc"));
      throw new Error("expected throw");
    } catch (e) {
      expect((e as DecodeError).reason).toBe("illegal encoding");
    }
  });
});

describe("real charmap decode throws at holes (DESIGN: errors are API)", () => {
  const win1252 = REAL_CODECS.get("windows-1252")!;

  test("real windows-1252 is registered with its holes", () => {
    expect(win1252).toBeInstanceOf(CharmapCodec);
    expect(win1252.holes.has(0x9d)).toBe(true);
    expect(win1252.holes.has(0x81)).toBe(true);
  });

  test("formats the canonical 0x9d-in-position-4 charmap message", () => {
    // b'\x00\x01\x02\x03\x9d\x05' — byte 0x9d is unassigned in windows-1252.
    const bytes = hex("00010203" + "9d" + "05");
    try {
      win1252.decode(bytes);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DecodeError);
      const de = e as DecodeError;
      expect(de.message).toBe(
        "'charmap' codec can't decode byte 0x9d in position 4: character maps to <undefined>",
      );
      expect(de.encoding).toBe("charmap");
      expect(de.start).toBe(4);
      expect(de.end).toBe(5);
      expect(de.reason).toBe("character maps to <undefined>");
    }
  });

  test("decodes assigned bytes correctly", () => {
    // 0x80 -> EURO SIGN, 0x41 -> 'A'
    expect(win1252.decode(hex("8041"))).toBe("€A");
  });

  test("throws at the first hole even after valid bytes", () => {
    const de = (() => {
      try {
        win1252.decode(hex("4180")); // valid
        win1252.decode(hex("418d")); // 0x8d is a hole
      } catch (e) {
        return e as DecodeError;
      }
      return undefined;
    })();
    expect(de).toBeInstanceOf(DecodeError);
    expect(de!.start).toBe(1);
  });
});

describe("charmap encode (last-write-wins build, throws on unmapped)", () => {
  const win1252 = REAL_CODECS.get("windows-1252")!;

  test("buildEncodeMap matches codecs.charmap_build (last-write-wins)", () => {
    // Two table positions hold the same character; the later byte wins.
    const table = "AB" + "A".repeat(254); // byte 0->'A', byte 2..255->'A'
    const map = buildEncodeMap(table);
    expect(map.get("A".charCodeAt(0))).toBe(255);
    expect(map.get("B".charCodeAt(0))).toBe(1);
  });

  test("encodes a mapped character", () => {
    expect(Array.from(win1252.encode("€"))).toEqual([0x80]); // EURO SIGN
  });

  test("throws on a character the real encoding cannot represent", () => {
    // Byte 0x81 is a hole in real windows-1252, so U+0081 has no encode entry.
    // The string is "A" + U+0081; "A" encodes, then U+0081 fails at position 1.
    try {
      win1252.encode("A");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(EncodeError);
      const ee = e as EncodeError;
      expect(ee.encoding).toBe("charmap");
      expect(ee.start).toBe(1);
      expect(ee.end).toBe(2);
      expect(ee.reason).toBe("character maps to <undefined>");
      expect(ee.message).toBe(
        "'charmap' codec can't encode character '\\x81' in position 1: character maps to <undefined>",
      );
    }
  });

  test("reports astral-char encode-failure position in UTF-16 units", () => {
    try {
      win1252.encode("\u{1F600}"); // 😀, not representable
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(EncodeError);
      const ee = e as EncodeError;
      expect(ee.start).toBe(0);
      expect(ee.end).toBe(2); // surrogate pair spans two UTF-16 units
    }
  });
});

describe("free-function charmap engine", () => {
  test("charmapDecode/charmapEncode round-trip latin-1", () => {
    const table = REAL_CODECS.get("latin-1")!.decodingTable;
    const holes = new Set<number>();
    const encodeMap = buildEncodeMap(table);
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const decoded = charmapDecode(bytes, table, holes);
    expect(decoded).toHaveLength(256);
    expect(Array.from(charmapEncode(decoded, encodeMap))).toEqual(
      Array.from(bytes),
    );
  });
});

describe("normalizeEncoding mirrors CPython encodings.normalize_encoding", () => {
  test.each([
    ["sloppy-windows-1252", "sloppy_windows_1252"],
    ["sloppy_windows_1252", "sloppy_windows_1252"],
    ["Sloppy-Windows-1252", "Sloppy_Windows_1252"],
    ["sloppy-iso-8859-3", "sloppy_iso_8859_3"],
    ["windows-1252", "windows_1252"],
    ["macroman", "macroman"],
    ["latin-1", "latin_1"],
    ["sloppy--windows  1252", "sloppy_windows_1252"],
    ["  latin1.x ", "latin1.x"],
  ] as const)("%j -> %j", (input, expected) => {
    expect(normalizeEncoding(input)).toBe(expected);
  });
});

describe("registries cover the expected encodings", () => {
  test("every INCOMPLETE encoding has a sloppy codec", () => {
    const names = [
      ...Array.from({ length: 9 }, (_, i) => `sloppy-windows-${1250 + i}`),
      ...[3, 6, 7, 8, 11].map((n) => `sloppy-iso-8859-${n}`),
      ...Array.from({ length: 9 }, (_, i) => `sloppy-cp${1250 + i}`),
      "sloppy-cp874",
    ];
    for (const n of names) {
      expect(getSloppyCodec(n), n).toBeInstanceOf(CharmapCodec);
    }
  });

  test("real codecs include the CHARMAP_ENCODINGS bases", () => {
    for (const n of ["latin-1", "iso-8859-2", "macroman", "cp437", "windows-1252"]) {
      expect(REAL_CODECS.get(n), n).toBeInstanceOf(CharmapCodec);
    }
  });

  test("SLOPPY_CODECS is keyed by normalized name", () => {
    expect(SLOPPY_CODECS.has("sloppy_windows_1252")).toBe(true);
    expect(SLOPPY_CODECS.has("sloppy-windows-1252")).toBe(false);
  });
});
