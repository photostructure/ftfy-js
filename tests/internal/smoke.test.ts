import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { __version__ } from "../../src/index.js";

/**
 * The upstream python-ftfy release this port pins to. Bumping this is a
 * deliberate act that must accompany a re-port against the new release.
 */
const PINNED_UPSTREAM = "6.3.1";

/** Parse `__version__ = "x.y.z"` out of the python-ftfy submodule. */
function pythonSubmoduleVersion(): string {
  const initPy = fileURLToPath(
    new URL("../../python-ftfy/ftfy/__init__.py", import.meta.url),
  );
  const src = readFileSync(initPy, "utf8");
  const m = src.match(/^__version__\s*=\s*["']([^"']+)["']/m);
  if (!m) throw new Error(`could not find __version__ in ${initPy}`);
  return m[1];
}

describe("scaffolding smoke", () => {
  // TS side: the exported marker is the pinned upstream version, *not* the npm
  // package version (which has its own independent semver line).
  test("__version__ mirrors the pinned upstream python-ftfy", () => {
    expect(__version__).toBe(PINNED_UPSTREAM);
  });

  // Python side: the actual submodule must agree with the TS marker. If
  // `upstream:sync` advances the submodule past the pinned version, this fails
  // loudly so the port is re-validated rather than silently drifting.
  test("__version__ matches the python-ftfy submodule", () => {
    expect(__version__).toBe(pythonSubmoduleVersion());
  });

  // Confirms test.each is wired up (used heavily by the ported parametrized suites).
  test.each([
    ["a", "a"],
    ["b", "b"],
  ])("test.each works: %s", (input, expected) => {
    expect(input).toBe(expected);
  });
});
