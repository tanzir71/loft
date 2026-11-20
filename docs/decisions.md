# Loft — decisions log

Living log. Newest entries at the top of each section. Mirrors `claude/loft-design-decisions.md` from the claude.ai project; the handoff (`docs/HANDOFF.md`) wins over Figma on constraints, and conflicts are noted here.

## Open questions

1. **2× mockup images.** The Figma MCP export only returns images at 1× (it never upscales), so the landing mockups are 1× WebP and look slightly soft on retina screens. To ship 2×, either export the visuals listed in `docs/design-map.md` from Figma at 2× into `apps/landing/public/img/` (same file names, then `node scripts/to-webp.mjs`), or add a Figma personal access token as a repo secret so a script can call the REST images endpoint with `scale=2`.

## Log

### 2026-11-21 — M1 landing + organisations
- **Rendering:** both pages are static HTML generated at build time by a Vite plugin from `apps/landing/build/content.mjs` (copy + render functions). No framework on the landing; 2 KB of JS for the quick-start and contact forms. Icons are inlined from `lucide-react`'s icon data at build time.
- **Conflict (Figma vs handoff):** the landing's organisations band said "swaps in your logo, colours and domain" and listed "your domain, with SSL handled for you". The handoff forbids custom domains, so the copy now reads "logo, colours and name" and "your own link: tanziro.com/spaces/your-name" (matching the organisations page, which already said custom domains aren't offered).
- **Quick start:** "start" opens `app/#/r/new?name=&guests=1|0`; "join" accepts a bare code or a full `…/r/<code>` link and opens `app/#/join?code=&name=`. The guest name is remembered in `localStorage` (`loft.guestName`). Rooms themselves arrive in M2.
- **Contact form** lives on the organisations page under "how buying works" (the Figma note says the same fields work as a plain form). Production posts JSON to `/spaces/api/v1/contact` (M10); Pages opens a filled-in `mailto:`.
- **Landing fonts:** Host Grotesk + JetBrains Mono are copied into `apps/landing/public/fonts/` (51 KB) so the hero font can be preloaded with a stable URL.
- **Footer links** `privacy`/`terms` point at in-page anchors until those pages exist; `tack` points at tanziro.com/tack.

### 2026-11-21 — M0 released
- v0.0.0 is live at https://tanzir71.github.io/loft/ (snapshot `/m0/`). The first tag run failed at the gh-pages snapshot step (git identity set before `git init`); fixed on `main` and redeployed with `workflow_dispatch` (milestone 0) instead of moving the tag.
- M1 broken down into issues #1–#10 (label `m1`).

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
