"""
Generate src/generated/encoding-regexes.ts.

ftfy.chardata.ENCODING_REGEXES is a per-encoding regex that quickly tests whether
a string *could* have been decoded from that single-byte encoding. We emit two
things for chardata.ts to consume:

- ENCODING_REGEX_SOURCES: the verbatim Python pattern string for each encoding
  (``^[\\x00-\\x19\\x1b-\\x7f<charlist>]*$``). The runtime value equals Python's
  ``.pattern`` exactly; chardata.ts compiles it with the ``u`` flag. (Python ``$``
  also matches just before a trailing ``\\n``; chardata.ts handles that nuance.)

- ENCODING_CHARLISTS: the raw character list each non-ascii encoding contributes
  (bytes 0x80..0xFF then 0x1A, decoded), in case chardata.ts prefers to assemble
  the class itself.

Key order is ascii first, then CHARMAP_ENCODINGS — matching python-ftfy.
"""

# /// script
# requires-python = "==3.12.*"
# dependencies = ["wcwidth"]
# ///

from __future__ import annotations

# _gen_common configures sys.path on import; keep it before any ftfy import.
from _gen_common import ts_string_literal, write_generated

import ftfy  # noqa: E402, F401
from ftfy.chardata import CHARMAP_ENCODINGS, ENCODING_REGEXES  # noqa: E402

ORDER = ["ascii", *CHARMAP_ENCODINGS]


def charlist(encoding: str) -> str:
    """The characters bytes 0x80..0xFF and 0x1A decode to in this encoding."""
    byte_range = bytes([*range(0x80, 0x100), 0x1A])
    return byte_range.decode(encoding)


def emit_record(name: str, items: list[tuple[str, str]]) -> str:
    lines = [f"export const {name}: Record<string, string> = {{"]
    for key, value in items:
        lines.append(f"  {ts_string_literal(key)}: {ts_string_literal(value)},")
    lines.append("};")
    return "\n".join(lines)


def main() -> None:
    sources = [(enc, ENCODING_REGEXES[enc].pattern) for enc in ORDER]
    # ascii contributes no high-byte charlist; the others do.
    charlists = [(enc, charlist(enc)) for enc in CHARMAP_ENCODINGS]

    body = (
        "/**\n"
        " * Per-encoding `possible_encoding` regex sources, verbatim from python-ftfy.\n"
        " * Compile with the `u` flag. Order: ascii, then CHARMAP_ENCODINGS.\n"
        " */\n" + emit_record("ENCODING_REGEX_SOURCES", sources) + "\n\n"
        "/** Characters bytes 0x80..0xFF and 0x1A decode to, per CHARMAP_ENCODINGS. */\n"
        + emit_record("ENCODING_CHARLISTS", charlists)
    )
    write_generated("encoding-regexes.ts", body, "gen_encoding_regexes.py")


if __name__ == "__main__":
    main()
