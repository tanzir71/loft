import { and, asc, eq, gte, lt, ne } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { activityLog, classSessions, courses, schema, users } from "@/db/schema";
import { listTutorInvoices } from "@/lib/billing";
import { listGradingSubmissions } from "@/lib/classroom";
import { hasEmail } from "@/lib/features";
import { listManualGradingQueue } from "@/lib/quizzes";

type AppDb = LibSQLDatabase<typeof schema>;
type RuntimeEnv = Record<string, string | undefined>;
type FetchFn = typeof fetch;

type SendTutorDailyDigestInput = {
  env?: RuntimeEnv;
  fetchFn?: FetchFn;
  fromEmail?: string;
  now?: number;
  origin?: string;
};

const dayMs = 24 * 60 * 60 * 1000;

function trim(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function startOfUtcDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dateLabel(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

async function dailyDigestAlreadyLogged(database: AppDb, date: string) {
  const [log] = await database
    .select({ id: activityLog.id })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.action, "daily_digest"),
        eq(activityLog.entityType, "digest"),
        eq(activityLog.entityId, date),
      ),
    );

  return Boolean(log);
}

async function listTodaySessions(database: AppDb, now: number) {
  const todayStart = startOfUtcDay(now);
  const tomorrowStart = todayStart + dayMs;

  return database
    .select({
      courseTitle: courses.title,
      durationMin: classSessions.durationMin,
      id: classSessions.id,
      startsAt: classSessions.startsAt,
      status: classSessions.status,
    })
    .from(classSessions)
    .innerJoin(courses, eq(classSessions.courseId, courses.id))
    .where(
      and(
        gte(classSessions.startsAt, todayStart),
        lt(classSessions.startsAt, tomorrowStart),
        ne(classSessions.status, "cancelled"),
      ),
    )
    .orderBy(asc(classSessions.startsAt), asc(courses.title));
}

async function getActiveTutor(database: AppDb) {
  const tutors = await database
    .select({ email: users.email, id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.role, "tutor"), eq(users.status, "active")))
    .orderBy(asc(users.createdAt));

  return tutors[0] ?? null;
}

function section(lines: string[], title: string, rows: string[]) {
  lines.push("", title);
  lines.push(...(rows.length > 0 ? rows : ["- None"]));
}

export async function sendTutorDailyDigest(
  database: AppDb,
  input: SendTutorDailyDigestInput = {},
) {
  const now = input.now ?? Date.now();
  const date = dateLabel(now);
  const env = input.env ?? process.env;
  const [tutor, sessions, assignmentRows, quizRows, invoiceRows] = await Promise.all([
    getActiveTutor(database),
    listTodaySessions(database, now),
    listGradingSubmissions(database),
    listManualGradingQueue(database),
    listTutorInvoices(database),
  ]);
  const assignmentSubmissions = assignmentRows.filter(
    (submission) => submission.status === "submitted" && submission.grade === null,
  );
  const overdueInvoices = invoiceRows.filter(
    (invoice) =>
      invoice.displayStatus !== "void" &&
      invoice.displayStatus !== "paid" &&
      invoice.balance > 0 &&
      invoice.dueDate < now,
  );
  const result = {
    assignmentSubmissions: assignmentSubmissions.length,
    failed: 0,
    overdueInvoices: overdueInvoices.length,
    quizAnswers: quizRows.length,
    sent: 0,
    sessions: sessions.length,
    skipped: 0,
  };

  if (!hasEmail(env)) {
    return { ...result, reason: "email_disabled" as const, skipped: 1 };
  }

  if (!tutor) {
    return { ...result, reason: "missing_tutor" as const, skipped: 1 };
  }

  const recipientEmail = trim(tutor.email);

  if (!recipientEmail) {
    return { ...result, reason: "missing_recipient" as const, skipped: 1 };
  }

  if (await dailyDigestAlreadyLogged(database, date)) {
    return { ...result, reason: "already_sent" as const, skipped: 1 };
  }

  const origin = input.origin ?? "http://localhost:3000";
  const lines = [`TutorLoft daily digest for ${date}`, `Tutor: ${tutor.name}`];
  section(
    lines,
    `Today's sessions (${sessions.length})`,
    sessions.map(
      (session) =>
        `- ${timeLabel(session.startsAt)} ${session.courseTitle} (${session.durationMin} min, ${session.status})`,
    ),
  );
  section(
    lines,
    `Ungraded assignment submissions (${assignmentSubmissions.length})`,
    assignmentSubmissions.map(
      (submission) =>
        `- ${submission.assignmentTitle}: ${submission.studentName} (${submission.courseTitle})`,
    ),
  );
  section(
    lines,
    `Manual quiz answers (${quizRows.length})`,
    quizRows.map((answer) => `- ${answer.quizTitle}: ${answer.studentName}`),
  );
  section(
    lines,
    `Overdue invoices (${overdueInvoices.length})`,
    overdueInvoices.map((invoice) => {
      const url = new URL(`/invoices/${invoice.id}`, origin).toString();
      return `- ${invoice.number}: ${invoice.studentName}, balance ${invoice.balance}, due ${dateLabel(invoice.dueDate)} (${url})`;
    }),
  );

  const response = await (input.fetchFn ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY?.trim() ?? ""}`,
      "Content-Type": "application/json",
      "User-Agent": "TutorLoft/0.1",
    },
    body: JSON.stringify({
      from: trim(input.fromEmail) ?? "TutorLoft <digest@resend.dev>",
      to: recipientEmail,
      subject: `TutorLoft daily digest - ${date}`,
      text: lines.join("\n"),
    }),
  });

  if (!response.ok) {
    return { ...result, failed: 1, reason: "email_failed" as const };
  }

  await database.insert(activityLog).values({
    id: crypto.randomUUID(),
    actorId: tutor.id,
    action: "daily_digest",
    entityType: "digest",
    entityId: date,
    metaJson: {
      assignmentSubmissions: assignmentSubmissions.length,
      overdueInvoices: overdueInvoices.length,
      quizAnswers: quizRows.length,
      recipientEmail,
      sessions: sessions.length,
    },
    at: now,
  });

  return { ...result, sent: 1 };
}
