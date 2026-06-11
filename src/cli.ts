/*!
 * @photostructure/ftfy — CLI (port of ftfy/cli.py)
 *
 * A hand-rolled clone of the argparse-based command-line utility in
 * `ftfy/cli.py`. The flags, the error texts, and the exit codes are part of
 * ftfy's observable contract (`tests/test_cli.py` compares full stdout/stderr),
 * so this mirrors the Python source closely.
 *
 * A faithful port of python-ftfy by Robyn Speer (Apache-2.0).
 */

import * as fs from "node:fs";
import { EOL } from "node:os";
import * as path from "node:path";

import { DecodeError } from "./codecs/index.js";
import type { NormalizationForm } from "./config.js";
import { __version__, fix_file, TextFixerConfig } from "./index.js";

// These four blocks are copied verbatim from ftfy/cli.py — the CLI tests compare
// the rendered stderr byte-for-byte, so the wording and whitespace are API.

const ENCODE_ERROR_TEXT_UNIX = `ftfy error:
Unfortunately, this output stream does not support Unicode.

Your system locale may be very old or misconfigured. You should use a locale
that supports UTF-8. One way to do this is to \`export LANG=C.UTF-8\`.
`;

const ENCODE_ERROR_TEXT_WINDOWS = `ftfy error:
Unfortunately, this output stream does not support Unicode.

You might be trying to output to the Windows Command Prompt (cmd.exe), which
does not fully support Unicode for historical reasons. In general, we recommend
finding a way to run Python without using cmd.exe.

You can work around this problem by using the '-o filename' option in ftfy to
output to a file instead.
`;

const DECODE_ERROR_TEXT = `ftfy error:
This input couldn't be decoded as %r. We got the following error:

    %s

ftfy works best when its input is in a known encoding. You can use \`ftfy -g\`
to guess, if you're desperate. Otherwise, give the encoding name with the
\`-e\` option, such as \`ftfy -e latin-1\`.
`;

const SAME_FILE_ERROR_TEXT = `ftfy error:
Can't read and write the same file. Please output to a new file instead.
`;

/**
 * Parsed command-line arguments, mirroring the namespace argparse produces in
 * `ftfy/cli.py`.
 */
interface ParsedArgs {
  filename: string;
  output: string;
  guess: boolean;
  encoding: string;
  normalization: string;
  preserve_entities: boolean;
}

/** Raised by the argument parser to short-circuit `main` with an exit code. */
class ParserExit extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`parser exit ${code}`);
    this.code = code;
  }
}

const PROG = "ftfy";

const USAGE = `usage: ${PROG} [-h] [-o OUTPUT] [-g] [-e ENCODING] [-n NORMALIZATION] [--preserve-entities] [filename]`;

const HELP_TEXT = `${USAGE}

ftfy (fixes text for you), version ${__version__}

positional arguments:
  filename              The file whose Unicode is to be fixed. Defaults to -,
                        meaning standard input.

options:
  -h, --help            show this help message and exit
  -o OUTPUT, --output OUTPUT
                        The file to output to. Defaults to -, meaning standard
                        output.
  -g, --guess           Ask ftfy to guess the encoding of your input. This is
                        risky. Overrides -e.
  -e ENCODING, --encoding ENCODING
                        The encoding of the input. Defaults to UTF-8.
  -n NORMALIZATION, --normalization NORMALIZATION
                        The normalization of Unicode to apply. Defaults to NFC.
                        Can be "none".
  --preserve-entities   Leave HTML entities as they are. The default is to
                        decode them, as long as no HTML tags have appeared in
                        the file.
`;

/** Write an argparse-style usage error to stderr and signal exit code 2. */
function usageError(message: string): never {
  process.stderr.write(`${USAGE}\n${PROG}: error: ${message}\n`);
  throw new ParserExit(2);
}

/**
 * Parse `argv` into {@link ParsedArgs}, mirroring the subset of argparse that
 * `ftfy/cli.py` configures. Recognizes `-h/--help`, the value-taking options in
 * both `-x VALUE` and `-xVALUE`/`--long=VALUE` forms, the `--preserve-entities`
 * flag, and a single optional positional `filename`.
 */
function parseArgs(argv: readonly string[]): ParsedArgs {
  const args: ParsedArgs = {
    filename: "-",
    output: "-",
    guess: false,
    encoding: "utf-8",
    normalization: "NFC",
    preserve_entities: false,
  };

  const positionals: string[] = [];
  let sawDoubleDash = false;

  // Pull the value for an option that requires one, supporting `-e utf-8`,
  // `-eutf-8`, and `--encoding=utf-8` spellings.
  function takeValue(
    tokens: readonly string[],
    i: { v: number },
    optName: string,
    inlineValue: string | undefined,
  ): string {
    if (inlineValue !== undefined) return inlineValue;
    const next = tokens[i.v + 1];
    // argparse refuses to consume `--` or anything option-shaped as a value
    // ("expected one argument"); a bare `-` is a legal value (stdin/stdout).
    if (next === undefined || next === "--" || /^--?[a-zA-Z]/.test(next)) {
      usageError(`argument ${optName}: expected one argument`);
    }
    i.v += 1;
    return tokens[i.v]!;
  }

  const idx = { v: 0 };
  for (; idx.v < argv.length; idx.v++) {
    const token = argv[idx.v]!;

    if (sawDoubleDash) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      sawDoubleDash = true;
      continue;
    }

    if (token === "-h" || token === "--help") {
      process.stdout.write(HELP_TEXT);
      throw new ParserExit(0);
    }

    // Long options, with optional `=value`.
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      const name = eq === -1 ? token : token.slice(0, eq);
      const inline = eq === -1 ? undefined : token.slice(eq + 1);
      switch (name) {
        case "--output":
          args.output = takeValue(argv, idx, "-o/--output", inline);
          break;
        case "--guess":
          if (inline !== undefined) {
            usageError(
              `argument -g/--guess: ignored explicit argument '${inline}'`,
            );
          }
          args.guess = true;
          break;
        case "--encoding":
          args.encoding = takeValue(argv, idx, "-e/--encoding", inline);
          break;
        case "--normalization":
          args.normalization = takeValue(
            argv,
            idx,
            "-n/--normalization",
            inline,
          );
          break;
        case "--preserve-entities":
          if (inline !== undefined) {
            usageError(
              `argument --preserve-entities: ignored explicit argument '${inline}'`,
            );
          }
          args.preserve_entities = true;
          break;
        default:
          usageError(`unrecognized arguments: ${token}`);
      }
      continue;
    }

    // Short options. A single `-` is the stdin/stdout sentinel (a positional).
    // argparse allows clustering boolean shorts before a value-taking one
    // (`-ge latin-1` == `-g -e latin-1`, `-go x`, `-eutf-8`).
    if (token.startsWith("-") && token !== "-") {
      for (let c = 1; c < token.length; c++) {
        const flag = token[c]!;
        const rest = token.slice(c + 1);
        const inline = rest === "" ? undefined : rest;
        if (flag === "h") {
          process.stdout.write(HELP_TEXT);
          throw new ParserExit(0);
        } else if (flag === "g") {
          args.guess = true;
        } else if (flag === "o") {
          args.output = takeValue(argv, idx, "-o/--output", inline);
          break;
        } else if (flag === "e") {
          args.encoding = takeValue(argv, idx, "-e/--encoding", inline);
          break;
        } else if (flag === "n") {
          args.normalization = takeValue(
            argv,
            idx,
            "-n/--normalization",
            inline,
          );
          break;
        } else {
          usageError(`unrecognized arguments: ${token}`);
        }
      }
      continue;
    }

    positionals.push(token);
  }

  if (positionals.length > 1) {
    usageError(`unrecognized arguments: ${positionals.slice(1).join(" ")}`);
  }
  if (positionals.length === 1) {
    args.filename = positionals[0]!;
  }

  return args;
}

/** Python's `repr()` of a (simple) string: single-quoted with `\` and `'` escaped. */
function pyRepr(value: string): string {
  // ftfy only ever feeds an encoding name (or `None`) here. Mirror CPython's
  // preference for single quotes, switching to double quotes only when the
  // string contains a `'` but no `"`.
  const hasSingle = value.includes("'");
  const hasDouble = value.includes('"');
  const quote = hasSingle && !hasDouble ? '"' : "'";
  let body = value.replace(/\\/g, "\\\\");
  if (quote === "'") body = body.replace(/'/g, "\\'");
  return quote + body + quote;
}

/**
 * Read all bytes from a stream (stdin) and split them into lines that keep their
 * trailing `\n`, mirroring how Python iterates a binary file object. The final
 * line has no terminator if the input did not end in `\n`.
 */
function splitKeepEnds(bytes: Uint8Array): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      lines.push(bytes.subarray(start, i + 1));
      start = i + 1;
    }
  }
  if (start < bytes.length) {
    lines.push(bytes.subarray(start));
  }
  return lines;
}

/** Read the entirety of `process.stdin` as bytes. */
async function readStdin(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () =>
      resolve(new Uint8Array(Buffer.concat(chunks))),
    );
    process.stdin.on("error", reject);
  });
}

/** Best-effort `os.path.realpath`: resolve symlinks if the path exists, else
 *  fall back to an absolute path (matching Python's behavior on missing files). */
function realPath(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * Run ftfy as a command-line utility. Returns the process exit code (0 on
 * success, 1 on a handled decode/encode/same-file error, 2 on a usage error).
 *
 * Port of `ftfy.cli.main`.
 */
export async function main(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof ParserExit) return err.code;
    throw err;
  }

  let encoding: string | null = args.encoding;
  if (args.guess) {
    encoding = null;
  }

  // Read the input as bytes so it can be decoded as whatever encoding the user
  // requested (or guessed). `-` means standard input.
  let inputBytes: Uint8Array;
  if (args.filename === "-") {
    inputBytes = await readStdin();
  } else {
    inputBytes = new Uint8Array(fs.readFileSync(args.filename));
  }

  // Resolve the output sink. `-` means standard output; otherwise open a file,
  // refusing to overwrite the input.
  // Python writes to text-mode streams (stdout / `open("w")`), which translate
  // each "\n" in the string to the platform line separator. Mirror that so the
  // CLI emits CRLF on Windows like Python does. On POSIX this is a no-op.
  const translateEol = (text: string): string =>
    EOL === "\n" ? text : text.replace(/\n/g, EOL);

  // A sentinel for the (in practice unreachable on Node) case where the output
  // stream cannot represent the fixed Unicode — Python's `UnicodeEncodeError`
  // branch. Node always writes UTF-8 to stdout/files, so this path documents the
  // parity with cli.py rather than triggering in normal use.
  class OutputEncodeError extends Error {}

  let writeChunk: (text: string) => void;
  let closeOutput: (() => void) | undefined;
  if (args.output === "-") {
    writeChunk = (text) => {
      try {
        process.stdout.write(translateEol(text));
      } catch {
        throw new OutputEncodeError();
      }
    };
  } else {
    if (
      args.filename !== "-" &&
      realPath(args.output) === realPath(args.filename)
    ) {
      process.stderr.write(SAME_FILE_ERROR_TEXT);
      return 1;
    }
    const fd = fs.openSync(args.output, "w");
    writeChunk = (text) => {
      try {
        fs.writeSync(fd, Buffer.from(translateEol(text), "utf-8"));
      } catch {
        throw new OutputEncodeError();
      }
    };
    closeOutput = () => fs.closeSync(fd);
  }

  let normalization: string | null = args.normalization;
  if (normalization.toLowerCase() === "none") {
    normalization = null;
  }

  const unescape_html: "auto" | false = args.preserve_entities ? false : "auto";

  // The user-supplied normalization is passed through unchecked, like Python; an
  // unsupported form would surface later as a runtime error from `.normalize()`.
  const config = TextFixerConfig({
    unescape_html,
    normalization: normalization as NormalizationForm | null,
  });

  const lines = splitKeepEnds(inputBytes);

  try {
    for (const fixedLine of fix_file(lines, encoding, config)) {
      writeChunk(fixedLine);
    }
  } catch (err) {
    if (err instanceof OutputEncodeError) {
      // Mirrors cli.py's `except UnicodeEncodeError` around `outfile.write`.
      process.stderr.write(
        process.platform === "win32"
          ? ENCODE_ERROR_TEXT_WINDOWS
          : ENCODE_ERROR_TEXT_UNIX,
      );
      return 1;
    }
    if (err instanceof DecodeError) {
      // Python renders `%r % encoding`: a quoted repr for a real name, or bare
      // `None` when `-g` left the encoding unset (the guess path still threw).
      const encodingRepr = encoding === null ? "None" : pyRepr(encoding);
      process.stderr.write(
        DECODE_ERROR_TEXT.replace("%r", encodingRepr).replace(
          "%s",
          err.message,
        ),
      );
      return 1;
    }
    throw err;
  } finally {
    closeOutput?.();
  }

  return 0;
}
