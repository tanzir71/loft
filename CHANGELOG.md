# Changelog

Every milestone is a tagged release with a frozen GitHub Pages snapshot at `https://tanzir71.github.io/loft/m<N>/` (landing) and `…/m<N>/app/` (app). The format below feeds the `/milestones/` index: `## vX.Y.Z — M<N>: Title (YYYY-MM-DD)` followed by `- ` notes.

## v0.0.0 — M0: Consolidate, scaffold, pipeline (2026-11-21)
- One repo with the full history of `tutorapp.quest` and `tutorloft` under `legacy/`.
- npm workspaces: `apps/web`, `apps/landing`, `packages/{core,data,ui,board}`; TypeScript strict, ESLint, Vitest, Playwright smoke test.
- Design tokens for all four Figma brand modes generated from one JSON (`npm run tokens`); self-hosted Barlow Condensed, Inter, JetBrains Mono and Host Grotesk.
- App shell: 264 px side panel (≥1200), 56 px icon rail + drawer (768–1199), bottom tab bar (<768). Home first-run state on desktop and phone.
- Data layer: `LocalAdapter` (IndexedDB + BroadcastChannel) for Pages, `HttpAdapter` for the PHP API.
- CI (`ci.yml`) and Pages deploy (`pages.yml`) with frozen milestone snapshots.
