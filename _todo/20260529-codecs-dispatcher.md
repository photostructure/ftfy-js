---
title: codecs/index.ts — encode/decode dispatcher
section: codecs
status: placeholder
---

# TPP: codecs dispatcher

# (Wave 2 — PLACEHOLDER. DEPENDS ON codecs-leaves + strict-utf8-decoder + utf8-variants.

# Scope before implementing — first action is to fill in the Tasks below.)

## Status

**Placeholder.** Pulled out of `codecs-leaves` so no dispatcher branch is ever
half-implemented. Do not start until all codec engines exist (leaves, strict utf8, and
utf8-variants). When those land, scope the Tasks section, then implement.

## Summary

`codecs/index.ts`: `encode(str, enc) -> Uint8Array` / `decode(bytes, enc) -> string`, throwing
on error. Routes each encoding name to the right engine (charmap/sloppy, strict utf-8,
utf-8-variants aliases, utf-16). This is the single entry point the fix loop and `guess_bytes`
call.

## Current phase

- [ ] Research & scoping ← start here once dependencies land
- [ ] Write breaking tests
- [ ] Implementation
- [ ] Final integration verification

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "Strict decode is the control-flow backbone", "Codegen tables"
- `../python-ftfy/ftfy/bad_codecs/__init__.py` — `search_function`, the alias set
- `../python-ftfy/tests/test_encodings.py`, `../python-ftfy/tests/test_bytes.py`
- The `codecs-leaves`, `strict-utf8-decoder`, and `utf8-variants` TPPs

## Lore

- Encoding-name resolution must accept the same aliases python-ftfy registers (sloppy-\*,
  utf-8-variants names, the `INCOMPLETE_ENCODINGS` set used by `fix_file -e`).
- THROW on any decode/encode error — no silent `�` except the single explicit `"replace"`
  path used by `test_russian_crash`.

## Tasks

To be scoped once the codec engines exist.
