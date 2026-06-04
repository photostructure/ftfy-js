---
title: utf8-variants codec (CESU-8 / Java null)
section: codecs
status: placeholder
---

# TPP: utf8-variants codec

# (Wave 2 — PLACEHOLDER. DEPENDS ON the strict-utf8-decoder TPP. Scope before implementing.)

## Status

**Placeholder** — intentionally light per the roadmap. First `/tpp` action is "Research &
scoping" once the strict UTF-8 step machine exists.

## Summary

Port `ftfy/bad_codecs/utf8_variants.py` over binary strings: the incremental decoder that
also accepts CESU-8 six-byte surrogate-pair sequences and Java's `C0 80` encoding of NUL.
Built on the strict UTF-8 step machine.

## Current phase

- [ ] Research & scoping ← start here
- [ ] Write breaking tests
- [ ] Implementation
- [ ] Final integration verification

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "UTF-8 / utf-8-variants"
- `python-ftfy/ftfy/bad_codecs/utf8_variants.py` — `_buffer_decode`,
  `_buffer_decode_step`, `_buffer_decode_surrogates`, `CESU8_RE`, `SPECIAL_BYTES_RE`
- `python-ftfy/tests/test_encodings.py` (`test_cesu8`), `python-ftfy/tests/test_bytes.py`
- The strict-utf8-decoder TPP (provides the base step machine + `IncrementalDecoder`)

## Lore

- Export `IncrementalDecoder` — `test_bytes.py` feeds input split at every byte boundary and
  expects identical output to the whole-input decode.
- Surrogate handling uses `charCodeAt`-level logic; regexes that match lone surrogate code
  units are compiled **without** the `u` flag.
- Inherits the strict decoder's truncation semantics: non-final incomplete tail buffered,
  final incomplete tail throws.
- Register under the `utf-8-variants` aliases the dispatcher uses.

## Tasks

To be scoped when the strict-utf8-decoder TPP completes.
