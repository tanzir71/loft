# TutorLoft

TutorLoft is a private tutoring workspace for one tutor, their students, and optional parent accounts. It combines scheduling, lesson materials, assignments, quizzes, progress reports, parent visibility, and invoice tracking in a single Next.js app.

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

## Verification

Use the same commands Codex uses before marking handoff work complete:

```bash
npm run check
npm run e2e
npm run build
```

## Deployment

TutorLoft is designed for Vercel Hobby with Turso/libSQL. Set `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `AUTH_SECRET`, `TUTOR_EMAIL`, and `TUTOR_PASSWORD` in the Vercel project. Optional integrations are enabled by environment variables: `RESEND_API_KEY` for email and `BLOB_READ_WRITE_TOKEN` for Vercel Blob uploads.
