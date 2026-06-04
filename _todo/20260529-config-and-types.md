---
title: config.ts — TextFixerConfig, Explanation types, FIXERS
section: config
---

# TPP: config.ts — types, config, FIXERS

# (Wave 1 — parallel. Defines the data model the whole API shares.)

## Summary

Define `TextFixerConfig`, the Explanation data model, the `FIXERS` registry, `makeConfig`,
`replace`, and `configFromKwargs`. This is split out of `__init__` to break the
`fixes ↔ index` import cycle cleanly.

## Current phase

- [ ] Research & Planning
- [ ] Implementation of tasks
- [ ] Final integration verification

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "Data model", "The fixers", "Import cycle"
- `../python-ftfy/ftfy/__init__.py:78-246` — FIXERS, TextFixerConfig (16-field
  NamedTuple), `_config_from_kwargs`
- `../python-ftfy/tests/test_entities.py` — `test_old_parameter_name` (the deprecation acceptance test)

## Lore

- `ExplanationStep = readonly [action, parameter]` (tuple — `apply_plan` indexes
  `step[0]/step[1]`; `toEqual([["apply","..."], ...])` ports cleanly).
- `ExplainedText = { text, explanation: ExplanationStep[] | null }` (object — `.text` /
  `.explanation` access).
- `TextFixerConfig` = snake_case-keyed interface mirroring the 16 NamedTuple fields;
  `makeConfig(overrides?)` is the defaults factory; `_replace` → `{...config, x}`.
  (`makeConfig`/`replace`/`configFromKwargs`/`tryFix` are internal helpers — camelCase is fine;
  they have no public Python counterpart. Public API stays snake_case with no aliases.)
- `FIXERS` has **12** members (see DESIGN). It references `fixes` via **namespace import**
  (`import * as fixes from "./fixes.js"`) — never destructure at top level.
- `configFromKwargs` emits a deprecation warning via `process.emitWarning` for the old
  `fix_entities` param (mapped to `unescape_html`); covered by `test_old_parameter_name`.
- `normalization` accepts `"NFC"|"NFD"|"NFKC"|"NFKD"|null` — preserve Python `None` as `null`.

## Tasks

1. `src/config.ts` — types (`TextFixerConfig`, `ExplanationStep`, `ExplainedText`),
   `makeConfig`, `replace`, `FIXERS` shape, `configFromKwargs`, `tryFix` helper.
2. Tests for `makeConfig` defaults, `replace` semantics, and the `fix_entities` deprecation.

Verify: `npm test -- config`; must not import `index.ts` at module top level.
