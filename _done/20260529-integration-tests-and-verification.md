---
title: Integration tests & end-to-end verification
section: tests
status: implemented
---

# TPP: Integration tests & end-to-end verification

# (Wave 4 — PLACEHOLDER, final. DEPENDS ON everything. Cross-cutting; per-wave tests are

# ported in their own TPPs — this covers the JSON corpus, doctests, CLI integration, and

# release gates. Scope before implementing.)

## Status

**Placeholder** — intentionally light per the roadmap. First `/tpp` action is "Research &
scoping" near the end of the project.

### Orchestrator verification note (2026-06-10)

The strict `process.versions.unicode === "17.0"` pin was validated against the full CI
matrix by running the real binaries: Node 22.22.3, 24.16.0, and 26.3.0 all report
`unicode=17.0`. Codex review of this wave returned **zero findings**.

## Summary

Wire up the cross-cutting test suites and the end-to-end verification gates: the 161-case JSON
corpus (with xfail-strict known-failures), transcribed doctests, CLI tests against
`dist/bin.js`, packaging smoke tests, and the codegen/Unicode drift guards.

## Current phase

- [x] Research & scoping
- [x] Implementation
- [x] Final integration verification

## What was done where (final-wave gap analysis)

Every upstream `tests/*.py` file is ported, mostly in earlier waves. This wave
added the doctest suite and the Unicode-version drift guard, and verified the
release gates (already wired in CI). Nothing was intentionally skipped for the
acceptance surface.

### Already ported in earlier waves (verified, not duplicated)

- `test_examples_in_json.py` → `tests/examples-in-json.test.ts` (161 cases;
  passing cases also assert `apply_plan(orig, plan)` round-trip + all-fixers-off
  encoding path + extra-latin-1-layer; 10 known-failures via `test.fails`,
  asserting the encoding-fix path only). Corpus JSON + `face.txt` byte-identical.
- `test_cli.py` → `tests/cli.test.ts` (all six cases against `dist/bin.js`).
- `test_bytes.py` → `tests/bytes.test.ts` (guess_bytes matrix, Java-null,
  IncrementalDecoder byte-split equivalence).
- `test_characters.py` → `tests/characters.test.ts`.
- `test_entities.py` → `tests/fix-entities.test.ts` (ftfy-level) +
  `tests/entities.test.ts` (raw html.unescape charref edges).
- `test_encodings.py` (`test_cesu8`, `test_russian_crash`) →
  `tests/codecs/utf8-variants.test.ts`. The `search_function`/alias half is in
  `tests/encodings.test.ts`.
- `__version__ == "6.3.1"` + submodule-agreement guard → `tests/smoke.test.ts`.
- Many doctests already pinned: `formatting.py` (character*width/
  monospaced_width/display*{ljust,rjust,center}) → `tests/formatting.test.ts`;
  `fix_text` / `fix_encoding_and_explain(sÃ³, voilÃ)` / `apply_plan` /
  `decode_escapes` / `explain_unicode` kaomoji → `tests/index-extras.test.ts`.

### Added this wave

- `tests/doctests.test.ts` — transcribes the doctests NOT already pinned: the
  per-fixer `fixes.py` examples (unescape_html, remove_terminal_escapes,
  uncurl_quotes, fix_latin_ligatures, fix_character_width, fix_line_breaks,
  fix_surrogates, remove_bom), the remaining `fix_encoding` `__init__.py`
  example, and the `bad_codecs` codec doctests (`utf-8-variants`/`utf-8-var`
  decode, and the `sloppy.py` three-way `explain_unicode` block). A header maps
  each block to its upstream source / or notes where it is already covered.
- `tests/generated.test.ts` — "Unicode-version drift guards" describe block:
  asserts every generated header records the same codegen unidata baseline
  (15.0.0) and that Node's `process.versions.unicode` matches the validated
  baseline (17.0). Both fail loudly on drift; comments explain how to re-baseline.

### Release gates — verified, not rebuilt

`.github/workflows/build.yml` already runs the full gate set: typecheck, build,
lint (prettier + ruff + publint), `gen:check` (codegen no-diff parity),
`attw --pack` (are-the-types-wrong), and the cross-OS / Node 22·24·26 test
matrix. No CI changes were needed.

## Final verification (run from clean tree)

- `npm test` → 18 files, 831 passed + 10 expected-fail. PASS
- `npm run typecheck` → clean. PASS
- `npm run build` → clean (ESM+CJS+CLI+.d.ts emitted). PASS
- `npm run gen:check` → no git diff. PASS
- `npm run lint` → prettier + ruff + publint all clean. PASS
- CLI smoke `printf 'âœ” No problems' | node dist/bin.js` → `✔ No problems`. PASS
- `__version__` → `6.3.1`. PASS
- Public barrel exports exactly the python-public names (no camelCase leaks). PASS

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — Unicode-version skew, verification expectations
- `python-ftfy/tests/test_examples_in_json.py` — corpus harness & round-trips
- `python-ftfy/tests/test_cli.py` — CLI acceptance tests
- `python-ftfy/pytest.ini` — `--doctest-modules`

## Lore

- `examples-in-json`: all 161 cases. Passing cases also check `apply_plan(orig, plan) ===
fixed_output`, the all-fixers-disabled encoding path, and the extra-latin-1-layer round trip.
- `known-failures` (10 cases): use Vitest `test.fails` (xfail-strict equivalent) and assert the
  **encoding-fix path** only (`fix_encoding_and_explain`), matching upstream.
- CLI tests spawn `dist/bin.js` against `face.txt`: `-g`, `-e sloppy-windows-1252`, stdin,
  wrong-encoding error, same-file error.
- Drift guards: codegen re-run yields no git diff; Node's `process.versions.unicode` matches
  the baseline recorded in generated headers (fail loudly on mismatch).

## Tasks

To be scoped near the end; verification checklist mirrors plan.md "Verification (end-to-end)".

Exit criteria: `npm test`, `npm run build`, `npm pack --dry-run`/`attw`/`publint`, ESM+CJS+CLI
smoke imports, and both drift guards all pass from a clean checkout.
