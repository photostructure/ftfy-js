---
name: tpp
description: Work on a Technical Project Plan.
argument-hint: "[path-to-tpp]"
disable-model-invocation: false
allowed-tools: Bash, Read, Glob, Grep, Edit, Write, WebSearch, Skill
---

# Work on TPP

Make progress on the referenced Technical Project Plan.
Determine the current phase and take appropriate action.

## Required Reading First

Before any work, you MUST read:

- [CLAUDE.md](CLAUDE.md) — project structure, conventions, build/test commands
- [docs/TPP-GUIDE.md](docs/TPP-GUIDE.md) — the TPP workflow

This is a faithful TypeScript port of `python-ftfy`. The upstream Python source at
`python-ftfy/ftfy/` is the spec and its `tests/` are the acceptance
criteria — consult them as needed for the subsystem you are porting.

## Process

1. Read the referenced TPP. It lives in `_todo/` (unfinished work).
2. Identify the current phase.
3. Do the work for that phase.
4. Update the TPP with progress and discoveries.
5. When the TPP is complete, move it to `_done/`.
