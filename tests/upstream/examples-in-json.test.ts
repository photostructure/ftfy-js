// Acceptance tests ported from python-ftfy's tests/test_examples_in_json.py.
//
// The test-cases/*.json corpus (collected from real-world mojibake plus
// synthetic cases) is the canonical end-to-end check of the fix loops: fix_text,
// fix_and_explain + apply_plan round-trip, fix_encoding_and_explain, and the
// "disable every other step" path that isolates the encoding fix.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { encode } from "../../src/codecs/index.js";
import {
  apply_plan,
  fix_and_explain,
  fix_encoding_and_explain,
  fix_text,
} from "../../src/index.js";

interface TestCase {
  label: string;
  original: string;
  fixed: string;
  expect: "pass" | "fail";
  "fixed-encoding"?: string;
  comment?: string;
}

function loadTestData(): TestCase[] {
  const dir = fileURLToPath(new URL("../test-cases/", import.meta.url));
  const data: TestCase[] = [];
  for (const file of readdirSync(dir)) {
    if (file.endsWith(".json")) {
      const parsed = JSON.parse(
        readFileSync(new URL(`../test-cases/${file}`, import.meta.url), "utf8"),
      ) as TestCase[];
      data.push(...parsed);
    }
  }
  return data;
}

const TEST_DATA = loadTestData();
const TESTS_THAT_PASS = TEST_DATA.filter((t) => t.expect === "pass");
const TESTS_THAT_FAIL = TEST_DATA.filter((t) => t.expect === "fail");

/** Mirror Python's `text.encode("utf-8").decode("latin-1")` (extra-bad layer). */
function utf8ThenLatin1(text: string): string {
  return Buffer.from(encode(text, "utf-8")).toString("latin1");
}

describe("test_examples_in_json", () => {
  test.each(TEST_DATA.map((tc) => [tc.label, tc] as const))(
    "test_well_formed_example: %s",
    (_label, testCase) => {
      expect(["pass", "fail"]).toContain(testCase.expect);
    },
  );

  test.each(TESTS_THAT_PASS.map((tc) => [tc.label, tc] as const))(
    "test_json_example: %s",
    (_label, testCase) => {
      const orig = testCase.original;
      const fixed = testCase.fixed;

      // We can fix the text as intended.
      expect(fix_text(orig)).toBe(fixed);

      // fix_and_explain outputs a plan that reproduces its result.
      const { text: fixedOutput, explanation: plan } = fix_and_explain(orig);
      expect(apply_plan(orig, plan!)).toBe(fixedOutput);

      // Same for fix_encoding_and_explain.
      const { text: encodingFix, explanation: encPlan } =
        fix_encoding_and_explain(orig);
      expect(apply_plan(orig, encPlan!)).toBe(encodingFix);

      // Ask for the encoding fix a different way, by disabling all other steps.
      expect(
        fix_text(orig, null, {
          unescape_html: false,
          remove_terminal_escapes: false,
          fix_character_width: false,
          fix_latin_ligatures: false,
          uncurl_quotes: false,
          fix_line_breaks: false,
          fix_surrogates: false,
          remove_control_chars: false,
          normalization: null,
        }),
      ).toBe(encodingFix);

      // Decode the text as intended.
      expect(fix_text(orig)).toBe(fixed);
      expect(encodingFix).toBe(testCase["fixed-encoding"] ?? fixed);

      // Decode even with an extra layer of badness.
      const extraBad = utf8ThenLatin1(orig);
      expect(fix_text(extraBad)).toBe(fixed);
    },
  );

  // xfail-strict: these cases are expected to fail ftfy's heuristic. Using
  // test.fails mirrors pytest's @pytest.mark.xfail(strict=True).
  if (TESTS_THAT_FAIL.length > 0) {
    test.fails.each(TESTS_THAT_FAIL.map((tc) => [tc.label, tc] as const))(
      "test_failing_json_example: %s",
      (_label, testCase) => {
        const fixed = testCase.fixed;
        const { text: encodingFix } = fix_encoding_and_explain(
          testCase.original,
        );
        expect(encodingFix).toBe(testCase["fixed-encoding"] ?? fixed);
      },
    );
  }
});
