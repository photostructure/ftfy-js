# Changelog

All notable changes to `@photostructure/ftfy` are documented here.

> **Versioning policy.** This package uses its own [semver](https://semver.org) line,
> independent of python-ftfy's version numbers. The npm `version` tracks _this package's_
> API stability (`0.x` until full parity, `1.0.0` once the ported test suite passes and
> the API is stable); the exported `__version__` separately records the upstream
> python-ftfy release being mirrored. Releases are cut by CI via
> `.github/workflows/build.yml` — the `version` in `package.json` is never edited by hand.

## Unreleased

### Provenance

- **Ports python-ftfy v6.3.1** — upstream commit
  `74dd0452b48286a3770013b3a02755313bd5575e` (2024-10-30). `__version__` is pinned
  to `"6.3.1"`; any future divergence from this upstream commit must be recorded
  here.

### Added

- Initial project scaffolding: dual ESM + CJS build (tsdown, isolatedDeclarations),
  Vitest, package exports map, `ftfy` bin stub, and Apache-2.0 attribution
  (LICENSE, NOTICE). Public surface is a placeholder exporting `__version__`.
