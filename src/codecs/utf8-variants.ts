/**
 * The `utf-8-variants` codec, a faithful port of
 * `ftfy/bad_codecs/utf8_variants.py`.
 *
 * It decodes text encoded with popular non-standard versions of UTF-8:
 *
 * - **CESU-8** — the accidental encoding made by layering UTF-8 on top of
 *   UTF-16, where an astral codepoint appears as a *six-byte* surrogate pair
 *   (`ED A0-AF .. ED B0-BF ..`) instead of a real four-byte sequence.
 * - **Java's modified UTF-8** — which encodes the null character `U+0000` as the
 *   two bytes `C0 80` instead of a single `00`.
 *
 * The codec does not enforce "correct" CESU-8: it freely mixes valid UTF-8 and
 * CESU-8, just like Python 2's UTF-8 decoder. Within the BMP it still enforces
 * shortest-form, with the single `C0 80` exception for `U+0000`.
 *
 * Strategy (mirrors Python): fall back on the strict UTF-8 step machine in
 * {@link ./utf8.js} wherever possible, and only handle the CESU-8 and Java-null
 * cases specially. The Python module uses byte-level regexes (`SPECIAL_BYTES_RE`,
 * `CESU8_RE`) to locate the next variant byte; this port runs those same regexes
 * over a **binary string** (one char per byte) so they can be transcribed
 * verbatim, then decodes the corresponding `Uint8Array` slices with the strict
 * machine.
 *
 * Parity notes:
 *
 * - Byte-split equivalence: feeding the whole input vs. feeding it split at every
 *   byte boundary yields identical output (ported `test_incomplete_sequences`).
 *   This is why `_buffer_decode` loops and why an incomplete tail is buffered.
 * - Strict decode THROWS `DecodeError` on malformed input — there is no silent
 *   `U+FFFD`. The single exception is `errors === "replace"`, used only by
 *   `test_russian_crash` (which asserts "doesn't crash", not any exact output).
 * - The variant-locating regexes are compiled **without** the `u` flag: they
 *   operate on binary-string bytes, not Unicode codepoints.
 *
 * Leaf module: must not import `index.ts`.
 *
 * A faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import { bytesToBinary } from "./binary-string.js";
import { DecodeError } from "./errors.js";
import { utf8BufferDecode, type BufferDecodeResult } from "./utf8.js";

/** The Unicode replacement character emitted in `errors === "replace"` mode. */
const REPLACEMENT = "�";

/**
 * The JS spelling of Python's non-`MULTILINE` `$`. CPython's `$` matches at the
 * very end of the string *or* just before a single trailing `\n`; JavaScript's
 * `$` (without the `m` flag) only matches at the very end. The variant patterns
 * use `$` to mean "no more bytes to match", so to stay byte-for-byte faithful
 * with Python's `re.search` — which decides whether `0xED`/`0xC0` near a chunk
 * boundary is a (truncated) variant or ordinary UTF-8 — every `$` is spelled as
 * this look-ahead. (Concretely: a lone `0xED` followed by a trailing `\n` must
 * be treated as a possibly-truncated surrogate and *buffered*, not eagerly
 * rejected.) The look-ahead stays zero-width, so it slots into the `(...|$)`
 * alternations unchanged.
 */
const DOLLAR = "(?=\\n?$)";

/**
 * Matches all possible six-byte CESU-8 sequences, plus truncations of them at
 * the end of the (binary) string. If any subgroup matches end-of-input, every
 * later subgroup must also match it, since there are no more characters.
 *
 * Ported from Python's `CESU8_EXPR`. Anchored with `^` (Python uses `re.match`,
 * which anchors at the start). No `u` flag: these are raw bytes carried as
 * U+0000..U+00FF code units.
 */
const CESU8_RE = new RegExp(
  `^(\\xed([\\xa0-\\xaf]|${DOLLAR})([\\x80-\\xbf]|${DOLLAR})(\\xed|${DOLLAR})([\\xb0-\\xbf]|${DOLLAR})([\\x80-\\xbf]|${DOLLAR}))`,
);

/** Matches isolated surrogate bytes that aren't CESU-8 (`SURROGATE_EXPR`). */
const SURROGATE_EXPR = `(\\xed([\\xa0-\\xbf]|${DOLLAR})([\\x80-\\xbf]|${DOLLAR}))`;

/** Matches the Java encoding of `U+0000`, including a truncation (`NULL_EXPR`). */
const NULL_EXPR = `(\\xc0(\\x80|${DOLLAR}))`;

/** Body of `CESU8_EXPR`, reused inside `SPECIAL_BYTES_RE`. */
const CESU8_EXPR = `(\\xed([\\xa0-\\xaf]|${DOLLAR})([\\x80-\\xbf]|${DOLLAR})(\\xed|${DOLLAR})([\\xb0-\\xbf]|${DOLLAR})([\\x80-\\xbf]|${DOLLAR}))`;

/**
 * Locates the next position that must be decoded differently from standard
 * UTF-8. Ported from Python's `SPECIAL_BYTES_RE` (`NULL_EXPR | CESU8 |
 * SURROGATE`). Compiled with the `g` flag so `lastIndex` can be set per search —
 * see {@link searchSpecial}.
 */
const SPECIAL_BYTES_RE = new RegExp(
  [NULL_EXPR, CESU8_EXPR, SURROGATE_EXPR].join("|"),
  "g",
);

/**
 * Decode result mirroring Python's `(text, consumed)` tuple from a buffer-decode
 * step. `consumed` counts bytes from the front of the input slice.
 */
type StepResult = BufferDecodeResult;

/**
 * Run `SPECIAL_BYTES_RE` like Python's `.search()`: return the match start index
 * (in bytes, i.e. binary-string positions) or `-1` if there is no match. Resets
 * `lastIndex` so the shared global regex carries no state between calls.
 */
function searchSpecial(binary: string): number {
  SPECIAL_BYTES_RE.lastIndex = 0;
  const m = SPECIAL_BYTES_RE.exec(binary);
  SPECIAL_BYTES_RE.lastIndex = 0;
  return m === null ? -1 : m.index;
}

/**
 * Strictly decode UTF-8 in replace mode: every malformed byte CPython would
 * reject is emitted as a single `U+FFFD` instead of throwing. Used only when
 * `errors === "replace"` (the `test_russian_crash` path). Mirrors the
 * consumed-byte contract of {@link utf8BufferDecode}: a trailing incomplete-but-
 * possibly-valid sequence is buffered (not replaced) unless `final`.
 *
 * This walks byte-by-byte, delegating runs of valid UTF-8 to the strict decoder
 * and substituting `U+FFFD` for each maximal invalid prefix, matching CPython's
 * "substitution of maximal subparts" used by its UTF-8 replace handler closely
 * enough for the no-crash contract.
 */
function utf8BufferDecodeReplace(
  bytes: Uint8Array,
  final: boolean,
): StepResult {
  let out = "";
  let pos = 0;
  while (pos < bytes.length) {
    let step: StepResult;
    try {
      step = utf8BufferDecode(bytes.subarray(pos), final);
    } catch (e) {
      if (!(e instanceof DecodeError)) throw e;
      // `e.start`/`e.end` index into the slice we just passed. Everything
      // before the offending span is valid, complete UTF-8 (CPython reports
      // the first invalid position) — decode and keep it, exactly as
      // CPython's replace handler does, then emit one U+FFFD for the maximal
      // invalid subpart and continue past it.
      if (e.start > 0) {
        out += utf8BufferDecode(bytes.subarray(pos, pos + e.start), true).text;
      }
      out += REPLACEMENT;
      pos += Math.max(e.end, e.start + 1);
      continue;
    }
    out += step.text;
    if (step.consumed === 0) {
      // A buffered incomplete tail (only when !final). Stop here.
      break;
    }
    pos += step.consumed;
  }
  return { text: out, consumed: pos };
}

/**
 * Dispatch to the strict or replace buffer-decoder for the "real UTF-8" fallback
 * (`sup` in the Python source). `bytes` is the slice to decode.
 */
function decodeReal(
  bytes: Uint8Array,
  errors: string,
  final: boolean,
): StepResult {
  return errors === "replace"
    ? utf8BufferDecodeReplace(bytes, final)
    : utf8BufferDecode(bytes, final);
}

/**
 * Decode a single segment, choosing between: decode as much real UTF-8 as
 * possible, decode a six-byte CESU-8 sequence, or decode a Java-style null.
 * Ports `_buffer_decode_step`.
 */
function bufferDecodeStep(
  bytes: Uint8Array,
  errors: string,
  final: boolean,
): StepResult {
  const binary = bytesToBinary(bytes);

  // Find the next byte position that indicates a variant of UTF-8.
  const cutoff = searchSpecial(binary);
  if (cutoff < 0) {
    return decodeReal(bytes, errors, final);
  }

  if (cutoff > 0) {
    // Decode the leading run of ordinary bytes up to the variant byte. This is
    // a complete slice, so it is decoded as `final = true`.
    return decodeReal(bytes.subarray(0, cutoff), errors, true);
  }

  // Some byte sequence we handle specially matches at the very start.
  if (bytes[0] === 0xc0) {
    if (bytes.length > 1) {
      // Decode the two-byte sequence C0 80 as a null.
      return { text: "\u0000", consumed: 2 };
    }
    if (final) {
      // End of stream: let the real decoder report the error.
      return decodeReal(bytes, errors, true);
    }
    // Wait for another byte.
    return { text: "", consumed: 0 };
  }

  // Decode a possible six-byte sequence starting with 0xed.
  return bufferDecodeSurrogates(bytes, errors, final);
}

/**
 * Decode improperly encoded surrogates (a CESU-8 six-byte sequence) starting at
 * `bytes[0] === 0xED`. Ports `_buffer_decode_surrogates`.
 *
 * The two surrogates encode a 20-bit number laid out as
 *
 *   11101101 1010abcd 10efghij 11101101 1011klmn 10opqrst
 *
 * which we reassemble and add `0x10000` to get the codepoint.
 */
function bufferDecodeSurrogates(
  bytes: Uint8Array,
  errors: string,
  final: boolean,
): StepResult {
  if (bytes.length < 6) {
    if (final) {
      // 0xed near end of stream with fewer than six bytes: hand it to the real
      // decoder (it might be a Hangul character or an error).
      return decodeReal(bytes, errors, final);
    }
    // A surrogate, stream not over, not enough following bytes to decode
    // anything yet: consume zero bytes and wait.
    return { text: "", consumed: 0 };
  }

  const binary = bytesToBinary(bytes);
  CESU8_RE.lastIndex = 0;
  if (CESU8_RE.test(binary)) {
    const codepoint =
      ((bytes[1]! & 0x0f) << 16) +
      ((bytes[2]! & 0x3f) << 10) +
      ((bytes[4]! & 0x0f) << 6) +
      (bytes[5]! & 0x3f) +
      0x10000;
    return { text: String.fromCodePoint(codepoint), consumed: 6 };
  }

  // Looked like CESU-8 but wasn't. 0xed starts a three-byte sequence, so give
  // three bytes to the real decoder to handle as usual.
  return decodeReal(bytes.subarray(0, 3), errors, false);
}

/**
 * Decode a (possibly streamed) chunk, following the codecs buffer-decode
 * contract. Ports `_buffer_decode`: loop `bufferDecodeStep` over the remaining
 * input until a step consumes nothing.
 */
function bufferDecode(
  bytes: Uint8Array,
  errors: string,
  final: boolean,
): StepResult {
  let out = "";
  let position = 0;
  for (;;) {
    const { text, consumed } = bufferDecodeStep(
      bytes.subarray(position),
      errors,
      final,
    );
    if (consumed === 0) {
      // Nothing left to decode, or we need more input. Either way, done.
      break;
    }
    out += text;
    position += consumed;
  }

  if (final && position !== bytes.length) {
    // The step loop must consume everything when `final` is true.
    throw new Error(
      `utf-8-variants: incomplete final decode (consumed ${position} of ${bytes.length})`,
    );
  }

  return { text: out, consumed: position };
}

/**
 * A strict, stateful incremental `utf-8-variants` decoder, mirroring CPython's
 * `ftfy.bad_codecs.utf8_variants.IncrementalDecoder`.
 *
 * Contract (matches {@link ./utf8.js}'s `IncrementalDecoder`):
 *
 * - `new IncrementalDecoder(errors = "strict")` — `errors` is `"strict"` or
 *   `"replace"`. Strict throws `DecodeError` on malformed input; replace emits
 *   `U+FFFD` (used only by `test_russian_crash`).
 * - `decode(bytes, final = false)` — feeds a chunk and returns the text
 *   decodable so far. Any incomplete trailing sequence is buffered and prepended
 *   to the next chunk; on `final = true` the buffer must drain or it throws.
 * - `consumed` — bytes consumed from the *combined* (buffered + new) input on the
 *   most recent `decode` call.
 * - `reset()` — clears the buffer.
 *
 * Exported because the byte-split equivalence test feeds input split at every
 * byte boundary through this class.
 */
export class IncrementalDecoder {
  /** Held bytes of an incomplete trailing sequence from a previous chunk. */
  #buffer: Uint8Array = new Uint8Array(0);
  /** `"strict"` or `"replace"`. */
  readonly #errors: string;
  /** Bytes consumed from the combined input on the most recent `decode` call. */
  consumed = 0;

  constructor(errors = "strict") {
    this.#errors = errors;
  }

  /**
   * Decode one chunk. Returns the text decodable so far; buffers any incomplete
   * trailing sequence (unless `final`). Throws `DecodeError` (strict) on
   * malformed input or, when `final`, on an incomplete trailing sequence.
   */
  decode(bytes: Uint8Array, final = false): string {
    // Prepend any buffered tail from the previous chunk.
    let input: Uint8Array;
    if (this.#buffer.length === 0) {
      input = bytes;
    } else {
      input = new Uint8Array(this.#buffer.length + bytes.length);
      input.set(this.#buffer, 0);
      input.set(bytes, this.#buffer.length);
    }

    const { text, consumed } = bufferDecode(input, this.#errors, final);
    this.consumed = consumed;

    // Whatever wasn't consumed is an incomplete tail to carry forward.
    this.#buffer = input.subarray(consumed);
    return text;
  }

  /** Clear the internal buffer, returning the decoder to its initial state. */
  reset(): void {
    this.#buffer = new Uint8Array(0);
    this.consumed = 0;
  }
}

/**
 * Decode a complete `utf-8-variants` byte string (CESU-8 / Java-null aware).
 * Convenience wrapper over a single `final = true` decode. Throws `DecodeError`
 * on malformed input.
 */
export function utf8VariantsDecode(bytes: Uint8Array): string {
  return bufferDecode(bytes, "strict", true).text;
}
