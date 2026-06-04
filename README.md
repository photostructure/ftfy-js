# @photostructure/ftfy

**ftfy** ("fixes text for you") repairs mojibake and other Unicode glitches _after the
fact_ — the garbled text you get when bytes were decoded with the wrong encoding, when
HTML entities were left unescaped, when curly quotes and ligatures crept in, and so on.

```ts
import { fix_text } from "@photostructure/ftfy";

fix_text("âœ” No problems"); // → "✔ No problems"
fix_text("&macr;\\_(ã\x83\x84)_/&macr;"); // → "¯\_(ツ)_/¯"
fix_text("Ã©tÃ©"); // → "été"
```

## A faithful port of python-ftfy

This package is a **straight, faithful TypeScript port** of
[**python-ftfy**](https://github.com/rspeer/python-ftfy) (v6.3.1, Apache-2.0) by
**Robyn Speer**. All of the cleverness — the encoding-detection heuristics, the badness
model, the sloppy codecs, the CESU-8/Java UTF-8 variants — is theirs.

The guiding rule of this port is **parity, not innovation**: it mirrors the Python library
module-for-module and function-for-function, and is validated against python-ftfy's own test
suite. Where you see something that looks unusual, it almost certainly encodes a Python
edge-case we are deliberately preserving. If you find a behavioral difference from
python-ftfy that isn't documented as an intentional divergence, that's a bug — please report
it.

### Intentional divergences from Python

- **`explain_unicode` is `async`.** Node has no built-in Unicode name database, so the names
  table is lazy-loaded on first call (`await explain_unicode(...)`). This keeps it out of the
  heap entirely for the common case where you only call `fix_text`.
- **Length semantics.** JavaScript strings are UTF-16 code units; Python strings are
  codepoints. This only affects the maximum-segment-length cap in `fix_text`, never the
  fix output.

## Why this port exists

- **Zero runtime dependencies.** CPython's `html.unescape` and the `wcwidth` package are
  ported in-tree, and all lookup tables are embedded. (Existing npm equivalents diverge from
  CPython on edge cases the test suite pins.)
- **Dual ESM + CJS**, with full TypeScript types. Requires **Node.js ≥ 22**.

## Install

```sh
npm install @photostructure/ftfy
```

## Usage

The public API mirrors python-ftfy, including its `snake_case` names:

```ts
import {
  fix_text, // the main entry point
  fix_and_explain, // → { text, explanation } so you can see/replay each step
  fix_encoding, // just the encoding-repair step
  apply_plan, // replay an explanation onto the original text
  guess_bytes, // best-effort decode of unknown bytes
  fix_file, // fix a stream/file line by line
  TextFixerConfig, // per-call options (snake_case keys)
  __version__, // "6.3.1" — the upstream version this mirrors
} from "@photostructure/ftfy";
```

### CLI

```sh
ftfy somefile.txt                 # fix a file, write to stdout
ftfy -g somefile.txt              # guess the encoding
ftfy -e sloppy-windows-1252 in.txt -o out.txt
cat somefile.txt | ftfy           # read from stdin
```

## Versioning

This package follows **its own [semver](https://semver.org) line, independent of
python-ftfy's version numbers.** The npm `version` describes the stability of _this
package's_ API; the exported `__version__` separately records the upstream python-ftfy
release this port mirrors (currently `6.3.1`). The two move independently — a bugfix
release here bumps the npm version without changing `__version__`.

- **`0.x`** while the port is still reaching full parity with python-ftfy's test suite.
- **`1.0.0`** once parity is complete and the public API is stable.
- After that, ordinary semver: patch for fixes, minor for additive API, major for
  breaking changes — regardless of which version upstream is on.

Releases are cut entirely by CI ([`.github/workflows/build.yml`](.github/workflows/build.yml)
via `workflow_dispatch`); the `version` field in `package.json` is never edited by hand.

## Status

This is an in-progress, parity-driven port. Correctness is defined by python-ftfy's test
suite, which is ported alongside the implementation. See [docs/DESIGN.md](docs/DESIGN.md) for
the technical decisions and [CLAUDE.md](CLAUDE.md) for the architecture.

## Attribution & license

This is a derivative work of [python-ftfy](https://github.com/rspeer/python-ftfy) by Robyn
Speer, used and redistributed under the **Apache License 2.0**. See [LICENSE](LICENSE) and
[NOTICE](NOTICE). The TypeScript port is maintained by PhotoStructure; the upstream design
and algorithms are credited to the original author.
