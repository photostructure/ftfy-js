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

- [x] Research & Planning
- [x] Write breaking tests (monospaced_width doctests)
- [x] Implementation of tasks
- [x] Final integration verification

## Outcome (durable facts)

- **wcwidth pinned to `0.2.13`.** This is the last release whose `wcswidth` is a
  simple per-character sum (ZWJ skip-2 + VS16 narrow→wide only — no grapheme
  clustering, Mc, or virama logic) and whose tables make every `formatting.py`
  doctest pass. Critically, SOFT HYPHEN (U+00AD) is **zero-width** in 0.2.13, so
  `monospaced_width('owl\xadflavored') == 11`. wcwidth 0.7.0 (the version vendored
  in `.pyenv`) changed both the algorithm and that width → broke the doctests.
- **Tables emitted** to `src/generated/wcwidth-tables.ts` at the latest ("auto")
  Unicode level **15.1.0** (VS16 table keyed at 9.0.0):
  `ZERO_WIDTH`, `WIDE_EASTASIAN`, `VS16_NARROW_TO_WIDE` — each
  `ReadonlyArray<readonly [number, number]>` of inclusive sorted ranges.
  Provenance banner records wcwidth pkg version + table Unicode version.
- **Exported public symbols** (snake_case, no aliases) from `src/formatting.ts`:
  `character_width`, `monospaced_width`, `display_ljust`, `display_rjust`,
  `display_center`. Internal helpers (`wcwidth`, `wcswidth`, `bisearch`,
  `removeTerminalEscapes`) are module-private.
- **`wcswidth` iterates by codepoint** (`Array.from`), not UTF-16 code units, so
  astral chars / ZWJ / VS16 indexing matches Python `str` iteration.
- **`removeTerminalEscapes` is inlined** in formatting.ts (mirrors
  `ftfy.fixes.ANSI_RE = /\x1b\[((?:\d|;)*)([a-zA-Z])/`) to keep the module
  self-contained while `fixes.ts` is written by another wave. Integration MAY later
  switch to importing `remove_terminal_escapes` from fixes.ts if desired (behavior
  is identical); not required.
- `display_*` raise `Error("The padding character must have display width 1")`
  (upstream raises `ValueError`); message text is verbatim.

## Codegen notes

- `scripts/gen_wcwidth.py` removes the vendored `.pyenv` dir from `sys.path` and
  purges any already-imported `wcwidth*` from `sys.modules`, then asserts the
  imported wcwidth is exactly `0.2.13`. This defeats `.pyenv`'s 0.7.0 shadow.
- `scripts/gen_all.py` now imports/registers `gen_wcwidth` and its PEP 723 dep is
  pinned `wcwidth==0.2.13` (safe — `import ftfy` works under any wcwidth).
- Verified: `uv run scripts/gen_wcwidth.py` and `uv run scripts/gen_all.py` both
  produce the byte-identical table; re-running yields no git diff. `uv` is
  available in this environment (0.11.17).

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "wcwidth" pitfall, Unicode-version skew
- `python-ftfy/ftfy/formatting.py` (and its module doctests = the acceptance tests)
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
