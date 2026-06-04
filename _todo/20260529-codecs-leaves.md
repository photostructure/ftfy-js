---
title: Codec leaves — binary-string, errors, charmap, sloppy, utf16
section: codecs
---

# TPP: Codec leaves

# (Wave 1 — parallel. Independent of index.ts. The `codecs/index.ts` dispatcher is a

# separate Wave-2 TPP, since it needs the utf8 + utf8-variants branches to exist.)

## Summary

The encoding primitives everything else stands on: the `Uint8Array`↔binary-string bridge,
`DecodeError`/`EncodeError`, the generic single-byte charmap engine, the sloppy codecs, and
utf-16-with-BOM (for `guess_bytes`). The dispatcher that ties these together lives in its own
TPP (`codecs-dispatcher`) so this one has no half-implemented branches.

## Current phase

- [ ] Research & Planning
- [ ] Write breaking tests
- [ ] Implementation of tasks
- [ ] Final integration verification

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "Bytes boundary", "Error messages are API", "Codegen tables"
- `python-ftfy/ftfy/bad_codecs/sloppy.py`
- `python-ftfy/tests/test_encodings.py`, `python-ftfy/tests/test_bytes.py` — acceptance tests
- `src/generated/charmaps.ts` (from the codegen TPP)

## Lore

- Binary string = one char per byte, `charCodeAt(i)===byte`. Bridge via
  `Buffer.from(u8).toString("latin1")` / `Uint8Array.from(s, c => c.charCodeAt(0))`.
- `charmap.ts` builds the **encode** map by iterating 0..255, last-write-wins (matches
  `codecs.charmap_build`).
- `DecodeError` must format the windows-1252 message verbatim:
  `'charmap' codec can't decode byte 0x9d in position 4: character maps to <undefined>` —
  keep the byte/position/encoding as fields, render the message separately.
- This TPP must NOT import `index.ts` (it's a leaf).

## Tasks

1. `codecs/binary-string.ts` — `bytesToBinary`/`binaryToBytes` + round-trip spec over 0..255.
2. `codecs/errors.ts` — `DecodeError`/`EncodeError` with structured fields + formatted message.
3. `codecs/charmap.ts` — generic 256-entry decode engine + encode-map builder; throws on holes.
4. `codecs/sloppy.ts` — consumes generated sloppy tables.
5. `codecs/utf16.ts` — utf-16 with BOM detection.

Verify: `npm test -- codecs`; round-trip and decode-error tests pass without `index.ts`.
