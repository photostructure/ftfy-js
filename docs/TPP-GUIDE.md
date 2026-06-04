# Technical Project Plan (TPP) Guide

## What is a TPP?

A TPP is a living handoff document for complex work that may span multiple agent
sessions or multiple engineers.

Each engineer reads it, does work, documents discoveries, and updates the file
so the next engineer can continue without starting over.

Every bit of context in the TPP should help the next engineer succeed.

## Golden rule

A good TPP transfers expertise, not just instructions.

It should explain:

- What problem we are solving for users
- Which approaches were considered
- Which approaches failed, and why
- Which tests and edge cases reveal the problem
- How to adapt if nearby architecture changes

These same answers serve four readers: the next session, the reviewer of the PR, the engineer drafting release notes, and whoever inherits this code years from now. Write once; serve all four.

## Typical process

1. An issue is raised, initial design and research is done, and a TPP is created.
2. Engineer A works on the TPP and updates it with discoveries, challenges, and
   next steps.
3. Engineer B picks up where Engineer A left off, using the TPP to continue the
   work.
4. The cycle continues until the TPP is complete.
5. The completed TPP moves to `_done/`.

Update the TPP as progress is made. The file is the handoff.

## Where TPPs live

This project uses the **simple layout**:

- `_todo/`: unfinished TPPs
- `_done/`: completed TPPs

When a TPP is finished, move the file from `_todo/` to `_done/`. The filesystem
location is the source of truth for whether work is outstanding.

Filenames should be date-prefixed:

```text
YYYYMMDD-feature-name.md
```

> If this project later accumulates a large backlog, it can graduate to priority
> folders (`_active/`, `_p1/`…`_p4/`, `_done/`). It does not use them today.

## This project: a faithful python-ftfy port

`@photostructure/ftfy` is a straight, faithful TypeScript port of `python-ftfy`
(v6.3.1, Apache-2.0, by Robyn Speer). The guiding rule is **parity, not
innovation**: mirror Python module-for-module, function-for-function.

- The upstream Python source at `python-ftfy/ftfy/` is the **spec**.
- The upstream tests under `python-ftfy/tests/` are the **acceptance
  criteria** — port tests first, then implement until they pass.
- Build: `npm run build` (tsdown). Test: `npm test` (Vitest).
- See [CLAUDE.md](../CLAUDE.md) for the full architecture, locked decisions, and
  parity pitfalls.

A TPP here typically scopes one implementation wave or one tricky module (e.g.
the strict incremental UTF-8 decoder, the codegen tables, the CLI). When in
doubt, record which upstream Python file the work mirrors and which upstream test
proves it.

## Frontmatter

Use YAML frontmatter when scripts, dashboards, issue trackers, or backlog tools
need structured data. In the simple layout, frontmatter is optional and light.

```yaml
---
title: Strict incremental UTF-8 decoder
section: codecs
issue: https://github.com/photostructure/ftfy/issues/NN
---
```

Common fields:

- `title`: human-readable task title
- `section`: subsystem (e.g. `codecs`, `fixes`, `chardata`, `cli`, `generated`)
- `issue`, `forum`: links to discussion
- `shelved: true`: evaluated and deferred indefinitely

## Placeholder TPPs

Lower-priority work may start as a placeholder TPP: frontmatter plus a short
description. Do not add phases, alternatives, or task breakdowns until the work
is close enough to need real scoping.

```markdown
---
title: explain_unicode lazy-loading polish
section: generated
---

# TPP: explain_unicode lazy-loading polish

The Unicode name/category table is lazy-loaded via `await import()` on first
call. Revisit whether the algorithmic-name derivation (CJK/Hangul/Tangut) can
shrink the committed table further. Needs real scoping before work begins.
```

## Full TPP structure

```markdown
---
title: Feature name
section: Subsystem
---

# TPP: Feature name

## Summary

Short description of the problem, under 10 lines.

## Current phase

- [ ] Research & Planning
- [ ] Write and validate breaking tests (if relevant)
- [ ] Design alternatives and iterate to an optimal approach
- [ ] Breakdown of tasks
- [ ] Implementation of tasks
- [ ] Review & Refinement
- [ ] Final Integration verification
- [ ] Review

## Required reading

YOU MUST study these before continuing. Work may be rejected if you skip them.

- **[CLAUDE.md](../CLAUDE.md)**: project structure, local rules, test commands
- **[TPP-GUIDE.md](./TPP-GUIDE.md)**: this workflow
- The upstream Python file this work mirrors (under `python-ftfy/ftfy/`)
- The upstream test(s) that prove it (under `python-ftfy/tests/`)
- Add the source files that define the subsystem

## Description

Detailed context about the problem, under 20 lines.

## Lore

- Non-obvious details that will help the next engineer
- Prior gotchas that tripped up previous sessions
- Relevant functions, classes, constraints, and historical context
- Parity pitfalls (UTF-16 vs codepoint length, regex `lastIndex`, `u`-flag on
  surrogate regexes, binary-string byte fixers, strict-decode-throws control flow)

## Solutions

It is OK to be unsure. Mark uncertainty clearly so the next engineer knows what
to verify.

### Option A (preferred)

Describe the preferred approach. Include pros, cons, code snippets, and why this
approach is preferred when useful.

### Option B (alternative)

Describe any serious alternative and why it was rejected or deferred.

## Tasks

Each task should include:

- Clear deliverable
- Implementation details
- Integration points
- Verification command (e.g. `npm test -- bytes`, `npm run build`)
```

## Keeping TPPs useful

Do not let the TPP become a transcript. Trim redundant notes, stale observations,
and obvious commentary. Preserve the facts that will save the next session time.

Try to keep full TPPs under 400 lines. If that is impossible, split the work into
multiple TPPs.

## Handoff rules

When context is running low or the session is ending:

1. Re-read the TPP.
2. Mark completed tasks.
3. Update the current phase.
4. Add discoveries, gotchas, and failed approaches.
5. Clarify exactly what remains.
6. Trim redundancy before saving.

The next session should be able to run `/tpp _todo/file.md`, read the TPP, and
continue without asking what happened last time.
