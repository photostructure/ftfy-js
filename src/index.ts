/*!
 * @photostructure/ftfy
 *
 * A faithful TypeScript port of python-ftfy (v6.3.1, Apache-2.0) by Robyn Speer.
 * https://github.com/rspeer/python-ftfy
 *
 * The design, heuristics, badness model, sloppy codecs, and UTF-8 variants are
 * all the work of the original author. This port mirrors python-ftfy
 * module-for-module; see CLAUDE.md and docs/DESIGN.md.
 *
 * Copyright PhotoStructure, Inc. and contributors.
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */

/**
 * Port of `ftfy/__init__.py`: the public API and the two fix loops.
 *
 * - `fix_text` runs the segment loop (split on `\n`, capped at
 *   `max_decode_length`), calling `fix_and_explain` per segment.
 * - `fix_and_explain` runs the plan loop until the text stops changing,
 *   interleaving `unescape_html`, the encoding-fix step, the character fixers,
 *   and normalization.
 * - `fix_encoding_and_explain` / `_fix_encoding_one_step_and_explain` implement
 *   the mojibake encoding-repair heuristic; strict decode THROWING is the
 *   control-flow backbone that rejects candidate encodings.
 * - `guess_bytes`, `apply_plan`, `fix_file`, and `explain_unicode` round out the
 *   public surface.
 *
 * Parity notes:
 *
 * - The byte stage of `apply_plan` and the encoding-fix loop is a **binary
 *   string** (one char per byte), so the byte-level fixers and byte regexes port
 *   verbatim; it is converted to/from `Uint8Array` only at the `encode`/`decode`
 *   dispatcher boundary.
 * - `explain_unicode` is `async` — the lone, documented sync→async divergence —
 *   because it lazy-loads the generated Unicode-names table on first call.
 *
 * This is a faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import { is_bad } from "./badness.js";
import {
  ALTERED_UTF8_RE,
  C1_CONTROL_RE,
  CHARMAP_ENCODINGS,
  possible_encoding,
  UTF8_DETECTOR_RE,
} from "./chardata.js";
import { binaryToBytes, bytesToBinary } from "./codecs/binary-string.js";
import { decode, DecodeError, encode } from "./codecs/index.js";
import { utf16Decode } from "./codecs/utf16.js";
import { IncrementalDecoder } from "./codecs/utf8-variants.js";
import {
  configFromKwargs,
  type ConfigKwargs,
  type ExplainedText,
  type ExplanationStep,
  type FixerName,
  FIXERS,
  makeConfig,
  replace,
  type TextFixerConfig,
  tryFix,
} from "./config.js";
import { display_ljust } from "./formatting.js";
// Importing `fixes` for its side effect — it calls `registerFixers(...)` to wire
// the real fixer implementations into the FIXERS registry. The byte-level fixers
// (`restore_byte_a0`, `replace_lossy_sequences`) are also referenced directly by
// the encoding-fix loop. (`fixes.ts` imports this module's namespace lazily, so
// the cycle resolves via ESM live bindings.)
import {
  decode_inconsistent_utf8,
  fix_c1_controls,
  replace_lossy_sequences,
  restore_byte_a0,
} from "./fixes.js";

/**
 * The upstream python-ftfy version this package mirrors.
 *
 * This is intentionally the *upstream* version, not the npm package version
 * (which is tracked separately in package.json). It must equal the version in
 * `python-ftfy/ftfy/__init__.py` so future drift is unambiguous.
 */
export const __version__ = "6.3.1";

// Public, python-ftfy-compatible config surface only. `TextFixerConfig`
// (callable like the Python NamedTuple constructor, plus the type), `FIXERS`,
// and the Explanation data model are part of ftfy's public API; the camelCase
// helpers (`makeConfig`, `replace`, `configFromKwargs`, `registerFixers`,
// `tryFix`) and port-invented types have no upstream counterpart and stay
// module-internal.
export { FIXERS, TextFixerConfig } from "./config.js";
export type { ExplainedText, ExplanationStep } from "./config.js";

export {
  character_width,
  display_center,
  display_ljust,
  display_rjust,
  monospaced_width,
} from "./formatting.js";

const BYTES_ERROR_TEXT = `Hey wait, this isn't Unicode.

ftfy is designed to fix problems with text. Treating bytes like they're
interchangeable with Unicode text is usually something that introduces
problems with text.

You should first decode these bytes from the encoding you think they're in.
If you're not sure what encoding they're in:

- First, try to find out. 'utf-8' is a good assumption.
- If the encoding is simply unknowable, try running your bytes through
  ftfy.guess_bytes. As the name implies, this may not always be accurate.

For more information on the distinction between bytes and text, read the
Python Unicode HOWTO:

    http://docs.python.org/3/howto/unicode.html
`;

/**
 * Reject a `Uint8Array`/`Buffer` passed where Unicode text is required, mirroring
 * Python's `isinstance(text, bytes)` guard that raises `UnicodeError`.
 */
function assertNotBytes(text: unknown): asserts text is string {
  if (text instanceof Uint8Array) {
    throw new Error(BYTES_ERROR_TEXT);
  }
}

/**
 * Resolve the `(config?, kwargs?)` argument pattern shared by the top-level
 * functions. Python accepts an optional `TextFixerConfig` plus `**kwargs`; the
 * port accepts an optional config object and an optional kwargs object. When no
 * config is supplied, `defaultExplain` chooses whether `explain` defaults to
 * `false` (the explanation-discarding entry points) or `true` (`fix_and_explain`,
 * `fix_encoding_and_explain`, `fix_file`).
 */
function resolveConfig(
  config: TextFixerConfig | null | undefined,
  kwargs: ConfigKwargs | undefined,
  defaultExplain: boolean,
): TextFixerConfig {
  const base = config ?? makeConfig({ explain: defaultExplain });
  return configFromKwargs(base, kwargs);
}

/**
 * Given Unicode text as input, fix inconsistencies and glitches in it, such as
 * mojibake (text that was decoded in the wrong encoding).
 *
 * Fixes text in independent segments — usually lines, or arbitrarily broken up
 * every `config.max_decode_length` code units if there aren't enough line
 * breaks. Discards explanations (different segments may have different fixes);
 * use `fix_and_explain` for an explanation.
 *
 * Port of `fix_text`.
 */
export function fix_text(
  text: string,
  config?: TextFixerConfig | null,
  kwargs?: ConfigKwargs,
): string {
  assertNotBytes(text);
  config = resolveConfig(config, kwargs, false);

  const out: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let textbreak = text.indexOf("\n", pos) + 1;
    if (textbreak === 0) {
      textbreak = text.length;
    }
    if (textbreak - pos > config.max_decode_length) {
      textbreak = pos + config.max_decode_length;
      // Never split a surrogate pair: if the cap lands between a high and low
      // surrogate, include the whole pair. (Code-unit vs codepoint length is
      // the one documented, test-irrelevant divergence; Python counts
      // codepoints so it can never split an astral character. Rounding UP —
      // not down — also guarantees forward progress when max_decode_length is
      // smaller than one astral character.)
      const hi = text.charCodeAt(textbreak - 1);
      if (hi >= 0xd800 && hi <= 0xdbff && textbreak < text.length) {
        textbreak += 1;
      }
    }

    const segment = text.slice(pos, textbreak);
    if (config.unescape_html === "auto" && segment.includes("<")) {
      config = replace(config, { unescape_html: false });
    }
    const { text: fixedSegment } = fix_and_explain(segment, config);
    out.push(fixedSegment);
    pos = textbreak;
  }
  return out.join("");
}

/**
 * Fix text as a single segment, returning the fixed text and an explanation of
 * what was fixed (a list of steps applicable with `apply_plan`, or `null` when
 * `config.explain` is false).
 *
 * Port of `fix_and_explain`.
 */
export function fix_and_explain(
  text: string,
  config?: TextFixerConfig | null,
  kwargs?: ConfigKwargs,
): ExplainedText {
  assertNotBytes(text);
  config = resolveConfig(config, kwargs, true);

  if (config.unescape_html === "auto" && text.includes("<")) {
    config = replace(config, { unescape_html: false });
  }

  const steps: ExplanationStep[] | null = config.explain ? [] : null;

  for (;;) {
    const origtext = text;

    text = tryFix("unescape_html", text, config, steps);

    if (config.fix_encoding) {
      if (steps === null) {
        // Upstream quirk, mirrored deliberately: `fix_and_explain` calls
        // `fix_encoding(text)` WITHOUT the config in the no-explanation
        // branch (ftfy/__init__.py), so encoding-fix sub-options like
        // `restore_byte_a0=False` are ignored when `explain` is off.
        text = fix_encoding(text);
      } else {
        const { text: encFixed, explanation: encodingSteps } =
          fix_encoding_and_explain(text, config);
        text = encFixed;
        if (encodingSteps !== null) {
          steps.push(...encodingSteps);
        }
      }
    }

    const fixerOrder: FixerName[] = [
      "fix_c1_controls",
      "fix_latin_ligatures",
      "fix_character_width",
      "uncurl_quotes",
      "fix_line_breaks",
      "fix_surrogates",
      "remove_terminal_escapes",
      "remove_control_chars",
    ];
    for (const fixer of fixerOrder) {
      text = tryFix(fixer, text, config, steps);
    }

    if (config.normalization !== null) {
      const fixed = text.normalize(config.normalization);
      if (steps !== null && fixed !== text) {
        steps.push(["normalize", config.normalization]);
      }
      text = fixed;
    }

    if (text === origtext) {
      return { text, explanation: steps };
    }
  }
}

/**
 * Apply the steps of ftfy that detect mojibake and fix it (by encoding/decoding
 * in different encodings, plus the subordinate byte/character fixes). Returns the
 * fixed text and a list explaining what was fixed.
 *
 * Port of `fix_encoding_and_explain`.
 */
export function fix_encoding_and_explain(
  text: string,
  config?: TextFixerConfig | null,
  kwargs?: ConfigKwargs,
): ExplainedText {
  assertNotBytes(text);
  config = resolveConfig(config, kwargs, true);

  if (!config.fix_encoding) {
    // A weird trivial case: we're asked to fix the encoding, but skip fixing
    // the encoding.
    return { text, explanation: [] };
  }

  const planSoFar: ExplanationStep[] = [];
  for (;;) {
    const prevtext = text;
    const { text: stepped, explanation: plan } = fixEncodingOneStepAndExplain(
      text,
      config,
    );
    text = stepped;
    if (plan !== null) {
      planSoFar.push(...plan);
    }
    if (text === prevtext) {
      return { text, explanation: planSoFar };
    }
  }
}

/** Whether the binary string `bin` contains the byte value `byte`. */
function binaryHasByte(bin: string, byte: number): boolean {
  return bin.indexOf(String.fromCharCode(byte)) !== -1;
}

/**
 * Perform one step of fixing the encoding of text. Port of
 * `_fix_encoding_one_step_and_explain`.
 *
 * The byte stage is held as a **binary string** (one char per byte) so the
 * byte-level regexes (`ALTERED_UTF8_RE`) and byte fixers (`restore_byte_a0`,
 * `replace_lossy_sequences`) port verbatim; it is converted to `Uint8Array` only
 * for the strict `decode(...)` call. Strict decode THROWING (`DecodeError`) is
 * how candidate encodings are rejected.
 */
function fixEncodingOneStepAndExplain(
  text: string,
  config: TextFixerConfig,
): ExplainedText {
  if (text.length === 0) {
    return { text, explanation: [] };
  }

  // The first plan is to return ASCII text unchanged, as well as text that
  // doesn't look like it contains mojibake.
  if (possible_encoding(text, "ascii") || !is_bad(text)) {
    return { text, explanation: [] };
  }

  // Remember the possible encodings we encounter but don't successfully fix yet.
  const possible1byteEncodings: string[] = [];

  // ALTERED_UTF8_RE / C1_CONTROL_RE are exported without the `g` flag, so they
  // are stateless `.test()` predicates here (no lastIndex to reset).
  const alteredUtf8Test = new RegExp(ALTERED_UTF8_RE.source);
  const utf8DetectorTest = new RegExp(UTF8_DETECTOR_RE.source, "u");
  const c1ControlTest = new RegExp(C1_CONTROL_RE.source, "u");

  // Suppose the text was supposed to be UTF-8, but it was decoded using a
  // single-byte encoding instead. When fixable, this is usually correct, so try
  // it next.
  for (const encoding of CHARMAP_ENCODINGS) {
    if (possible_encoding(text, encoding)) {
      possible1byteEncodings.push(encoding);
      let encodedBin = bytesToBinary(encode(text, encoding));
      const encodeStep: ExplanationStep = ["encode", encoding];
      const transcodeSteps: ExplanationStep[] = [];

      // Now, find out if it's UTF-8 (or close enough). Otherwise, remember the
      // encoding for later.
      try {
        let decoding = "utf-8";
        // Check for sequences that would be UTF-8 except they have b' ' where
        // b'\xa0' would belong. Don't do this in macroman, where it would match
        // an en dash followed by a space (false positives).
        if (
          config.restore_byte_a0 &&
          encoding !== "macroman" &&
          alteredUtf8Test.test(encodedBin)
        ) {
          const replacedBin = restore_byte_a0(encodedBin);
          if (replacedBin !== encodedBin) {
            transcodeSteps.push(["transcode", "restore_byte_a0"]);
            encodedBin = replacedBin;
          }
        }

        // Replace sequences where information has been lost.
        if (config.replace_lossy_sequences && encoding.startsWith("sloppy")) {
          const replacedBin = replace_lossy_sequences(encodedBin);
          if (replacedBin !== encodedBin) {
            transcodeSteps.push(["transcode", "replace_lossy_sequences"]);
            encodedBin = replacedBin;
          }
        }

        if (
          binaryHasByte(encodedBin, 0xed) ||
          binaryHasByte(encodedBin, 0xc0)
        ) {
          decoding = "utf-8-variants";
        }

        const decodeStep: ExplanationStep = ["decode", decoding];
        const steps: ExplanationStep[] = [
          encodeStep,
          ...transcodeSteps,
          decodeStep,
        ];
        const fixed = decode(binaryToBytes(encodedBin), decoding);
        return { text: fixed, explanation: steps };
      } catch (err) {
        if (err instanceof DecodeError) {
          // This candidate encoding doesn't decode; try the next one.
          continue;
        }
        throw err;
      }
    }
  }

  // Look for a-hat-euro sequences that remain, and fix them in isolation.
  if (config.decode_inconsistent_utf8 && utf8DetectorTest.test(text)) {
    const steps: ExplanationStep[] = [["apply", "decode_inconsistent_utf8"]];
    const fixed = decode_inconsistent_utf8(text);
    if (fixed !== text) {
      return { text: fixed, explanation: steps };
    }
  }

  // The next most likely case is Latin-1 that was intended to be Windows-1252,
  // because those two encodings are easily confused.
  if (possible1byteEncodings.includes("latin-1")) {
    if (possible1byteEncodings.includes("windows-1252")) {
      // This text is in the intersection of Latin-1 and Windows-1252, so it's
      // probably legit.
      return { text, explanation: [] };
    } else {
      // Otherwise, we have characters that are in Latin-1 but not Windows-1252.
      // Those are C1 control characters; nobody wants those. Assume they were
      // meant to be Windows-1252.
      try {
        const fixed = decode(encode(text, "latin-1"), "windows-1252");
        if (fixed !== text) {
          const steps: ExplanationStep[] = [
            ["encode", "latin-1"],
            ["decode", "windows-1252"],
          ];
          return { text: fixed, explanation: steps };
        }
      } catch (err) {
        if (!(err instanceof DecodeError)) {
          throw err;
        }
      }
    }
  }

  // Fix individual characters of Latin-1 with a less satisfying explanation.
  if (config.fix_c1_controls && c1ControlTest.test(text)) {
    const steps: ExplanationStep[] = [["transcode", "fix_c1_controls"]];
    const fixed = fix_c1_controls(text);
    return { text: fixed, explanation: steps };
  }

  // The cases that remain are mixups between two different single-byte
  // encodings, and not the common Latin-1-vs-Windows-1252 case. We leave the
  // text unchanged.
  return { text, explanation: [] };
}

/**
 * Apply just the encoding-fixing steps of ftfy to this text. Returns the fixed
 * text, discarding the explanation. Port of `fix_encoding`.
 */
export function fix_encoding(
  text: string,
  config?: TextFixerConfig | null,
  kwargs?: ConfigKwargs,
): string {
  config = resolveConfig(config, kwargs, false);
  const { text: fixed } = fix_encoding_and_explain(text, config);
  return fixed;
}

/** An alternate name for `fix_text`, mirroring Python's `ftfy = fix_text`. */
export const ftfy: typeof fix_text = fix_text;

/**
 * Fix text as a single segment, with a consistent sequence of steps. Discards
 * the explanation. Port of `fix_text_segment`.
 */
export function fix_text_segment(
  text: string,
  config?: TextFixerConfig | null,
  kwargs?: ConfigKwargs,
): string {
  config = resolveConfig(config, kwargs, false);
  const { text: fixed } = fix_and_explain(text, config);
  return fixed;
}

/**
 * Fix text that is found in a file's lines.
 *
 * Python's `fix_file` is a generator over a file object's lines; the port takes
 * an iterable of lines (each a string already decoded, or raw bytes to be
 * decoded/guessed) and returns a generator of fixed lines. The CLI (a later TPP)
 * is responsible for splitting a byte stream into lines.
 *
 * The `unescape_html: "auto" → false` flip is **persisted across lines**
 * (stateful, like Python), so once a `<` is seen, HTML entities are preserved for
 * the remainder of the file.
 *
 * Port of `fix_file`.
 */
export function* fix_file(
  lines: Iterable<string | Uint8Array>,
  encoding?: string | null,
  config?: TextFixerConfig | null,
  kwargs?: ConfigKwargs,
): Generator<string> {
  config = resolveConfig(config, kwargs, true);

  for (const rawLine of lines) {
    let line: string;
    if (rawLine instanceof Uint8Array) {
      if (encoding == null) {
        const [decoded, guessedEncoding] = guess_bytes(rawLine);
        line = decoded;
        encoding = guessedEncoding;
      } else {
        line = decode(rawLine, encoding);
      }
    } else {
      line = rawLine;
    }
    if (config.unescape_html === "auto" && line.includes("<")) {
      config = replace(config, { unescape_html: false });
    }

    const { text: fixedLine } = fix_and_explain(line, config);
    yield fixedLine;
  }
}

/**
 * Guess a reasonable decoding for bytes in an unknown encoding by trying a few
 * common, mutually-distinguishable encodings. Returns `[decodedText, encoding]`.
 *
 * NOTE: This is not the recommended way of using ftfy; ftfy is not an encoding
 * detector, and this may *create* Unicode problems instead of solving them.
 *
 * Port of `guess_bytes`.
 */
export function guess_bytes(bstring: Uint8Array): [string, string] {
  if (typeof bstring === "string") {
    throw new Error(
      "This string was already decoded as Unicode. You should pass " +
        "bytes to guess_bytes, not Unicode.",
    );
  }

  if (
    bstring.length >= 2 &&
    ((bstring[0] === 0xfe && bstring[1] === 0xff) ||
      (bstring[0] === 0xff && bstring[1] === 0xfe))
  ) {
    return [utf16Decode(bstring), "utf-16"];
  }

  const byteset = new Set(bstring);
  try {
    if (byteset.has(0xed) || byteset.has(0xc0)) {
      // 0xed often signals CESU-8 (UTF-16 surrogates), 0xc0 signals Java's
      // non-standard null encoding; the utf-8-variants decoder handles both
      // (and standard UTF-8). See the upstream comment for the full rationale.
      const decoder = new IncrementalDecoder();
      const decoded = decoder.decode(bstring, true);
      return [decoded, "utf-8-variants"];
    } else {
      return [decode(bstring, "utf-8"), "utf-8"];
    }
  } catch (err) {
    if (!(err instanceof DecodeError)) {
      throw err;
    }
  }

  if (byteset.has(0x0d) && !byteset.has(0x0a)) {
    // Files that contain CR and not LF are likely to be MacRoman.
    return [decode(bstring, "macroman"), "macroman"];
  }

  return [decode(bstring, "sloppy-windows-1252"), "sloppy-windows-1252"];
}

/**
 * Apply a plan for fixing the encoding of text. The plan is a list of
 * `[operation, arg]` tuples (`"encode"`, `"decode"`, `"transcode"`, `"apply"`).
 *
 * The byte stage between an `encode` and the next `decode` is held as a **binary
 * string** so the `transcode` byte-fixers (`restore_byte_a0`,
 * `replace_lossy_sequences`) receive the binary strings they expect; it is
 * converted to/from `Uint8Array` only at the codec boundary.
 *
 * Port of `apply_plan`.
 */
export function apply_plan(
  text: string,
  plan: readonly ExplanationStep[],
): string {
  // `obj` is a Unicode string after `decode`/`apply`/initially, and a binary
  // string after `encode`/`transcode`. We track which with `isBytes`.
  let obj: string = text;
  let isBytes = false;

  for (const [operation, parameter] of plan) {
    if (operation === "encode") {
      obj = bytesToBinary(encode(obj, parameter));
      isBytes = true;
    } else if (operation === "decode") {
      obj = decode(binaryToBytes(obj), parameter);
      isBytes = false;
    } else if (operation === "transcode" || operation === "apply") {
      if (parameter in FIXERS) {
        obj = FIXERS[parameter as FixerName](obj);
      } else {
        throw new Error(`Unknown function to apply: ${parameter}`);
      }
    } else {
      // Includes the `normalize` step a `fix_and_explain` plan can contain:
      // Python's `apply_plan` raises `ValueError("Unknown plan step: ...")`
      // on it too (verified against 6.3.1; no corpus case generates one).
      throw new Error(`Unknown plan step: ${operation}`);
    }
  }

  if (isBytes) {
    // A plan that ends on the byte stage is malformed for ftfy's purposes;
    // returning the binary string mirrors Python returning `bytes` (the caller
    // gets back what the plan produced).
    return obj;
  }
  return obj;
}

/**
 * A utility that breaks down a string, printing for each codepoint its number in
 * hexadecimal, its glyph, its Unicode category, and its Unicode name.
 *
 * This is **async** in the port (the lone sync→async divergence): the Unicode
 * names/categories table is large, so it is lazy-loaded via `await import()` on
 * first call. A consumer who never calls `explain_unicode` pays zero added heap.
 *
 * Port of `explain_unicode`.
 */
export async function explain_unicode(text: string): Promise<void> {
  const { unicodeName, unicodeCategory } = await loadUnicodeData();
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    const category = unicodeCategory(cp);
    const display = isPrintable(cp, category) ? char : encodeUnicodeEscape(cp);
    const line =
      `U+${cp.toString(16).toUpperCase().padStart(4, "0")}  ` +
      `${display_ljust(display, 7)} ` +
      `[${category}] ${unicodeName(cp, "<unknown>")}`;
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

/** Lazily-loaded accessors over the generated Unicode names/categories table. */
interface UnicodeData {
  unicodeName: (cp: number, fallback: string) => string;
  unicodeCategory: (cp: number) => string;
}

let unicodeDataPromise: Promise<UnicodeData> | undefined;

function loadUnicodeData(): Promise<UnicodeData> {
  unicodeDataPromise ??= import("./unicode-data.js").then((m) => ({
    unicodeName: m.unicodeName,
    unicodeCategory: m.unicodeCategory,
  }));
  return unicodeDataPromise;
}

/**
 * Whether a codepoint is "printable" in Python's `str.isprintable` sense: a
 * character is printable unless its general category is Other (`C*`) or Separator
 * (`Z*`), with the single exception that SPACE (U+20) is printable. This drives
 * `explain_unicode`'s display column — non-printable characters are shown as a
 * `unicode-escape` rendering instead of their glyph.
 */
function isPrintable(cp: number, category: string): boolean {
  if (cp === 0x20) return true;
  const major = category[0];
  return major !== "C" && major !== "Z";
}

/** Render a codepoint the way Python's `char.encode("unicode-escape")` does. */
function encodeUnicodeEscape(cp: number): string {
  if (cp <= 0xff) {
    return "\\x" + cp.toString(16).padStart(2, "0");
  }
  if (cp <= 0xffff) {
    return "\\u" + cp.toString(16).padStart(4, "0");
  }
  return "\\U" + cp.toString(16).padStart(8, "0");
}
