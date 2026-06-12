// Doctest transcriptions.
//
// python-ftfy runs its module docstrings through pytest's `--doctest-modules`
// (see python-ftfy/pytest.ini). Those `>>>` examples are part of the acceptance
// surface, so this suite transcribes the ones not already pinned elsewhere:
//
//   - the per-fixer doctests in `ftfy/fixes.py`,
//   - the remaining `fix_encoding` / `fix_encoding_and_explain` doctests in
//     `ftfy/__init__.py`,
//   - the codec doctests in `ftfy/bad_codecs/__init__.py`,
//     `ftfy/bad_codecs/utf8_variants.py`, and `ftfy/bad_codecs/sloppy.py`.
//
// Doctests already covered by other ported suites are NOT duplicated here:
//   - fix_text / fix_encoding_and_explain(sÃ³, voilÃ) / apply_plan / decode_escapes
//     / explain_unicode → tests/internal/index-extras.test.ts
//   - character_width / monospaced_width / display_{ljust,rjust,center}
//     → tests/internal/formatting.test.ts
//   - unescape_html(&#xffff; …) charref edges → tests/internal/entities.test.ts

import { describe, expect, test, vi } from "vitest";

import { decode } from "../../src/codecs/index.js";
import {
  fix_character_width,
  fix_latin_ligatures,
  fix_line_breaks,
  fix_surrogates,
  remove_bom,
  remove_terminal_escapes,
  uncurl_quotes,
  unescape_html,
} from "../../src/fixes.js";
import { explain_unicode, fix_encoding } from "../../src/index.js";

describe("fixes.py doctests", () => {
  test("unescape_html", () => {
    expect(unescape_html("&lt;tag&gt;")).toBe("<tag>");
    expect(unescape_html("&Jscr;ohn &HilbertSpace;ancock")).toBe(
      "𝒥ohn ℋancock",
    );
    expect(unescape_html("&checkmark;")).toBe("✓");
    expect(unescape_html("P&eacute;rez")).toBe("Pérez");
    expect(unescape_html("P&EACUTE;REZ")).toBe("PÉREZ");
    expect(unescape_html("BUNDESSTRA&SZLIG;E")).toBe("BUNDESSTRASSE");
    expect(unescape_html("&ntilde; &Ntilde; &NTILDE; &nTILDE;")).toBe(
      "ñ Ñ Ñ &nTILDE;",
    );
  });

  test("remove_terminal_escapes", () => {
    expect(
      remove_terminal_escapes(
        "\x1b[36;44mI'm blue, da ba dee da ba doo...\x1b[0m",
      ),
    ).toBe("I'm blue, da ba dee da ba doo...");
  });

  test("uncurl_quotes", () => {
    expect(uncurl_quotes("“here’s a test”")).toBe('"here\'s a test"');
  });

  test("fix_latin_ligatures", () => {
    expect(fix_latin_ligatures("ﬂuﬃeﬆ")).toBe("fluffiest");
  });

  test("fix_character_width", () => {
    expect(fix_character_width("ＬＯＵＤ　ＮＯＩＳＥＳ")).toBe("LOUD NOISES");
    // "Ｕﾀｰﾝ" means "U-turn".
    expect(fix_character_width("Ｕﾀｰﾝ")).toBe("Uターン");
  });

  test("fix_line_breaks", () => {
    expect(
      fix_line_breaks(
        "This string is made of two things: " + "1. Unicode " + "2. Spite",
      ),
    ).toBe("This string is made of two things:\n1. Unicode\n2. Spite");

    // The upstream doctest renders these via `text.encode("unicode-escape")`;
    // the literal results are spelled out here.
    expect(fix_line_breaks("Content-type: text/plain\r\n\r\nHi.")).toBe(
      "Content-type: text/plain\n\nHi.",
    );
    expect(fix_line_breaks("This is how Microsoft \r trolls Mac users")).toBe(
      "This is how Microsoft \n trolls Mac users",
    );
    expect(fix_line_breaks("What is this \x85 I don't even")).toBe(
      "What is this \n I don't even",
    );
  });

  test("fix_surrogates", () => {
    // high_surrogate = chr(0xd83d); low_surrogate = chr(0xdca9)
    const highSurrogate = "\ud83d";
    const lowSurrogate = "\udca9";
    expect(fix_surrogates(highSurrogate + lowSurrogate)).toBe("💩");
    // A reversed (low, high) pair is not a valid surrogate pair: each lone
    // surrogate becomes U+FFFD (the upstream doctest prints "��"). Verified
    // against python-ftfy 6.3.1: the return value is two U+FFFD codepoints.
    expect(fix_surrogates(lowSurrogate + highSurrogate)).toBe("��");
  });

  test("remove_bom", () => {
    expect(remove_bom("﻿" + "Where do you want to go today?")).toBe(
      "Where do you want to go today?",
    );
  });
});

describe("__init__.py doctests (fix_encoding)", () => {
  test("fix_encoding", () => {
    expect(fix_encoding("Ã³")).toBe("ó");
    // HTML entities are not encoding mojibake, so fix_encoding leaves them alone.
    expect(fix_encoding("&ATILDE;&SUP3;")).toBe("&ATILDE;&SUP3;");
  });
});

describe("bad_codecs doctests", () => {
  // b'\xed\xa0\xbd\xed\xb8\x8d'.decode('utf-8-variants') == '😍'
  test("utf-8-variants decodes a CESU-8 astral pair", () => {
    const bytes = Uint8Array.from([0xed, 0xa0, 0xbd, 0xed, 0xb8, 0x8d]);
    expect(decode(bytes, "utf-8-variants")).toBe("😍");
  });

  // b'here comes a null! \xc0\x80'.decode('utf-8-var') == 'here comes a null! \x00'
  test("utf-8-var decodes a Java-style overlong null", () => {
    const prefix = "here comes a null! ";
    const bytes = Uint8Array.from([
      ...[...prefix].map((c) => c.charCodeAt(0)),
      0xc0,
      0x80,
    ]);
    expect(decode(bytes, "utf-8-var")).toBe("here comes a null! \x00");
  });
});

describe("bad_codecs/sloppy.py doctest (via explain_unicode)", () => {
  // b'\x80\x81\x82' decoded three ways, then explained. explain_unicode is async
  // in this port (the documented sync→async divergence), so each block awaits.
  async function explainLines(text: string): Promise<string[]> {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      lines.push(line);
    });
    try {
      await explain_unicode(text);
    } finally {
      spy.mockRestore();
    }
    return lines;
  }

  test("latin-1 decode", async () => {
    // some_bytes.decode('latin-1') == '\x80\x81\x82'
    expect(await explainLines("\x80\x81\x82")).toEqual([
      "U+0080  \\x80    [Cc] <unknown>",
      "U+0081  \\x81    [Cc] <unknown>",
      "U+0082  \\x82    [Cc] <unknown>",
    ]);
  });

  test("windows-1252 decode with replace", async () => {
    // some_bytes.decode('windows-1252', 'replace') == '€�‚'
    expect(await explainLines("€�‚")).toEqual([
      "U+20AC  €       [Sc] EURO SIGN",
      "U+FFFD  �       [So] REPLACEMENT CHARACTER",
      "U+201A  ‚       [Ps] SINGLE LOW-9 QUOTATION MARK",
    ]);
  });

  test("sloppy-windows-1252 decode", async () => {
    // some_bytes.decode('sloppy-windows-1252') == '€\x81‚'
    const decoded = decode(
      Uint8Array.from([0x80, 0x81, 0x82]),
      "sloppy-windows-1252",
    );
    expect(decoded).toBe("€\x81‚");
    expect(await explainLines(decoded)).toEqual([
      "U+20AC  €       [Sc] EURO SIGN",
      "U+0081  \\x81    [Cc] <unknown>",
      "U+201A  ‚       [Ps] SINGLE LOW-9 QUOTATION MARK",
    ]);
  });
});
