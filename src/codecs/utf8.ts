/**
 * Strict, incremental UTF-8 codec, mirroring CPython's `encodings.utf_8`
 * (`IncrementalDecoder` / `IncrementalEncoder`) closely enough that
 * `ftfy/bad_codecs/utf8_variants.py` can be ported on top of it.
 *
 * Why hand-written instead of `TextDecoder`:
 *
 * - **Consumed-byte reporting.** The `utf-8-variants` decoder calls the real
 *   UTF-8 buffer-decode and needs the *number of bytes consumed* for each step
 *   so it can advance its own position. `TextDecoder` does not surface this.
 * - **Truncation as control flow.** A non-final incomplete tail must be
 *   *buffered* (consume the complete prefix, hold the rest, do not throw) so
 *   that the byte-split equivalence test passes; a final flush over an
 *   incomplete tail must *throw* `DecodeError`. `TextDecoder`'s `fatal`/`stream`
 *   options cannot express exactly this split.
 * - **Strict decode is the control-flow backbone.** The encoding-fix loop
 *   rejects candidate encodings by catching the throw from `decode`, so decode
 *   MUST throw on overlong encodings, surrogate-range code points, and invalid
 *   lead/continuation bytes — never silently emit U+FFFD.
 *
 * Error positions/reasons match CPython's `UnicodeDecodeError`:
 *
 * - `"invalid start byte"` — a byte that can never begin a sequence
 *   (continuation byte `0x80..0xBF`, the always-overlong leads `0xC0`/`0xC1`,
 *   or `0xF5..0xFF`). Span is the single offending byte.
 * - `"invalid continuation byte"` — a lead byte was valid but a following byte
 *   fell outside the range allowed for that lead (this is how overlong 3/4-byte
 *   forms, surrogates, and code points > U+10FFFF are rejected — their second
 *   byte is out of range). Span covers the lead plus the continuation bytes that
 *   *were* valid.
 * - `"unexpected end of data"` — the input ended part-way through an otherwise
 *   valid sequence, on a *final* flush. Span covers the lead plus the valid
 *   continuation bytes seen so far.
 *
 * This is a leaf module: it must not import `index.ts`. Errors come from
 * `./errors.js`.
 *
 * A faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import { DecodeError, EncodeError } from "./errors.js";

/** CPython's encoding label for the built-in UTF-8 codec in error messages. */
const UTF8_LABEL = "utf-8";

const REASON_INVALID_START = "invalid start byte";
const REASON_INVALID_CONTINUATION = "invalid continuation byte";
const REASON_UNEXPECTED_END = "unexpected end of data";
const REASON_SURROGATES_NOT_ALLOWED = "surrogates not allowed";

/**
 * Matches any UTF-16 surrogate *code unit*. Compiled WITHOUT the `u` flag so it
 * matches lone surrogates (a `u`-mode class would only match well-formed pairs),
 * and without `g`/`y` so `.test()` carries no `lastIndex` state. Used only as a
 * cheap "could this string contain a lone surrogate?" pre-check.
 */
const SURROGATE_CODE_UNIT_RE = /[\ud800-\udfff]/;

/**
 * The valid range `[lo, hi]` for the *second* byte of a multi-byte sequence,
 * keyed by lead byte. This is what encodes the "no overlong forms", "no
 * surrogates", and "no code points past U+10FFFF" rules — exactly the table
 * CPython's UTF-8 DFA uses. Third/fourth bytes are always plain continuation
 * bytes (`0x80..0xBF`).
 */
function secondByteRange(lead: number): [number, number] {
  // Two-byte leads 0xC2..0xDF: any continuation byte.
  if (lead >= 0xc2 && lead <= 0xdf) return [0x80, 0xbf];
  // Three-byte leads.
  if (lead === 0xe0) return [0xa0, 0xbf]; // exclude overlong < U+0800
  if (lead === 0xed) return [0x80, 0x9f]; // exclude surrogates U+D800..U+DFFF
  if (lead >= 0xe1 && lead <= 0xef) return [0x80, 0xbf];
  // Four-byte leads.
  if (lead === 0xf0) return [0x90, 0xbf]; // exclude overlong < U+10000
  if (lead === 0xf4) return [0x80, 0x8f]; // exclude > U+10FFFF
  // 0xf1..0xf3
  return [0x80, 0xbf];
}

/** Number of bytes in a sequence given its lead byte. Lead must be >= 0xC2. */
function sequenceLength(lead: number): number {
  if (lead <= 0xdf) return 2;
  if (lead <= 0xef) return 3;
  return 4;
}

/**
 * The result of a single buffer-decode call: the decoded text and the number of
 * bytes consumed from the front of `bytes`. Any trailing bytes belong to an
 * incomplete sequence that has been buffered (only possible when `final` is
 * false).
 */
export interface BufferDecodeResult {
  /** Decoded text for the consumed prefix. */
  readonly text: string;
  /** Number of leading bytes of the input that were consumed. */
  readonly consumed: number;
}

/**
 * Strictly decode UTF-8 bytes, following the CPython codecs buffer-decode
 * contract.
 *
 * - Returns the decoded text and the count of bytes consumed.
 * - When `final` is `false`, a trailing *incomplete but so-far-valid* sequence
 *   is left unconsumed (buffered): `consumed` points at the start of that tail
 *   and no error is thrown. Genuinely malformed bytes still throw immediately.
 * - When `final` is `true`, every byte must be consumed; an incomplete trailing
 *   sequence throws `DecodeError("unexpected end of data")`.
 *
 * `bytes` is the canonical `Uint8Array`. Positions in any thrown `DecodeError`
 * are relative to the start of `bytes`.
 */
export function utf8BufferDecode(
  bytes: Uint8Array,
  final: boolean,
): BufferDecodeResult {
  let out = "";
  let i = 0;
  const n = bytes.length;

  while (i < n) {
    const b0 = bytes[i]!;

    // Fast path: ASCII.
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i++;
      continue;
    }

    // A continuation byte or an always-invalid lead can never start a sequence.
    if (b0 < 0xc2 || b0 > 0xf4) {
      throw new DecodeError(UTF8_LABEL, bytes, i, i + 1, REASON_INVALID_START);
    }

    const seqLen = sequenceLength(b0);
    const [lo, hi] = secondByteRange(b0);

    // How many bytes of this sequence are available?
    const avail = n - i;

    // Validate the second byte (special-ranged) if present.
    if (avail < 2) {
      // Only the lead byte is available.
      if (final) {
        throw new DecodeError(
          UTF8_LABEL,
          bytes,
          i,
          i + 1,
          REASON_UNEXPECTED_END,
        );
      }
      // Buffer the incomplete tail for more input.
      break;
    }
    const b1 = bytes[i + 1]!;
    if (b1 < lo || b1 > hi) {
      if (!final && b0 === 0xed && avail === 2 && b1 >= 0xa0 && b1 <= 0xbf) {
        break;
      }
      // Out of range for this lead: overlong / surrogate / >10FFFF / bad cont.
      throw new DecodeError(
        UTF8_LABEL,
        bytes,
        i,
        i + 1,
        REASON_INVALID_CONTINUATION,
      );
    }

    // Validate any remaining continuation bytes (plain 0x80..0xBF range).
    let valid = 2; // lead + second byte validated
    let truncated = false;
    for (; valid < seqLen; valid++) {
      if (i + valid >= n) {
        truncated = true;
        break;
      }
      const bc = bytes[i + valid]!;
      if (bc < 0x80 || bc > 0xbf) {
        // A later continuation byte is out of range.
        throw new DecodeError(
          UTF8_LABEL,
          bytes,
          i,
          i + valid,
          REASON_INVALID_CONTINUATION,
        );
      }
    }

    if (truncated) {
      if (final) {
        throw new DecodeError(
          UTF8_LABEL,
          bytes,
          i,
          i + valid,
          REASON_UNEXPECTED_END,
        );
      }
      // Buffer the incomplete-but-valid tail and wait for more input.
      break;
    }

    // We have a complete, valid sequence: assemble its code point.
    let cp: number;
    if (seqLen === 2) {
      cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
    } else if (seqLen === 3) {
      cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (bytes[i + 2]! & 0x3f);
    } else {
      cp =
        ((b0 & 0x07) << 18) |
        ((b1 & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f);
    }
    out += String.fromCodePoint(cp);
    i += seqLen;
  }

  return { text: out, consumed: i };
}

/**
 * A strict, stateful incremental UTF-8 decoder, mirroring CPython's
 * `encodings.utf_8.IncrementalDecoder`.
 *
 * Contract (this is the interface the whole codec critical path is built on):
 *
 * - `new IncrementalDecoder()` — no constructor arguments. (CPython accepts an
 *   `errors` mode; this port is strict-only and ignores it.)
 * - `decode(bytes: Uint8Array, final = false): string` — feeds a chunk and
 *   returns the text decodable so far. Any incomplete trailing sequence is held
 *   in an internal buffer and prepended to the next chunk. When `final` is
 *   `true`, the buffer must drain completely or `DecodeError` is thrown.
 * - `consumed` — after each `decode` call, the number of bytes consumed from the
 *   *combined* (buffered + new) input during that call. `utf-8-variants` reads
 *   this to advance its own position.
 * - `reset()` — clears the buffer.
 *
 * Feeding the whole input at once and feeding it split at every byte boundary
 * produce identical output (verified by the byte-split equivalence test).
 */
export class IncrementalDecoder {
  /** Held bytes of an incomplete trailing sequence from a previous chunk. */
  #buffer: Uint8Array = new Uint8Array(0);
  /** Bytes consumed from the combined input on the most recent `decode` call. */
  consumed = 0;

  /**
   * Decode one chunk. Returns the text decodable so far; buffers any incomplete
   * trailing sequence (unless `final`). Throws `DecodeError` on malformed input
   * or, when `final`, on an incomplete trailing sequence.
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

    const { text, consumed } = utf8BufferDecode(input, final);
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
 * Strictly decode a complete UTF-8 byte string. Convenience wrapper over a
 * single `final = true` buffer-decode. Throws `DecodeError` on any
 * malformed/truncated/overlong/surrogate input.
 */
export function utf8Decode(bytes: Uint8Array): string {
  return utf8BufferDecode(bytes, true).text;
}

/**
 * Encode a string to UTF-8 bytes.
 *
 * CPython's strict UTF-8 encoder throws `UnicodeEncodeError` on lone
 * surrogates. After validating that strict-only edge case, `TextEncoder` is
 * byte-identical to `str.encode("utf-8")` for every well-formed input. (The
 * variants encoder is documented as "identical to UTF-8", so it re-uses this
 * directly.)
 */
export function utf8Encode(text: string): Uint8Array {
  // Fast path: a lone surrogate is only possible when a surrogate code unit is
  // present at all. The vast majority of inputs have none, so skip the O(n)
  // JS-level scan and let TextEncoder (native) do the single pass.
  if (SURROGATE_CODE_UNIT_RE.test(text)) {
    let pyPos = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          // A well-formed surrogate pair = one astral codepoint.
          i++;
          pyPos++;
          continue;
        }
        throw new EncodeError(
          UTF8_LABEL,
          text,
          pyPos,
          pyPos + 1,
          REASON_SURROGATES_NOT_ALLOWED,
        );
      }
      if (code >= 0xdc00 && code <= 0xdfff) {
        throw new EncodeError(
          UTF8_LABEL,
          text,
          pyPos,
          pyPos + 1,
          REASON_SURROGATES_NOT_ALLOWED,
        );
      }
      pyPos++;
    }
  }
  return new TextEncoder().encode(text);
}

/**
 * The encoder is identical to UTF-8 (the variants module re-uses it verbatim).
 * Exposed as a class to mirror CPython's `IncrementalEncoder` surface for the
 * variants port, though it carries no incremental state for UTF-8 output.
 */
export class IncrementalEncoder {
  encode(text: string): Uint8Array {
    return utf8Encode(text);
  }

  reset(): void {
    // No state.
  }
}
