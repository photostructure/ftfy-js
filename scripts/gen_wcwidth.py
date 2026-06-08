"""
Generate src/generated/wcwidth-tables.ts.

`ftfy/formatting.py` delegates display-width measurement to the external
``wcwidth`` package (Jeff Quast's port of Markus Kuhn's wcwidth/wcswidth). Since
``@photostructure/ftfy`` ships with zero runtime dependencies, this script
imports the installed ``wcwidth`` package and emits the interval tables that
``src/formatting.ts`` ports the algorithm against.

We pin ``wcwidth==0.2.13``: this is the last release whose ``wcswidth`` is a
simple per-character sum (no grapheme clustering / Mc / virama logic) and whose
tables make every ``formatting.py`` doctest pass — notably the SOFT HYPHEN
(U+00AD) is zero-width, so ``monospaced_width('owl\\xadflavored') == 11``.
Newer wcwidth (0.7.x) changed both the algorithm and that width, breaking the
upstream doctests.

The tables are interval lists of ``(start, end)`` codepoint ranges. We emit the
three the algorithm consults at the latest ("auto") Unicode level:
  - ZERO_WIDTH       — the latest level (15.1.0)
  - WIDE_EASTASIAN   — the latest level (15.1.0)
  - VS16_NARROW_TO_WIDE — keyed only at "9.0.0"

The provenance banner additionally records the ``wcwidth`` package version and
the Unicode data version of the emitted tables (this generator's distinctive
requirement), so any drift is attributable.
"""

# /// script
# requires-python = "==3.12.*"
# dependencies = ["wcwidth==0.2.13"]
# ///

from __future__ import annotations

import sys
from pathlib import Path

# _gen_common configures sys.path on import; keep it before any ftfy import.
from _gen_common import REPO_ROOT, header

# _gen_common prepends a vendored ``.pyenv`` (used to satisfy ftfy's wcwidth dep
# for the bare-python3 codegen path) to sys.path. That vendored wcwidth may be a
# newer release with an incompatible table layout. This generator REQUIRES the
# PEP 723-pinned ``wcwidth==0.2.13`` provisioned by ``uv run``, so drop the
# ``.pyenv`` entry before importing wcwidth so uv's copy wins.
_pyenv = (REPO_ROOT / ".pyenv").resolve()
sys.path[:] = [p for p in sys.path if Path(p).resolve(strict=False) != _pyenv]

# When run from gen_all.py, an earlier `import ftfy` may have already imported a
# shadowing wcwidth (e.g. the vendored .pyenv 0.7.0) into sys.modules. Purge it so
# the import below re-resolves against the now-cleaned sys.path (uv's 0.2.13).
for _mod in [m for m in sys.modules if m == "wcwidth" or m.startswith("wcwidth.")]:
    del sys.modules[_mod]

import wcwidth  # noqa: E402
from wcwidth.table_vs16 import VS16_NARROW_TO_WIDE  # noqa: E402
from wcwidth.table_wide import WIDE_EASTASIAN  # noqa: E402
from wcwidth.table_zero import ZERO_WIDTH  # noqa: E402

_EXPECTED_WCWIDTH = "0.2.13"
if wcwidth.__version__ != _EXPECTED_WCWIDTH:
    raise SystemExit(
        f"gen_wcwidth: imported wcwidth {wcwidth.__version__}, expected "
        f"{_EXPECTED_WCWIDTH}. Run `uv run scripts/gen_wcwidth.py` (PEP 723 pins "
        f"it) and make sure the vendored .pyenv wcwidth isn't shadowing it."
    )

# The Unicode level the algorithm uses when unicode_version='auto' is the latest
# table key available. wcwidth picks this via max(list_versions()).
_LATEST_LEVEL = "15.1.0"
_VS16_LEVEL = "9.0.0"


def _emit_table(name: str, table: tuple) -> str:
    # `table` is a tuple/list of (start, end) integer pairs, already sorted
    # ascending and non-overlapping (required for binary search).
    rows = "\n".join(f"  [{lo}, {hi}]," for (lo, hi) in table)
    return f"export const {name}: ReadonlyArray<readonly [number, number]> = [\n{rows}\n];\n"


def _wcwidth_header(generator: str) -> str:
    """header() plus the wcwidth-specific provenance lines."""
    base = header(generator)
    extra = (
        f"// wcwidth package version: {wcwidth.__version__}\n"
        f"// wcwidth tables Unicode data version: {_LATEST_LEVEL} "
        f"(VS16 table: {_VS16_LEVEL})\n"
        "\n"
    )
    # Insert the extra provenance just before the trailing blank line of header().
    return base.rstrip("\n") + "\n" + extra


def main() -> None:
    body_parts = [
        "/**",
        " * Interval tables ported verbatim from the `wcwidth` package (pinned",
        " * 0.2.13). Each table is a sorted, non-overlapping list of inclusive",
        " * [start, end] codepoint ranges, consumed by a binary search in",
        " * formatting.ts. See scripts/gen_wcwidth.py for provenance.",
        " */",
        "",
        _emit_table("ZERO_WIDTH", ZERO_WIDTH[_LATEST_LEVEL]),
        _emit_table("WIDE_EASTASIAN", WIDE_EASTASIAN[_LATEST_LEVEL]),
        _emit_table("VS16_NARROW_TO_WIDE", VS16_NARROW_TO_WIDE[_VS16_LEVEL]),
    ]
    body = "\n".join(body_parts)
    # write_generated() prepends header(); we want the extended header instead, so
    # build the full content here and write directly via the same conventions.
    _write(body)


def _write(body: str) -> None:
    from _gen_common import GENERATED_DIR, REPO_ROOT

    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    path = GENERATED_DIR / "wcwidth-tables.ts"
    content = _wcwidth_header("gen_wcwidth.py") + body
    if not content.endswith("\n"):
        content += "\n"
    path.write_text(content, encoding="utf-8", newline="\n")
    print(f"wrote {path.relative_to(REPO_ROOT)} ({len(content)} bytes)")


if __name__ == "__main__":
    main()
