/**
 * Port of `python-ftfy/tests/test_cli.py`.
 *
 * The CLI's stdout/stderr and exit codes are part of ftfy's observable
 * contract, so these run the *built* `dist/bin.js` as a subprocess (exactly how
 * the Python suite invokes the installed `ftfy` entry point) and compare the
 * combined output byte-for-byte.
 */

import { execFileSync } from "node:child_process";
import { EOL } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "vitest";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(THIS_DIR, "..");
const BIN = path.join(ROOT, "dist", "bin.js");
const TEST_FILENAME = path.join(THIS_DIR, "face.txt");

// os.linesep.join(["┒(⌣˛⌣)┎", ""])
const CORRECT_OUTPUT = ["┒(⌣˛⌣)┎", ""].join(EOL);

const FAILED_OUTPUT = [
  "ftfy error:",
  "This input couldn't be decoded as 'windows-1252'. We got the following error:",
  "",
  "    'charmap' codec can't decode byte 0x9d in position 4: character maps to <undefined>",
  "",
  "ftfy works best when its input is in a known encoding. You can use `ftfy -g`",
  "to guess, if you're desperate. Otherwise, give the encoding name with the",
  "`-e` option, such as `ftfy -e latin-1`.",
  "",
].join("\n");

interface CommandResult {
  status: number;
  output: string;
}

/** Run `node dist/bin.js <args>`, capturing combined stdout+stderr and the exit
 *  code (mirroring subprocess.check_output with stderr=STDOUT). */
function getCommandOutput(
  args: readonly string[],
  stdin?: Buffer,
): CommandResult {
  try {
    const out = execFileSync("node", [BIN, ...args], {
      input: stdin,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    return { status: 0, output: out.toString("utf-8") };
  } catch (err) {
    const e = err as {
      status: number | null;
      stdout?: Buffer;
      stderr?: Buffer;
    };
    const combined = Buffer.concat([
      e.stdout ?? Buffer.alloc(0),
      e.stderr ?? Buffer.alloc(0),
    ]);
    return { status: e.status ?? 1, output: combined.toString("utf-8") };
  }
}

beforeAll(() => {
  // The CLI tests run against the built bin entry point, like upstream.
  // Always rebuild: a stale dist/ would silently test old code.
  execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "ignore" });
}, 60_000);

describe("cli", () => {
  test("test_basic", () => {
    const { status, output } = getCommandOutput([TEST_FILENAME]);
    expect(status).toBe(0);
    expect(output).toBe(CORRECT_OUTPUT);
  });

  test("test_guess_bytes", () => {
    const { status, output } = getCommandOutput(["-g", TEST_FILENAME]);
    expect(status).toBe(0);
    expect(output).toBe(CORRECT_OUTPUT);
  });

  test("test_alternate_encoding", () => {
    const { status, output } = getCommandOutput([
      "-e",
      "sloppy-windows-1252",
      TEST_FILENAME,
    ]);
    expect(status).toBe(0);
    expect(output).toBe(CORRECT_OUTPUT);
  });

  test("test_wrong_encoding", () => {
    const { status, output } = getCommandOutput([
      "-e",
      "windows-1252",
      TEST_FILENAME,
    ]);
    // cli.py exits via sys.exit(1) on decode errors.
    expect(status).toBe(1);
    expect(output).toBe(FAILED_OUTPUT);
  });

  test("test_same_file", () => {
    const { status, output } = getCommandOutput([
      TEST_FILENAME,
      "-o",
      TEST_FILENAME,
    ]);
    // cli.py exits via sys.exit(1) on the same-file guard.
    expect(status).toBe(1);
    expect(output.startsWith("ftfy error:")).toBe(true);
    expect(output).toContain("Can't read and write the same file");
  });

  test("test_stdin", async () => {
    const { readFileSync } = await import("node:fs");
    const stdin = readFileSync(TEST_FILENAME);
    const { status, output } = getCommandOutput([], stdin);
    expect(status).toBe(0);
    expect(output).toBe(CORRECT_OUTPUT);
  });
});

// Not pinned by test_cli.py, but argparse behavior cli.py inherits; verified
// against `python -m ftfy.cli` with CPython 3.12 argparse semantics.
describe("argparse-clone edge cases", () => {
  test("short flags cluster: -ge sloppy-windows-1252", () => {
    const { status, output } = getCommandOutput([
      "-ge",
      "sloppy-windows-1252",
      TEST_FILENAME,
    ]);
    // -g overrides -e, so this guesses and succeeds.
    expect(status).toBe(0);
    expect(output).toBe(CORRECT_OUTPUT);
  });

  test("boolean long option rejects an explicit =value", () => {
    const { status, output } = getCommandOutput(["--guess=false"]);
    expect(status).toBe(2);
    expect(output).toContain(
      "argument -g/--guess: ignored explicit argument 'false'",
    );
  });

  test("a value-taking option will not consume `--` or an option as its value", () => {
    for (const args of [
      ["--encoding", "--", TEST_FILENAME],
      ["-e", "-g", TEST_FILENAME],
    ]) {
      const { status, output } = getCommandOutput(args);
      expect(status).toBe(2);
      expect(output).toContain("argument -e/--encoding: expected one argument");
    }
  });

  test("unknown flag exits 2", () => {
    const { status } = getCommandOutput(["--frobnicate"]);
    expect(status).toBe(2);
  });
});
