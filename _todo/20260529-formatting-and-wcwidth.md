---
title: formatting.ts + ported wcwidth
section: formatting
---

# TPP: formatting.ts + ported wcwidth

# (Wave 1 — parallel. Self-contained; also used by explain_unicode's display_ljust.)

## Summary

Port `ftfy/formatting.py` (`character_width`, `monospaced_width`, `display_ljust`/`rjust`/
`center`) and the `wcwidth` tables it relies on (zero-dep). Python imports the external
`wcwidth` package; this TPP **owns** a `scripts/gen_wcwidth.py` codegen that emits those tables
to `src/generated/wcwidth-tables.ts`. **Public names are snake_case; no camelCase aliases.**

## Current phase

- [ ] Research & Planning
- [ ] Write breaking tests (monospaced_width doctests)
- [ ] Implementation of tasks
- [ ] Final integration verification

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "wcwidth" pitfall, Unicode-version skew
- `../python-ftfy/ftfy/formatting.py` (and its module doctests = the acceptance tests)
- The `wcwidth` package source (record the exact version + its Unicode data version)
- The `codegen-and-generated-tables` TPP — for the shared generated-header/determinism conventions

## Ownership boundary

`wcwidth` is a separate upstream package from `ftfy`, so its generator lives here, not in the
ftfy codegen TPP. `scripts/gen_wcwidth.py` imports the installed `wcwidth` package and emits
`src/generated/wcwidth-tables.ts` with a provenance header recording the **`wcwidth` version**
and **its Unicode data version**, following the same sort-keys/deterministic conventions and
the same no-diff CI guard as the ftfy generators. `formatting.ts` consumes that generated
table — it does **not** hand-maintain width data.

## Lore

- This is the one spot a naive port drifts — **verify `monospaced_width` doctests early.**
- `monospaced_width` handles NFC normalization and strips terminal escapes before measuring.
- Watch Unicode-version skew between the wcwidth tables (their Unicode data version) and
  Node's ICU; the provenance header makes drift attributable.

## Tasks

1. `scripts/gen_wcwidth.py` → `src/generated/wcwidth-tables.ts` (zero-width / wide / combining
   ranges) with the provenance header above.
2. `src/formatting.ts` — `character_width`, `monospaced_width`, `display_ljust`,
   `display_rjust`, `display_center`, consuming the generated table.
3. Transcribe the formatting doctests as tests; add the no-diff regen check for the wcwidth table.

Verify: `npm test -- formatting`; doctests green; `gen_wcwidth.py` re-run yields no git diff.
