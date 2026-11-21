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
| POST | `auth/link` | email a 15-minute single-use sign-in link | M10 |
| POST | `auth/signout` | end the session | M10 |
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

This table grows with every milestone.
