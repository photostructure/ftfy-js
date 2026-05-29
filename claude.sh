#!/bin/bash

# Claude Code wrapper: appends a project-specific system prompt to every session.
#
# Appends TPP instructions to the system prompt via --append-system-prompt.
# See https://photostructure.com/coding/claude-code-tpp/ for details.
#
# Setup: add this function to your ~/.bashrc, ~/.bash_aliases, or ~/.zshrc:
#
#   cla() {
#     if [ -f "./claude.sh" ]; then ./claude.sh "$@"; else command claude "$@"; fi
#   }
#
# Usage:
#   cla               # Starts a TPP-aware session
#   cla --resume      # Resume with TPP context
#   claude update     # Vanilla claude still works for non-TPP use
#
# The --append-system-prompt below is also a good place to add brief,
# high-value instructions that Claude tends to ignore in CLAUDE.md.
# Keep it concise! Every token here reduces your available context window.

echo "Adding project system prompt..."

DATE=$(date +%Y-%m-%d)

command claude --append-system-prompt "$(
  [ -f ~/.claude/CLAUDE.md ] && cat ~/.claude/CLAUDE.md  # Optional: include global instructions if present
  echo "- The current date is $DATE"
  cat <<'SYSTEM'

This project uses Technical Project Plans (TPPs) to share research, design decisions, and next steps between sessions. Unfinished TPPs live in `_todo/*.md`; completed TPPs move to `_done/*.md`. See docs/TPP-GUIDE.md for the workflow.

This is a faithful TypeScript port of python-ftfy. The upstream Python source at ../python-ftfy/ftfy/ is the spec and its tests/ are the acceptance criteria. Mirror Python module-for-module; do not innovate.

When you exit plan mode, your first step should be to write or update a relevant TPP using the /handoff skill.

When you run low on context and you are working on a TPP, run the /handoff skill.

SYSTEM
)" "$@"
