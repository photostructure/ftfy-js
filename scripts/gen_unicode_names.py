"""
Generate src/generated/unicode-names.ts — the data behind explain_unicode().

explain_unicode() needs, for any codepoint, its general category and its Unicode
name (or "<unknown>"). Node has no Unicode name database, so we embed one. To
keep the table small (and tree-shakeable via lazy import), we emit only the
codepoints whose names are NOT algorithmically derivable, plus the metadata the
runtime needs to derive the rest:

- UNICODE_NAMES:  { codepoint -> name } for explicitly-named codepoints only.
- ALGORITHMIC_NAME_RANGES: [start, end, prefix] runs whose name is
  ``prefix + codepoint.toString(16).toUpperCase()`` (CJK ideographs, Tangut,
  Khitan, Nushu, compatibility ideographs, ...). Auto-discovered, so no
  hard-coded block list can drift from the Python unicodedata version.
- HANGUL_SYLLABLE_RANGE + the Hangul jamo tables: the runtime composes
  "HANGUL SYLLABLE <LVT>" for U+AC00..U+D7A3.
- UNICODE_CATEGORIES: range-compressed [start, end, category] over the whole
  codepoint space (unassigned runs collapse to "Cn").

The split is verified by construction: a codepoint is treated as algorithmic only
when our derivation reproduces unicodedata.name() exactly; anything else is
emitted explicitly, so the names can never be wrong — only the table size varies.
"""

# /// script
# requires-python = "==3.12.*"
# dependencies = ["wcwidth"]
# ///

from __future__ import annotations

import unicodedata

from _gen_common import ts_string_literal, write_generated

MAX_CP = 0x110000

# Hangul composition constants (Unicode 3.12, "Hangul Syllable Composition").
S_BASE = 0xAC00
L_COUNT = 19
V_COUNT = 21
T_COUNT = 28
N_COUNT = V_COUNT * T_COUNT  # 588
S_COUNT = L_COUNT * N_COUNT  # 11172
HANGUL_END = S_BASE + S_COUNT - 1  # 0xD7A3

JAMO_L = [
    "G",
    "GG",
    "N",
    "D",
    "DD",
    "R",
    "M",
    "B",
    "BB",
    "S",
    "SS",
    "",
    "J",
    "JJ",
    "C",
    "K",
    "T",
    "P",
    "H",
]
JAMO_V = [
    "A",
    "AE",
    "YA",
    "YAE",
    "EO",
    "E",
    "YEO",
    "YE",
    "O",
    "WA",
    "WAE",
    "OE",
    "YO",
    "U",
    "WEO",
    "WE",
    "WI",
    "YU",
    "EU",
    "YI",
    "I",
]
JAMO_T = [
    "",
    "G",
    "GG",
    "GS",
    "N",
    "NJ",
    "NH",
    "D",
    "L",
    "LG",
    "LM",
    "LB",
    "LS",
    "LT",
    "LP",
    "LH",
    "M",
    "B",
    "BS",
    "S",
    "SS",
    "NG",
    "J",
    "C",
    "K",
    "T",
    "P",
    "H",
]


def hangul_name(cp: int) -> str:
    """Compose the algorithmic HANGUL SYLLABLE name for cp in the syllable block."""
    s_index = cp - S_BASE
    lead = s_index // N_COUNT
    vowel = (s_index % N_COUNT) // T_COUNT
    trail = s_index % T_COUNT
    return "HANGUL SYLLABLE " + JAMO_L[lead] + JAMO_V[vowel] + JAMO_T[trail]


def main() -> None:
    explicit_names: list[tuple[int, str]] = []
    # Algorithmic codepoints, as (cp, prefix); compressed into runs afterwards.
    algo_points: list[tuple[int, str]] = []
    # (cp, category) for every codepoint, compressed into runs afterwards.
    categories: list[tuple[int, str]] = []

    for cp in range(MAX_CP):
        ch = chr(cp)
        categories.append((cp, unicodedata.category(ch)))

        name = unicodedata.name(ch, None)
        if name is None:
            continue

        if S_BASE <= cp <= HANGUL_END and name == hangul_name(cp):
            continue  # derived at runtime from the jamo tables

        hexsuffix = f"{cp:X}"
        if (
            name.endswith(hexsuffix)
            and len(name) > len(hexsuffix)
            and name[-len(hexsuffix) - 1] == "-"
        ):
            prefix = name[: -len(hexsuffix)]
            algo_points.append((cp, prefix))
            continue

        explicit_names.append((cp, name))

    # Compress algorithmic codepoints into [start, end, prefix] runs.
    algo_ranges: list[tuple[int, int, str]] = []
    for cp, prefix in algo_points:
        if algo_ranges and algo_ranges[-1][2] == prefix and algo_ranges[-1][1] == cp - 1:
            start, _end, p = algo_ranges[-1]
            algo_ranges[-1] = (start, cp, p)
        else:
            algo_ranges.append((cp, cp, prefix))

    # Compress categories into [start, end, category] runs.
    cat_ranges: list[tuple[int, int, str]] = []
    for cp, cat in categories:
        if cat_ranges and cat_ranges[-1][2] == cat and cat_ranges[-1][1] == cp - 1:
            start, _end, c = cat_ranges[-1]
            cat_ranges[-1] = (start, cp, c)
        else:
            cat_ranges.append((cp, cp, cat))

    out: list[str] = []

    out.append("/** Explicitly-named codepoints (algorithmic names are derived at runtime). */")
    out.append("export const UNICODE_NAMES: Record<number, string> = {")
    for cp, name in explicit_names:
        out.append(f"  {cp}: {ts_string_literal(name)},")
    out.append("};")
    out.append("")

    out.append(
        "/**\n"
        " * Inclusive codepoint runs whose name is\n"
        " * `prefix + cp.toString(16).toUpperCase()` (e.g. CJK ideographs).\n"
        " */"
    )
    out.append("export const ALGORITHMIC_NAME_RANGES: readonly [number, number, string][] = [")
    for start, end, prefix in algo_ranges:
        out.append(f"  [{start}, {end}, {ts_string_literal(prefix)}],")
    out.append("];")
    out.append("")

    out.append("/** Hangul syllable block; names composed from the jamo tables below. */")
    out.append(
        f"export const HANGUL_SYLLABLE_RANGE: readonly [number, number] = [{S_BASE}, {HANGUL_END}];"
    )
    out.append(f"export const HANGUL_S_BASE = {S_BASE};")
    out.append(f"export const HANGUL_N_COUNT = {N_COUNT};")
    out.append(f"export const HANGUL_T_COUNT = {T_COUNT};")
    out.append(
        "export const HANGUL_JAMO_L: readonly string[] = ["
        + ", ".join(ts_string_literal(x) for x in JAMO_L)
        + "];"
    )
    out.append(
        "export const HANGUL_JAMO_V: readonly string[] = ["
        + ", ".join(ts_string_literal(x) for x in JAMO_V)
        + "];"
    )
    out.append(
        "export const HANGUL_JAMO_T: readonly string[] = ["
        + ", ".join(ts_string_literal(x) for x in JAMO_T)
        + "];"
    )
    out.append("")

    out.append("/** Range-compressed general categories over the whole codepoint space. */")
    out.append("export const UNICODE_CATEGORIES: readonly [number, number, string][] = [")
    for start, end, cat in cat_ranges:
        out.append(f"  [{start}, {end}, {ts_string_literal(cat)}],")
    out.append("];")

    write_generated("unicode-names.ts", "\n".join(out), "gen_unicode_names.py")
    print(
        f"  explicit names: {len(explicit_names)}, "
        f"algo ranges: {len(algo_ranges)}, category ranges: {len(cat_ranges)}"
    )


if __name__ == "__main__":
    main()
