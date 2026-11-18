# tutorapp.quest

A single-page collaborative whiteboard with live chat. Open a room by URL, draw, add sticky notes and text boxes, and chat with other people in the same room. Room state is stored as JSON files by a small PHP script, so it runs on ordinary shared hosting.

## Features

- Pen and eraser drawing on an infinite canvas (Ctrl/Cmd + scroll to zoom, pan with the Move tool or right-click drag).
- Sticky notes and text boxes as editable overlays.
- Floating chat with optional Spacebar dictation using the Web Speech API (needs HTTPS or localhost).
- Rooms selected with `?room=<id>`; a Share button copies the link. Room names are remembered in browser localStorage.
- Presence list with editable, auto-generated usernames.
- Only the room creator can delete a room (ownership via a per-room key; the server stores its hash).
- Responsive layout with a condensed toolbar and menu below 1200px.

## Tech stack

Vite, React, TypeScript, Tailwind CSS, shadcn/ui (Radix), Vitest. Backend: `public/save.php`.

## Getting started

```bash
npm install
npm run dev
```

`npm run dev` serves `public/save.php` as a static file and does not execute PHP. The client falls back to localStorage for room state and presence, so drawing and chat work in one browser (including across tabs) but not across machines.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build into `dist/` |
| `npm run build:dev` | Development-mode build |
| `npm run preview` | Preview the build |
| `npm run lint` | ESLint |
| `npm test` | Vitest (single run) |

## Deployment

Built for PHP shared hosting.

1. `npm run build`.
2. Upload the contents of `dist/` to the web root, with `save.php` next to `index.html`.
3. Make sure PHP can create and write a `rooms/` directory in the web root.
4. Enable HTTPS so dictation works.

## Documentation

Architecture, the room JSON format and the `save.php` endpoints are described in [docs/HANDOFF.md](docs/HANDOFF.md).
