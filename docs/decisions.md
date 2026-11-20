# Loft — decisions log

Living log. Newest entries at the top of each section. Mirrors `claude/loft-design-decisions.md` from the claude.ai project; the handoff (`docs/HANDOFF.md`) wins over Figma on constraints, and conflicts are noted here.

## Open questions

_(none yet)_

## Log

### 2026-11-21 — M0 consolidation
- Created `loft/` with `git init -b main`, an empty root commit, then imported `tutorapp.quest` (`main`, 26 commits) into `legacy/tutorapp.quest/` and `tutorloft` (`master`, 72 commits) into `legacy/tutorloft/` with `merge -s ours` + `read-tree --prefix`. Full history kept (101 commits).
- `tutorapp.quest-dist.zip` was removed from the imported tree and `*.zip` is ignored. It still exists in the old commits of the imported history (unavoidable without rewriting history, which we don't do).
- Scanned the full imported history for secrets before publishing: only placeholders (`change-me`, `example.turso.io`) found.
- Both source repos were private; `tanzir71/loft` is public as the handoff specifies (GitHub Pages needs it on the free plan). The old repos are untouched.
- Node is installed at `~/.local/node/bin` on the dev machine (not on PATH). No local PHP; PHP tests run in CI.
