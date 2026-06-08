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

- [x] Research & Planning
- [x] Write breaking tests
- [x] Implementation of tasks (charmap, sloppy, utf16; binary-string & errors were
      pre-supplied foundation files)
- [x] Final integration verification (`npx vitest run encodings` — 37 passed)

NOTE: `binary-string.ts` and `errors.ts` (tasks 1–2) were already written as shared
foundation files before this agent ran; they were consumed, not recreated. This agent
owned tasks 3–5 (charmap, sloppy, utf16) plus the test file.

## Done — durable facts for later waves

Exported symbols (import these from the Wave-2 dispatcher / fixes / guess_bytes):

- `src/codecs/charmap.ts`
  - `buildEncodeMap(decodingTable: string, holes?: ReadonlySet<number>): Map<number, number>`
    — mirrors `codecs.charmap_build`, last-write-wins. `holes` skips unassigned byte
    positions so their Latin-1 placeholder codepoint gets NO encode entry (real
    encodings can't encode their holes; sloppy tables pass no holes and round-trip fully).
  - `charmapDecode(bytes, decodingTable, holes): string` — throws `DecodeError` at first hole.
  - `charmapEncode(text, encodeMap): Uint8Array` — iterates by codepoint; throws `EncodeError`;
    EncodeError positions are in UTF-16 units (astral char spans start..start+2).
  - `class CharmapCodec { name; decodingTable; holes; decode(bytes): string;
encode(text): Uint8Array; encodeMap(): ReadonlyMap<number,number> }` — lazy encode map.
  - Charmap errors use the CPython label `"charmap"` (not the human encoding name).
- `src/codecs/sloppy.ts`
  - `normalizeEncoding(encoding: string): string` — faithful to CPython
    `encodings.normalize_encoding` (CASE-PRESERVING; collapses non-alnum runs to `_`).
  - `REAL_CODECS: ReadonlyMap<string, CharmapCodec>` — keyed by the table name as in
    `REAL_DECODING_STRINGS` (e.g. `"windows-1252"`, `"iso-8859-2"`, `"macroman"`, `"cp437"`,
    `"latin-1"`). These THROW at their holes.
  - `SLOPPY_CODECS: ReadonlyMap<string, CharmapCodec>` — keyed by NORMALIZED name
    (e.g. `"sloppy_windows_1252"`, `"sloppy_cp1252"`). No holes; decode never throws.
  - `getSloppyCodec(encoding: string): CharmapCodec | undefined` — LOWERCASES then normalizes
    (mirrors `codecs.lookup` lowercasing before dispatch), so `"Sloppy-Windows-1252"`,
    `"sloppy_cp1252"`, etc. all resolve.
- `src/codecs/utf16.ts`
  - `hasUtf16Bom(bytes: Uint8Array): boolean`
  - `utf16Decode(bytes: Uint8Array): string` — BOM-detecting, strict; throws `DecodeError`
    with reasons `"truncated data"` / `"unexpected end of data"` /
    `"illegal UTF-16 surrogate"` / `"illegal encoding"`; error positions are buffer-relative
    and count the consumed 2-byte BOM (first data byte = position 2), matching CPython.
    Used by `guess_bytes` (which only calls it on BOM-prefixed input).

Cross-file assumptions / notes for the dispatcher (Wave 2) and `guess_bytes`:

- This file deliberately exports BOTH a free-function engine and the `CharmapCodec` class +
  registries. The dispatcher should resolve a name to a `CharmapCodec`: sloppy names via
  `getSloppyCodec`, real single-byte names via `REAL_CODECS.get(<table-name>)`.
- The Wave-2 dispatcher reconciles the public `IncrementalDecoder` name with `utf8.ts`; this
  TPP exports NO `IncrementalDecoder` (charmap/sloppy/utf16 are stateless, single-shot).
- No xfails. No `index.ts` import (leaf).

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
