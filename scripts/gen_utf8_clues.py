"""
Generate src/generated/utf8-clues.ts.

ftfy.chardata.UTF8_CLUES maps clue names to concatenated character-class strings
(with \\N{...} names already resolved to characters). chardata.ts assembles
UTF8_DETECTOR_RE from these by interpolating them into a verbose regex, mirroring
Python's ``.format(**UTF8_CLUES)``.

We emit the five clue strings verbatim. They contain literal range expressions
such as ``\\x80-\\xbf`` (the ``-`` is a regex range, not a literal hyphen); the
escaping helper preserves the ``-`` and the surrounding characters exactly.
"""

# /// script
# requires-python = "==3.12.*"
# dependencies = ["wcwidth"]
# ///

from __future__ import annotations

# _gen_common configures sys.path on import; keep it before any ftfy import.
from _gen_common import ts_string_literal, write_generated

import ftfy  # noqa: E402, F401
from ftfy.chardata import UTF8_CLUES  # noqa: E402


def main() -> None:
    lines = ["export const UTF8_CLUES: Record<string, string> = {"]
    for key, value in UTF8_CLUES.items():
        lines.append(f"  {ts_string_literal(key)}: {ts_string_literal(value)},")
    lines.append("};")
    body = (
        "/**\n"
        " * Character-class clue strings used to assemble UTF8_DETECTOR_RE in chardata.ts.\n"
        " * Values are raw class bodies (\\N{...} resolved); interpolate inside `[...]`.\n"
        " */\n" + "\n".join(lines)
    )
    write_generated("utf8-clues.ts", body, "gen_utf8_clues.py")


if __name__ == "__main__":
    main()
