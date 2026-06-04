#!/usr/bin/env node
/*!
 * @photostructure/ftfy — `ftfy` executable.
 *
 * Thin shebang wrapper; all logic lives in cli.ts so tests can import it.
 */

import { main } from "./cli.js";

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  },
);
