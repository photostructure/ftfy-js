---
name: handoff
description: Update TPP for engineer handoff when context is running low.
disable-model-invocation: false
allowed-tools: Read, Edit, Write, Glob
---

# TPP Handoff

We're out of time and need to hand off the remaining work.

## Required Reading First

Before any work, you MUST read:

- [CLAUDE.md](CLAUDE.md) — project structure, conventions, build/test commands
- [docs/TPP-GUIDE.md](docs/TPP-GUIDE.md) — the TPP workflow

This is a faithful TypeScript port of `python-ftfy`. The upstream Python source at
`python-ftfy/ftfy/` is the spec and its `tests/` are the acceptance
criteria.

## Your Task

1. Re-read the TPP and update progress.
2. Mark completed tasks, update the current phase.
3. Document discoveries, gotchas, and insights.
4. Record failed approaches and why they failed.
5. Clarify what remains and any blockers.
6. Trim redundancy so the file stays a useful handoff, not a transcript.

The TPP lives in `_todo/`. The next session should be able to run
`/tpp _todo/file.md`, read it, and continue without asking what happened last time.
