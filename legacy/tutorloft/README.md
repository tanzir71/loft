# TutorLoft

TutorLoft is a private tutoring workspace for one tutor, their students, and optional parent accounts. It combines scheduling, lesson materials, assignments, quizzes, progress reports, parent visibility, and invoice tracking in a single Next.js app.

## Website & demo

- Landing page: https://tutorloft-workspace.vercel.app/
- Read-only demo: https://tutorloft-workspace.vercel.app/demo

The public demo uses seeded browser-only data for tutor, student, and parent views. It makes no database mutations and disables outbound email, uploads, AI calls, and payments.

## Architecture

One Next.js app, three roles, and a database that is a local file in development and a hosted libSQL instance in production:

```
   Tutor          Students         Parents
     │                │                │
     └───────────── HTTPS ────────────┘
                      │
┌─────────────────── Next.js (Vercel Hobby) ───────────────────┐
│  Auth.js sessions — role-based access (authz rules            │
│  unit-tested: content gating, parent visibility)               │
│                                                                │
│  Domain surfaces: scheduling · lessons · assignments ·         │
│  quizzes (auto-grading) · progress reports · invoices          │
│  (TL-YYYYMM-#### numbering) · automations · AI adapters        │
│                                                                │
│  /api/cron (guarded by CRON_SECRET) — reminders & digests      │
│        │                                                       │
│        ▼                                                       │
│  Drizzle → SQLite file (dev: file:./data/dev.db)               │
│            Turso/libSQL (prod: libsql:// + auth token)          │
│                                                                │
│  Optional: Resend (email) · Vercel Blob (file uploads) —        │
│  both feature-gated by env vars, app works without them         │
└────────────────────────────────────────────────────────────────┘
```

The design goal: run the whole product on free/hobby tiers — Vercel Hobby + Turso free tier — with zero required paid services. Optional integrations (email, blob storage) light up only when their env vars exist.

## Branding

The product name is TutorLoft, written as one word with a capital T and L. The wordmark uses the Instrument Serif italic display style with Loft in the primary accent color. Invoice numbers use the default `TL` prefix, such as `TL-202607-0001`.

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env.local` and set at least:

```bash
AUTH_SECRET=dev-only-change-me
TUTOR_EMAIL=tutor@example.com
TUTOR_PASSWORD=correct horse battery staple
DATABASE_URL=file:./data/dev.db
```

3. Apply the database migration and seed the tutor account:

```bash
npm run db:migrate
npm run seed
```

4. Start the app:

```bash
npm run dev
```

The local app uses `file:./data/dev.db` by default. The `data/` directory is ignored by Git.

## Environment

Required for local development:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Use `file:./data/dev.db` locally. |
| `AUTH_SECRET` | Long random string for Auth.js and encrypted AI settings. |
| `TUTOR_EMAIL` | Tutor seed account email. |
| `TUTOR_PASSWORD` | Tutor seed account password, minimum 8 characters. |

Production-only or optional:

| Variable | Notes |
|---|---|
| `DATABASE_AUTH_TOKEN` | Turso/libSQL token for `libsql://` production databases. |
| `CRON_SECRET` | Guards `/api/cron`; set this before enabling the Vercel cron. |
| `RESEND_API_KEY` | Enables invite, invoice, reminder, and digest email. |
| `BLOB_READ_WRITE_TOKEN` | Enables Vercel Blob file uploads. |

## Verification

Run these before considering a change complete:

```bash
npm run check
npm run e2e
npm run build
```

The Playwright suite covers tutor, student, and parent happy paths. Unit tests cover the domain rules called out in `CODEX_HANDOFF.md`, including authz, billing math, scheduling, content gating, quiz grading, classroom feedback, automations, AI adapters, exports, and branding.

## Deployment

TutorLoft is designed for Vercel Hobby with Turso/libSQL.

1. Create a Turso/libSQL database and copy its `libsql://` URL and auth token.
2. Set Vercel environment variables: `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `AUTH_SECRET`, `TUTOR_EMAIL`, `TUTOR_PASSWORD`, and `CRON_SECRET`.
3. Add optional `RESEND_API_KEY` and `BLOB_READ_WRITE_TOKEN` only when those integrations should be enabled.
4. Run migrations against production:

```bash
DATABASE_URL="libsql://..." DATABASE_AUTH_TOKEN="..." npm run db:migrate
```

5. Seed the tutor once:

```bash
DATABASE_URL="libsql://..." DATABASE_AUTH_TOKEN="..." TUTOR_EMAIL="..." TUTOR_PASSWORD="..." npm run seed
```

6. Deploy to Vercel. `vercel.json` schedules `/api/cron` daily at 02:00 UTC; the route stays inert unless `CRON_SECRET` is set.

After deploy, run a smoke check by signing in as the tutor, creating a student invite, and confirming the student can reach `/home`.
