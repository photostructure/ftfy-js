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

- [ ] Research & Planning
- [ ] Write breaking tests (overlong, surrogate, buffered tail, final-tail throw, byte splits)
- [ ] Implementation of tasks
- [ ] Final integration verification

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "Strict decode is the control-flow backbone", "UTF-8 / utf-8-variants"
- CPython's UTF-8 incremental decoder behavior (step machine, consumed-byte reporting)
- `../python-ftfy/ftfy/bad_codecs/utf8_variants.py` — the consumer
- `../python-ftfy/tests/test_bytes.py` — `test_incomplete_sequences` (the byte-split / buffering acceptance test)

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
