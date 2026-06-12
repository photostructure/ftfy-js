// Acceptance tests for the html.unescape port (src/html-entities.ts).
//
// These port the charref/unescape parts of python-ftfy's test_entities.py, plus
// the charref edge cases called out in the html-unescape TPP. The values are the
// raw output of CPython's `html.unescape` (verified against CPython 3.12), NOT
// ftfy's `unescape_html` fixer — the fixer's HTML_ENTITY_RE guard and uppercase
// named-entity handling live in fixes.ts / chardata.ts (Wave 2). In particular,
// uppercased named refs such as &EURO; / &SACUTE; are NOT recognized by raw
// html.unescape and are left unchanged here.

import { describe, expect, test } from "vitest";

import { unescape } from "../../src/html-entities.js";

describe("unescape", () => {
  test("returns input unchanged when it contains no '&'", () => {
    expect(unescape("plain text")).toBe("plain text");
    expect(unescape("")).toBe("");
  });

  test.each<[string, string]>([
    // TPP-required charref edge cases
    ["&#xffff;", ""], // _invalid_codepoints → empty string
    ["&#xffffffff;", "�"], // num > 0x10FFFF → U+FFFD
    ["euro &#x80;", "euro €"], // _invalid_charrefs[0x80] → EURO SIGN
    ["not an entity &#20x6;", "not an entity x6;"], // raw: matches &#20 → invalid cp → ""

    // _invalid_charrefs (C1 remaps)
    ["&#0;", "�"], // 0x00 → REPLACEMENT CHARACTER
    ["&#x0;", "�"],
    ["&#13;", "\r"], // 0x0D → CARRIAGE RETURN
    ["broken&#x81;", "broken\x81"], // 0x81 → <control>
    ["ellipsis&#133;", "ellipsis…"], // 0x85 → HORIZONTAL ELLIPSIS
    ["ellipsis&#x85;", "ellipsis…"],

    // _invalid_codepoints → empty string
    ["&#1;", ""],
    ["&#x0B;", ""],
    ["&#xfdd0;", ""],

    // surrogate range and out-of-range → U+FFFD
    ["&#xD800;", "�"],
    ["&#xDFFF;", "�"],
    ["&#x110000;", "�"],

    // astral numeric ref
    ["&#x1F600;", "😀"],

    // named refs (with and without semicolon)
    ["&amp;", "&"],
    ["&amp;amp;amp;", "&amp;amp;"], // only first &amp; is a reference
    ["&lt;&gt;", "<>"],
    ["jednocze&sacute;nie", "jednocześnie"],

    // longest-prefix-without-semicolon loop
    ["&notit;", "¬it;"], // &not is a legacy entity, 'it;' is trailing
    ["&notin;", "∉"], // &notin; is itself an entity
    ["&not html", "¬ html"], // legacy &not without semicolon
    [
      "this is just informal english &not html",
      "this is just informal english ¬ html",
    ],

    // uppercased named refs are NOT in the raw html5 dict (left unchanged here)
    ["EURO &EURO;", "EURO &EURO;"],
    ["JEDNOCZE&SACUTE;NIE", "JEDNOCZE&SACUTE;NIE"],
    ["V&SCARON;ICHNI", "V&SCARON;ICHNI"],

    // a bare '&' that doesn't start a reference is left alone
    ["a & b", "a & b"],
  ])("unescape(%j) === %j", (input, expected) => {
    expect(unescape(input)).toBe(expected);
  });

  test("multiple calls do not leak regex lastIndex state", () => {
    // The shared global _charref regex must not carry lastIndex between calls.
    expect(unescape("&amp;")).toBe("&");
    expect(unescape("&amp;")).toBe("&");
    expect(unescape("&lt;")).toBe("<");
  });
});
