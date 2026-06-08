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

- [x] Research & Planning
- [x] Implementation of tasks
- [x] Final integration verification (own vitest green: 17 passed; isolatedDeclarations clean)

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "Data model", "The fixers", "Import cycle"
- `python-ftfy/ftfy/__init__.py:78-246` — FIXERS, TextFixerConfig (16-field
  NamedTuple), `_config_from_kwargs`
- `python-ftfy/tests/test_entities.py` — `test_old_parameter_name` (the deprecation acceptance test)

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

## Outcome / durable facts (for later waves)

`src/config.ts` exports:

- Types: `ExplanationStep` (`readonly [action, parameter]`), `ExplainedText`
  (`{ text, explanation: ExplanationStep[] | null }`), `NormalizationForm`
  (`"NFC"|"NFD"|"NFKC"|"NFKD"`), `TextFixerConfig` (snake_case interface, 16 fields,
  `null` for Python `None`), `FixerName`, `FixerFn` (`(input: string) => string`),
  `ConfigKwargs` (`Partial<TextFixerConfig> & { fix_entities? }`).
- Values/fns: `FIXER_NAMES` (`readonly` tuple of the 12 names, in Python order),
  `FIXERS` (Proxy registry), `registerFixers(fixers)`, `makeConfig(overrides?)`,
  `replace(config, partial)`, `configFromKwargs(config, kwargs?)`,
  `tryFix(fixerName, text, config, steps)`.

### HOW WAVE 3 (fixes.ts) WIRES IN THE REAL FIXERS — IMPORTANT

`config.ts` does NOT import `fixes.ts` (avoids the cycle + the not-yet-existing module).
The `FIXERS` registry is empty until wired. Wave 3 (`fixes.ts`, or `index.ts` at startup)
MUST call ONCE:

```ts
import { registerFixers } from "./config.js";
import * as fixes from "./fixes.js"; // namespace import only
registerFixers({
  unescape_html: fixes.unescape_html,
  remove_terminal_escapes: fixes.remove_terminal_escapes,
  restore_byte_a0: fixes.restore_byte_a0,            // byte-level: binary-string in/out
  replace_lossy_sequences: fixes.replace_lossy_sequences, // byte-level: binary-string in/out
  decode_inconsistent_utf8: fixes.decode_inconsistent_utf8,
  fix_c1_controls: fixes.fix_c1_controls,
  fix_latin_ligatures: fixes.fix_latin_ligatures,
  fix_character_width: fixes.fix_character_width,
  uncurl_quotes: fixes.uncurl_quotes,
  fix_line_breaks: fixes.fix_line_breaks,
  fix_surrogates: fixes.fix_surrogates,
  remove_control_chars: fixes.remove_control_chars,
});
```

Until then, `FIXERS[name]` for a known-but-unregistered fixer THROWS (programming-error
guard). `name in FIXERS` works immediately (membership by `FIXER_NAMES`), so `apply_plan`'s
`encoding in FIXERS` validation is correct before/after wiring.

### Deprecation test note

`test_old_parameter_name` (from `test_entities.py`) exercises `fix_text(..., fix_entities=...)`,
but `fix_text` lives in `index.ts` (later wave). We ported the deprecation assertion at the
`configFromKwargs` layer that owns it: `fix_entities` emits `process.emitWarning(msg,
"DeprecationWarning")` and maps to `unescape_html`. No xfails. When index.ts exists, the
end-to-end `fix_text(..., fix_entities=...)` assertion can be added in the entities suite owned
by the html agent.
