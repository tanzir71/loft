# Changelog

Every milestone is a tagged release with a frozen GitHub Pages snapshot at `https://tanzir71.github.io/loft/m<N>/` (landing) and `…/m<N>/app/` (app). The format below feeds the `/milestones/` index: `## vX.Y.Z — M<N>: Title (YYYY-MM-DD)` followed by `- ` notes.

## v0.11.0 — M11: Live features over PHP (2026-11-21)
- Rooms over plain HTTP: the board op-log syncs every 1.5 s, presence every 5 s (30 s expiry, leaving frees the seat at once) and WebRTC signalling through `/signal`. No WebSocket server.
- P2P audio for up to 6 talking: mute, a speaking ring, and a seat note when talk is full.
- Stage mode for up to 12: the host speaks, people raise a hand, the host gives 60-second turns, and anyone without a turn is muted.
- Screen share for up to 6 viewers on its own connections. A still image every 3 s covers viewers whose connection fails. Annotations sync to everyone and clear 10 s after the share ends unless kept. Snapshot to board turns the frame and its strokes into a new board page.
- Open together: everyone gets a prompt to open the same link in their own browser (never embedded or proxied), and the host sees who opened it. Follow-me puts everyone on the host's view of the board.
- Admin → Calls & budget: P2P or the organisation's own SFU keys (Cloudflare Realtime, Daily, Jitsi), stored encrypted with only the last 4 characters shown; STUN/TURN servers; free minutes, a monthly budget and unit price, a daily pool, and 14 days of usage. At 80% of the pool you get a warning, at 100% audio-only, and after a 10-minute grace the host's own link. A live session is never cut. Routing media through the SFU isn't wired yet: it needs a real provider account to verify. Rooms use P2P and stage mode, and the host's own link beyond that.
- Reconnecting banner in rooms; call errors say what failed and what to do.

## v0.10.0 — M10: PHP backend + production on Namecheap (2026-11-21)
- A PHP 8 + SQLite API in `api/` (no Composer, no daemons, no cron) with every endpoint the app uses. It runs the same logic as the preview, ported module by module, and 80 PHP tests run in CI on PHP 8.2.
- The app talks to it through the HTTP adapter: session cookies, changes polled every 4 s (15 s in a background tab), JSON-only writes with a same-origin check, and 240 writes a minute per IP.
- First run: an install wizard (server checks, owner account, site address, an encryption key in `data/config.php`). Sign in with an email link (single use, 15 minutes) or an optional password; Settings for your name, time zone and password.
- Owner console: organisations with the branding toggle and paid-until date (active until paid-until + 14 days), notes, ending soon and asked-by-email flags, a change log and landing-form requests. Brand studio: set up name, monogram, one of four brand themes and where it applies while branding is off; publish once it's on.
- Server-only behaviour the preview simulates: invoices, reminders, receipts, nudges and calendar invites are emailed (invites as `.ics` with a stable UID and SEQUENCE); private calendar feeds; busy times from a host's iCal feed (cached, public addresses only); daily jobs on the first request of the day.
- The agent link protocol is live on the server: seats from the User-Agent, 60 requests a minute per seat, atomic claims, an audit log, and file uploads.
- Deploy: `loft-prod.zip` (landing → `/loft`, app → `/spaces`, API → `/spaces/api`, code and `data/` outside the web root) is attached to every release. `docs/deploy-namecheap.md` covers cPanel step by step; an FTP deploy action runs only if the owner adds secrets.
- Fix: opening a session's room again after it ended now gives the new room its own board pages.

## v0.9.0 — M9: Agents (2026-11-21)
- Agents page: one link (workspace, a space or a room) plus one line to hand prep to any agent; who's on your links (approve, revoke), what agents are working on, questions that need you (answer with a tap), drafts ready for you, and agent time this week.
- Prep tab in every space: the next session's prep status, ready / in progress / needs you / queued, templates (agenda, board from a brief, N-question check, recap, client-call agenda, invoice drafts) and a New prep task sheet with brief, attachments, ready-by time and agent.
- The agent link protocol (capabilities v1): next.md that starts with what an agent can do, claim, redacted context, drafts (plan, board ops, post, check, invoice draft), report, ask, changes; seats, approval, 60 requests a minute, pause, 30-day expiry. Documented in docs/agent-link.md.
- A draft layer in the room: agent board drafts show dashed with "draft by <agent>", only to the host, with an activity panel, Review and Pause agents.
- Ready for you: review each draft with a preview, accept all or some, reject with a reason the agent sees, or ask for changes.
- What agents read: the exact next.md / next.json for a link.
- Run the demo agent on the preview: a scripted agent works through a queued task with the same endpoints.

## v0.8.0 — M8: Insights, checks, states (2026-11-21)
- Insights: active members, attendance, homework on time and session length with change vs the previous period; a People table with last seen, last login, attendance, homework, fees and at-risk reasons; filters for At risk and Not seen 7 days; CSV export; a phone layout.
- Nudges: one-tap Nudge for anyone at risk (in-app, or open in WhatsApp), automatic nudges (deadline, missed 2 sessions in a row, fee overdue + 3 days, files not opened) run on the first visit of the day, and custom nudges to a group now or at a set time, with "this week" sent / opened / acted on.
- Quick checks in each course's Grades tab: one answer, several answers, true/false and short answer; time limit, close time, attempts, shuffle; auto-graded, with short answers you mark; results by member and by question.
- Integrity signals with tinyproctor.js (MIT, vendored, nothing leaves the page, no camera or screen): leaving the tab, switching windows, pasting and similar, summarised as Clean / Review / Flagged for the host. Signals never change a mark.
- Gradebook: tasks and checks per member with averages (missing work counts once due) and CSV export.
- System states: an offline banner, "Reconnecting… the board keeps working" in rooms, errors that say what failed with Try again and a way home, a "Couldn't send N invoices" state with Copy links, and the room-full host view.
- Fix: answers saved quickly one after another in a check could overwrite each other; attempt writes are now atomic.

## v0.7.0 — M7: Money (2026-11-21)
- Billing setup per space (hosts): per session, per hour (prorated to the cent), monthly, package or free; bill each member or the client once per session; who pays for whom (siblings on one invoice); late cancel, no-show and excused policy; monthly / after each session / when a package runs out; due days, next number and footer; a per-space payment link override.
- Session log: every wrap-up row with payer, minutes, status and amount; change a status and it re-prices from the policy (excused → $0 + a makeup credit); invoiced rows are locked; rows with no payer are highlighted; CSV export.
- Invoice runs: drafts are made automatically on the first visit on/after the 1st (or now, from the log), one per payer, with makeup credits applied. "Needs attention" for members with no payer, with an Add payer sheet. Send assigns LF-numbers, freezes the lines, notifies the payer in-app and gives one-tap WhatsApp links (WhatsApp is never sent for you).
- Invoice detail: every line links to its session and recap; Draft → Sent → Viewed → Payer says paid → Paid / Partly paid / Overdue / Void; activity, questions per line, edit lines (revision -B), discounts and fees, copy pay link, resend, void, and a printable A4/Letter page.
- Packages & credits: sell a package (credits start when it's paid), a ledger of purchases, uses and makeup credits, renewal drafts at a threshold, credit expiry.
- Confirm a payment: claims from payers with their note and reference, confirm with a receipt (RC-numbers), part payments, "Can't find it · ask" by DM, "Not received" with a reason (reminders resume), or mark paid without a claim.
- Reminders & overdue: −3 / 0 / +3 / +10 (final) days with per-step channels and an editable message; claims and pauses stop them; overdue payers with "Send nudge now" and Pause.
- The payer's pay page (phone-first, no sign-in): the invoice, the host's own payment link, "I've paid", questions, receipts and a PDF view. Money never touches Loft.

## v0.6.0 — M6: Plans (2026-11-21)
- Plans tab for hosts in every space (the workshop's "Agenda"): plans grouped by unit with coverage bars, Draft → Ready → Taught status, reordering, and a warning with a one-click template for unplanned upcoming sessions.
- New plan from blank, a template (lesson, workshop, sprint day, client session, retro) or a PDF (one block per page). Draft with AI stays hidden until an organisation adds its own key.
- Block editor: the timeline bar shows planned vs available time (free or over), six block types, what members see vs private host notes, resources, visibility, Alt+↑/↓ reorder, 800 ms autosave, version history with restore, and "Preview as member".
- Attach & prepare (idempotent): board pages in the session's room, the agenda posted 1 h before, a reminder 24 h before; "Open room" goes straight in.
- In the room, a host-only plan rail (current block, countdown, overrun, notes, time's-up prompt, "Start next block", "+2 min"); members only see "Now / next". The rail state is saved to the session.
- Wrap-up: what we covered, carry-over into the next plan, attendance prefilled from presence, homework, a recap post, and one `session_log` line per member at the space's price. Unwrapped sessions show as "Wrap-up pending" and get default lines after 24 h.

## v0.5.0 — M5: Scheduling (2026-11-21)
- Calendar with week, day and month views (agenda on phones): sessions in space colours, bookable hours shaded, booked calls and requests in lighter or dashed fills, a now line, drag to move (host) with "this / following / all" for series.
- New session or weekly series in one form, with a live clash check against your sessions and busy times and "skip date" for clashes.
- Availability (weekly hours, buffer, notice, max per day, horizon), busy times from a pasted iCal feed, and booking types (length, USD price or free, destination space, auto or manual approval).
- Public booking page at `/book/<handle>`: pick a type, a day and a time in your own time zone; approval or instant; honeypot; a no-login manage link to reschedule or cancel.
- Requests (moves, cancels, bookings) with "you're free / clash / late change" checks; approve or decline in one tap, and a decline suggests the next free times.
- `.ics` for every session (stable UID, SEQUENCE+1 on updates, METHOD:REQUEST/CANCEL) and a downloadable calendar feed; the legacy TutorLoft ICS test is ported.

## v0.4.0 — M4: Board v2 (2026-11-21)
- Flowchart shapes (process, rounded, start/end, decision, input/output, database, document, ellipse) with labels, fills, resize and four anchors each.
- Connectors: straight, elbow (≤2 bends) and curved (Bézier, 0.4 × distance controls); arrow/dot caps, dash, colour and labels; they re-route when shapes move. Quick-create arrows add a connected copy of a shape.
- Sections that carry their contents, multi-select with marquee, align · distribute · tidy up, smart guides, keyboard nudging and find on board (⌘F).
- Pen smoothing with perfect-freehand (raw points kept, slider 0–100%), pressure from a pen or stylus, highlighter, and shape recognition (rough box, circle or diamond → clean shape; undo restores the stroke).
- Diagram as code: flowchart, sequence, ERD and swimlane with a small layered auto-layout; a Mermaid flowchart subset; live editing; "Detach to freeform"; copy as Mermaid.
- PDF, slides and image import as board pages (rendered to WebP in the browser); export a page or section to PNG and pages or sections to PDF (A4) with no server.

## v0.3.0 — M3: Spaces, stream, hallway, inbox (2026-11-21)
- Demo workspace seeded on Pages (consulting and team spaces first, a course second); "Start with an empty workspace" in More shows the first-run state again.
- New space wizard with five modes (team, client, workshop, course, tutoring); each mode sets its tabs and labels.
- Space page: banner, join code, upcoming, and a stream with updates, recaps, must-read notices (who hasn't seen it + Remind them), tasks with hand-ins (mark done / return), files (upload, sha-256 dedupe), people and space chat.
- Hallway: DMs with presence, Knock and "Start a room together" (a room invite card lands in the DM); phone Chats lists live rooms, spaces and DMs.
- Home (hybrid, desktop and phone): room link card, Today, space cards, To review rail. Inbox (To review + Notifications), notifications bell with "Mark all read", search for people and spaces.

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
