---
title: codecs/index.ts — encode/decode dispatcher
section: codecs
status: complete
---

# TPP: codecs dispatcher

## Status

**Complete.** `src/codecs/index.ts` wires every codec engine behind `decode`/`encode`;
codex-reviewed with four parity fixes applied (see "Post-review fixes"). Suite 459 green.

## Summary

`codecs/index.ts`: `encode(str, enc) -> Uint8Array` / `decode(bytes, enc) -> string`, throwing
on error. Routes each encoding name to the right engine (charmap/sloppy, strict utf-8,
utf-8-variants aliases, utf-16). This is the single entry point the fix loop and `guess_bytes`
call.

## Current phase

- [x] Research & scoping
- [x] Write breaking tests
- [x] Implementation
- [x] Final integration verification

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "Strict decode is the control-flow backbone", "Codegen tables"
- `python-ftfy/ftfy/bad_codecs/__init__.py` — `search_function`, the alias set
- `python-ftfy/tests/test_encodings.py`, `python-ftfy/tests/test_bytes.py`
- The `codecs-leaves`, `strict-utf8-decoder`, and `utf8-variants` TPPs

## Lore

- Encoding-name resolution must accept the same aliases python-ftfy registers (sloppy-\*,
  utf-8-variants names, the `INCOMPLETE_ENCODINGS` set used by `fix_file -e`).
- Deferred from the utf8-variants review (codex): upstream
  `test_encodings.py::test_cesu8` asserts `"cesu8"` and `"cesu-8"` resolve to the same
  codec before checking the decode vector. The utf8-variants TPP only ported the decode
  vector; the alias-resolution assertion belongs HERE — add it when wiring lookup.
- THROW on any decode/encode error — no silent `�` except the single explicit `"replace"`
  path used by `test_russian_crash`.

### Implementation decisions (done 2026-06-10)

- **`src/codecs/index.ts`** exposes `decode(bytes, encoding)` / `encode(text, encoding)`
  (strict, throwing), plus `resolveEncoding`, `search_function` (the `test_cesu8` shim),
  `UnknownEncodingError`, and re-exports `DecodeError`/`EncodeError`/`normalizeEncoding`.
- **No `errors` arg on the dispatcher.** Verified `guess_bytes` only ever calls
  `decode("utf-8-variants")` in strict mode; `test_russian_crash` exercises `"replace"` by
  hitting the variants codec directly. So the dispatcher is strict-only, matching DESIGN.md.
- **Identity for `test_cesu8`.** `ResolvedCodec` is a tagged union; engine-only kinds
  (`ascii`/`utf-8`/`utf-8-variants`/`utf-16`) are module singletons, and charmap kinds carry
  the shared `CharmapCodec` instance, so `search_function("cesu8") === search_function("cesu-8")`
  by reference (`===`), and `latin-1`/`iso-8859-1` resolve to the same `CharmapCodec`.
- **Two-layer name folding.** `encoding.toLowerCase()` then `normalizeEncoding` (already in
  `sloppy.ts`), mirroring `codecs.lookup`'s pre-folding. Then `search_function`-style order:
  `UTF8_VAR_NAMES` → `sloppy_*` → utf-8 → utf-16 → ascii → real charmap (`REAL_BY_NORM`, a
  normalized-name index over `REAL_CODECS`, with explicit Latin-1 aliases). Raw-name `_CACHE`
  mirrors upstream.
- **`utf-16` encode is supported (post-review reversal).** The first cut threw
  `UnknownEncodingError`; codex review pointed out Python succeeds (`"abc".encode("utf-16")`
  → `ff fe 61 00 …`) and the public `apply_plan` accepts arbitrary user plans, so parity
  requires it. `utf16Encode` (utf16.ts) emits BOM + LE code units; lone surrogates throw
  `EncodeError` with CPython's `"surrogates not allowed"`. CPython-derived vectors pin it.
- **ascii engine** is a tiny inline strict decode/encode (byte/codepoint < 0x80 else throw with
  CPython's `"ordinal not in range(128)"` reason); no generated table needed.

### Post-review fixes (codex review, vetted against CPython, 2026-06-10)

- **utf-16 encode implemented** (see above).
- **stdlib alias parity**: added `STDLIB_CHARMAP_ALIASES`, derived from CPython's
  `encodings.aliases` by resolving every alias via `codecs.lookup` and keeping those that
  land on a shipped codec (`cp1252`/`1252`→windows-1252, `437`/`ibm437`→cp437,
  `macintosh`/`mac_roman`→macroman, `latin1`/`l1`/`iso_ir_100`/`csisolatin1`/…→latin-1,
  `latin2`/`iso_ir_101`/…→iso-8859-2). The CLI `-e` passes user names straight through,
  so Python-resolvable names must resolve here too.
- **latin-1 encode is not charmap**: CPython's latin-1 codec reports
  `"ordinal not in range(256)"`, not the charmap `"character maps to <undefined>"` —
  dedicated `latin1Encode` path.
- **encode error spans group runs**: CPython reports a run of consecutive unencodable
  characters as ONE error (`"characters in position 0-1"`); `rangeEncode` (ascii +
  latin-1) now mirrors that.
- **charmap `ResolvedCodec` identity**: wrappers are now cached per `CharmapCodec`
  instance, so `resolveEncoding("cp1252") === resolveEncoding("windows-1252")` (the doc
  contract previously claimed identity that only held for engine-only kinds).
- Tests: `tests/codecs/index.test.ts` (37 cases). Full suite 401 → **459 green** (incl. post-review fix coverage); typecheck and
  build clean. No generated files touched.

## Tasks

### Scope (research done)

The dispatcher is `src/codecs/index.ts`, exposing two functions that the not-yet-built
fix loop / `guess_bytes` / `apply_plan` will call:

- `decode(bytes: Uint8Array, encoding: string): string`
- `encode(text: string, encoding: string): Uint8Array`

Both THROW (`DecodeError`/`EncodeError`) on malformed input — strict is the backbone.
There is **no** `errors` argument on the public dispatcher; the single `"replace"`
path (`test_russian_crash`) is exercised through the variants `IncrementalDecoder`
directly, not through `decode`. (Confirmed: `guess_bytes` calls `bstring.decode("utf-8-variants")`
in _strict_ mode; only `test_russian_crash` passes `"replace"`, and it does so by calling
the codec directly.)

**Name resolution mirrors Python's two-layer scheme** that ftfy relies on:

1. CPython's `codecs.lookup` lowercases + `normalize_encoding` (run of non-alnum/non-`.`
   → single `_`) before any search function sees the name. We already have
   `normalizeEncoding` in `sloppy.ts`; the dispatcher lowercases then normalizes, so
   `"UTF-8"`, `"utf_8"`, `"utf 8"` all collapse.
2. ftfy's `search_function` adds the bad-codec aliases: `UTF8_VAR_NAMES`
   (cesu8/java*utf8/…) → variants codec, and `sloppy*\*` → sloppy charmap.

Encodings the ftfy consumers actually pass (the complete set the dispatcher must route):

- `ascii` — strict ASCII (bytes < 0x80; throw otherwise). `possible_encoding` uses a
  regex, not decode, but `apply_plan` could legitimately ask to decode/encode ascii.
- `latin-1` / `iso-8859-1` — charmap, hole-free.
- `utf-8` — strict utf8.ts.
- `utf-8-variants` (+ all `UTF8_VAR_NAMES` aliases) — utf8-variants.ts.
- `utf-16` — utf16.ts (BOM-detecting; decode-only — `guess_bytes` never encodes utf-16).
- `windows-1252` and the other real single-byte encodings (real charmap, throws at holes):
  windows-1250..1258, iso-8859-2/3/6/7/8/11, cp437, cp874, macroman.
- `sloppy-windows-125x`, `sloppy-iso-8859-N`, `sloppy-cpNNNN` (sloppy charmap, no holes).
- `cp437`, `macroman`, `iso-8859-2` — these are hole-free real charmaps used by
  `CHARMAP_ENCODINGS`.

### Implementation plan

1. `src/codecs/index.ts`:
   - `resolveEncoding(name)` → a small tagged union `{kind, codec?}` describing which
     engine handles the (lowercased, normalized) name, or `undefined` if unknown.
     Resolution order mirrors `search_function` plus the stdlib encodings ftfy needs:
     utf-8-variants aliases → sloppy\_\* → utf-8 → utf-16 → ascii → real charmap (incl.
     latin-1/iso-8859-1 and `INCOMPLETE_ENCODINGS` reals).
   - `decode(bytes, encoding)` / `encode(text, encoding)` dispatch; unknown name throws
     a `LookupError`-style error (mirrors Python's `LookupError: unknown encoding`).
   - Re-export `DecodeError`/`EncodeError`/`normalizeEncoding`, and a `search_function`
     shim that returns a codec-identity object so `test_cesu8`'s
     "cesu8 and cesu-8 resolve to the same codec" assertion ports.
   - ASCII engine: tiny strict decode/encode (no generated table needed; byte<0x80).
   - latin-1/iso-8859-1: route to the `latin-1` real charmap (hole-free).
2. Build the alias set `UTF8_VAR_NAMES` verbatim from the Python tuple.
3. Real-charmap encode: `CharmapCodec.encode` already exists; wire by name.
4. utf-16: decode routes to `utf16Decode`; encode is unsupported (throw) — no ftfy
   consumer encodes utf-16, and a faithful encoder is out of scope. Flag if a test needs it.

### Tests (`tests/codecs/index.test.ts` + additions to `tests/encodings.test.ts`)

- Port `test_encodings.py::test_cesu8` alias assertion: `search_function("cesu8")` and
  `search_function("cesu-8")` resolve to the same codec identity; then the decode vector
  through `decode(bytes, "cesu8")`.
- Name normalization matrix: `UTF-8`/`utf_8`/`utf 8` → utf-8; `Sloppy-Windows-1252` etc.
- Round-trip each `CHARMAP_ENCODINGS` member via encode→decode.
- Real windows-1252 decode of byte 0x9d throws with the exact charmap message.
- Unknown encoding throws.
- ascii decode/encode + throw on high byte / non-ascii char.
