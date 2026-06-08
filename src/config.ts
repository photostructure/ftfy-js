/**
 * Port of the data model from `ftfy/__init__.py`:
 *
 * - `ExplanationStep` (NamedTuple) → a `readonly [action, parameter]` tuple.
 * - `ExplainedText` (NamedTuple) → a `{ text, explanation }` object.
 * - `TextFixerConfig` (16-field NamedTuple with defaults) → a snake_case-keyed
 *   interface plus the `makeConfig` defaults factory and `replace` helper.
 * - `FIXERS` → the registry of the 12 string→string fixer functions that
 *   `apply_plan` and `_try_fix` can dispatch by name.
 * - `_config_from_kwargs` → `configFromKwargs`, including the `fix_entities`
 *   deprecation warning.
 *
 * This module is split out of `index.ts` to break the `fixes ↔ index` import
 * cycle: `config.ts` owns the data model and the `FIXERS` registry; `fixes.ts`
 * (Wave 3) registers the real fixer implementations, and `index.ts` consumes
 * both. `config.ts` must NOT import `index.ts` or `fixes.ts` at module top
 * level.
 *
 * See docs/DESIGN.md → "Data model", "The fixers", "Import cycle".
 */

/**
 * A step in an {@link ExplainedText}, explaining how to decode text.
 *
 * The possible actions are:
 *
 * - "encode": take in a string and encode it as bytes, with the given encoding
 * - "decode": take in bytes and decode them as a string, with the given encoding
 * - "transcode": convert bytes to bytes with a particular named function
 * - "apply": convert str to str with a particular named function
 * - "normalize": apply a Unicode normalization form (e.g. "NFC")
 *
 * The `parameter` is the name of the encoding or function to use. If it's a
 * function, it must appear in the {@link FIXERS} dictionary.
 *
 * Ported from Python's `ExplanationStep` NamedTuple. We use a tuple (rather than
 * an object) so that `apply_plan` can index `step[0]`/`step[1]` and so that
 * `toEqual([["apply", "..."], ...])` ports cleanly from the Python tests.
 */
export type ExplanationStep = readonly [action: string, parameter: string];

/**
 * The return type from ftfy's functions that provide an "explanation" of which
 * steps it applied to fix the text, such as `fix_and_explain()`.
 *
 * When the 'explain' option is disabled, these functions return the same type,
 * but the `explanation` will be `null`.
 *
 * Ported from Python's `ExplainedText` NamedTuple. We use an object (rather than
 * a tuple) so that `.text`/`.explanation` access ports cleanly, and Python's
 * `text, plan = ...` becomes `const { text, explanation: plan } = ...`.
 */
export interface ExplainedText {
  text: string;
  explanation: ExplanationStep[] | null;
}

/** The Unicode normalization forms accepted by `normalization`. */
export type NormalizationForm = "NFC" | "NFD" | "NFKC" | "NFKD";

/**
 * A `TextFixerConfig` object stores configuration options for ftfy.
 *
 * This is the TypeScript port of Python's `TextFixerConfig` NamedTuple. The keys
 * are intentionally snake_case to match the public Python API. Python's `None`
 * is preserved as `null`.
 *
 * See the upstream `TextFixerConfig` docstring (`ftfy/__init__.py`) for a full
 * description of each option.
 */
export interface TextFixerConfig {
  /**
   * Configures whether to replace HTML entities such as `&amp;` with the
   * character they represent. "auto" (the default) enables this by default but
   * disables it when a literal `<` appears. May also be `true` or `false`.
   */
  unescape_html: "auto" | boolean;
  /** Remove "ANSI" terminal escapes, such as for changing text color. */
  remove_terminal_escapes: boolean;
  /** Detect mojibake and attempt to fix it by re-decoding in another encoding. */
  fix_encoding: boolean;
  /** Allow U+20 to be interpreted as U+A0 when that makes a fixable mojibake. */
  restore_byte_a0: boolean;
  /** Replace partially-lossy mojibake ('�'/'?') with '�'. */
  replace_lossy_sequences: boolean;
  /** Reinterpret distinct UTF-8 mojibake even with no consistent re-encoding. */
  decode_inconsistent_utf8: boolean;
  /** Replace C1 control characters (U+80–U+9B) with Windows-1252 equivalents. */
  fix_c1_controls: boolean;
  /** Replace common Latin-alphabet ligatures, such as `ﬁ`, with their letters. */
  fix_latin_ligatures: boolean;
  /** Replace fullwidth Latin / halfwidth Katakana with standard widths. */
  fix_character_width: boolean;
  /** Replace curly quotes with straight quotes. */
  uncurl_quotes: boolean;
  /** Replace various line breaks with the standard Unix line break, `\n`. */
  fix_line_breaks: boolean;
  /** Replace UTF-16 surrogate codepoint sequences with the encoded character. */
  fix_surrogates: boolean;
  /** Remove certain control characters that have no displayed effect. */
  remove_control_chars: boolean;
  /**
   * Which kind of Unicode normalization to apply. `null` applies no
   * normalization. (Python `None` → `null`.)
   */
  normalization: NormalizationForm | null;
  /** The maximum "segment" size that ftfy will try to fix all at once. */
  max_decode_length: number;
  /** Whether to compute 'explanations' (lists describing what ftfy changed). */
  explain: boolean;
}

/** The 16 field names accepted by Python's TextFixerConfig NamedTuple. */
export const TEXT_FIXER_CONFIG_FIELDS = [
  "unescape_html",
  "remove_terminal_escapes",
  "fix_encoding",
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
  "normalization",
  "max_decode_length",
  "explain",
] as const satisfies readonly (keyof TextFixerConfig)[];

const TEXT_FIXER_CONFIG_FIELD_SET = new Set<string>(TEXT_FIXER_CONFIG_FIELDS);

/**
 * Reject unknown config fields. Python's `TextFixerConfig` NamedTuple rejects
 * unexpected keyword arguments (from both the constructor and `_replace`), and
 * we keep that *behavior* so a mistyped key fails loudly instead of silently
 * leaking into the config. We do NOT mirror CPython's exact wording here — that
 * message (`...__new__() got an unexpected keyword argument...`) is a Python
 * implementation detail no upstream test pins, and `__new__` is meaningless in
 * a TypeScript library. An idiomatic `TypeError` naming the field is clearer.
 */
function assertKnownConfigKeys(
  obj: object,
): asserts obj is Partial<TextFixerConfig> {
  const unexpected = Object.keys(obj).filter(
    (key) => !TEXT_FIXER_CONFIG_FIELD_SET.has(key),
  );
  if (unexpected.length > 0) {
    const names = unexpected.map((k) => `'${k}'`).join(", ");
    const plural = unexpected.length > 1 ? "s" : "";
    throw new TypeError(`Unknown TextFixerConfig field${plural}: ${names}`);
  }
}

/**
 * The 12 fixer names, in the order they appear in Python's `FIXERS` dict
 * (`ftfy/__init__.py`). The order matters because the registry and the public
 * API iterate over it.
 *
 * Note: `fix_encoding` is NOT a member of this list — it is a separate step
 * with its own loop in `index.ts`, not a `FIXERS` entry.
 */
export const FIXER_NAMES = [
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
] as const;

/** The name of one of the 12 fixers in {@link FIXERS}. */
export type FixerName = (typeof FIXER_NAMES)[number];

/**
 * A fixer function. Most fixers map a string to a string; the byte-level fixers
 * (`restore_byte_a0`, `replace_lossy_sequences`) operate on binary strings (one
 * char per byte). At the registry level both are typed as `(input) => output`.
 */
export type FixerFn = (input: string) => string;

/**
 * Registry of the functions that can be applied by `apply_plan` (and `_try_fix`)
 * via the "transcode"/"apply" plan steps.
 *
 * Ported from Python's `FIXERS` dict. Because `fixes.ts` does not exist yet
 * (Wave 3) and `config.ts` must not import it at the top level, the function
 * bindings are wired in later via {@link registerFixers}. Until then, looking up
 * a fixer that hasn't been registered throws — this is a programming error, not
 * a runtime-input error.
 *
 * WIRING (Wave 3): `fixes.ts` (or `index.ts`) must call
 * `registerFixers({ unescape_html: fixes.unescape_html, ... })` exactly once at
 * startup, supplying all 12 functions named in {@link FIXER_NAMES}. The
 * byte-level fixers (`restore_byte_a0`, `replace_lossy_sequences`) take/return
 * binary strings; the rest take/return Unicode strings. `FIXERS` is a `Proxy`,
 * so the registered functions are visible through it immediately and `in`
 * checks (used by `apply_plan`) work as in Python.
 */
const fixerRegistry: Partial<Record<FixerName, FixerFn>> = Object.create(null);

/**
 * Wire the real fixer implementations into the {@link FIXERS} registry. Called
 * once by Wave 3's `fixes.ts`/`index.ts`. Accepts a partial map so it can be
 * called incrementally if needed; calling it again overwrites existing entries.
 */
export function registerFixers(
  fixers: Partial<Record<FixerName, FixerFn>>,
): void {
  for (const name of Object.keys(fixers) as FixerName[]) {
    const fn = fixers[name];
    if (fn !== undefined) {
      fixerRegistry[name] = fn;
    }
  }
}

/**
 * The `FIXERS` registry, mirroring Python's `FIXERS` dict. Supports:
 *
 * - `FIXERS[name]` → the registered fixer function (throws if not yet wired).
 * - `name in FIXERS` → whether `name` is one of the 12 registered fixers
 *   (used by `apply_plan` to validate "transcode"/"apply" steps).
 *
 * Implemented as a `Proxy` so that lazy registration via {@link registerFixers}
 * is transparent to consumers.
 */
export const FIXERS: Record<FixerName, FixerFn> = new Proxy(
  fixerRegistry as Record<FixerName, FixerFn>,
  {
    get(target, prop: string | symbol): FixerFn | undefined {
      if (typeof prop !== "string") {
        return undefined;
      }
      const fn = target[prop as FixerName];
      if (fn === undefined) {
        if ((FIXER_NAMES as readonly string[]).includes(prop)) {
          throw new Error(
            `Fixer "${prop}" has not been registered yet. ` +
              `Wave 3's fixes.ts must call registerFixers(...) before use.`,
          );
        }
        return undefined;
      }
      return fn;
    },
    has(target, prop: string | symbol): boolean {
      // Mirror Python's `name in FIXERS`: membership is by the known fixer
      // names, regardless of whether the function has been wired in yet.
      return (
        typeof prop === "string" &&
        (FIXER_NAMES as readonly string[]).includes(prop)
      );
    },
  },
);

/**
 * The default {@link TextFixerConfig}, matching the defaults of Python's
 * `TextFixerConfig` NamedTuple. Returned fresh on each call so callers can
 * mutate without affecting others (in practice we treat configs as immutable
 * and use {@link replace}).
 */
export function makeConfig(
  overrides?: Partial<TextFixerConfig>,
): TextFixerConfig {
  const base: TextFixerConfig = {
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
  };
  if (overrides !== undefined) {
    assertKnownConfigKeys(overrides);
    return { ...base, ...overrides };
  }
  return base;
}

/** Runtime constructor-compatible factory for Python's TextFixerConfig NamedTuple. */
export function TextFixerConfig(
  overrides?: Partial<TextFixerConfig>,
): TextFixerConfig {
  return makeConfig(overrides);
}

/**
 * Port of `TextFixerConfig._replace`: return a new config with the given fields
 * overridden, leaving the original untouched.
 */
export function replace(
  config: TextFixerConfig,
  partial: Partial<TextFixerConfig>,
): TextFixerConfig {
  assertKnownConfigKeys(partial);
  return { ...config, ...partial };
}

/**
 * The keyword arguments accepted by ftfy's top-level functions: any subset of
 * the {@link TextFixerConfig} fields, plus the deprecated `fix_entities` alias.
 */
export type ConfigKwargs = Partial<TextFixerConfig> & {
  /** @deprecated Renamed to `unescape_html`. */
  fix_entities?: "auto" | boolean;
};

/**
 * Port of `_config_from_kwargs`: handle parameters provided as keyword arguments
 * to ftfy's top-level functions, converting them into a {@link TextFixerConfig}.
 *
 * The deprecated `fix_entities` kwarg is mapped to `unescape_html` and emits a
 * deprecation warning (Python's `warnings.warn(..., DeprecationWarning)` →
 * `process.emitWarning(..., "DeprecationWarning")`). Covered by
 * `test_old_parameter_name`.
 */
export function configFromKwargs(
  config: TextFixerConfig,
  kwargs?: ConfigKwargs,
): TextFixerConfig {
  if (kwargs === undefined) {
    return config;
  }
  if ("fix_entities" in kwargs) {
    process.emitWarning(
      "`fix_entities` has been renamed to `unescape_html`",
      "DeprecationWarning",
    );
    const { fix_entities, ...rest } = kwargs;
    return replace(config, { ...rest, unescape_html: fix_entities });
  }
  return replace(config, kwargs);
}

/**
 * Port of `_try_fix`: decide whether to apply a fixer and whether to record the
 * fix in `steps`.
 *
 * Applies the named fixer when `config[fixerName]` is truthy, appending an
 * `("apply", fixerName)` step to `steps` when the fixer changed the text (and
 * `steps` is being collected). Returns the (possibly) fixed text.
 */
export function tryFix(
  fixerName: FixerName,
  text: string,
  config: TextFixerConfig,
  steps: ExplanationStep[] | null,
): string {
  if (config[fixerName as keyof TextFixerConfig]) {
    const fixer = FIXERS[fixerName];
    const fixed = fixer(text);
    if (steps !== null && fixed !== text) {
      steps.push(["apply", fixerName]);
    }
    return fixed;
  }
  return text;
}
