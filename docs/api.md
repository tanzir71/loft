# /api/v1 contract

Base: `/spaces/api/v1` (production, PHP 8 + SQLite). The SPA's `HttpAdapter` calls these; the `LocalAdapter` serves the same resource names from IndexedDB on GitHub Pages, so both stay in step. `query(resource, params)` = `GET /<resource>?<params>`, `mutate(resource, body)` = `POST /<resource>` with a JSON body.

All money is integer cents (USD). All times are UTC ISO-8601; the client applies the viewer's time zone.

| Method | Resource | Purpose | Since |
|---|---|---|---|
| GET | `me` | signed-in user or 401 | M0 |
| GET | `nav` | side panel data: brand, live rooms, spaces, DMs, counts | M0 |
| GET | `home` | Home: me, settings, spaces, rooms | M0 |
| GET/POST | `settings` | room link (read-only), booking page, default payment link | M0 |
| GET/POST | `spaces` | list mine / create `{name, mode, sub?, colour?}` | M3 |
| GET | `spaces/:slugOrId` | space + mode config, my role, members, upcoming, join code | M3 |
| POST | `spaces/:id/read` | mark the space read | M3 |
| GET/POST | `spaces/:id/posts` | stream / post `{kind: post|notice|task|recap, title?, body, dueAt?}` (hosts only for notice/task) | M3 |
| POST | `posts/:id/ack` · `posts/:id/remind` · `posts/:id/handin` | acknowledge · remind non-ackers (host) · hand in a task | M3 |
| GET | `spaces/:id/work` · POST `submissions/:id/review` | tasks + hand-ins · mark done / return (host) | M3 |
| GET/POST | `spaces/:id/files` · `spaces/:id/messages` · POST `spaces/:id/members` | files · space chat · add a person (host) | M3 |
| GET | `dms` · `dms/:userId` | DM list (unread, presence) · thread | M3 |
| POST | `dms/:userId/messages` · `dms/:userId/read` · `dms/:userId/room` | send · mark read · start a room / knock (`{knock: true}`) | M3 |
| GET | `notifications` · POST `notifications/read-all` · `notifications/:id/read` | notifications | M3 |
| GET | `review` | To review items (hand-ins, knocks, must-reads to confirm) | M3 |
| GET | `calendar?from&to` | sessions (viewer-filtered), pending requests, availability, feed token, booking handle | M5 |
| POST | `sessions` | one session `{startsAt}` or a weekly series `{series: {days, time, tz, from, count|until}}`; `dryRun` returns clashes; `skip[]` drops dates | M5 |
| POST | `sessions/:id/move` · `sessions/:id/cancel` | host only; `{scope: this|following|all}`; bumps SEQUENCE | M5 |
| GET | `sessions/:id/ics` · `feed` (prod: `/ics/<token>.ics`) | invite / private feed | M5 |
| GET/POST | `availability` · POST `booking-types` · `booking-types/:id/delete` | hours, rules, busy iCal, booking types | M5 |
| GET | `book/:handle` · `book/:handle/slots?type=` · POST `book/:handle` | public booking page (no auth, honeypot `website`) | M5 |
| GET | `manage/:token` · POST `manage/:token/cancel` · `manage/:token/move` | no-login manage link | M5 |
| POST | `sessions/:id/requests` · GET `requests` · POST `requests/:id` | member asks to move/cancel · host's pending list with checks · `{decision}` | M5 |
| GET/POST | `spaces/:id/plans` | library (units, unplanned sessions) / create `{title, minutes, unit, objective, tags, from: blank|template:<key>, blocks?}` | M6 |
| GET/POST | `plans/:id` | plan with sessions + versions / autosave `{blocks?, title?, minutes?, …}` | M6 |
| POST | `plans/:id/restore` · `plans/:id/reorder` · `plans/:id/delete` | history · order · delete | M6 |
| POST | `plans/:id/attach` · `plans/:id/detach` | idempotent prepare (room pages, agenda post, reminder), `copyTo[]` | M6 |
| POST | `sessions/:id/room` | the session's room (created on first use) | M6 |
| GET/POST | `sessions/:id/plan` · `sessions/:id/rail` | rail data (host notes only for hosts) · save rail state | M6 |
| POST | `rooms/:id/attendance` | `{event: join|leave}` | M6 |
| GET/POST | `sessions/:id/wrapup` | prefill · write session_log, recap, homework, carry-over | M6 |
| GET/POST | `spaces/:id/billing` | host only: model, price, per member/session, payers, policy, schedule, due days, link override · `settings: {footer, nextNumber}` | M7 |
| POST | `spaces/:id/billing/payer` | `{memberId, payerId}`: map a payer, move unbilled rows, rebuild drafts | M7 |
| GET | `money/overview?month=` | KPIs, To do (claims, drafts, WhatsApp to send), recent invoices; runs the daily money task | M7 |
| GET | `money/log?month=` · POST `money/log/:id` | session log rows with payer, package and invoice · re-price `{status, minutes?}` (403 when invoiced) | M7 |
| POST | `money/run` | `{month}` draft one invoice per payer from unbilled rows | M7 |
| GET | `money/invoices` | `ready`, `attention`, `sent` (derived status, balance, next reminder) | M7 |
| GET | `invoices/:id` | detail: lines with their sessions, activity, claims, payments, questions, payer, pay link | M7 |
| POST | `invoices/send` | `{ids, email?, whatsapp?, inapp?}` number, freeze rows, set due date, notify payer | M7 |
| POST | `invoices/:id/lines` · `/revise` · `/void` · `/resend` · `/comments` | edit a draft · revision `-B` · void (rows back to the log) or delete a draft · resend/nudge · reply | M7 |
| GET | `money/claims` | open "I've paid" claims, unpaid invoices, confirmed this month | M7 |
| POST | `invoices/:id/confirm` · `/reject` · `/ask` | confirm `{claimId?, amountCents?}` → receipt `RC-…` (part payments allowed) · reject `{claimId, reason}` · DM the payer | M7 |
| GET/POST | `money/packages` | packages with ledger, makeup credits, rules · sell `{spaceId, memberId, size, priceCents}` → draft | M7 |
| GET/POST | `money/settings` | prefix, next number, footer, payment link `{mode, link, template, perPayer}`, reminders, package rules | M7 |
| GET | `money/reminders` · POST `money/payers/:id/pause` | steps, message, overdue + queued WhatsApp · `{paused}` | M7 |
| GET | `pay/:token` · POST `pay/:token/claim` · `pay/:token/comments` | public pay page (no sign-in) · "I've paid" `{amountCents, method, reference, note}` · question on a line | M7 |
| GET | `insights?space=&days=` | KPIs with deltas, people (last seen/login, attendance, homework, fees, at-risk reasons), rules, audiences, week stats; runs the daily nudge rules | M8 |
| POST | `nudges` · `nudges/rules` | custom nudge `{audience | userId, text, channels, sendAt?}` → recipients + wa.me texts · `{rule, on}` | M8 |
| POST | `files/:id/open` | record that a member opened a file (for the "hasn't opened shared files" nudge) | M8 |
| GET/POST | `spaces/:id/checks` | host: checks with done/average/to-mark/flagged · member: checks with my attempt · create a draft | M8 |
| GET/POST | `checks/:id` · POST `checks/:id/status` | host: full check · member: no answer key · edit · `{status: published|closed|draft}` (publish validates) | M8 |
| POST | `checks/:id/start` · GET `attempts/:id` | start or resume an attempt (window, time limit, attempt limit) | M8 |
| POST | `attempts/:id/answer` · `/integrity` · `/submit` | autosave `{questionId, answer}` · tinyproctor snapshot · submit → auto-graded score | M8 |
| GET | `checks/:id/results` · POST `attempts/:id/grade` | attempts with scores and integrity review, not started, per-question rates, short answers to mark · `{questionId, points}` | M8 |
| GET | `spaces/:id/grades` | gradebook columns (tasks, checks) and rows with averages | M8 |
| GET | `agents` | links, seats (state, time this week), working, needs you, ready, activity, built-in capabilities | M9 |
| POST | `agents/links` · `agents/links/:id` · `agents/pause` | get-or-create a link `{scope, scopeId}` · `{paused?, liveEdits?, rotate?}` · pause/resume all | M9 |
| POST | `agents/seats/:id` | `{action: approve|revoke|rename, name?}` | M9 |
| GET | `agents/read?link=` | the next.md / next.json an agent on that link reads | M9 |
| GET/POST | `spaces/:id/prep` | prep queue (next session, ready, working, needs you, queued), templates, seats · queue a task `{template, sessionId?, brief, attachments, readyBy, who?, post?}` | M9 |
| POST | `prep/:id/answer` | answer an agent's question (re-queues with feedback) | M9 |
| GET/POST | `prep/:id/review` | drafts with previews and the report · `{accept[], reject[], reason?, changes?}` | M9 |
| GET | `rooms/:id/agent` | host only: pending board draft ops, activity, working agent, review task | M9 |
| GET/POST | `a/:token` · `a/:token/next.json` · `/claim` · `/context/:id` · `/drafts` · `/report` · `/ask` · `/changes` | the agent link protocol (see `docs/agent-link.md`) | M9 (local) · M10 (PHP) |
| POST | `auth/register` · `auth/login` · `auth/recover` · `auth/recovery-confirm` | username + password accounts (no email needed) · one-time recovery code, reset with it (revokes sessions, issues a new code) · confirm it was saved | v1.1.1 |
| POST | `auth/password` · `auth/password/set` · `auth/signout` | sign in (same as `auth/login`) · change username or password · end the session | M10 · v1.1.1 |
| POST | `auth/link` · GET `auth/callback?token=` | legacy email sign-in link; off unless the private config sets `email_signin_enabled` | M10 |
| POST | `profile` | your name, title, time zone | M10 |
| GET | `changes?since=` | `{version, tables}`: what the app polls instead of WebSockets | M10 |
| GET/POST | `rooms/:id/ops?since=` | the op-log over HTTP (actor comes from the session) | M10 |
| POST · GET | `files` (multipart) · `files/:id` | upload (sha-256 dedupe, bytes outside the web root) · download (members of the file's space) | M10 |
| GET/POST | `install` | server checks · create the owner (username + password) and data/config.php, returns the recovery code once (first run only) | M10 · v1.1.1 |
| GET · POST | `owner` · `owner/orgs/:id` | owner only: organisations with branding, paid-until, active members, ending soon, asked by email; change log; requests · `{branded, brandedUntil, note, notify}` | M10 |
| GET/POST | `brand` | the host's organisation brand: set up while off, `{publish: true}` only while branding is active (paid-until + 14 days) | M10 |
| POST | `contact` | the landing's organisations form → stored + emailed to the owner | M10 |
| GET | `ics/:token.ics` | private calendar feed (text/calendar) | M10 |
| POST | `rooms` | create a room `{name?, guestJoin?, spaceId?}` → room with `code` | M2 |
| GET | `rooms/by-code/:code` | room + `hostName` (code normalised) | M2 |
| GET | `rooms/:id` | room + `hostName` | M2 |
| POST | `rooms/:id/settings` | host only: `{guestJoin?, name?}` | M2 |
| POST | `rooms/:id/end` | host only: end for everyone | M2 |
| POST | `rooms/:id/knock` | guest asks in → admission `{status: admitted|pending}` | M2 |
| GET | `rooms/:id/admission` | my admission | M2 |
| GET | `rooms/:id/admissions` | host only: pending guests | M2 |
| POST | `rooms/:id/admissions/:aid` | host only: `{decision: admit|deny}` | M2 |
| GET/POST | `rooms/:id/messages` | room chat (ordered by time-sortable id) | M2 |
| POST | `guests` | create a guest user `{name}` (no account) | M2 |
| GET/POST | `rooms/:id/ops?since=` | op-log read (poll 1–2 s) / append; payload carries `_cid` | M2 (local), M11 (http) |
| POST | `rooms/:id/presence` | heartbeat (5 s), returns peers (TTL 30 s) | M2 / M11 |
| GET/POST | `signal` | WebRTC signalling by polling | M11 |
| POST | `files` | upload (sha-256 dedupe) | M3 / M10 |
| POST | `rooms/:id/presence/leave` · GET `rooms/:id/presence` | leave now (frees the seat) · current peers | M11 |
| GET/POST | `admin/calls` | org call settings: tier (P2P / SFU provider), STUN/TURN, sealed provider keys (last 4 shown), free minutes, budget, unit price; usage for 14 days and the month | M11 |
| GET | `rooms/:id/call-config` | ICE servers (STUN, plus Cloudflare TURN when set), the host's own link, and `video: {provider, step, allowed}` or null | M11 · v1.1.0 |
| POST | `rooms/:id/usage` | add call minutes `{minutes ≤ 5, video?}` → feeds the daily pool | M11 |
| POST · GET | `rooms/:id/still` · `rooms/:id/still?tabId=` | upload / fetch the latest screen-share still (WebP, ≤ 1280 px) for viewers whose connection fails | M11 |
| POST | `a/:token/files` (multipart) | an agent uploads an attachment (≤ 20 MB, optional claimed `taskId`) | M10 |
| POST | `rooms/:id/video/join` | start video with the org's provider (you must be in the room; only at the "full" budget step) → Cloudflare `{sessionId, iceServers}`, or Daily / Jitsi `{url}` | v1.1.0 |
| POST | `rooms/:id/video/cf` | Cloudflare Realtime negotiation for your own session: `{sessionId, op: tracks/new \| renegotiate \| tracks/close, body}`, relayed with the org's app token | v1.1.0 |
| POST | `rooms/:id/video/leave` | forget your video session | v1.1.0 |
| GET | `owner/backup` | owner only: a zip of `data/` with a consistent copy of the database (`VACUUM INTO`), uploads and config | M12 |

This table grows with every milestone.
