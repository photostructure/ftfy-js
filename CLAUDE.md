# CLAUDE.md — `@photostructure/ftfy`

## What this is

A **straight, faithful TypeScript port** of [`python-ftfy`](https://github.com/rspeer/python-ftfy)
(v6.3.1, Apache-2.0, by Robyn Speer), published as `@photostructure/ftfy`. ftfy
fixes mojibake and other Unicode glitches after the fact.

**Guiding rule: parity, not innovation.** Mirror Python module-for-module,
function-for-function — including the parts that look unusual because they encode
Python edge-case behavior. The package must carry clear attribution that it is a
direct port of python-ftfy.

**Parity is anchored by the upstream tests.** Behavior that `python-ftfy/tests/`
pins — fixer output, CLI stderr/stdout, the `DecodeError`/charmap messages — is a
hard contract: reproduce it exactly. Code paths upstream never tests carry no such
obligation; there, match the _behavior_ but write idiomatic TypeScript — do not
transcribe CPython internals for their own sake (e.g. leaking `__new__` into an
error string, or mirroring the `TypeError`-vs-`ValueError` split, in an
unknown-kwarg guard no test exercises). Faithful ≠ slavish.

## Sources of truth

- **Spec:** `python-ftfy/ftfy/` — the Python source submodule. Port it verbatim.
- **Acceptance criteria:** `python-ftfy/tests/` — port tests first,
  then implement until they pass. Keep filenames and test bodies as verbatim as
  TypeScript allows.
- **Master plan / detailed design:** see the TPPs in `_todo/` and `_done/`.

Record the upstream commit SHA before the first implementation commit and verify
`__version__ == "6.3.1"` so future drift is unambiguous.

## How we work: TPPs

This project uses **Technical Project Plans** to carry research, design decisions,
and next steps across sessions. See [docs/TPP-GUIDE.md](docs/TPP-GUIDE.md).

- Unfinished TPPs live in `_todo/`; completed TPPs move to `_done/`.
- Run `/tpp _todo/<file>.md` to resume work on a plan.
- Run `/handoff` when context runs low or a session ends, to update the TPP.
- Start sessions with `cla` (the `claude.sh` wrapper) so the TPP system prompt is
  injected — vanilla `claude` still works for non-TPP use.

## Commands

- Build: `npm run build` (tsdown — Rolldown-based, isolatedDeclarations for `.d.ts`)
- Test: `npm test` (Vitest; `test.each` for parametrized, `test.fails` for xfail-strict)
- Typecheck: `npm run typecheck` (`tsc --noEmit`)
- Regenerate data tables: `npm run gen` (`uv run scripts/gen_all.py` — provisions
  `wcwidth`, pins Python 3.12 → unidata 15.0.0). `npm run gen:check` re-runs codegen
  and asserts **no git diff** (parity guard; CI enforces it). Never hand-edit
  `src/generated/`.
- Sync upstream spec: `npm run upstream:sync` — updates the `python-ftfy`
  submodule to upstream `main` HEAD and regenerates copied fixtures/generated tables.

## Locked decisions

- **Scope:** full parity — all fixers, `guess_bytes`, `apply_plan`, `fix_file`, the
  `ftfy` CLI, `formatting.ts` (display width), and `explain_unicode`.
- **Runtime dependencies: zero.** Port CPython's `html.unescape` and `wcwidth`;
  embed all generated lookup tables. (npm `entities`/`wcwidth` diverge on edge cases.)
- **Module output:** dual ESM + CJS, `engines.node >= 22`.
- **tsconfig:** `module`/`moduleResolution: "nodenext"`, `target: "es2023"`, strict.
- **Codegen:** Python scripts that `import ftfy` and emit TS data files under
  `src/generated/` (byte-identical to Python). Do **not** hand-edit generated files.
- **Public compatibility:** preserve Python names that are part of the API
  (`fix_text`, `fix_and_explain`, `guess_bytes`, `apply_plan`, `TextFixerConfig`,
  `ExplanationStep`, `ExplainedText`, `__version__`). Keep snake_case config keys. The
  public API is **snake_case only — no camelCase aliases**; internal helpers with no public
  Python counterpart may use idiomatic camelCase. The package-root barrel (`src/index.ts`)
  re-exports **only** the python-public names — the camelCase helpers
  (`makeConfig`, `replace`, `configFromKwargs`, `registerFixers`, `tryFix`) stay
  module-internal.
- **License:** `Apache-2.0`. README, package.json, `NOTICE`, and `src/index.ts`
  must credit python-ftfy and Robyn Speer and link the upstream repo.

## Architecture (mirrors Python)

```
src/
  index.ts        ← ftfy/__init__.py   (public API + the two fix loops)
  config.ts        TextFixerConfig, Explanation types, FIXERS registry, makeConfig/replace/configFromKwargs
  fixes.ts        ← ftfy/fixes.py       (12 FIXERS + fix_encoding step; byte-fixers on binary strings)
  chardata.ts     ← ftfy/chardata.py    (regexes, maps, clues, html.unescape consumer)
  badness.ts      ← ftfy/badness.py     (BADNESS_RE, is_bad, badness)
  formatting.ts   ← ftfy/formatting.py  (display width; ported wcwidth)
  html-entities.ts CPython html/__init__.py unescape() + generated html5 dict
  cli.ts / bin.ts ← ftfy/cli.py         (hand-rolled argparse clone; exact error texts/exit codes)
  codecs/         Uint8Array⇄binary-string bridge, errors (DecodeError/EncodeError),
                  charmap, sloppy, strict utf8, utf8-variants, utf16
  generated/      committed codegen output (do NOT hand-edit)
scripts/          Python codegen (gen_*.py)
tests/            ported Vitest suites + test-cases/*.json + face.txt (copied verbatim)
```

## Parity pitfalls (read before porting)

- **Bytes boundary:** canonical byte type is `Uint8Array`. Inside the encoding-fix
  step, convert to a **binary string** (one char per byte) so Python's byte-level
  regexes port verbatim. Never pass binary strings to Unicode/codepoint helpers.
- **Strict decode is the control-flow backbone:** `decode()` must **throw** on any
  malformed/truncated/overlong/surrogate input — the fix loop relies on it. No
  silent-`�` mode except `test_russian_crash`.
- **Error messages are API:** CLI tests compare full stderr/stdout. Keep
  `DecodeError`/`EncodeError` fields separate from their formatted message.
- **UTF-8:** do not use `TextDecoder` — hand-write the strict incremental step
  machine; export `IncrementalDecoder`.
- **Surrogate regexes:** compiled **without** the `u` flag (match lone surrogate
  code units); `convert_surrogate_pair` uses `charCodeAt`.
- **`translate()` over astral chars:** iterate by codepoint, not code-unit `.replace`.
- **Regex `lastIndex`:** JS global regexes carry mutable state; clone or reset when
  used as predicates in loops. Python regex objects do not.
- **Length semantics:** `String.length` is UTF-16 code units; Python `len(str)` is
  codepoints. Classify every length comparison as parity-sensitive or
  segmentation-only before implementing.
- **`explain_unicode` is `async` in the port** (lazy-loads the names table) — the
  lone sync→async divergence.
- **Unicode-version skew:** codegen Python's `unidata_version` vs Node's bundled
  ICU can diverge for normalization/category/width. Record both in generated-file
  headers; guard with a drift test.
