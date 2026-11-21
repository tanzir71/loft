-- Loft · PHP 8 + SQLite. Documents mirror the browser's local adapter (one logic, two runtimes):
-- every app table (users, spaces, memberships, posts, sessions, invoices, prep_tasks, …) is a
-- "tbl" in `rows` with a JSON body. Money is integer cents; times are UTC ISO strings.

CREATE TABLE IF NOT EXISTS rows (
  tbl  TEXT NOT NULL,
  id   TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (tbl, id)
);

-- Board op-log (handoff §7.2): last-writer-wins per object field.
CREATE TABLE IF NOT EXISTS ops (
  room_id TEXT NOT NULL,
  seq     INTEGER NOT NULL,
  actor   TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  kind    TEXT NOT NULL,
  payload TEXT,
  PRIMARY KEY (room_id, seq)
);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);

-- What the app polls instead of WebSockets.
CREATE TABLE IF NOT EXISTS changes (version INTEGER PRIMARY KEY, tables TEXT NOT NULL, at INTEGER NOT NULL);

-- Auth: session cookies and single-use sign-in links (only hashes are stored).
CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS login_links (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT);

-- Token buckets: per IP, per agent seat.
CREATE TABLE IF NOT EXISTS rate (k TEXT PRIMARY KEY, tokens REAL NOT NULL, at INTEGER NOT NULL);

-- Uploaded files (sha-256 dedupe; bytes live in data/files/<sha256>).
CREATE TABLE IF NOT EXISTS blobs (sha256 TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL);

-- Who did what (owner console change log, agent audit).
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, data TEXT);
