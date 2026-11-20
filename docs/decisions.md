# Loft — decisions log

Living log. Newest entries at the top of each section. Mirrors `claude/loft-design-decisions.md` from the claude.ai project; the handoff (`docs/HANDOFF.md`) wins over Figma on constraints, and conflicts are noted here.

## Open questions

_(none yet)_

## Log

### 2026-11-21 — M0 scaffold and pipeline
- **Toolchain versions:** Vite 7, React 18.3, TypeScript 6.0 (typescript-eslint supports < 6.1), ESLint 9, Vitest 5, Playwright 1.65. Vite 8 / TS 7 were skipped until the lint tooling supports them.
- **One root tsconfig** (`tsc -p tsconfig.json`, `noEmit`) instead of project references: fewer files, same strictness.
- **Tokens:** values copied once from the Figma variables into `packages/ui/tokens.json`; `npm run tokens` writes `tokens.css`, and `npm run check` fails when the CSS is stale. Modes are `[data-theme="loft|sunrise|northwind|aurelian"]`.
- **Conflict (Figma vs handoff):** the Figma variable `brand/domain` holds custom domains (e.g. `learn.sunriseacademy.edu.bd`). The handoff forbids custom domains, so that variable is **not** exported; branded orgs live at `tanziro.com/spaces/<org-slug>`.
- **Fonts:** latin-subset woff2 from Google Fonts (SIL OFL 1.1), self-hosted in `packages/ui/fonts` (≈148 KB total). Upright only.
- **Routing on Pages:** GitHub Pages serves a single root `404.html` for the whole site, so per-snapshot `404.html` copies cannot work for `/m<N>/app/`. Pages builds use `HashRouter` (`VITE_ROUTER=hash`); production uses `BrowserRouter` with `.htaccess`.
- **Snapshot storage:** `pages.yml` keeps every built site on a `gh-pages` branch (storage only; Pages itself deploys via `actions/deploy-pages`). Each tag adds `/m<N>/` and replaces the root "latest".
- **Data adapter additions to §7.1:** `subscribe()` (re-read on changes from any tab), `append()` (write ops; `sync()` only reads), `onSignal()` (receive side of `signal()`), and `presence(roomId, me, onPeers)` returns `{update, stop}` so the UI can move its cursor without re-subscribing.
- **Two tabs = two users:** IndexedDB is shared per origin, so the local adapter keeps an optional per-tab identity in `sessionStorage` (`setTabIdentity`). A guest joining in a second tab becomes a different user.
- **First run vs seeded demo data:** M0 seeds only the host (Nusrat Rahman, from the Figma persona), so Home shows the Figma first-run state. Demo spaces arrive with M3, consulting/team examples first.
- **No phone frame for first run** exists in Figma; the phone version reuses the desktop content stacked, with the header from "Host · Home (phone)".
- **Playwright:** only the Chromium headless shell is installed (smallest download).

### 2026-11-21 — M0 consolidation
- Created `loft/` with `git init -b main`, an empty root commit, then imported `tutorapp.quest` (`main`, 26 commits) into `legacy/tutorapp.quest/` and `tutorloft` (`master`, 72 commits) into `legacy/tutorloft/` with `merge -s ours` + `read-tree --prefix`. Full history kept (101 commits).
- `tutorapp.quest-dist.zip` was removed from the imported tree and `*.zip` is ignored. It still exists in the old commits of the imported history (unavoidable without rewriting history, which we don't do).
- Scanned the full imported history for secrets before publishing: only placeholders (`change-me`, `example.turso.io`) found.
- Both source repos were private; `tanzir71/loft` is public as the handoff specifies (GitHub Pages needs it on the free plan). The old repos are untouched.
- Node is installed at `~/.local/node/bin` on the dev machine (not on PATH). No local PHP; PHP tests run in CI.
