---
title: index.ts — fix loops & public API
section: index
status: placeholder
---

# TPP: index.ts — orchestration & public API

# (Wave 3 — PLACEHOLDER, the heart. DEPENDS ON fixes + all of Wave 2. Co-developed with the

# fixes TPP. Scope before implementing.)

## Status

**Placeholder** — intentionally light per the roadmap. First `/tpp` action is "Research &
scoping" once the fixes TPP is underway.

## Summary

Port `ftfy/__init__.py`: both fix loops, `_fix_encoding_one_step_and_explain`, `fix_text`
segmentation, and the public API (`fix_text`, `fix_and_explain`, `fix_encoding`,
`fix_encoding_and_explain`, `fix_text_segment`, `guess_bytes`, `apply_plan`, `fix_file`,
`explain_unicode`, `__version__`). **All public names snake_case — no camelCase aliases.**

## Current phase

- [ ] Research & scoping ← start here
- [ ] Write breaking tests
- [ ] Implementation
- [ ] Final integration verification

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "Strict decode is the control-flow backbone",
  "explain_unicode is async", "Import cycle", `fix_text`/`fix_file` segmentation pitfalls
- `../python-ftfy/ftfy/__init__.py`
- `../python-ftfy/tests/test_characters.py`, `../python-ftfy/tests/test_examples_in_json.py`

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

To be scoped when the fixes TPP is underway.
