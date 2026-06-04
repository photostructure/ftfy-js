/*!
 * @photostructure/ftfy
 *
 * A faithful TypeScript port of python-ftfy (v6.3.1, Apache-2.0) by Robyn Speer.
 * https://github.com/rspeer/python-ftfy
 *
 * The design, heuristics, badness model, sloppy codecs, and UTF-8 variants are
 * all the work of the original author. This port mirrors python-ftfy
 * module-for-module; see CLAUDE.md and docs/DESIGN.md.
 *
 * Copyright PhotoStructure, Inc. and contributors.
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */

/**
 * The upstream python-ftfy version this package mirrors.
 *
 * This is intentionally the *upstream* version, not the npm package version
 * (which is tracked separately in package.json). It must equal the version in
 * `python-ftfy/ftfy/__init__.py` so future drift is unambiguous.
 */
export const __version__ = "6.3.1";
