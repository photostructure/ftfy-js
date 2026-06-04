"""
Run every ftfy-js codegen step and copy the upstream test fixtures.

Usage:  python3 scripts/gen_all.py

Running this must produce no git diff (CI re-runs it and asserts the tree is
clean). It regenerates every file under src/generated/ and re-copies the upstream
test fixtures verbatim, so any drift from python-ftfy surfaces as a diff.
"""

# /// script
# requires-python = "==3.12.*"
# dependencies = ["wcwidth"]
# ///

from __future__ import annotations

import shutil

from _gen_common import PYTHON_FTFY_SRC, REPO_ROOT

import gen_charmaps
import gen_encoding_regexes
import gen_html5_entities
import gen_mojibake_categories
import gen_unicode_names
import gen_utf8_clues

GENERATORS = [
    gen_charmaps,
    gen_encoding_regexes,
    gen_utf8_clues,
    gen_mojibake_categories,
    gen_html5_entities,
    gen_unicode_names,
]


def copy_fixtures() -> None:
    """Copy upstream test fixtures byte-for-byte into tests/."""
    src_tests = PYTHON_FTFY_SRC / "tests"
    dst_tests = REPO_ROOT / "tests"

    dst_cases = dst_tests / "test-cases"
    dst_cases.mkdir(parents=True, exist_ok=True)
    for f in sorted(dst_cases.glob("*.json")) + [dst_cases / "README.md"]:
        if f.exists():
            f.unlink()

    for f in sorted((src_tests / "test-cases").glob("*")):
        if f.suffix == ".json" or f.name == "README.md":
            shutil.copyfile(f, dst_cases / f.name)
            print(f"copied tests/test-cases/{f.name}")

    shutil.copyfile(src_tests / "face.txt", dst_tests / "face.txt")
    print("copied tests/face.txt")


def main() -> None:
    for gen in GENERATORS:
        gen.main()
    copy_fixtures()


if __name__ == "__main__":
    main()
