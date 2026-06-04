---
title: html.unescape port (html-entities.ts)
section: chardata
---

# TPP: html.unescape port

# (Wave 1 — parallel. Consumed by chardata.ts / unescape_html fixer.)

## Summary

Port CPython's `html/__init__.py` `unescape()` exactly, consuming the generated `html5`
entity dict. npm `entities` diverges on the edge cases python-ftfy's tests pin, so this is a
verbatim port, not a dependency.

## Current phase

- [ ] Research & Planning
- [ ] Write breaking tests (charref edge cases)
- [ ] Implementation of tasks
- [ ] Final integration verification

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "html.unescape exactness"
- CPython `html/__init__.py` — `_charref`, `_replace_charref`, `_invalid_charrefs`,
  `_invalid_codepoints`
- `../python-ftfy/tests/test_entities.py` — the entity acceptance tests
- `src/generated/html5-entities.ts` (from the codegen TPP)

## Lore

- Behaviors to reproduce: `_invalid_charrefs` (`0x80→€`, `0x00→�`, …), `_invalid_codepoints`
  (→ ""), out-of-range → `�`, named-entity longest-prefix-without-semicolon loop.
- Write the tests first: `&#xffff;→""`, `&#xffffffff;→"�"`, `euro &#x80;→euro €`,
  `&#20x6;` unchanged.
- `_build_html_entities` (the `&name;` filter + uppercase variants) is ported at runtime in
  `chardata.ts`, not here — this TPP is just `unescape()` + the charref machinery.

## Tasks

1. `src/html-entities.ts` — `unescape()`, `_charref` regex, `_replace_charref`, invalid
   tables, consuming the generated html5 dict.
2. Standalone charref test file covering the cases above.

Verify: `npm test -- entities` (the unescape-specific cases).
