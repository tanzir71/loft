# Loft

A free workspace for small teams who run things live: a shared board that opens PDFs and slides, chat with whoever is online, built-in audio, a space per group, scheduling with booking links, session plans, and invoices where every line links to the session it pays for. Agents (Claude, Codex) do the prep through a link and only ever create drafts.

- **Preview (GitHub Pages):** https://tanzir71.github.io/loft/ · app: https://tanzir71.github.io/loft/app/ · every milestone: https://tanzir71.github.io/loft/milestones/
- **Production:** landing `tanziro.com/loft`, app `tanziro.com/spaces` on PHP 8 + SQLite shared hosting.
- **Install on your hosting:** [`INSTALL.md`](INSTALL.md), step by step for Namecheap shared hosting (cPanel), about 20 minutes.
- **Plan:** [`docs/HANDOFF.md`](docs/HANDOFF.md) · decisions: [`docs/decisions.md`](docs/decisions.md) · design map: [`docs/design-map.md`](docs/design-map.md)

## Layout

```
apps/web        Vite + React 18 SPA (the app)
apps/landing    static landing + organisations page
packages/core   framework-free domain logic + tests
packages/data   DataAdapter: LocalAdapter (IndexedDB + BroadcastChannel) and HttpAdapter (PHP API)
packages/ui     tokens (4 brand modes), fonts, base components
packages/board  board engine
api/            PHP 8 + SQLite /api/v1 (production only, no Composer)
legacy/         tutorapp.quest + tutorloft with full history (read-only reference)
```

## Develop

Node ≥ 20. One lockfile at the root (npm workspaces).

```bash
npm install
npm run dev          # app at http://localhost:5173
npm run dev:landing  # landing at http://localhost:5174
npm run check        # tokens up to date + typecheck + lint + unit tests
npm run build:pages -- --milestone 0 && npm run e2e   # Pages build + Playwright smoke test
```

`npm run tokens` regenerates `packages/ui/src/tokens.css` from `packages/ui/tokens.json` (values copied once from the Figma variables).

## Releases

Each milestone M<N> is tagged `v0.N.0`. The tag triggers `.github/workflows/pages.yml`, which deploys the latest build to `/loft/` and freezes a snapshot at `/loft/m<N>/`.
