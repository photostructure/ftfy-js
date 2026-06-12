// Acceptance tests ported from python-ftfy's tests/test_entities.py.
//
// These exercise the ftfy-level entity handling: the unescape_html fixer (with
// its uppercase-named-entity support and the unescape_html:"auto"→false flip on
// a literal '<'), end-to-end through fix_text / fix_text_segment, plus the
// fix_entities deprecation alias. (The raw html.unescape charref tests live in
// entities.test.ts.)

import { describe, expect, test, vi } from "vitest";

import { unescape_html } from "../../src/fixes.js";
import { fix_text, fix_text_segment } from "../../src/index.js";

describe("test_entities", () => {
  test("test_entities", () => {
    const example = "&amp;\n<html>\n&amp;";
    expect(fix_text(example)).toBe("&\n<html>\n&amp;");
    expect(fix_text_segment(example)).toBe("&amp;\n<html>\n&amp;");

    expect(fix_text(example, null, { unescape_html: true })).toBe(
      "&\n<html>\n&",
    );
    expect(fix_text_segment(example, null, { unescape_html: true })).toBe(
      "&\n<html>\n&",
    );

    expect(fix_text(example, null, { unescape_html: false })).toBe(
      "&amp;\n<html>\n&amp;",
    );
    expect(fix_text_segment(example, null, { unescape_html: false })).toBe(
      "&amp;\n<html>\n&amp;",
    );

    expect(fix_text_segment("&lt;&gt;", null, { unescape_html: false })).toBe(
      "&lt;&gt;",
    );
    expect(fix_text_segment("&lt;&gt;", null, { unescape_html: true })).toBe(
      "<>",
    );
    expect(fix_text_segment("&lt;&gt;")).toBe("<>");
    expect(fix_text_segment("jednocze&sacute;nie")).toBe("jednocześnie");
    expect(fix_text_segment("JEDNOCZE&Sacute;NIE")).toBe("JEDNOCZEŚNIE");
    expect(
      fix_text_segment("ellipsis&#133;", null, { normalization: "NFKC" }),
    ).toBe("ellipsis...");
    expect(
      fix_text_segment("ellipsis&#x85;", null, { normalization: "NFKC" }),
    ).toBe("ellipsis...");
    expect(fix_text_segment("broken&#x81;")).toBe("broken\x81");
    expect(fix_text_segment("&amp;amp;amp;")).toBe("&");
    expect(unescape_html("euro &#x80;")).toBe("euro €");
    expect(unescape_html("EURO &EURO;")).toBe("EURO €");
    expect(unescape_html("not an entity &#20x6;")).toBe(
      "not an entity &#20x6;",
    );
    expect(unescape_html("JEDNOCZE&SACUTE;NIE")).toBe("JEDNOCZEŚNIE");
    expect(unescape_html("V&SCARON;ICHNI")).toBe("VŠICHNI");
    expect(unescape_html("&#xffff;")).toBe("");
    expect(unescape_html("&#xffffffff;")).toBe("�");
    expect(fix_text_segment("this is just informal english &not html")).toBe(
      "this is just informal english &not html",
    );
  });

  test("test_old_parameter_name", () => {
    const example = "&amp;\n<html>\n&amp;";
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      expect(fix_text(example, null, { fix_entities: true })).toBe(
        "&\n<html>\n&",
      );
      expect(warn).toHaveBeenCalled();
      warn.mockClear();
      expect(fix_text(example, null, { fix_entities: false })).toBe(
        "&amp;\n<html>\n&amp;",
      );
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
