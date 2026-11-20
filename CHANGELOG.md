# Changelog

Every milestone is a tagged release with a frozen GitHub Pages snapshot at `https://tanzir71.github.io/loft/m<N>/` (landing) and `…/m<N>/app/` (app). The format below feeds the `/milestones/` index: `## vX.Y.Z — M<N>: Title (YYYY-MM-DD)` followed by `- ` notes.

## v0.2.0 — M2: Rooms + board v1 (2026-11-21)
- Rooms by link or code (`K7P-42Q`): start one from the "+" sheet or the landing hero, join with a code and your name. Guest join on = walk in; off = the host gets a "wants to join" toast with Let in / Deny.
- Board v1 on a room op-log: pen (4 colours, smoothed), object eraser, sticky notes (4 colours), text, select and drag, pan and zoom (wheel, ctrl/⌘-scroll, pinch, space-drag), pages, undo/redo, keyboard shortcuts.
- Presence avatars, live named cursors, a "typing" lock on notes, and room chat as a minimised pill with unread count.
- Capacity 12 with a waiting line (the 13th person sees "This room is full · You're #1 in line" and gets in when a seat frees), and "Session ended" with a PNG download of the board.
- Pages preview: two tabs are two people (BroadcastChannel); the share popover opens the room as a guest in a new tab.

## v0.1.0 — M1: Landing + organisations page (2026-11-21)
- "Loft · landing v2" built section by section: nav, dot-grid hero with a working start-a-room / join-with-code block, hero visual, agents · how it works, one tab instead of, features 01–11, principles, organisations band, compare table, FAQ (8 equal-height cards), CTA and footer.
- "Loft · for organisations v2": identity, your link, documents, free vs branded, email-first buying, plans, FAQ and CTA, plus a plain contact form (posts to `/spaces/api/v1/contact` in production, opens a filled-in email on Pages).
- Text and layout are real HTML rendered at build time from one content file; only the product mockups are images (WebP, 476 KB total, lazy-loaded below the fold).
- Responsive down to 390 px with no horizontal scroll.

## v0.0.0 — M0: Consolidate, scaffold, pipeline (2026-11-21)
- One repo with the full history of `tutorapp.quest` and `tutorloft` under `legacy/`.
- npm workspaces: `apps/web`, `apps/landing`, `packages/{core,data,ui,board}`; TypeScript strict, ESLint, Vitest, Playwright smoke test.
- Design tokens for all four Figma brand modes generated from one JSON (`npm run tokens`); self-hosted Barlow Condensed, Inter, JetBrains Mono and Host Grotesk.
- App shell: 264 px side panel (≥1200), 56 px icon rail + drawer (768–1199), bottom tab bar (<768). Home first-run state on desktop and phone.
- Data layer: `LocalAdapter` (IndexedDB + BroadcastChannel) for Pages, `HttpAdapter` for the PHP API.
- CI (`ci.yml`) and Pages deploy (`pages.yml`) with frozen milestone snapshots.
