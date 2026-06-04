/*!
 * @photostructure/ftfy — CLI (port of ftfy/cli.py)
 *
 * Placeholder. The real argparse-clone CLI lands in a later wave; this file
 * exists so the build output contract (dist/cli.js, importable by tests) holds
 * from Wave 0 onward.
 */

import { __version__ } from "./index.js";

/** Entry point invoked by `bin.ts`. Returns the process exit code. */
export async function main(
  _argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  process.stdout.write(`ftfy ${__version__}\n`);
  return 0;
}
