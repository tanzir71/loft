# tutorapp.quest — Project Context (handoff)

This README is a compact handoff document capturing the project’s intent, architecture, data formats, and the major changes implemented during the build-out of the collaborative whiteboard + chat app.

## Product Summary

**tutorapp.quest** is a single-page, collaborative whiteboard with:
- Pen + eraser drawing on an infinite canvas
- Sticky notes and text boxes as editable overlays
- Floating live chat with optional Spacebar dictation (Web Speech API)
- Room-based collaboration via `?room=<id>`
- Simple presence (user list) per room

The app is designed to run on **Namecheap shared hosting** using a minimal **PHP backend** (`save.php`) that stores per-room JSON state on disk.

## Key User Flows

- **Create / join room**: open `https://yourdomain.com/?room=abc123` (or omit `room` to auto-generate).
- **Share**: Share button copies a link that includes the room ID.
- **Draw**: pen strokes persist to room state.
- **Add sticky**: click to place a sticky, type immediately, select to change color or delete.
- **Add text**: click to create a text box; select to move/resize; double-click to edit.
- **Chat**: floating live chat shows current user count and supports a clear button in expanded state.
- **Dictate**: hold Space to dictate into chat (HTTPS required).
- **Navigate rooms**: room names are saved in browser localStorage; switch via dropdown.
- **Delete room**: only the room creator can delete; link becomes invalid for everyone.

## Important Runtime Notes

- **Local dev (`npm run dev`) does not execute PHP**. `public/save.php` is served as a static file by Vite, so server persistence/collaboration won’t work locally.
  - The client includes a **localStorage fallback** for room state + presence to make development usable and to allow cross-tab “collaboration” on the same machine.
- **Web Speech API dictation** generally requires **HTTPS** (or `http://localhost`). On shared hosting, enable SSL.

## Frontend Architecture

- **Main page / orchestration**: [Index.tsx](../src/pages/Index.tsx)
  - Derives `roomId` from `?room=...` (or generates one)
  - Holds the canonical app state:
    - `canvasState` (`strokes`, `items`)
    - `messages` (chat)
    - `users` (presence list)
  - Saves/polls room state through `save.php` (or local fallback)
  - Handles:
    - Spacebar dictation (Web Speech API)
    - ESC switches to Move tool
    - Room list persistence + naming
    - Room deletion (creator-only)

- **Whiteboard canvas + overlays**: [Whiteboard.tsx](../src/components/whiteboard/Whiteboard.tsx)
  - Canvas drawing for strokes
  - Overlay items:
    - stickies (textarea overlay)
    - text boxes (select/move/resize + edit)
  - Infinite-canvas transforms:
    - CTRL/CMD + scroll zoom
    - pan via Move tool and right-click drag

- **Top chrome (brand/rooms/users/share + controls modal + mobile menu)**: [TopBar.tsx](../src/components/whiteboard/TopBar.tsx)
  - Brand text: `tutorapp.quest`
  - Rooms dropdown (desktop) and hamburger menu (mobile)
  - User avatars reflect real presence; click self to rename
  - “Controls” mini modal opens on load and can be reopened by clicking brand

- **Bottom toolbar (tools + mobile “more” stack)**: [Toolbar.tsx](../src/components/whiteboard/Toolbar.tsx)
  - Desktop: full controls
  - <1200px: condensed toolbar + chevron to open stacked options
  - Pen-only: color palette and stroke width controls

- **Chat overlay**: [ChatOverlay.tsx](../src/components/whiteboard/ChatOverlay.tsx)
  - Collapsed view becomes minimal on small widths
  - Expanded view includes clear button and “Hold Space to dictate” hint
  - Shows user count consistent with presence list

## Room + State Model

### Room identity

- Room is identified by URL query param: `?room=<id>`
- Valid IDs: `/^[a-zA-Z0-9_-]{1,64}$/`
- Share button always includes `?room=...`

### Local room list (browser)

- LocalStorage key: `tutorapp.rooms:v1`
- Stores up to 50 entries:
  - `id`: room id
  - `name`: user-chosen room name
  - `lastOpened`: timestamp
- Selecting a room changes the URL and reloads with the new room id.

### Presence (users list)

- Each client:
  - has a stable `clientId` per room (localStorage)
  - gets a random Google-Docs-style username like `lazypanda`, `humblepenguin` (editable)
- Presence is a TTL heartbeat (about 30 seconds) updated every ~5 seconds.

## Backend: save.php (Namecheap shared hosting)

PHP file: [save.php](../public/save.php)

### Storage layout

- Writes to `public/rooms/<room>.json`
- Creates `rooms/` directory if missing

### JSON format (RoomFileV1)

The core payload is versioned (`v: 1`) and includes:
- `room`: string
- `createdAt`, `createdBy`: set on first write
- `updatedAt`, `updatedBy`
- `canvas`: `{ strokes: Stroke[], items: TextItem[] }`
- `chat`: `ChatMessage[]`
- `users`: presence array (server-maintained TTL list)
- `deletedAt`, `deletedBy`: set when room is deleted

### Endpoints / modes

- `GET save.php?room=<id>`
  - `200` with room JSON if it exists and is not deleted
  - `404` if room file does not exist (typo / never created)
  - `410` if room was deleted
- `POST save.php?room=<id>` (full save)
  - Expects JSON payload including `canvas`, `chat`, `updatedBy`, plus `ownerKey`
  - Returns `{ ok: true, saved: <state>, isOwner: boolean }`
- `POST save.php?room=<id>&mode=presence`
  - Heartbeat presence update (requires room to exist)
- `POST save.php?room=<id>&mode=check_owner`
  - Returns `{ ok: true, isOwner: boolean }` for the provided `ownerKey`
- `POST save.php?room=<id>&mode=delete`
  - Creator-only deletion
  - Marks the room deleted and clears stored canvas/chat/users

### Creator-only deletion (ownership)

- Client generates and stores an **ownerKey** per room in localStorage:
  - `tutorapp-ownerkey:<roomId>`
- Server stores only `ownerHash = sha256(ownerKey)` inside the JSON file.
- Deletion requires the correct ownerKey; otherwise `403`.

## Mobile / Responsive Behavior

- The “mobile/condensed” layout is used below **1200px** via Tailwind `min-[1200px]:...` breakpoints.
- Top bar becomes a hamburger sheet with: share, controls, room list, users.
- Bottom toolbar shows core tools and a chevron to reveal extra controls stacked above.

## Deployment (Namecheap)

1. Build:
   - `npm run build` → outputs `dist/`
2. Upload:
   - Upload contents of `dist/` to `public_html/` (or your domain folder)
   - Ensure `save.php` is present in the web root next to `index.html`
3. PHP write permissions:
   - Ensure the server can create/write `rooms/` within the web root
4. HTTPS:
   - Enable SSL and use `https://` for dictation (Web Speech API)

An upload-ready zip is generated locally as:
- `tutorapp.quest-dist.zip` (contains `dist/*`)
