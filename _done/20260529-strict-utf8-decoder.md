---
title: Strict incremental UTF-8 decoder
section: codecs
---

# TPP: Strict incremental UTF-8 decoder

# (Wave 1 — parallel, HIGHEST RISK. Blocks utf8-variants. Do this early.)

## Summary

Hand-write the strict incremental UTF-8 step machine in `codecs/utf8.ts` (decoder + encoder).
This is the control-flow backbone: the fix loop rejects candidate encodings by catching the
decode throw, and the variants codec is built on top of this step machine.

## Current phase

- [x] Research & Planning
- [x] Write breaking tests (overlong, surrogate, buffered tail, final-tail throw, byte splits)
- [x] Implementation of tasks
- [x] Final integration verification (own subsystem: `npx vitest run tests/codecs/utf8.test.ts` → 102 passed; isolatedDeclarations typecheck of `src/codecs/utf8.ts` clean)

## Durable facts (for downstream waves — utf8-variants, codecs-dispatcher, fixes, index)

### Exported symbols from `src/codecs/utf8.ts`

- `class IncrementalDecoder` — strict, stateful. **Interface (the codec critical path depends on this):**
  - `new IncrementalDecoder()` — no constructor args (strict-only; CPython's `errors` mode is not modelled).
  - `decode(bytes: Uint8Array, final = false): string` — feeds a chunk, returns text decodable so far. A non-final incomplete trailing sequence is **buffered** internally (prepended to the next chunk); a `final = true` flush over an incomplete tail **throws** `DecodeError`.
  - `consumed: number` — public field; after each `decode` call holds the number of bytes consumed from the **combined** (buffered + new) input during that call. utf8-variants reads this to advance position.
  - `reset(): void` — clears the buffer.
- `class IncrementalEncoder` — `encode(text: string): Uint8Array`, `reset(): void`. UTF-8 output is stateless; variants re-uses verbatim ("identical to UTF-8").
- `function utf8BufferDecode(bytes: Uint8Array, final: boolean): BufferDecodeResult` — the static buffer-decode step. Returns `{ text, consumed }`. **This is what utf8-variants should call** in place of CPython's `UTF8IncrementalDecoder._buffer_decode(input, errors, final)` — same `(text, consumed)` contract. Throws immediately on malformed bytes; buffers an incomplete tail (consumed < len) only when `final` is false.
- `interface BufferDecodeResult { readonly text: string; readonly consumed: number }`.
- `function utf8Decode(bytes: Uint8Array): string` — convenience `final = true` whole-string decode.
- `function utf8Encode(text: string): Uint8Array` — delegates to `TextEncoder` (byte-identical to `str.encode("utf-8")`).

### Cross-file assumptions

- Imports `DecodeError` from `./errors.js`. `EncodeError` is **not** used (encode delegates to `TextEncoder`, which never throws for well-formed JS strings; ftfy never encodes lone surrogates through this path).
- utf8-variants operates over binary strings per DESIGN.md; it must convert binary string ⇄ `Uint8Array` (via `binary-string.ts`) before calling `utf8BufferDecode`, OR a future refactor can add a binary-string overload. Current public surface is `Uint8Array`-typed.
- DecodeError positions/reasons match CPython exactly (verified against `bytes.decode("utf-8")`):
  - `"invalid start byte"` — continuation byte `0x80..0xBF`, always-overlong leads `0xC0`/`0xC1`, or `0xF5..0xFF`. Span = single byte (start, start+1).
  - `"invalid continuation byte"` — second byte out of the per-lead range (this is how overlong 3/4-byte, surrogates `ED A0..BF`, and `> U+10FFFF` are rejected) OR a later continuation byte out of `0x80..0xBF`. Span = lead + already-valid continuation bytes.
  - `"unexpected end of data"` — incomplete trailing sequence on a **final** flush only. Span = lead + valid continuation bytes seen.
  - Per-lead second-byte ranges: `E0`→`A0..BF`, `ED`→`80..9F`, `F0`→`90..BF`, `F4`→`80..8F`, others→`80..BF`.

### xfails / skips

None.

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "Strict decode is the control-flow backbone", "UTF-8 / utf-8-variants"
- CPython's UTF-8 incremental decoder behavior (step machine, consumed-byte reporting)
- `python-ftfy/ftfy/bad_codecs/utf8_variants.py` — the consumer
- `python-ftfy/tests/test_bytes.py` — `test_incomplete_sequences` (the byte-split / buffering acceptance test)

## Lore

- **Do NOT use `TextDecoder`** — it can't report consumed-byte counts or throw on a truncated
  final tail under streaming. Both are required by the variants decoder and the byte-split test.
- **Incremental truncation semantics (get this right):** a **non-final** incomplete tail is
  **buffered/held** — the decoder consumes the complete prefix and waits for more bytes; it
  does **not** throw. A **final** incomplete tail (the `final=true` flush, i.e. end of input
  with a partial sequence) **throws** `DecodeError`. (Earlier drafts had this reversed.)
- Must also **throw `DecodeError`** on genuinely malformed input regardless of position:
  overlong encodings, surrogate-range code points, and invalid continuation/lead bytes.
- Export an `IncrementalDecoder` whose output is identical whether fed whole or split at every
  byte boundary (`test_bytes.py` asserts this).
- Operates conceptually over bytes; integrates with the binary-string bridge from the codecs
  leaves TPP.

## Tasks

1. `codecs/utf8.ts` — strict incremental decoder (step machine, consumed-byte tracking) +
   encoder; throws via `DecodeError`/`EncodeError`.
2. Export `IncrementalDecoder`.
3. Tests: overlong (`C0 80`), surrogate (`ED A0 80`), invalid lead/continuation, a **non-final
   incomplete tail is buffered** (no throw, no output past the complete prefix), a **final
   incomplete tail throws**, and the full byte-split equivalence loop.

Verify: `npm test -- utf8`; compare a batch of malformed inputs against Python's behavior.
