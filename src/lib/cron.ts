import { and, eq, lte } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";

import { announcements, invoices, materials, quizzes, schema, users } from "@/db/schema";
import { generateMonthlyInvoice } from "@/lib/billing";
import { sendPaymentReminders } from "@/lib/payment-reminders";
import { generateSessions } from "@/lib/schedule";

type AppDb = LibSQLDatabase<typeof schema>;

type RunCronTasksInput = {
  env?: Record<string, string | undefined>;
  fetchFn?: typeof fetch;
  origin?: string;
  now?: number;
  sessionWeeks?: number;
};

type RunAutomationTasksInput = RunCronTasksInput & {
  skipInvoices?: boolean;
  skipSessions?: boolean;
};

const monthlyInvoiceNotes = "Generated monthly invoice";
const runAutomationTasksSchema = z.object({
  now: z.number().int().optional(),
  sessionWeeks: z.number().int().min(1).max(52).optional(),
  skipInvoices: z.boolean().optional(),
  skipSessions: z.boolean().optional(),
});

function utcMonthStart(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function utcNextMonthStart(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

export function isCronRequestAuthorized(request: Request, secret: string) {
  const normalizedSecret = secret.trim();

  if (!normalizedSecret) {
    return false;
  }

  const url = new URL(request.url);
  const authorization = request.headers.get("authorization") ?? "";

  return (
    authorization === `Bearer ${normalizedSecret}` ||
    url.searchParams.get("secret") === normalizedSecret
  );
}

async function monthlyDraftInvoiceExists(
  database: AppDb,
  input: { periodEnd: number; periodStart: number; studentId: string },
) {
  const [invoice] = await database
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.studentId, input.studentId),
        eq(invoices.periodStart, input.periodStart),
        eq(invoices.periodEnd, input.periodEnd),
        eq(invoices.notes, monthlyInvoiceNotes),
      ),
    );

  return Boolean(invoice);
}

async function runCoreAutomationTasks(database: AppDb, input: RunAutomationTasksInput = {}) {
  const parsed = runAutomationTasksSchema.parse(input);
  const now = parsed.now ?? Date.now();
  const periodStart = utcMonthStart(now);
  const periodEnd = utcNextMonthStart(now);
  const sessions = parsed.skipSessions
    ? { created: 0, skipped: 0 }
    : await generateSessions(database, {
        from: now,
        now: () => now,
        weeks: parsed.sessionWeeks ?? 4,
      });
  const closedQuizzes = await database
    .update(quizzes)
    .set({ status: "closed", updatedAt: now })
    .where(and(eq(quizzes.status, "published"), lte(quizzes.closeAt, now)))
    .returning({ id: quizzes.id });
  const publishedAnnouncements = await database
    .update(announcements)
    .set({ status: "published", updatedAt: now })
    .where(and(eq(announcements.status, "draft"), lte(announcements.publishAt, now)))
    .returning({ id: announcements.id });
  const publishedMaterials = await database
    .update(materials)
    .set({ status: "published", updatedAt: now })
    .where(and(eq(materials.status, "draft"), lte(materials.publishAt, now)))
    .returning({ id: materials.id });
  let invoicesCreated = 0;
  let invoicesRefreshed = 0;
  let invoicesSkipped = 0;

  if (!parsed.skipInvoices) {
    const studentRows = await database
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "student"), eq(users.status, "active")));

    for (const student of studentRows) {
      const existed = await monthlyDraftInvoiceExists(database, {
        periodEnd,
        periodStart,
        studentId: student.id,
      });
      const result = await generateMonthlyInvoice(database, {
        dueDate: periodEnd,
        now: () => now,
        periodEnd,
        periodStart,
        studentId: student.id,
      });

      if (result.skipped) {
        invoicesSkipped += 1;
      } else if (existed) {
        invoicesRefreshed += 1;
      } else {
        invoicesCreated += 1;
      }
    }
  }

  return {
    announcementsPublished: publishedAnnouncements.length,
    invoicesCreated,
    invoicesRefreshed,
    invoicesSkipped,
    materialsPublished: publishedMaterials.length,
    quizzesClosed: closedQuizzes.length,
    sessions,
  };
}

export async function runReadTimeFallbacks(database: AppDb, input: RunAutomationTasksInput = {}) {
  return runCoreAutomationTasks(database, { skipInvoices: true, ...input });
}

export async function runCronTasks(database: AppDb, input: RunCronTasksInput = {}) {
  const core = await runCoreAutomationTasks(database, input);
  const paymentReminders = await sendPaymentReminders(database, {
    env: input.env,
    fetchFn: input.fetchFn,
    now: input.now,
    origin: input.origin ?? "http://localhost:3000",
  });

  return {
    ...core,
    paymentReminders,
  };
}
