# Loft — Consolidation & Milestone Handoff (for Claude Code)

> Read this whole file before the first command. Then follow **§13 Loop protocol** every iteration.
> Owner: Tanzir (tanzir71 on GitHub). Folder: `~/Desktop/projects/tutor/` (contains both source repos).

---

## 0. TL;DR

1. Create **one new repo `tanzir71/loft`** that keeps the full git history of both sources:
   - `tutorapp.quest` (Vite + React whiteboard + chat, PHP `save.php`, branch `main`)
   - `tutorloft` (Next.js 16 LMS + billing, Drizzle + libSQL, Auth.js, branch `master`)
2. Build the new product **Loft** in that repo as a **static SPA + landing** (Vite + React + TS). The SPA has one data interface with two adapters:
   - `local`: IndexedDB plus BroadcastChannel. Used for **GitHub Pages** preview builds.
   - `http`: talks to a **PHP 8 + SQLite** `/api/v1`. Used for production on Namecheap shared hosting.
3. Ship **milestones M0–M12**. Every milestone ends with:
   - a tagged release `v0.N.0`
   - a working build on GitHub Pages at `https://tanzir71.github.io/loft/m<N>/`
   - `https://tanzir71.github.io/loft/` always showing the latest milestone.
4. Match the Figma file exactly (see §2). If the design and this doc disagree, **this doc's constraints win**, and you note the conflict in `docs/decisions.md`.

---

## 1. Product in one paragraph

Loft is a free workspace for **small teams** who run things live: client calls, workshops, classes, coaching, team meetings. It has:
- a shared board that opens PDFs and slides
- Slack-style chat with whoever is online
- built-in audio
- a Classroom-style space per group (stream, tasks, files, people)
- scheduling with booking links
- lesson and session plans
- invoices where every line links to the session it pays for
- agents (Claude, Codex) that do the prep through a link.

Only **branding** is paid, and it starts with an email, never a checkout. Production URLs: landing `tanziro.com/loft`, app `tanziro.com/spaces`.

---

## 2. Source of truth: Figma

File: https://www.figma.com/design/OvapmLmXJ0QmobXQA1mxNG/Tutor

| Page | What's there | Use it for |
|---|---|---|
| Foundations | Variables `Loft · Brand theme` (modes: Loft default, Sunrise, Northwind, **Aurelian** premium), text styles, components: Button, Badge, Avatar, App / Side panel (Active=Home/Calendar/Space/DM/Money/Insights/Agents/To review), App / Mobile tab bar | Tokens + base components |
| 03 · Workflows | session loop, architecture, call ladder, billing swimlane | Behaviour reference |
| 04 · Screens — host | Home, Live Room, Space stream, Hallway DM, Planner, Money, Insights, Brand studio (+ "branding off" state), Org admin (Calls, Integrations), **Owner console**, **Board v2** (desktop, tools spec, phone), **Board feature map**, **Room · screen share** | Desktop screens |
| 05 · Mobile | All host/participant/payer phone screens (390×844) | Phone screens |
| 06 · Schedule, plan & bill | Rows **A Planning P1–P6**, **B Invoicing I1–I7**, **C Scheduling S1–S5**. Desktop + phone. Every screen has a caption with **build rules** above it | Feature specs (read the captions!) |
| 06 · Landing pages | `Loft · landing v2 (tack pattern) · tanziro.com/loft` and `Loft · for organisations v2 · tanziro.com/loft/organisations` | Landing build |
| 07 · Onboarding, states & spec | Responsive spec, screen inventory (72 frames), sign-in, join with code, room full, session ended, first run, new space wizard, install, notifications, system states | States + breakpoints |
| 08 · Agents | Agent link, seats, prep queue, review (being designed) | M9 |

The project decisions doc (`claude/loft-design-decisions.md` in the claude.ai project) is mirrored into `docs/decisions.md` in M0. Keep it updated.

**Design rules that are easy to break:**
- **No italics anywhere. No serif fonts.**
- App type: Barlow Condensed (display, headings), Inter (body, UI), JetBrains Mono (meta, codes, amounts in tables).
- Landing type: Host Grotesk + JetBrains Mono (Tack pattern).
- All colours come from CSS variables generated from the Figma variable modes. A branded org = a different mode, with `brand/name` and `brand/monogram` as variables.
- Board dot grid must be **extremely subtle**: `canvas-dot` ≈ bg + 7.5% ink, dots with no strokes.
- Side-by-side cards share one height.
- Currency **USD**.
- Breakpoints:
  - ≥1200: 264px side panel
  - 768–1199: 56px icon rail + drawer
  - <768: bottom tab bar (Home · Chats · + · Inbox · More)

---

## 3. Hard constraints (do not violate)

1. **Production = Namecheap shared hosting**:
   - PHP 8.2 + PDO SQLite + cURL + OpenSSL + Sodium.
   - **No Composer packages, no daemons, no WebSockets, no cron.**
   - "Daily" jobs run on the **first request of each day** (store `last_daily_run` in `settings`).
2. **Preview = GitHub Pages** (static only). No server code runs there. Pages builds use the `local` adapter and show a slim banner: *"Preview build: data stays in this browser."*
3. **Small teams by design**:
   - Rooms hold **12 people max** (agents don't count).
   - Peer-to-peer audio for up to **6 talking**; stage mode up to 12.
   - Screen share up to **6 viewers**.
   - The 13th person joins a waiting line.
4. **Owner configures nothing per customer.** Every integration is optional and set by each org/host with their own keys: Daily, Cloudflare Realtime/TURN, AI key, payment links, SMTP. The app must fully work with all of them off.
5. **Branding** = one toggle + paid-until date in the owner console (`/spaces/owner`).
   - **No custom domains, no SSO promises, no checkout, no self-host licence.**
   - The branded link is `tanziro.com/spaces/<org-slug>`.
6. **Money never touches Loft.**
   - Invoices use the host's own payment link (same link / `{amount}` template / per payer).
   - Payers tap "I've paid"; the host confirms.
7. **Agents create drafts only**:
   - They never send messages, invoices or invites, and never confirm payments.
   - They never see payer contact details or DMs.
8. Keep the dependency footprint small.
   - The dev machine is a MacBook Air with limited storage: one root lockfile (npm workspaces), no duplicate node_modules.
   - Don't commit build zips (`tutorapp.quest-dist.zip` must not enter the new repo).
9. Secrets never committed. `.env*` ignored. Keys stored in the DB are encrypted with the key generated by the install wizard.

---

## 4. Target repo layout

```
loft/
├─ apps/
│  ├─ web/                 # Vite + React 18 + TS SPA (the app at /spaces, /app on Pages)
│  └─ landing/             # Vite multi-page static site (/loft and /loft/organisations)
├─ packages/
│  ├─ core/                # framework-free TS domain logic (ported from tutorloft/src/lib), vitest
│  ├─ data/                # DataAdapter interface + LocalAdapter (IndexedDB/BroadcastChannel) + HttpAdapter
│  ├─ ui/                  # tokens.css (generated), fonts, base components (Button, Badge, Avatar, Sheet, SidePanel, TabBar)
│  └─ board/               # board engine: op-log model, renderer, tools, connectors, smoothing, diagram-as-code
├─ api/                    # PHP 8 /api/v1 + SQLite (prod only). No Composer.
│  ├─ public/index.php     # single front controller; .htaccess rewrites
│  ├─ src/                 # small hand-written router, PDO, auth, modules
│  ├─ migrations/          # 001_init.sql … (ported from tutorloft/drizzle/0000_rare_romulus.sql + new tables)
│  └─ tests/               # plain PHP test runner (php tests/run.php), no PHPUnit
├─ legacy/
│  ├─ tutorapp.quest/      # full history, read-only reference, excluded from builds/lint
│  └─ tutorloft/           # full history, read-only reference, excluded from builds/lint
├─ docs/
│  ├─ HANDOFF.md           # this file
│  ├─ decisions.md         # living decisions log
│  ├─ api.md               # /api/v1 contract
│  ├─ agent-link.md        # agent protocol (capabilities v1)
│  └─ design-map.md        # Figma frame → route/component map
├─ .github/workflows/
│  ├─ ci.yml               # lint, typecheck, unit tests, php tests, build
│  └─ pages.yml            # build + deploy milestone to GitHub Pages
├─ package.json            # npm workspaces
└─ CHANGELOG.md
```

**Why a Vite SPA and not Next.js:** Next's server features (Auth.js, route handlers, Vercel cron) can't run on a PHP shared host or on GitHub Pages. TutorLoft's value is its **domain logic and tests** in `src/lib` + `tests/unit`. That gets ported into `packages/core` as pure TS. Its React pages are reference only.

**Why the board comes from tutorapp.quest:** `Whiteboard.tsx` (canvas + overlays, infinite pan/zoom), `Toolbar.tsx`, `TopBar.tsx`, `ChatOverlay.tsx` and `save.php` (room JSON, presence TTL 30s, owner hash) are the starting point for `packages/board` and the rooms API. Replace whole-room JSON saves with an **op-log** (`/sync?room=&since=seq`).

---

## 5. M0 commands: consolidate with full history

Run from `~/Desktop/projects/tutor/`. You need `gh auth status` to be logged in as tanzir71; if it isn't, stop and ask the owner to run `gh auth login`.

```bash
cd ~/Desktop/projects/tutor
mkdir loft && cd loft
git init -b main

# 1) tutorapp.quest → legacy/tutorapp.quest (history preserved)
git remote add quest https://github.com/tanzir71/tutorapp.quest.git
git fetch quest
git merge --allow-unrelated-histories -s ours --no-commit quest/main
git read-tree --prefix=legacy/tutorapp.quest/ -u quest/main
git rm -r --cached legacy/tutorapp.quest/tutorapp.quest-dist.zip 2>/dev/null || true
git commit -m "chore: import tutorapp.quest history into legacy/tutorapp.quest"

# 2) tutorloft → legacy/tutorloft (history preserved)
git remote add tl https://github.com/tanzir71/tutorloft.git
git fetch tl
git merge --allow-unrelated-histories -s ours --no-commit tl/master
git read-tree --prefix=legacy/tutorloft/ -u tl/master
git commit -m "chore: import tutorloft history into legacy/tutorloft"

git remote remove quest && git remote remove tl

# 3) create the new GitHub repo and push
gh repo create tanzir71/loft --public --source=. --remote=origin --push
```

Then:
- Add a `.gitignore` covering `node_modules`, `dist`, `.env*`, `api/data/*.sqlite`, `*.zip` and `.DS_Store`.
- In GitHub → Settings → Pages, set **Source = GitHub Actions** (`gh api -X POST repos/tanzir71/loft/pages -f build_type=workflow` works too).
- **Do not delete or archive the two old repos.** Add a line to each of their READMEs pointing to `tanzir71/loft` only if the owner asks.
- Log your actions to `docs/decisions.md`.

---

## 6. GitHub Pages pipeline

- Repo Pages URL: `https://tanzir71.github.io/loft/`
  - `/` = landing (latest)
  - `/app/` = SPA (latest)
  - `/m<N>/` and `/m<N>/app/` = frozen milestone snapshots
- Vite `base` comes from env: `BASE=/loft/` (latest) or `/loft/m<N>/` (snapshot).
- SPA routing on Pages: copy `index.html` to `404.html` in the app folder (or use HashRouter in Pages builds only, behind `VITE_ROUTER=hash`).
- `pages.yml`:
  1. On push of tag `v0.*`, build the landing + app with `VITE_ADAPTER=local`.
  2. Assemble `site/` = previous gh-pages content (keep the old `/m*/` folders) + the new latest at root + a new `/m<N>/` snapshot.
  3. Deploy with `actions/deploy-pages`.
  4. Keep an index page at `/milestones/` listing every milestone with date + notes (generated from `CHANGELOG.md`).
- Every Pages build:
  - shows the preview banner
  - uses seeded demo data (port `tutorloft/src/lib/seed.ts` ideas, but with consulting/team examples first, tutoring second)
  - has AI, email, uploads to server, and calls across devices **disabled or simulated**.
  - Cross-tab realtime works through BroadcastChannel, so two tabs = two users.

---

## 7. Architecture details

### 7.1 Data adapter (packages/data)
```ts
interface DataAdapter {
  auth: { me(): Promise<User|null>; requestLink(email): Promise<void>; signOut(): Promise<void> };
  query<T>(resource: string, params?: object): Promise<T>;     // REST-ish reads
  mutate<T>(resource: string, body: object): Promise<T>;        // writes
  sync(roomId: string, since: number): AsyncIterable<Op[]>;     // op-log stream (poll 1–2 s in http)
  presence(roomId: string, me: PresenceState): Unsubscribe;     // heartbeat 5 s, TTL 30 s
  signal(roomId: string, msg: SignalMsg): void;                 // WebRTC signalling (http: /signal polling; local: BroadcastChannel)
  files: { put(file, meta): Promise<FileRef>; url(ref): string };
}
```
- `LocalAdapter`: IndexedDB (via `idb` ~1KB) + BroadcastChannel.
- `HttpAdapter`: fetch to `/spaces/api/v1`.
- Pick the adapter with `VITE_ADAPTER`.

### 7.2 Board (packages/board)
- **Objects:** stroke (raw points + smoothing), sticky, text, shape (rect/rounded/pill/diamond/parallelogram/cylinder/document/ellipse), connector `{from:{id,anchor}|{x,y}, to, type: straight|elbow|curved, startCap, endCap, weight, dash, colour, label}`, section, image/pdf page, stamp.
- **Op-log:** `{seq, roomId, actor, ts, kind: add|update|remove|batch, payload}`. Last-writer-wins per object field. A text box locks while someone types (no CRDT).
- **Smoothing:** `perfect-freehand` (MIT, ~2KB).
- **Shape recognition** on pointer-up.
- **Connector routing:**
  - straight line
  - elbow (orthogonal, ≤2 bends)
  - curved (cubic Bézier, control points 0.4×distance along the anchor normals)
  - re-route on move.
- **Diagram as code:** `A > B: label` per line, plus parsers for flowchart, sequence, ERD and swimlane. Layered auto-layout (write it in-house, keep it small). "Detach to freeform" converts the diagram into normal board objects.
- **PDF import:** pdf.js in the browser renders pages to WebP and places them as board pages. Google Slides/Docs come in via their `/export/pdf` URL.
- **Export** a section or page to PNG/PDF in the browser.
- **Live cursors:** WebRTC data channel when a call is on; buffered polling otherwise.
- **Feature tiers** come from the Figma "Board feature map" (ship / next / optional PHP / not doing). Respect the "not doing" list.

### 7.3 Calls
- **Ladder:** own Meet/Zoom link → P2P audio (≤6 talking) → stage mode (host as hub, raise hand, 60s turns) → optional SFU/video with the org's own Cloudflare/Daily keys.
- **Daily budget cap:** pool/day = (free + budget ÷ unit price) ÷ days. Step-down at 80% → 100% → own link; 10-minute grace; never cut a live session.
- **Screen share:** `getDisplayMedia` over the same mesh (≤6 viewers).
  - Fallback for viewers whose connection fails: a still WebP every 3s.
  - Annotation layer on top + "snapshot to board".
- **"Open together":** push a link to everyone. Follow-me inside Loft.
- **No co-browsing proxy.**

### 7.4 PHP API (api/)
- **Front controller** `public/index.php` with `.htaccess` rewrite. Tiny router, PDO SQLite (WAL mode, `busy_timeout=3000`).
- **Auth:**
  - email sign-in link (32-byte token, single use, 15-minute expiry) via `mail()`
  - optional password
  - session cookie (HttpOnly, SameSite=Lax).
- **Rate limits** per IP and per agent seat (token bucket in SQLite).
- **Daily task** on first request: reminders, invoice drafts on/after the 1st, credit expiry, branding expiry notices, booking iCal busy-block refresh (≤ every 15 min).
- **Calendar invites:** `.ics` email attachments with the same UID and SEQUENCE+1 on updates; private per-person feed `GET /ics/<token>.ics`.
- **Files:** chunked upload with sha-256 dedupe, stored in `api/data/files/` outside the web root.
- **Install wizard** (first run):
  1. server checks
  2. owner account
  3. generate encryption key into `data/config.php`.
- **Owner console** `/spaces/owner`: organisations list, Branding toggle, paid-until date, note, change log. Branding is active while `today ≤ branded_until + 14 days`.

---

## 8. Data model (SQLite, api/migrations/001_init.sql)

Port from `legacy/tutorloft/src/db/schema.ts` + `drizzle/0000_rare_romulus.sql`:
users, invites, parentLinks, ratePlans, courses→spaces, enrollments→memberships, scheduleSlots, classSessions→sessions, attendance, invoices, invoiceItems, packagePurchases, payments, modules, materials, standards, quizzes, quizQuestions, quizAttempts, quizAnswers, announcements→posts, assignments→tasks, submissions, comments, progressReports, settings, activityLog.

Generalise names: course → space (with `mode`: team|client|workshop|course|tutoring). Then add these tables:

```
orgs(id, slug, name, theme_json, branded_until, owner_note, created_at)
spaces(id, org_id, mode, code, name, colour, room_slug, billing_json, created_at)
memberships(space_id, user_id, role: host|cohost|member|payer|guest, payer_user_id)
rooms(id, space_id, slug, capacity DEFAULT 12, guest_join INTEGER, created_by, ended_at)
ops(room_id, seq INTEGER, actor, ts, kind, payload_json, PRIMARY KEY(room_id, seq))
presence(room_id, user_id, state_json, last_seen)            -- TTL 30 s, pruned on read
waitlist(room_id, guest_name, joined_at)
messages(id, channel_type: space|dm|room, channel_id, user_id, body, created_at)
posts(id, space_id, kind, body_md, must_read, created_by, created_at) ; post_acks(post_id, user_id, at)
files(id, sha256, name, mime, bytes, owner_id, space_id)
series(id, space_id, rule_json, until, count)
sessions(id, space_id, series_id, title, starts_at_utc, minutes, room: loft|external, external_url, plan_id, status)
availability(user_id, tz, weekly_json, rules_json, busy_ical_url_enc)
busy_blocks(user_id, starts_at, ends_at)
booking_types(id, user_id, name, minutes, price_cents, dest_space_id|NULL, approval)
bookings(id, booking_type_id, session_id, guest_name, guest_email, status, manage_token)
change_requests(id, session_id, member_id, kind: move|cancel, proposed_starts_at, note, status)
plans(id, space_id, title, minutes, objective, tags_json, status: draft|ready|taught, version)
plan_blocks(id, plan_id, ord, title, type, minutes, member_text, host_notes, resources_json, visible)
session_log(id, session_id, member_id, payer_id, minutes, status, unit_price_cents, amount_cents, invoice_id)
ledger(id, member_id, space_id, kind: purchase|use|credit|expiry, qty, minutes, invoice_id, at)
claims(id, invoice_id, amount_cents, method, reference, note, status, decided_at)
reminders_sent(invoice_id, step, channel, at)
agent_links(id, owner_user_id, scope: workspace|space|room, scope_id, token_hash, expires_at, paused)
agent_seats(id, link_id, name, runtime, user_agent, approved, last_seen, revoked_at)
agent_tasks(id, link_id, space_id, session_id, template, inputs_json, ready_by, status, claimed_by_seat, report_md)
drafts(id, task_id, seat_id, kind: plan|board_ops|post|check|invoice, payload_json, status: pending|accepted|rejected)
notifications(id, user_id, kind, payload_json, read_at)
```

Money is stored in **cents (INTEGER)**. Times are stored in **UTC**; the time zone is applied in the client (Intl).

---

## 9. Porting map

| From | To | Notes |
|---|---|---|
| `legacy/tutorapp.quest/src/components/whiteboard/Whiteboard.tsx` | `packages/board/src/` | canvas + overlay model, pan/zoom; split into engine + React view |
| `…/Toolbar.tsx`, `TopBar.tsx`, `ChatOverlay.tsx` | `apps/web/src/room/` | restyle to Figma "Live Room — minimal" islands |
| `…/public/save.php` | `api/src/rooms/` | reference for presence TTL, owner hash, validation; replace whole-room JSON with op-log |
| `legacy/tutorloft/src/lib/billing.ts`, `payment-reminders.ts`, `invoice-delivery.ts` | `packages/core/billing/` | keep invoice numbering scheme but configurable prefix (`LF-`) |
| `…/lib/schedule.ts`, `ics.ts`, `calendar-feed.ts`, `session-routing.ts` | `packages/core/schedule/` + `api/src/ics/` | .ics generation must exist in PHP too |
| `…/lib/quizzes.ts`, `gradebook.ts`, `classroom.ts`, `content.ts`, `markdown.ts`, `standards.ts` | `packages/core/{checks,classroom,content}/` | |
| `…/lib/ai/*` | `packages/core/ai/` (prompt builders only) + `api/src/ai/proxy.php` | AI calls only via PHP proxy with the org's/host's own key; disabled on Pages |
| `…/lib/authz.ts`, `crypto.ts`, `login-rate-limit.ts`, `invites.ts` | `api/src/auth/` (PHP) + `packages/core/authz` | port the rules + tests |
| `…/tests/unit/*.test.ts` | `packages/core/**/*.test.ts` | keep every test that still applies; this is the quality floor |
| tinyproctorjs (`github.com/tanzir71/tinyproctorjs`) | `packages/core/checks/integrity` | vendor the small client (MIT?) after checking the licence |

Drop: next-auth, @vercel/blob, Vercel cron, Turso/libSQL client, the Next app router pages (keep them only as UI reference).

---

## 10. Milestones

Each milestone ends with the **Definition of done** in §11. Figma frame names are in quotes.

### M0: Consolidate, scaffold, pipeline
- [x] §5 consolidation with history; repo `tanzir71/loft` pushed.
- [x] npm workspaces; TS strict; ESLint; Vitest; Playwright (one smoke test).
- [x] `packages/ui`: generate `tokens.css` for all 4 modes from Figma variables (hard-code the values into a JSON once; script `npm run tokens` → CSS vars). Self-host woff2 for Barlow Condensed, Inter, JetBrains Mono, Host Grotesk.
- [x] App shell: desktop side panel (component "App / Side panel"), tablet rail, phone tab bar ("App / Mobile tab bar").
- [x] Empty states: "Home · first run (desktop)" and its phone version.
- [x] `ci.yml` + `pages.yml`. **Release v0.0.0 → Pages live** at `/loft/` with landing placeholder + app shell.

### M1: Landing + organisations page (static)
- [x] Build "Loft · landing v2" exactly. Sections in order:
  1. nav
  2. hero with **start-a-room / join-with-code** block
  3. hero visual
  4. **agents · how it works**
  5. one tab instead of
  6. features 01–11 (rooms, diagrams, files, calls, hallway, spaces, agendas, money, insights, checks, phones)
  7. principles ("Small on purpose")
  8. organisations band
  9. compare table
  10. FAQ (8 equal-height cards)
  11. CTA
  12. footer
- [x] Build "Loft · for organisations v2": email-first buying, the premium "Aurelian" mode mockups, `mailto:` CTA + plain contact form (form posts to `/spaces/api/v1/contact` in prod; on Pages it opens mailto).
- [x] Mockup images: export the Figma visuals as WebP (2×) into `apps/landing/public/img/`.
- [x] Lighthouse ≥ 95 performance/accessibility on Pages.

### M2: Rooms + board v1 (port of tutorapp.quest)
- [x] Room by link/code; guest join toggle ON = enter, OFF = host admits ("guest admit toast").
- [x] Board v1: pen, eraser, sticky, text, pan/zoom, pages.
- [x] Chat minimised pill. Presence avatars. Live cursors (BroadcastChannel on Pages).
- [x] Capacity 12 + waiting line ("Room full (phone)"); "Session ended (phone)".
- [x] Frames: "Host · Live Room — minimal", "Host · Room (phone)", "Join with code (phone)".

### M3: Spaces, stream, hallway, inbox
- [x] Spaces with modes (wizard "New space · step 1 mode"); tabs per mode.
- [x] Stream: posts, recap posts, must-read with acks, files, tasks.
- [x] Hallway: live rooms, spaces as channels, DMs with presence + Knock, "start a room" from a DM.
- [x] Home (desktop + phone), Inbox (To review + Notifications), More (phone), Notifications panel.

### M4: Board v2 (FigJam / Eraser-style)
- [x] Smoothing, shape recognition, flowchart shapes, connectors (3 types, caps, labels, re-route), sections, quick-create arrows, tidy up, snapping, find.
- [x] Diagram as code panel (flowchart first; sequence, ERD, swimlane after).
- [x] PDF/slides import; export PNG/PDF.
- [x] Frames: "Board v2 · flowchart + connectors (desktop)", "Board v2 · tools spec", "Board v2 · phone".

### M5: Scheduling (row C)
- [x] S1 Calendar (week/day/month) incl. Calendar in side panel.
- [x] S2 New session / series with clash check.
- [x] S3 Availability + booking types.
- [x] S4 Public booking page.
- [x] S5 Reschedule + booking requests.
- [x] `.ics` generation in TS (Pages download) and PHP (M10).

### M6: Plans (row A)
- [ ] P1 Library, P2 New plan (blank/template/file; AI hidden on Pages), P3 Block editor (timeline bar), P4 Attach & prepare, P5 Host-only plan rail in room, P6 Wrap-up.
- [ ] Wrap-up writes `session_log` rows (the hinge into billing).

### M7: Money (row B)
- [ ] I1 Billing setup, I2 Session log, I3 Invoice run, I4 Invoice detail (printable A4/Letter HTML), I5 Packages & credits, I6 Confirm a payment, I7 Reminders & overdue.
- [ ] Payer pay page (phone) with "I've paid" claim. Default payment link (same / `{amount}` template / per payer).

### M8: Insights, checks, states
- [ ] Insights (last seen/login, attendance, on-time, at-risk) + automatic and custom nudges.
- [ ] Quick checks with integrity signals (tinyproctorjs) + host review.
- [ ] All system states on page 07 (offline, reconnecting, skeletons, errors with a way out).

### M9: Agents (UI complete; real protocol arrives in M10)
- [ ] Agents page: agent link with scope, one-line prompt, seats (approve/revoke), "needs you" questions, "what agents read" preview.
- [ ] Prep queue per space + new prep task (templates: agenda for a session, board from a brief/PDF, N-question check, recap from today's board, invoice drafts with anomalies flagged, client-call agenda from last 3 recaps).
- [ ] Draft layer on the board (dashed, "draft · by claude"), agent cursor + presence chip, "Pause agents".
- [ ] "Ready for you" review: accept all / per item / ask for changes.
- [ ] On Pages: a **simulated agent run** (scripted drafts) so the flow is demoable. Write `docs/agent-link.md` (§12).

### M10: PHP backend + production on Namecheap
- [ ] `api/` with every endpoint the app uses (`docs/api.md`), `HttpAdapter`, migrations, install wizard, email sign-in links, uploads, daily task, owner console, branding toggle + expiry, contact form, `.ics` feeds and invites, booking iCal busy blocks.
- [ ] **Agent link protocol live** (§12) with rate limits and audit log.
- [ ] Deploy:
  - build artefact `loft-prod.zip` (landing → `/loft`, SPA → `/spaces`, `api/` → `/spaces/api`, `data/` outside the web root) attached to the GitHub release
  - `docs/deploy-namecheap.md` with cPanel steps
  - optional GitHub Action using FTP/SFTP secrets **only if the owner adds them**.

### M11: Live features over PHP
- [ ] Op-log sync + presence over HTTP polling (1–2s, ETag/since).
- [ ] WebRTC signalling via `/signal`.
- [ ] P2P audio, stage mode, hand raise, screen share (+ annotation + snapshot), "open together", follow-me.
- [ ] Optional SFU/video via the org's own keys; daily budget cap.

### M12: Hardening + mobile polish
- [ ] Capacity + rate limits verified with a 12-user load script (`scripts/load-room.mjs`).
- [ ] Backups (download `data/` zip from the owner console), restore guide.
- [ ] Accessibility pass (keyboard on board, focus rings, contrast in every mode).
- [ ] Playwright e2e for the main loops: create room → join as guest → board → end → recap; schedule → plan → wrap-up → invoice → claim → confirm.
- [ ] Release **v1.0.0**.

---

## 11. Definition of done (every milestone)

1. Screens match the listed Figma frames: spacing, type, colours from tokens, no italics. Desktop + phone.
2. Domain logic in `packages/core` has unit tests; ported TutorLoft tests pass.
3. `npm run check` (typecheck + lint + vitest) is green in CI. `php api/tests/run.php` is green from M10 on.
4. Playwright smoke test passes against the built Pages output.
5. `CHANGELOG.md` entry; tag `v0.N.0`; GitHub release notes with the Pages links `…/loft/m<N>/` and `…/loft/m<N>/app/`.
6. `docs/design-map.md` updated (frame → route/component).
7. A 5-line summary posted in the release notes covering what's demoable on Pages and what's simulated.

---

## 12. Agent link protocol (capabilities v1)

Mirrors Tack's agent link.

The host copies **one link + one line**:
- Link: `https://tanziro.com/spaces/a/<token>` (scope: workspace | space | room)
- Line: `Get things ready through this link, top to bottom.`

Plain HTTP only, so it works on shared hosting:
- `GET /a/<token>` → `next.md` (human/agent readable). It **starts with the capabilities list**, so nobody has to explain it in a prompt.
- `GET /a/<token>/next.json` → the same data, structured.
- `POST /a/<token>/claim` → claims the next queued prep task. Returns task + context links (plan, files, past recaps, space).
- `GET /a/<token>/context/<id>` → read-only context (redacted: no payer contacts, no DMs).
- `POST /a/<token>/drafts` → create drafts: `plan`, `board_ops` (batched, ≤500 ops), `post`, `check`, `invoice_draft`.
- `POST /a/<token>/files` → upload (size cap).
- `POST /a/<token>/report` → `{status: progress|done|blocker, note, minutes}` (agent time is recorded separately).
- `POST /a/<token>/ask` → question to the host (shows in "Needs you"); the agent moves on to the next task.
- `GET /a/<token>/changes?since=` → re-read changes; the agent stops when the link is paused.

**Seats:** the first contact creates a seat from the `User-Agent` + self-reported name (e.g. `claude-code`, `codex-cli`). New seats wait for **approve**. Seats can be renamed or revoked.

**Limits:**
- drafts only
- can't send, invite, charge or confirm payments
- 60 requests/min per seat
- link expires in 30 days
- agents don't take one of the 12 room seats; max 2 agents per room.

**In the room:**
- An agent appears as a quiet participant: no audio, named cursor.
- Its board ops land on a **draft layer** until the host accepts them.
- During a live session, agent edits pause unless the host allows "let agents edit live".

---

## 13. Loop protocol (READ FIRST EVERY ITERATION)

1. `git pull`. Read `docs/decisions.md` (latest entries) and this file's current milestone checklist.
2. Pick the **first unchecked box** in the current milestone. Keep tasks small (≤ ~300 lines changed).
3. Open the referenced Figma frames (use the Figma MCP if available; otherwise ask the owner for screenshots) and implement.
4. Write or port the tests first for domain logic. Run `npm run check`.
5. Commit with a conventional message referencing the milestone, e.g. `feat(m5): booking page slots in viewer tz`. Push.
6. Tick the box in this file (edit `docs/HANDOFF.md` in the repo) and add a line to `docs/decisions.md` if you decided anything.
7. When all boxes in a milestone are ticked:
   - tag `v0.N.0`, push the tag, confirm the Pages deploy is green
   - open the Pages URL and run the smoke test against it
   - write the release notes.
8. If blocked (missing credentials, an unclear design, a constraint conflict), write the question at the top of `docs/decisions.md` under **Open questions**, skip to the next unblocked box, and tell the owner at the end of the session.

**Never:**
- add a paid service or a server dependency
- add Composer
- add a WebSocket server
- add cron requirements
- add italics
- promise custom domains
- commit secrets
- force-push `main`
- delete the legacy folders or the old repos.

---

## 14. First session checklist for Claude Code

- [x] Read §0–§13.
- [x] Confirm `gh auth status` (as tanzir71) and Node ≥ 20.
- [x] Do M0 end to end and post the Pages URL.
- [x] Propose the M1 task breakdown as GitHub issues (label `m1`) before starting M1.
