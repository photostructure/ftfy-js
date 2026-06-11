// Acceptance tests ported from python-ftfy's tests/test_bytes.py.
//
// These pin guess_bytes across utf-16 / utf-8 / sloppy-windows-1252 / macroman,
// the Java-null (utf-8-variants) case, and the IncrementalDecoder byte-split
// equivalence. The encode side uses the codecs dispatcher (Python's
// `string.encode(encoding)`).

import { describe, expect, test } from "vitest";

import { encode } from "../src/codecs/index.js";
import { IncrementalDecoder } from "../src/codecs/utf8-variants.js";
import { guess_bytes } from "../src/index.js";

const TEST_ENCODINGS = ["utf-16", "utf-8", "sloppy-windows-1252"];

const TEST_STRINGS = [
  "Renée\nFleming",
  "Noël\nCoward",
  "Señor\nCardgage",
  "€ • £ • ¥",
  "¿Qué?",
];

describe("test_bytes", () => {
  test.each(TEST_STRINGS)("test_guess_bytes(%j)", (string) => {
    for (const encoding of TEST_ENCODINGS) {
      const [resultStr, resultEncoding] = guess_bytes(encode(string, encoding));
      expect(resultStr).toBe(string);
      expect(resultEncoding).toBe(encoding);
    }

    if (string.includes("\n")) {
      const oldMacBytes = encode(string.replaceAll("\n", "\r"), "macroman");
      const [resultStr] = guess_bytes(oldMacBytes);
      expect(resultStr).toBe(string.replaceAll("\n", "\r"));
    }
  });

  test("test_guess_bytes_null", () => {
    // b"null\xc0\x80separated"
    const bowdlerizedNull = Uint8Array.from([
      0x6e, 0x75, 0x6c, 0x6c, 0xc0, 0x80, 0x73, 0x65, 0x70, 0x61, 0x72, 0x61,
      0x74, 0x65, 0x64,
    ]);
    const [resultStr, resultEncoding] = guess_bytes(bowdlerizedNull);
    expect(resultStr).toBe("null\x00separated");
    expect(resultEncoding).toBe("utf-8-variants");
  });

  test("test_incomplete_sequences", () => {
    // b"surrogates: \xed\xa0\x80\xed\xb0\x80 / null: \xc0\x80"
    const testBytes = Uint8Array.from([
      0x73, 0x75, 0x72, 0x72, 0x6f, 0x67, 0x61, 0x74, 0x65, 0x73, 0x3a, 0x20,
      0xed, 0xa0, 0x80, 0xed, 0xb0, 0x80, 0x20, 0x2f, 0x20, 0x6e, 0x75, 0x6c,
      0x6c, 0x3a, 0x20, 0xc0, 0x80,
    ]);
    const testString = "surrogates: \u{10000} / null: \x00";

    // Feed this to decode() in two pieces; for every split point, the combined
    // output must equal testString.
    for (let splitPoint = 0; splitPoint <= testBytes.length; splitPoint++) {
      const left = testBytes.slice(0, splitPoint);
      const right = testBytes.slice(splitPoint);

      const decoder = new IncrementalDecoder();
      let got = decoder.decode(left, false);
      got += decoder.decode(right, true);
      expect(got).toBe(testString);
    }
  });
});
