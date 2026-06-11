---
title: index.ts — fix loops & public API
section: index
status: placeholder
---

# TPP: index.ts — orchestration & public API

# (Wave 3 — PLACEHOLDER, the heart. DEPENDS ON fixes + all of Wave 2. Co-developed with the

# fixes TPP. Scope before implementing.)

## Status

**Implemented** (co-developed with fixes). `src/index.ts` ports all of `ftfy/__init__.py`'s
public API and both fix loops; `src/unicode-data.ts` backs the async `explain_unicode`. Full
suite green (812 tests, incl. the 312-case + 10-xfail JSON corpus); typecheck and build clean.
Awaiting orchestrator review/move.

## Summary

Port `ftfy/__init__.py`: both fix loops, `_fix_encoding_one_step_and_explain`, `fix_text`
segmentation, and the public API (`fix_text`, `fix_and_explain`, `fix_encoding`,
`fix_encoding_and_explain`, `fix_text_segment`, `guess_bytes`, `apply_plan`, `fix_file`,
`explain_unicode`, `__version__`). **All public names snake_case — no camelCase aliases.**

## Current phase

- [x] Research & scoping
- [x] Write breaking tests (ported `test_bytes.py` guess_bytes/IncrementalDecoder,
      `test_examples_in_json.py` JSON corpus, `test_entities.py` end-to-end; added
      `index-extras` for explain_unicode/apply_plan/fix_file/doctests)
- [x] Implementation
- [x] Final integration verification (JSON corpus is the canonical end-to-end check)

## Decisions & divergences (this implementation)

- **Argument shape.** Python's `(text, config=None, **kwargs)` is ported as
  `(text, config?, kwargs?)` — an optional `TextFixerConfig` plus an optional kwargs object
  (`ConfigKwargs`). Snake_case kwargs only. Public functions taking no explanation default
  `explain:false`; `fix_and_explain`/`fix_encoding_and_explain`/`fix_file` default `explain:true`.
- **Byte stage is a binary string.** Both `apply_plan` and the encoding-fix loop hold the
  post-`encode` bytes as a **binary string**, so the byte fixers and `ALTERED_UTF8_RE` port
  verbatim; converted to `Uint8Array` only at the `decode()` boundary. `apply_plan` tracks a
  bytes/text flag to call the byte-stage fixers with the right representation.
- **Strict decode is load-bearing.** The candidate-encoding rejection catches `DecodeError`
  (re-throws anything else). Verified by the JSON corpus's many encodings.
- **`apply_plan` `normalize` step.** Python's `apply_plan` predates and would reject a
  `("normalize", form)` step, but a real `fix_and_explain` plan can contain one. The port
  applies it faithfully so a full plan round-trips (the JSON corpus asserts
  `apply_plan(orig, plan) == fixed_output`). Unknown ops/fixers still throw, matching Python.
- **`explain_unicode` is async** — the lone sync→async divergence. The Unicode names/categories
  table (`src/unicode-data.ts` over `generated/unicode-names.ts`) is `await import()`-loaded on
  first call; the build confirms it code-splits into its own ~1.36 MB chunk (zero added heap for
  `fix_text`-only consumers). Algorithmic CJK/Hangul names are derived at runtime. Output
  matches the upstream kaomoji doctest byte-for-byte. `isprintable` uses category C*/Z* (SPACE
  excepted). **Reviewer: scrutinize the `unicodeName`/`unicodeCategory` derivation.**
- **`fix_file`** takes an iterable of lines (`string | Uint8Array`) and is a generator, with the
  `unescape_html:"auto"→false` flip **persisted across lines** (stateful, like Python). The CLI
  (later TPP) will own splitting a byte stream into lines.
- **Stale upstream docstring.** `fix_text("Broken text&hellip;…")` keeps `…` under the NFC
  default (the docstring's `...` would require NFKC). Verified against real python-ftfy 6.3.1;
  the port matches the runtime, not the doc.

## Post-review fixes (codex review, vetted by the orchestrator, 2026-06-10)

- **`apply_plan` 'normalize' extension reverted.** The port had accepted a `normalize`
  plan step "so fix_and_explain plans round-trip"; verified against 6.3.1 that Python's
  `apply_plan` raises `ValueError("Unknown plan step: normalize")` and that ZERO corpus
  cases generate a normalize step (in Python or this port). The extension was innovation,
  not parity — `apply_plan` now throws, pinned by a test.
- **`fix_text` infinite loop fixed.** When `max_decode_length` landed inside a surrogate
  pair, the boundary was backed DOWN one unit, producing an empty segment and no forward
  progress (`fix_text("😀", null, {max_decode_length: 1})` hung). The boundary now rounds
  UP to include the whole pair — Python counts codepoints and can never split one.
  Regression tests added.
- **No-explanation branch mirrors the upstream quirk.** `fix_and_explain` with
  `steps === null` now calls `fix_encoding(text)` WITHOUT the config, exactly like
  `ftfy/__init__.py` — so encoding-fix sub-options are ignored when `explain` is off.
  Deliberately quirky; documented inline.
- **`decode_escapes` `\N{...}` stays unsupported** (clear throw): the upstream doctest
  only pins `\u`/`\x` escapes; supporting `\N` would need a sync name→codepoint table.
  Flagged to Matthew as a known, documented gap.

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "Strict decode is the control-flow backbone",
  "explain_unicode is async", "Import cycle", `fix_text`/`fix_file` segmentation pitfalls
- `python-ftfy/ftfy/__init__.py`
- `python-ftfy/tests/test_characters.py`, `python-ftfy/tests/test_examples_in_json.py`

## Lore

- The encoding fix loop rejects candidates by **catching the decode throw** — strict decode
  is load-bearing.
- `fix_text` segmentation: split on `\n`; cap by code units but never split a surrogate pair.
- `fix_file`: read bytes, split keeping `\n` terminators, decode/guess per line, and
  **persist** the `unescape_html:"auto"→false` flip across lines (stateful).
- **`explain_unicode` is `async`** — lazy-load `generated/unicode-names.ts` via `await
import()` on first call (zero heap otherwise); derive CJK/Hangul/Tangut names
  algorithmically. Update its doctest to `await`.
- Every generated explanation must replay exactly via `apply_plan(orig, plan)`.

## Tasks

Done. `src/index.ts` exports the python-public surface (`fix_text`, `ftfy`, `fix_and_explain`,
`fix_encoding`, `fix_encoding_and_explain`, `fix_text_segment`, `guess_bytes`, `apply_plan`,
`fix_file`, `explain_unicode`, `__version__`, plus the re-exported `TextFixerConfig`/`FIXERS`/
types and the formatting helpers). `src/unicode-data.ts` provides `unicodeName`/`unicodeCategory`
(lazy-loaded). Tests: `tests/bytes.test.ts`, `tests/examples-in-json.test.ts`,
`tests/fix-entities.test.ts`, `tests/index-extras.test.ts`.

## Open questions for Matthew

- None blocking. One judgment call to confirm: the JSON corpus suite
  (`tests/examples-in-json.test.ts`, ported from `test_examples_in_json.py`) was nominally
  assigned to a later TPP, but it is the canonical end-to-end acceptance test for exactly these
  two modules, so it was ported now. If a later TPP wants ownership, it can adopt the existing
  file as-is.
