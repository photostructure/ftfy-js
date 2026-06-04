import { defineConfig } from "tsdown";

// Dual ESM + CJS build with isolatedDeclarations-driven .d.ts.
// Build output contract (other TPPs depend on these paths):
//   dist/index.js  (ESM) / dist/index.cjs (CJS) — public API
//   dist/cli.js    — importable by tests
//   dist/bin.js    — shebang entry, the package `bin`
export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts", "src/bin.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  outDir: "dist",
  target: "es2023",
  tsconfig: "tsconfig.build.json",
  // tsdown defaults to .mjs/.cjs for dual builds. The package is `type: module`,
  // so ESM can use the bare `.js`/`.d.ts` that package.json and the contract above
  // point at; keep CJS on `.cjs`/`.d.cts`.
  outExtensions: ({ format }) =>
    format === "es"
      ? { js: ".js", dts: ".d.ts" }
      : { js: ".cjs", dts: ".d.cts" },
});
