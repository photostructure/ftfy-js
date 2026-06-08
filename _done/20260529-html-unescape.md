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

- [x] Research & Planning
- [x] Write breaking tests (charref edge cases)
- [x] Implementation of tasks
- [x] Final integration verification (31/31 green via `npx vitest run entities`)

## Outcome / durable facts

- `src/html-entities.ts` exports exactly one public symbol: `unescape(s: string): string`
  (faithful port of CPython 3.12 `html.unescape`). snake_case-free public name matches
  Python `html.unescape`.
- Internal (NOT exported): `_replace_charref(ref)`, the `_charref` global RegExp,
  `_invalid_charrefs` (Map<number,string>), `_invalid_codepoints` (Set<number>). These mirror
  CPython names. chardata.ts (Wave 2) only needs `unescape`; it builds HTML_ENTITIES itself
  from the generated HTML5_ENTITIES dict + uppercase variants (calling `unescape` to test
  whether an uppercased name is already an entity), so no extra exports were required.
- Consumes read-only `src/generated/html5-entities.ts` → `HTML5_ENTITIES` (Record<string,string>).
- Parity notes:
  - `_charref` compiled WITHOUT `u` flag, global; `unescape` uses `String.prototype.replace`
    which resets lastIndex per call (no leak). Test pins this.
  - `int(...rstrip(';'),base)` ported as `Number.parseInt(slice.replace(/;+$/,''), base)`.
  - `chr(num)` → `String.fromCodePoint(num)`; out-of-range / surrogate → `�`;
    `_invalid_codepoints` → `""`.
  - Longest-prefix loop uses code-unit slicing — safe because charref bodies are ASCII.
- Test values are RAW `html.unescape` output (verified vs CPython 3.12), NOT ftfy's
  `unescape_html` fixer. Notably uppercased named refs (`&EURO;`, `&SACUTE;`, `&SCARON;`) are
  left UNCHANGED by raw unescape; the uppercase handling + HTML_ENTITY_RE guard live in
  chardata.ts/fixes.ts (Wave 2). The `&#20x6;`-unchanged assertion in test_entities.py belongs
  to the fixer (Wave 2), not raw unescape (raw → `x6;`); that case is covered here with its
  raw value.

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, build/test commands
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md) — workflow
- [docs/DESIGN.md](../docs/DESIGN.md) — "html.unescape exactness"
- CPython `html/__init__.py` — `_charref`, `_replace_charref`, `_invalid_charrefs`,
  `_invalid_codepoints`
- `python-ftfy/tests/test_entities.py` — the entity acceptance tests
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
