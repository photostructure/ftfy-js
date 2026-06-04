"""
Generate src/generated/mojibake-categories.ts.

ftfy.badness.MOJIBAKE_CATEGORIES maps category names to concatenated
character-class strings (with \\N{...} names already resolved). badness.ts
assembles BADNESS_RE from these by interpolating them into a verbose regex,
mirroring Python's ``.format(**MOJIBAKE_CATEGORIES)``.

We emit the category strings verbatim. Several contain literal range expressions
(e.g. ``\\xc0-\\xd1``, ``Ò-Ö``) where ``-`` is a regex range; the
escaping helper preserves them exactly.
"""

# /// script
# requires-python = "==3.12.*"
# dependencies = ["wcwidth"]
# ///

from __future__ import annotations

# _gen_common configures sys.path on import; keep it before any ftfy import.
from _gen_common import ts_string_literal, write_generated

import ftfy  # noqa: E402, F401
from ftfy.badness import MOJIBAKE_CATEGORIES  # noqa: E402


def main() -> None:
    lines = ["export const MOJIBAKE_CATEGORIES: Record<string, string> = {"]
    for key, value in MOJIBAKE_CATEGORIES.items():
        lines.append(f"  {ts_string_literal(key)}: {ts_string_literal(value)},")
    lines.append("};")
    body = (
        "/**\n"
        " * Character-class clue strings used to assemble BADNESS_RE in badness.ts.\n"
        " * Values are raw class bodies (\\N{...} resolved); interpolate inside `[...]`.\n"
        " */\n" + "\n".join(lines)
    )
    write_generated("mojibake-categories.ts", body, "gen_mojibake_categories.py")


if __name__ == "__main__":
    main()
