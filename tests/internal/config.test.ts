import { afterEach, describe, expect, test, vi } from "vitest";

import {
  configFromKwargs,
  FIXER_NAMES,
  FIXERS,
  makeConfig,
  registerFixers,
  replace,
  TextFixerConfig,
  type TextFixerConfig as TextFixerConfigType,
} from "../../src/config.js";
import { TextFixerConfig as RootTextFixerConfig } from "../../src/index.js";

describe("makeConfig", () => {
  test("returns the Python defaults", () => {
    expect(makeConfig()).toEqual({
      unescape_html: "auto",
      remove_terminal_escapes: true,
      fix_encoding: true,
      restore_byte_a0: true,
      replace_lossy_sequences: true,
      decode_inconsistent_utf8: true,
      fix_c1_controls: true,
      fix_latin_ligatures: true,
      fix_character_width: true,
      uncurl_quotes: true,
      fix_line_breaks: true,
      fix_surrogates: true,
      remove_control_chars: true,
      normalization: "NFC",
      max_decode_length: 1000000,
      explain: true,
    });
  });

  test("applies overrides without mutating other fields", () => {
    const config = makeConfig({ unescape_html: false, explain: false });
    expect(config.unescape_html).toBe(false);
    expect(config.explain).toBe(false);
    // Everything else stays at the default.
    expect(config.remove_terminal_escapes).toBe(true);
    expect(config.normalization).toBe("NFC");
  });

  test("preserves null normalization (Python None)", () => {
    expect(makeConfig({ normalization: null }).normalization).toBeNull();
  });

  test("returns a fresh object each call", () => {
    expect(makeConfig()).not.toBe(makeConfig());
  });

  test("rejects unknown fields like Python's NamedTuple constructor", () => {
    expect(() => makeConfig({ bogus: true } as never)).toThrow(
      "Unknown TextFixerConfig field: 'bogus'",
    );
  });

  test("TextFixerConfig is a runtime constructor-compatible factory", () => {
    expect(TextFixerConfig({ explain: false })).toEqual(
      makeConfig({ explain: false }),
    );
  });
});

describe("replace", () => {
  test("returns a new config with the given fields overridden", () => {
    const base = makeConfig();
    const replaced = replace(base, { unescape_html: false });
    expect(replaced.unescape_html).toBe(false);
    expect(replaced).not.toBe(base);
  });

  test("does not mutate the original config", () => {
    const base = makeConfig();
    replace(base, { explain: false });
    expect(base.explain).toBe(true);
  });

  test("leaves all unspecified fields unchanged", () => {
    const base = makeConfig({ max_decode_length: 42 });
    const replaced = replace(base, { uncurl_quotes: false });
    expect(replaced.max_decode_length).toBe(42);
    expect(replaced.uncurl_quotes).toBe(false);
    expect(replaced.unescape_html).toBe("auto");
  });

  test("rejects unknown fields", () => {
    expect(() => replace(makeConfig(), { bogus: true } as never)).toThrow(
      "Unknown TextFixerConfig field: 'bogus'",
    );
  });
});

describe("FIXERS registry", () => {
  test("FIXER_NAMES has exactly the 12 Python fixers, in order", () => {
    expect([...FIXER_NAMES]).toEqual([
      "unescape_html",
      "remove_terminal_escapes",
      "restore_byte_a0",
      "replace_lossy_sequences",
      "decode_inconsistent_utf8",
      "fix_c1_controls",
      "fix_latin_ligatures",
      "fix_character_width",
      "uncurl_quotes",
      "fix_line_breaks",
      "fix_surrogates",
      "remove_control_chars",
    ]);
  });

  test("fix_encoding is NOT a FIXERS member", () => {
    expect(FIXER_NAMES as readonly string[]).not.toContain("fix_encoding");
    expect("fix_encoding" in FIXERS).toBe(false);
  });

  test("membership (`in`) reports the 12 known fixers", () => {
    for (const name of FIXER_NAMES) {
      expect(name in FIXERS).toBe(true);
    }
    expect("not_a_fixer" in FIXERS).toBe(false);
  });

  test("registerFixers wires functions retrievable through FIXERS", () => {
    const fn = (s: string): string => `${s}!`;
    registerFixers({ uncurl_quotes: fn });
    expect(FIXERS.uncurl_quotes).toBe(fn);
    expect(FIXERS.uncurl_quotes("x")).toBe("x!");
  });

  test("known fixers are wired once fixes.ts is loaded", () => {
    // This file imports `../src/index.js`, which imports `fixes.ts`; loading
    // `fixes.ts` runs its one-time `registerFixers(...)` call. So in this process
    // every FIXER_NAMES entry resolves to a real function — the empty-registry
    // "not registered yet" guard (a Wave-1 placeholder) is no longer reachable
    // here. The guard itself is still covered in isolation by config-only
    // consumers; see the Proxy `get` trap in config.ts.
    expect(typeof FIXERS.restore_byte_a0).toBe("function");
  });
});

describe("configFromKwargs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns the config unchanged with no kwargs", () => {
    const base = makeConfig();
    expect(configFromKwargs(base)).toBe(base);
  });

  test("applies plain kwargs", () => {
    const result = configFromKwargs(makeConfig(), { uncurl_quotes: false });
    expect(result.uncurl_quotes).toBe(false);
  });

  // Ported from test_entities.py::test_old_parameter_name. Since the public
  // fix_text entry point lives in index.ts (a later wave), we exercise the
  // deprecation at the configFromKwargs layer that owns it: passing the
  // deprecated `fix_entities` kwarg must emit a DeprecationWarning and map to
  // `unescape_html`.
  test("fix_entities=true emits a deprecation warning and maps to unescape_html", () => {
    const emit = vi
      .spyOn(process, "emitWarning")
      .mockImplementation((() => {}) as typeof process.emitWarning);

    const result = configFromKwargs(makeConfig(), { fix_entities: true });

    expect(result.unescape_html).toBe(true);
    expect(emit).toHaveBeenCalledOnce();
    const [message, type] = emit.mock.calls[0] as [string, string];
    expect(message).toContain("fix_entities");
    expect(message).toContain("unescape_html");
    expect(type).toBe("DeprecationWarning");
  });

  test("fix_entities=false maps to unescape_html=false and warns", () => {
    const emit = vi
      .spyOn(process, "emitWarning")
      .mockImplementation((() => {}) as typeof process.emitWarning);

    const result = configFromKwargs(makeConfig(), { fix_entities: false });

    expect(result.unescape_html).toBe(false);
    expect(emit).toHaveBeenCalledOnce();
  });

  test("does not leak the fix_entities key into the config", () => {
    vi.spyOn(process, "emitWarning").mockImplementation(
      (() => {}) as typeof process.emitWarning,
    );
    const result = configFromKwargs(makeConfig(), {
      fix_entities: true,
    }) as TextFixerConfigType & { fix_entities?: unknown };
    expect("fix_entities" in result).toBe(false);
  });

  test("rejects unknown kwargs after translating fix_entities", () => {
    vi.spyOn(process, "emitWarning").mockImplementation(
      (() => {}) as typeof process.emitWarning,
    );
    expect(() =>
      configFromKwargs(makeConfig(), {
        fix_entities: true,
        bogus: true,
      } as never),
    ).toThrow("Unknown TextFixerConfig field: 'bogus'");
  });
});

describe("package root config exports", () => {
  test("exports the callable TextFixerConfig from index.ts", () => {
    // Only the python-public names are re-exported from the package root; the
    // camelCase helpers (makeConfig, replace, …) stay module-internal.
    expect(RootTextFixerConfig({ unescape_html: false })).toEqual(
      makeConfig({ unescape_html: false }),
    );
  });
});
