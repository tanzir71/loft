# api/ — PHP 8 + SQLite (production only)

Arrives in **M10**. Constraints: PHP 8.2 with PDO SQLite, cURL, OpenSSL, Sodium. No Composer, no daemons, no WebSockets, no cron (daily jobs run on the first request of each day). See `docs/HANDOFF.md` §7.4 and `docs/api.md`.
