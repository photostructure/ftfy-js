// Tests for src/formatting.ts, transcribed from the doctests in
// python-ftfy/ftfy/formatting.py. The doctests are the acceptance criteria for
// the ported wcwidth/wcswidth display-width logic.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  character_width,
  display_center,
  display_ljust,
  display_rjust,
  monospaced_width,
} from "../../src/formatting.js";
import {
  character_width as root_character_width,
  display_ljust as root_display_ljust,
} from "../../src/index.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("character_width", () => {
  test.each([
    ["車", 2],
    ["A", 1],
    ["‍", 0], // ZERO WIDTH JOINER
    ["\n", -1],
  ])("character_width(%j) === %d", (char, expected) => {
    expect(character_width(char)).toBe(expected);
  });

  test("throws on multi-codepoint strings", () => {
    expect(() => character_width("ab")).toThrow(
      "ord() expected a character, but string of length 2 found",
    );
  });
});

describe("monospaced_width", () => {
  test.each<[string, number]>([
    ["ちゃぶ台返し", 12],
    ["owl­flavored", 11], // SOFT HYPHEN is zero-width (wcwidth 0.2.13)
    ["example\x80", -1],
    // 'ibnida' written with 3 pre-composed characters...
    ["입니다", 6],
    // ...or with 7 jamo: same display width after NFC normalization.
    ["입니다", 6],
    // "blue" with terminal escapes still occupies 4 cells.
    ["\x1b[34mblue\x1b[m", 4],
  ])("monospaced_width(%j) === %d", (text, expected) => {
    expect(monospaced_width(text)).toBe(expected);
  });

  test("len of CJK string differs from its display width", () => {
    // Python: len('ちゃぶ台返し') == 6; here we count codepoints.
    expect(Array.from("ちゃぶ台返し").length).toBe(6);
    expect(monospaced_width("ちゃぶ台返し")).toBe(12);
  });
});

// The justify doctests render fixed lines; we check exact output strings.
const LINES = ["Table flip", "(╯°□°)╯︵ ┻━┻", "ちゃぶ台返し"];

describe("display_ljust", () => {
  test.each<[string, string]>([
    ["Table flip", "Table flip▒▒▒▒▒▒▒▒▒▒"],
    ["(╯°□°)╯︵ ┻━┻", "(╯°□°)╯︵ ┻━┻▒▒▒▒▒▒▒"],
    ["ちゃぶ台返し", "ちゃぶ台返し▒▒▒▒▒▒▒▒"],
  ])("display_ljust(%j, 20, '▒')", (line, expected) => {
    expect(display_ljust(line, 20, "▒")).toBe(expected);
  });

  test("returns text unchanged when it contains a control character", () => {
    expect(display_ljust("a\x80b", 20, "▒")).toBe("a\x80b");
  });

  test("throws when fillchar is not width 1", () => {
    expect(() => display_ljust("x", 5, "車")).toThrow(
      "The padding character must have display width 1",
    );
  });

  test("throws when fillchar has multiple codepoints", () => {
    expect(() => display_ljust("x", 5, "ab")).toThrow(
      "ord() expected a character, but string of length 2 found",
    );
  });
});

describe("display_rjust", () => {
  test.each<[string, string]>([
    ["Table flip", "▒▒▒▒▒▒▒▒▒▒Table flip"],
    ["(╯°□°)╯︵ ┻━┻", "▒▒▒▒▒▒▒(╯°□°)╯︵ ┻━┻"],
    ["ちゃぶ台返し", "▒▒▒▒▒▒▒▒ちゃぶ台返し"],
  ])("display_rjust(%j, 20, '▒')", (line, expected) => {
    expect(display_rjust(line, 20, "▒")).toBe(expected);
  });
});

describe("display_center", () => {
  test.each<[string, string]>([
    ["Table flip", "▒▒▒▒▒Table flip▒▒▒▒▒"],
    ["(╯°□°)╯︵ ┻━┻", "▒▒▒(╯°□°)╯︵ ┻━┻▒▒▒▒"],
    ["ちゃぶ台返し", "▒▒▒▒ちゃぶ台返し▒▒▒▒"],
  ])("display_center(%j, 20, '▒')", (line, expected) => {
    expect(display_center(line, 20, "▒")).toBe(expected);
  });
});

// Sanity: each justified output is itself at least `width` display cells wide.
describe("justification reaches the requested display width", () => {
  test.each(LINES)("%j justifies to >= 20 cells", (line) => {
    for (const out of [
      display_ljust(line, 20, "▒"),
      display_rjust(line, 20, "▒"),
      display_center(line, 20, "▒"),
    ]) {
      expect(monospaced_width(out)).toBeGreaterThanOrEqual(20);
    }
  });
});

describe("wcwidth-tables.ts is deterministic codegen output", () => {
  test("re-running gen_wcwidth.py yields no change", () => {
    const tablePath = new URL(
      "../../src/generated/wcwidth-tables.ts",
      import.meta.url,
    );
    const before = readFileSync(tablePath, "utf8");
    try {
      execFileSync("uv", ["run", "scripts/gen_wcwidth.py"], {
        cwd: REPO_ROOT,
        stdio: "pipe",
      });
    } catch (err) {
      // If `uv` is unavailable in this environment, skip the determinism check
      // rather than fail spuriously; CI runs codegen with uv and asserts no diff.
      const code = (err as { code?: string }).code;
      if (code === "ENOENT") {
        return;
      }
      throw err;
    }
    const after = readFileSync(tablePath, "utf8");
    expect(after).toBe(before);
  });
});

describe("package root formatting exports", () => {
  test("exports display-width helpers from index.ts", () => {
    expect(root_character_width("A")).toBe(1);
    expect(root_display_ljust("x", 3, ".")).toBe("x..");
  });
});
