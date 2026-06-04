---
title: Project scaffolding & packaging
section: build
---

# TPP: Project scaffolding & packaging

## Summary

Stand up the empty-but-buildable package: tsconfig, tsdown dual ESM/CJS build, Vitest,
package.json (exports map, `bin`, `engines>=22`, `sideEffects:false`, `files`), and the
attribution files (LICENSE, NOTICE, README already drafted). Everything else depends on this,
so it lands first and alone (Wave 0, single owner).

## Current phase

- [x] Research & Planning
- [x] Breakdown of tasks
- [x] Implementation of tasks
- [x] Final integration verification — **COMPLETE** (2026-05-29)

## Status: DONE

Empty-but-buildable package stands up cleanly. All exit criteria pass:
`npm run build`, `npm test`, `npx tsc --noEmit`, `npm pack --dry-run`, `attw --pack .`
(🌟 no problems, node10/node16-cjs/node16-esm/bundler all green), and `publint` (all good).

### What landed

- `package.json` — `@photostructure/ftfy`, Apache-2.0, `type: module`, dual
  `exports` (import→`.d.ts`/`.js`, require→`.d.cts`/`.cjs`), `bin.ftfy → dist/bin.js`,
  `engines.node >= 22`, `sideEffects: false`, `files: [dist, README, LICENSE, NOTICE,
  CHANGELOG]`. Scripts: `build` (tsdown), `test` (`vitest run`), `typecheck`, `gen`
  (`uv run scripts/gen_all.py`), plus `gen:check`, formatting/lint, and the `all` script
  added by the codegen TPP.
  npm package version is `0.0.0` (placeholder, tracked separately from upstream `__version__`).
- `tsconfig.json` — nodenext/es2023/strict, `noEmit`, `verbatimModuleSyntax`,
  `types: [node]`, includes src+tests+config files. `tsconfig.build.json` extends it with
  `isolatedDeclarations: true` + `outDir: dist`, src-only (tsdown uses this one).
- `tsdown.config.ts` — entries `index`/`cli`/`bin`, `format: [esm, cjs]`, `dts: true`,
  `clean: true`, `tsconfig: tsconfig.build.json`. tsdown auto-preserves bin shebang and chmod +x.
- `vitest.config.ts` — node env; `tests/smoke.test.ts` exercises `test.each` and passes (3 tests).
- `LICENSE` (full Apache-2.0 text), `NOTICE` (credits Robyn Speer / python-ftfy, pins upstream SHA).
- `src/index.ts` exports `__version__ = "6.3.1"` with attribution header.
  `src/cli.ts` exports `async main(): Promise<number>` placeholder; `src/bin.ts` is the
  shebang wrapper importing `cli.main`. ESM + CJS smoke imports both print `6.3.1`.
- `CHANGELOG.md` — records upstream provenance.

### Durable facts for the next engineers

- **Upstream pin:** python-ftfy v6.3.1, commit `74dd0452b48286a3770013b3a02755313bd5575e`
  (2024-10-30). Recorded in both `NOTICE` and `CHANGELOG.md`. `__version__` must stay `"6.3.1"`.
- **Local env when last validated:** Node v24.16.0 / npm 11.13.0 (engines floor is 22).
  Resolved dev deps: tsdown 0.22.0, vitest 4.1.6, typescript 6.0.3,
  @arethetypeswrong/cli 0.18.2, publint 0.3.21.
- **Build contract verified present:** `dist/index.js` (ESM), `dist/index.cjs` (CJS),
  `dist/cli.js` (+ `.cjs`, importable by tests), `dist/bin.js` (shebang `#!/usr/bin/env node`,
  executable). `.d.ts` + `.d.cts` emitted for each.
- **Build-output note:** current tsdown output emits stable entry files directly
  (`dist/index.{js,cjs}`, `dist/cli.{js,cjs}`, `dist/bin.{js,cjs}` plus declarations). If later
  implementation modules cause shared content-hashed chunks, that is acceptable as long as the
  contract entry files remain stable and attw/publint stay green.
- **isolatedDeclarations is live** in the build config: every exported function needs an
  explicit return type (e.g. `cli.main` is annotated `Promise<number>`). Design public APIs
  accordingly from the start.
- `.gitignore` already covers `node_modules/`, `dist/`, `*.tsbuildinfo`, `.pyenv/`.
- `scripts/gen_all.py` now exists (landed by the codegen TPP). Use `npm run gen` to refresh
  generated data and `npm run gen:check` to verify no generated drift.

## Required reading

- [CLAUDE.md](../CLAUDE.md) — locked decisions, commands
- [docs/DESIGN.md](../docs/DESIGN.md) — "Locked decisions (rationale)"
- [docs/TPP-GUIDE.md](../docs/TPP-GUIDE.md)
- `../python-ftfy/pyproject.toml` — license, scripts entry, version

## Description

The package must publish dual ESM + CJS with `.d.ts`, expose a `ftfy` bin, and ship only
`dist`, `README.md`, `LICENSE`, `NOTICE`, `CHANGELOG.md`. Build is **tsdown** (Rolldown-based,
isolatedDeclarations). Tests are **Vitest**. No source logic in this TPP — just a compiling,
testable, packable skeleton with a placeholder public surface.

## Lore

- `engines.node >= 22`; `module`/`moduleResolution: "nodenext"`, `target: "es2023"`, strict.
- isolatedDeclarations requires explicit return types on exported functions — design APIs
  with that in mind from the start.
- Build output contract (other TPPs depend on these paths): `dist/index.js` (ESM) /
  `dist/index.cjs` (CJS) expose the public API; `dist/cli.js` is importable by tests;
  `dist/bin.js` has the shebang and is the package `bin`.
- `__version__`/`version` exports must equal upstream `"6.3.1"`; the npm package version is
  tracked separately in package.json.
- Record the upstream python-ftfy commit SHA somewhere durable (CHANGELOG or a constant)
  before the first implementation commit.

## Tasks

1. **package.json** — name `@photostructure/ftfy`, `license: "Apache-2.0"`, `type: "module"`,
   `exports` for `import`/`require`/`types`, `bin: { ftfy: "dist/bin.js" }`, `engines.node
   > = 22`, `sideEffects: false`, `files`, scripts (`build`, `test`, `gen`).
Verify: `npm pkg get exports engines bin`.
2. **tsconfig.json / tsconfig.build.json** — nodenext, es2023, strict, isolatedDeclarations
   for the build config. Verify: `npx tsc --noEmit`.
3. **tsdown.config.ts** — dual format, `.d.ts`, entries for `index`, `cli`, `bin` (shebang).
   Verify: `npm run build` produces the four dist artifacts above.
4. **vitest.config.ts** — node environment; ensure `test.each`/`test.fails` work.
   Verify: a trivial `tests/smoke.test.ts` passes.
5. **LICENSE + NOTICE** — Apache-2.0 text; NOTICE credits python-ftfy / Robyn Speer and links
   upstream. (README + DESIGN already written.)
6. **Placeholder `src/index.ts`** exporting `__version__ = "6.3.1"` with the attribution
   header comment. Verify: ESM + CJS smoke imports print the version.

Exit criteria: `npm run build` and `npm test` both succeed from a clean checkout;
`npm pack --dry-run`, `attw`, and `publint` are clean.
