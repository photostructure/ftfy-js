/**
 * Structured decode/encode errors that mirror CPython's `UnicodeDecodeError` /
 * `UnicodeEncodeError`.
 *
 * Two reasons these are structured (fields kept separate from the rendered
 * message), per docs/DESIGN.md → "Error messages are API":
 *
 * 1. **Control flow.** The encoding-fix loop rejects candidate encodings by
 *    catching the *throw* from `decode(...)`. Strict decode MUST throw on any
 *    malformed/truncated/overlong/surrogate input.
 * 2. **CLI parity.** The CLI renders Python-compatible error text. Keeping the
 *    byte/position/encoding as fields lets it format messages without string
 *    parsing. The real-windows-1252 case must format exactly:
 *    `'charmap' codec can't decode byte 0x9d in position 4: character maps to <undefined>`.
 *
 * Note: CPython's built-in charmap codec raises with the encoding label
 * `"charmap"` (not the human encoding name), so the charmap engine constructs
 * `DecodeError` with `encoding = "charmap"`.
 */

function hexByte(b: number): string {
  return "0x" + b.toString(16).padStart(2, "0");
}

/** Mirrors CPython's `UnicodeDecodeError.__str__`. */
function formatDecodeMessage(
  encoding: string,
  bytes: Uint8Array,
  start: number,
  end: number,
  reason: string,
): string {
  if (end === start + 1) {
    return `'${encoding}' codec can't decode byte ${hexByte(
      bytes[start] ?? 0,
    )} in position ${start}: ${reason}`;
  }
  return `'${encoding}' codec can't decode bytes in position ${start}-${
    end - 1
  }: ${reason}`;
}

/** Repr of a single character, matching CPython's error rendering. */
function charRepr(cp: number): string {
  if (cp <= 0xff) return "\\x" + cp.toString(16).padStart(2, "0");
  if (cp <= 0xffff) return "\\u" + cp.toString(16).padStart(4, "0");
  return "\\U" + cp.toString(16).padStart(8, "0");
}

/** Mirrors CPython's `UnicodeEncodeError.__str__`. */
function formatEncodeMessage(
  encoding: string,
  text: string,
  start: number,
  end: number,
  reason: string,
): string {
  if (end === start + 1) {
    const cp = text.codePointAt(start) ?? 0;
    return `'${encoding}' codec can't encode character '${charRepr(
      cp,
    )}' in position ${start}: ${reason}`;
  }
  return `'${encoding}' codec can't encode characters in position ${start}-${
    end - 1
  }: ${reason}`;
}

/**
 * Thrown by every strict decoder (utf-8, charmap, sloppy, utf-16, variants).
 * Structured fields mirror `UnicodeDecodeError`; `message` is the Python-format
 * rendering.
 */
export class DecodeError extends Error {
  override readonly name = "DecodeError";
  readonly encoding: string;
  /** The bytes being decoded (the `object` field of `UnicodeDecodeError`). */
  readonly bytes: Uint8Array;
  /** Start index of the offending span. */
  readonly start: number;
  /** End index (exclusive) of the offending span. */
  readonly end: number;
  /** Human-readable reason, e.g. `"invalid start byte"`. */
  readonly reason: string;

  constructor(
    encoding: string,
    bytes: Uint8Array,
    start: number,
    end: number,
    reason: string,
  ) {
    super(formatDecodeMessage(encoding, bytes, start, end, reason));
    this.encoding = encoding;
    this.bytes = bytes;
    this.start = start;
    this.end = end;
    this.reason = reason;
  }
}

/**
 * Thrown by strict encoders (e.g. utf-8 encode of a lone surrogate, charmap
 * encode of an unmapped character). Structured fields mirror
 * `UnicodeEncodeError`.
 */
export class EncodeError extends Error {
  override readonly name = "EncodeError";
  readonly encoding: string;
  /** The string being encoded (the `object` field of `UnicodeEncodeError`). */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly reason: string;

  constructor(
    encoding: string,
    text: string,
    start: number,
    end: number,
    reason: string,
  ) {
    super(formatEncodeMessage(encoding, text, start, end, reason));
    this.encoding = encoding;
    this.text = text;
    this.start = start;
    this.end = end;
    this.reason = reason;
  }
}
