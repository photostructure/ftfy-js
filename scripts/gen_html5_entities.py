"""
Generate src/generated/html5-entities.ts.

This is CPython's ``html.entities.html5`` dictionary, emitted verbatim. It is the
input both for ftfy's ``_build_html_entities`` (ported at runtime in chardata.ts)
and for the ``unescape()`` named-reference longest-prefix loop (in html-entities.ts).

The dict includes both the ``&name;`` (semicolon-terminated) forms and the legacy
non-semicolon forms (e.g. ``"amp"`` as well as ``"amp;"``), and a handful of
values are two codepoints (combining sequences). We emit all of it, sorted by key
for a stable, diff-free output.
"""

# /// script
# requires-python = "==3.12.*"
# dependencies = ["wcwidth"]
# ///

from __future__ import annotations

import html.entities

# _gen_common configures sys.path on import (not strictly needed here, but keeps
# the header() version/commit lookups working).
from _gen_common import ts_string_literal, write_generated


def main() -> None:
    items = sorted(html.entities.html5.items())
    lines = ["export const HTML5_ENTITIES: Record<string, string> = {"]
    for key, value in items:
        lines.append(f"  {ts_string_literal(key)}: {ts_string_literal(value)},")
    lines.append("};")
    body = (
        "/**\n"
        f" * CPython html.entities.html5, verbatim ({len(items)} entries, sorted by key).\n"
        " * Keys include both `name;` and legacy non-semicolon forms; some values are\n"
        " * two codepoints. Consumed by unescape() and _build_html_entities (chardata.ts).\n"
        " */\n" + "\n".join(lines)
    )
    write_generated("html5-entities.ts", body, "gen_html5_entities.py")


if __name__ == "__main__":
    main()
