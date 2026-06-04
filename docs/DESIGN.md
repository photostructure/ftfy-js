# Design & porting strategies — `@photostructure/ftfy`

This document holds the **detailed technical decisions and porting strategies** behind the
faithful TypeScript port of [`python-ftfy`](https://github.com/rspeer/python-ftfy) (v6.3.1,
Apache-2.0, by Robyn Speer). [CLAUDE.md](../CLAUDE.md) is the concise quick-reference and
[docs/TPP-GUIDE.md](TPP-GUIDE.md) is the workflow; this file is the "why" the TPPs link to.

**Guiding rule: parity, not innovation.** Mirror Python module-for-module,
function-for-function — including code that looks unusual because it encodes a Python
edge-case. The upstream `ftfy/` is the spec; upstream `tests/` are the acceptance criteria.

## Locked decisions (rationale)

- **Zero runtime dependencies.** Port CPython's `html.unescape` and the `wcwidth` package
  in-tree and embed all generated lookup tables. npm `entities`/`wcwidth` diverge from
  CPython on edge cases that the upstream tests pin, so a faithful port cannot use them.
- **Dual ESM + CJS, `engines.node >= 22`.** Built with tsdown (Rolldown-based,
  isolatedDeclarations for `.d.ts`). `sideEffects: false` so unused subsystems (notably the
  `explain_unicode` names table) tree-shake out.
- **Codegen, not hand-porting, for data tables.** `scripts/gen_*.py` `import ftfy` and emit
  TS data under `src/generated/` so tables are byte-identical to Python. A CI check re-runs
  codegen and asserts no git diff. Generated files are never hand-edited.
- **snake_case public API.** Preserve Python names that are part of the API (`fix_text`,
  `fix_and_explain`, `fix_encoding`, `fix_encoding_and_explain`, `fix_text_segment`,
  `fix_file`, `guess_bytes`, `apply_plan`, `explain_unicode`, `TextFixerConfig`,
  `ExplanationStep`, `ExplainedText`, `__version__`) and keep snake_case config keys. The
  public API is **snake_case only — no camelCase aliases.** Internal/private helpers with no
  public Python counterpart (e.g. `bytesToBinary`, `makeConfig`) may use idiomatic camelCase.

## The fixers

The `FIXERS` dict (`ftfy/__init__.py:78-91`) has exactly **12** members:
`unescape_html, remove_terminal_escapes, restore_byte_a0, replace_lossy_sequences,
decode_inconsistent_utf8, fix_c1_controls, fix_latin_ligatures, fix_character_width,
uncurl_quotes, fix_line_breaks, fix_surrogates, remove_control_chars`. `fix_encoding` is a
**separate step** with its own loop — not a `FIXERS` member. Two fixers
(`restore_byte_a0`, `replace_lossy_sequences`) operate on **bytes/binary strings**.

## Key porting strategies (the hard parts)

**Bytes boundary.** Canonical byte type is `Uint8Array` (what `encode` returns / `decode`
accepts). Inside the encoding-fix step, convert to a **binary string** (one char per byte,
`charCodeAt(i)===byte`) so Python's byte-level regexes (`ALTERED_UTF8_RE`, `LOSSY_UTF8_RE`,
`A_GRAVE_WORD_RE`, the utf8-variants matchers) port verbatim. `restore_byte_a0` and
`replace_lossy_sequences` are therefore typed `(bin: string) => string`. Use
`Buffer.from(u8).toString("latin1")` / `Uint8Array.from(s, c => c.charCodeAt(0))`. **Never**
pass these internal binary strings to Unicode-normalization or codepoint helpers.

**Strict decode is the control-flow backbone.** `_fix_encoding_one_step_and_explain` relies
on `bytes.decode("utf-8")` _throwing_ to reject candidate encodings. `decode(...)` must throw
`DecodeError` on any malformed/truncated/overlong/surrogate input. Never use a silent-`�`
mode in the fix loop. Only `test_russian_crash` uses an explicit `"replace"` mode.

**Error messages are API.** CLI tests compare full stderr/stdout text. Keep
`DecodeError`/`EncodeError` fields separate from their formatted message so the CLI can render
Python-compatible messages without string parsing. The real-windows-1252 decode error must
format exactly:
`'charmap' codec can't decode byte 0x9d in position 4: character maps to <undefined>`.

**UTF-8 / utf-8-variants.** Do **not** use `TextDecoder` — it can't report consumed-byte
counts or throw on a truncated final tail under streaming. Hand-write the strict incremental
UTF-8 step machine in `utf8.ts`, then port `_buffer_decode` / `_buffer_decode_step` /
`_buffer_decode_surrogates` in `utf8-variants.ts` over binary strings. Export
`IncrementalDecoder` (imported by `bytes.test.ts`, which splits input at every byte boundary
and expects identical output).

**Codegen tables.** `scripts/gen_*.py` emit:

- `charmaps.ts`: 256-entry decode tables — sloppy-\* (Latin-1 base, overlay real decode where
  `!=U+FFFD`, force `0x1A→U+FFFD`), real `windows-1252` (`null` at holes
  0x81/8D/8F/90/9D), hole-free `latin-1`/`iso-8859-2`/`macroman`/`cp437`, plus the rest of
  `INCOMPLETE_ENCODINGS` for `fix_file -e`. `charmap.ts` builds the encode map by iterating
  0..255 (last write wins, matching `codecs.charmap_build`).
- `encoding-regexes.ts`: per-encoding charlist strings + assembled `^[...]*$` sources;
  defensively escape `] \ ^ -` if present.
- `utf8-clues.ts` / `mojibake-categories.ts`: already-`\N{}`-resolved class strings;
  `BADNESS_RE` and `UTF8_DETECTOR_RE` are assembled in TS by string-interpolation mirroring
  Python's `.format()`, verbose whitespace/comments stripped at author time, `u` flag set.
  (`SURROGATE_RE`/`SURROGATE_PAIR_RE` compiled **without** `u` — they match lone surrogate
  code units.)
- `html5-entities.ts`: `html.entities.html5` dict. `_build_html_entities` (the `&name;`
  filter + uppercase variants) is ported at runtime in `chardata.ts`.
- `unicode-names.ts`: full Unicode name lookup + range-compressed `category` table, emitting
  only **explicitly-named** codepoints (~40–50k). See "explain_unicode" below.
- `WIDTH_MAP`/`CONTROL_CHARS`/`LIGATURES` built at runtime in `chardata.ts`
  (`String.fromCodePoint(i).normalize("NFKC")`, range loops, 22-entry literal).

Each generated file carries a deterministic header naming the generator, upstream ftfy
version, upstream commit SHA, the codegen Python's `unicodedata.unidata_version`, and (for
width tables) the exact `wcwidth` package version used. Generators sort keys and avoid
locale/platform-dependent formatting so the no-diff CI check is meaningful.

**`translate()` over astral chars.** Port `str.translate` by iterating **by codepoint**
(`for (const ch of text)`, `ch.codePointAt(0)` → `Map<number, string|null>`), not via
code-unit `.replace`. `null` → drop char.

**html.unescape exactness.** Port CPython `html/__init__.py`: `_charref` regex,
`_replace_charref`, `_invalid_charrefs` (`0x80→€`, `0x00→�`, …), `_invalid_codepoints`
(→ ""), out-of-range → `�`, named-entity longest-prefix-without-semicolon loop. Write its
tests first: `&#xffff;→""`, `&#xffffffff;→"�"`, `euro &#x80;→euro €`, `&#20x6;` unchanged.

**Data model.** `ExplanationStep = readonly [action, parameter]` (tuple — so
`expect(plan).toEqual([["apply","remove_terminal_escapes"], ...])` ports cleanly and
`apply_plan` indexes `step[0]/step[1]`). `ExplainedText = {text, explanation:
ExplanationStep[] | null}` (object — preserves `.text`/`.explanation`; Python
`text, plan = ...` becomes `const {text, explanation: plan} = ...`). `TextFixerConfig` is a
snake_case-keyed interface (Python: 16-field `NamedTuple`) + `makeConfig(overrides?)` defaults
factory; `_replace` → `{...config, x}`; public fns take `(text, configOrPartial?)`.
`configFromKwargs` emits a deprecation warning via `process.emitWarning` for `fix_entities`
(covered by `test_old_parameter_name`).

**Import cycle.** `fixes.ts` ↔ `index.ts`: import the module **namespace**
(`import * as ftfyIndex from "./index.js"`) and call lazily; never destructure at top level.
`FIXERS` lives in `config.ts`, referencing `fixes` via namespace.

**Regex state.** JS global regexes carry mutable `lastIndex`. Any regex used as a predicate in
a loop must avoid `g`/`y`, be cloned per use, or reset `lastIndex` explicitly. Python regex
objects have no such state.

## `explain_unicode` is async (the one intentional divergence)

Python's `explain_unicode` is synchronous and prints. Node has no built-in Unicode name
database, so a faithful, full-parity implementation needs a generated names table — naively
~3–4 MB of live heap. To stay memory-conservative for the common `fix_text`-only consumer:

- The names/category table lives in its own `generated/unicode-names.ts`, **lazy-loaded via
  `await import()` on first call**. A consumer who never calls `explain_unicode` pays **zero**
  added heap, and `sideEffects: false` lets bundlers drop it entirely.
- Codegen emits only **explicitly-named** codepoints (~40–50k); algorithmic names for CJK
  Unified Ideographs / Hangul syllables / Tangut ranges are derived at runtime (mirrors how
  CPython `unicodedata.name()` works), shrinking the table to ~0.5–1 MB and loaded on demand.
- Consequence: **`explain_unicode` is `async`** in the port — the lone, documented sync→async
  divergence. Its single doctest is updated to `await`.

## Parity pitfalls (must-handle)

- `fix_surrogates` regexes: **no `u` flag** (match lone surrogate code units);
  `convert_surrogate_pair` uses `charCodeAt`.
- `possible_encoding` anchoring: patterns are `^...*$`; `\n` is inside the class, so the only
  Python-vs-JS `$` difference is a trailing newline (Python `$` also matches before a final
  `\n`). Mirror `test_possible_encoding` (all 256 chars in latin-1) and add a `"x\n"` case.
- `fix_text` segmentation: split on `\n` (common path); cap by code units but never split a
  surrogate pair. (Codepoint-vs-code-unit length is the one documented, test-irrelevant
  divergence.)
- `fix_file`: read bytes, split keeping `\n` terminators, decode/guess per line, and
  **persist** the `unescape_html:"auto"→false` flip across lines (stateful, like Python).
- CLI: replicate argparse flags (`filename`, `-o/--output`, `-g/--guess`, `-e/--encoding`,
  `-n/--normalization`, `--preserve-entities`), exact error texts, exit code 1, and `os.EOL`
  line handling.
- `wcwidth`: port the Python `wcwidth` tables (zero-dep); verify `monospaced_width` doctests
  early — the one spot a naive port drifts. Record the source `wcwidth` version.
- `String.length` is UTF-16 code units; Python `len(str)` is codepoints. Classify every length
  comparison as "parity-sensitive" or "segmentation-only" before implementing.
- **Unicode-version skew:** codegen Python's `unidata_version` (15.0.0 on the current box) vs
  Node's bundled ICU can diverge for `normalize`, category, and width. Record both versions in
  generated headers; guard with a drift test (compare `process.versions.unicode` against the
  baseline) so drift surfaces as a known signal, not a mystery failure.

## Primary spec files (upstream)

- `python-ftfy/ftfy/__init__.py` — fix loops, config, public API
- `python-ftfy/ftfy/chardata.py` — regexes/maps/clues, most codegen
- `python-ftfy/ftfy/fixes.py` — 12 fixers + `fix_encoding` (incl. byte fixers)
- `python-ftfy/ftfy/badness.py` — BADNESS_RE
- `python-ftfy/ftfy/bad_codecs/utf8_variants.py` — incremental CESU-8/Java decoder
- `python-ftfy/ftfy/bad_codecs/sloppy.py` — single-byte table construction
- `python-ftfy/ftfy/formatting.py` — display width (delegates to `wcwidth`)
- `python-ftfy/ftfy/cli.py` — CLI flags/errors
- `python-ftfy/tests/` — acceptance tests + `test-cases/*.json` + `face.txt`
