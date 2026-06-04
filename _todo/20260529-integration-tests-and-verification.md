---
title: Integration tests & end-to-end verification
section: tests
status: placeholder
---

# TPP: Integration tests & end-to-end verification

# (Wave 4 — PLACEHOLDER, final. DEPENDS ON everything. Cross-cutting; per-wave tests are

# ported in their own TPPs — this covers the JSON corpus, doctests, CLI integration, and

# release gates. Scope before implementing.)

## Status

**Placeholder** — intentionally light per the roadmap. First `/tpp` action is "Research &
scoping" near the end of the project.

## Summary

Wire up the cross-cutting test suites and the end-to-end verification gates: the 161-case JSON
corpus (with xfail-strict known-failures), transcribed doctests, CLI tests against
`dist/bin.js`, packaging smoke tests, and the codegen/Unicode drift guards.

## Current phase

- [ ] Research & scoping ← start here
- [ ] Implementation
- [ ] Final integration verification

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
