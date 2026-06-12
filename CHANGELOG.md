# Changelog

All notable changes to `@photostructure/ftfy` are documented here.

> **Versioning policy.** This package uses its own [semver](https://semver.org) line,
> independent of python-ftfy's version numbers. The npm `version` tracks _this package's_
> API stability (`0.x` until full parity, `1.0.0` once the ported test suite passes and
> the API is stable); the exported `__version__` separately records the upstream
> python-ftfy release being mirrored. Releases are cut by CI via
> `.github/workflows/build.yml` — the `version` in `package.json` is never edited by hand.

## 0.0.1 - 2026-06-12

First published release: a full, faithful TypeScript port of python-ftfy with
zero runtime dependencies.

### Provenance

- **Ports python-ftfy v6.3.1** — upstream commit
  `74dd0452b48286a3770013b3a02755313bd5575e` (2024-10-30). `__version__` is pinned
  to `"6.3.1"`; any future divergence from this upstream commit must be recorded
  here.

### Added

- **Public API** (snake_case, mirroring python-ftfy): `fix_text`,
  `fix_and_explain`, `fix_encoding`, `fix_encoding_and_explain`, `fix_file`,
  `guess_bytes`, `apply_plan`, `explain_unicode`, plus the `TextFixerConfig`,
  `ExplanationStep`, and `ExplainedText` data model and the `__version__` export.
- **Fixers** — all 12 upstream fixers and the `fix_encoding` step, ported from
  `ftfy/fixes.py`, with both the outer and encoding fix loops from
  `ftfy/__init__.py`.
- **Codecs** — zero-dependency ports of the encodings ftfy relies on: a strict
  incremental UTF-8 step machine (`IncrementalDecoder`), the `utf-8-variants`
  codec (CESU-8 / Java-style overlong null), `sloppy-windows-*` charmap codecs,
  `utf-16` with BOM detection, and the decode/encode dispatcher. `DecodeError` /
  `EncodeError` carry CPython-compatible messages and codepoint-based positions.
- **Character data & badness** — `chardata.py` regexes, maps, and encoding clues;
  `badness.py` (`BADNESS_RE`, `badness`, `is_bad`).
- **Display width** — `formatting.py` API (`monospaced_width`,
  `display_ljust`/`rjust`/`center`, `character_width`) with a ported `wcwidth`.
- **HTML entities** — a faithful port of CPython's `html.unescape()` over the
  generated HTML5 entity table.
- **CLI** — the `ftfy` command, a hand-rolled argparse clone reproducing
  upstream's exact stderr/stdout, error texts, and exit codes.
- **Generated data tables** — committed codegen output under `src/generated/`,
  byte-identical to the Python tables, with Unicode-version drift guards.
- **Packaging** — dual ESM + CJS build (tsdown, isolatedDeclarations), package
  exports map, `ftfy` bin, and Apache-2.0 attribution to python-ftfy and Robyn
  Speer (LICENSE, NOTICE, README).

### Tested

- Ports the upstream `tests/` acceptance suite (fixers, CLI, codecs, entities,
  and the `test-cases/*.json` corpus) plus the upstream doctests, with
  byte-identical fixtures. The direct ports live under `tests/upstream/`;
  supplemental coverage lives under `tests/internal/`.
