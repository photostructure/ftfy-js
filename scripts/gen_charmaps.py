"""
Generate src/generated/charmaps.ts — 256-entry single-byte decode tables.

Two families of tables are emitted:

- REAL_DECODING_STRINGS / REAL_DECODING_HOLES: the standard-library codecs that
  ftfy decodes with (latin-1, the iso-8859-* family, macroman, cp437, cp874, and
  windows-1250..1258). A byte that is *unassigned* in the encoding is a "hole":
  strict decoding must throw there. Holes are listed in REAL_DECODING_HOLES; the
  character stored at a hole position in the string is the Latin-1 fallback and
  is only a placeholder (consumers that hit a hole must throw, not use it).

- SLOPPY_DECODING_STRINGS: the "sloppy" codecs from ftfy.bad_codecs.sloppy, one
  per INCOMPLETE_ENCODINGS member. These fill holes with the Latin-1 codepoint of
  the same number and force byte 0x1A -> U+FFFD. They have no holes.

charmap.ts builds the *encode* maps at runtime by iterating 0..255 (last write
wins, matching codecs.charmap_build), so no encode tables are emitted here.
"""

# /// script
# requires-python = "==3.12.*"
# dependencies = ["wcwidth"]
# ///

from __future__ import annotations

# _gen_common configures sys.path (vendored deps + python-ftfy) on import, so it
# must come before any `ftfy` import.
from _gen_common import ts_string_literal, write_generated

import ftfy  # noqa: E402, F401  (registers the sloppy bad_codecs)
import ftfy.bad_codecs  # noqa: E402, F401
from ftfy.bad_codecs.sloppy import INCOMPLETE_ENCODINGS  # noqa: E402

# Standard single-byte codecs we emit "real" (hole-bearing) decode tables for.
# This is the union of the non-sloppy CHARMAP_ENCODINGS members and the distinct
# codecs behind INCOMPLETE_ENCODINGS (cp125x are aliases of windows-125x, so we
# key the canonical windows-/iso-/cp874 names and let the dispatcher alias).
REAL_ENCODINGS = [
    "latin-1",
    "iso-8859-2",
    "iso-8859-3",
    "iso-8859-6",
    "iso-8859-7",
    "iso-8859-8",
    "iso-8859-11",
    "macroman",
    "cp437",
    "cp874",
    "windows-1250",
    "windows-1251",
    "windows-1252",
    "windows-1253",
    "windows-1254",
    "windows-1255",
    "windows-1256",
    "windows-1257",
    "windows-1258",
]


def real_table(encoding: str) -> tuple[str, list[int]]:
    """Decode each byte 0..255; return (256-char string, sorted hole indices)."""
    chars: list[str] = []
    holes: list[int] = []
    for i in range(256):
        try:
            decoded = bytes([i]).decode(encoding)
        except UnicodeDecodeError:
            holes.append(i)
            decoded = chr(i)  # Latin-1 placeholder; strict decode throws here.
        assert len(decoded) == 1, (encoding, i, decoded)
        chars.append(decoded)
    return "".join(chars), holes


def sloppy_table(encoding: str) -> str:
    """The 256-char sloppy decode table (no holes; 0x1A -> U+FFFD)."""
    table = bytes(range(256)).decode("sloppy-" + encoding)
    assert len(table) == 256, (encoding, len(table))
    return table


def emit_string_record(name: str, items: list[tuple[str, str]]) -> str:
    lines = [f"export const {name}: Record<string, string> = {{"]
    for key, value in items:
        lines.append(f"  {ts_string_literal(key)}: {ts_string_literal(value)},")
    lines.append("};")
    return "\n".join(lines)


def emit_holes_record(name: str, items: list[tuple[str, list[int]]]) -> str:
    lines = [f"export const {name}: Record<string, readonly number[]> = {{"]
    for key, holes in items:
        if not holes:
            continue
        nums = ", ".join(str(h) for h in holes)
        lines.append(f"  {ts_string_literal(key)}: [{nums}],")
    lines.append("};")
    return "\n".join(lines)


def main() -> None:
    real_strings: list[tuple[str, str]] = []
    real_holes: list[tuple[str, list[int]]] = []
    for enc in sorted(REAL_ENCODINGS):
        table, holes = real_table(enc)
        real_strings.append((enc, table))
        real_holes.append((enc, holes))

    sloppy_strings: list[tuple[str, str]] = []
    for enc in sorted(INCOMPLETE_ENCODINGS):
        sloppy_strings.append(("sloppy-" + enc, sloppy_table(enc)))

    body = (
        "/**\n"
        " * Real single-byte decode tables, indexed by byte value (0..255).\n"
        " * Byte positions listed in REAL_DECODING_HOLES are unassigned: strict\n"
        " * decoding must throw there. The stored character is a Latin-1 placeholder.\n"
        " */\n" + emit_string_record("REAL_DECODING_STRINGS", real_strings) + "\n\n"
        "/** Unassigned byte positions per real encoding (strict decode throws). */\n"
        + emit_holes_record("REAL_DECODING_HOLES", real_holes)
        + "\n\n"
        "/**\n"
        " * Sloppy decode tables (Latin-1 base, real decode overlaid where it is not\n"
        " * U+FFFD, and byte 0x1A forced to U+FFFD). No holes.\n"
        " */\n" + emit_string_record("SLOPPY_DECODING_STRINGS", sloppy_strings)
    )
    write_generated("charmaps.ts", body, "gen_charmaps.py")


if __name__ == "__main__":
    main()
