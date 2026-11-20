# /api/v1 contract

Base: `/spaces/api/v1` (production, PHP 8 + SQLite). The SPA's `HttpAdapter` calls these; the `LocalAdapter` serves the same resource names from IndexedDB on GitHub Pages, so both stay in step. `query(resource, params)` = `GET /<resource>?<params>`, `mutate(resource, body)` = `POST /<resource>` with a JSON body.

All money is integer cents (USD). All times are UTC ISO-8601; the client applies the viewer's time zone.

| Method | Resource | Purpose | Since |
|---|---|---|---|
| GET | `me` | signed-in user or 401 | M0 |
| GET | `nav` | side panel data: brand, live rooms, spaces, DMs, counts | M0 |
| GET | `home` | Home: me, settings, spaces, rooms | M0 |
| GET/POST | `settings` | room link (read-only), booking page, default payment link | M0 |
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
