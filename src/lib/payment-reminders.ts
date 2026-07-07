import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

import { activityLog, schema } from "@/db/schema";
import { listTutorInvoices } from "@/lib/billing";
import { hasEmail } from "@/lib/features";

type AppDb = LibSQLDatabase<typeof schema>;
type RuntimeEnv = Record<string, string | undefined>;
type FetchFn = typeof fetch;
type ReminderStage = "due+3" | "due+10";

type PaymentReminderMessageInput = {
  balance: number;
  dueDate: number;
  invoiceNumber: string;
  invoiceUrl: string;
  studentName: string;
};

type SendPaymentRemindersInput = {
  env?: RuntimeEnv;
  fetchFn?: FetchFn;
  fromEmail?: string;
  now?: number;
  origin: string;
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

function reminderStage(input: { dueDate: number; now: number }): ReminderStage | null {
  const daysPastDue = Math.floor(
    (startOfUtcDay(input.now) - startOfUtcDay(input.dueDate)) / dayMs,
  );

  if (daysPastDue >= 10) {
    return "due+10";
  }

  if (daysPastDue >= 3) {
    return "due+3";
  }

  return null;
}

function metaStage(meta: unknown) {
  return typeof meta === "object" && meta !== null && "stage" in meta
    ? String((meta as { stage?: unknown }).stage ?? "")
    : "";
}

async function reminderAlreadyLogged(
  database: AppDb,
  input: { invoiceId: string; now: number; stage: ReminderStage },
) {
  const logs = await database
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.action, "payment_reminder"),
        eq(activityLog.entityType, "invoice"),
        eq(activityLog.entityId, input.invoiceId),
      ),
    );
  const todayStart = startOfUtcDay(input.now);
  const todayEnd = todayStart + dayMs;

  return logs.some((log) => {
    const stage = metaStage(log.metaJson);
    return stage === input.stage || (log.at >= todayStart && log.at < todayEnd);
  });
}

export function paymentReminderMessage(input: PaymentReminderMessageInput) {
  return [
    `Payment reminder for TutorLoft invoice ${input.invoiceNumber}.`,
    `Student: ${input.studentName}`,
    `Balance due: ${input.balance}`,
    `Due date: ${dateLabel(input.dueDate)}`,
    `Open invoice: ${input.invoiceUrl}`,
    "",
    `পেমেন্ট রিমাইন্ডার: TutorLoft ইনভয়েস ${input.invoiceNumber}`,
    `শিক্ষার্থী: ${input.studentName}`,
    `বাকি টাকা: ${input.balance}`,
    `শেষ তারিখ: ${dateLabel(input.dueDate)}`,
    `ইনভয়েস লিংক: ${input.invoiceUrl}`,
  ].join("\n");
}

async function deliverPaymentReminder(input: {
  env: RuntimeEnv;
  fetchFn?: FetchFn;
  fromEmail?: string;
  message: string;
  recipientEmail: string;
  stage: ReminderStage;
  subject: string;
}) {
  const recipientEmail = trim(input.recipientEmail);

  if (!hasEmail(input.env)) {
    return { mode: "copy" as const, reason: "email_disabled" as const };
  }

  if (!recipientEmail) {
    return { mode: "copy" as const, reason: "missing_recipient" as const };
  }

  const response = await (input.fetchFn ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.env.RESEND_API_KEY?.trim() ?? ""}`,
      "Content-Type": "application/json",
      "User-Agent": "TutorLoft/0.1",
    },
    body: JSON.stringify({
      from: trim(input.fromEmail) ?? "TutorLoft <billing@resend.dev>",
      to: recipientEmail,
      subject: input.subject,
      text: [`Reminder stage: ${input.stage}`, "", input.message].join("\n"),
    }),
  });

  if (!response.ok) {
    return { mode: "copy" as const, reason: "email_failed" as const };
  }

  return { mode: "email" as const, recipientEmail };
}

export async function sendPaymentReminders(
  database: AppDb,
  input: SendPaymentRemindersInput,
) {
  const now = input.now ?? Date.now();
  const env = input.env ?? process.env;
  const invoices = await listTutorInvoices(database);
  const result = {
    copied: 0,
    eligible: 0,
    failed: 0,
    sent: 0,
    skipped: 0,
  };

  for (const invoice of invoices) {
    if (invoice.displayStatus !== "sent" || invoice.balance <= 0) {
      continue;
    }

    const stage = reminderStage({ dueDate: invoice.dueDate, now });

    if (!stage) {
      continue;
    }

    result.eligible += 1;

    if (await reminderAlreadyLogged(database, { invoiceId: invoice.id, now, stage })) {
      result.skipped += 1;
      continue;
    }

    const invoiceUrl = new URL(`/invoices/${invoice.id}`, input.origin).toString();
    const message = paymentReminderMessage({
      balance: invoice.balance,
      dueDate: invoice.dueDate,
      invoiceNumber: invoice.number,
      invoiceUrl,
      studentName: invoice.studentName,
    });
    const delivery = await deliverPaymentReminder({
      env,
      fetchFn: input.fetchFn,
      fromEmail: input.fromEmail,
      message,
      recipientEmail: invoice.studentEmail,
      stage,
      subject: `TutorLoft payment reminder ${invoice.number}`,
    });

    if (delivery.mode === "email") {
      result.sent += 1;
    } else if (delivery.reason === "email_failed") {
      result.failed += 1;
    } else {
      result.copied += 1;
    }

    await database.insert(activityLog).values({
      id: crypto.randomUUID(),
      actorId: null,
      action: "payment_reminder",
      entityType: "invoice",
      entityId: invoice.id,
      metaJson: {
        invoiceNumber: invoice.number,
        mode: delivery.mode,
        stage,
        ...(delivery.mode === "email"
          ? { recipientEmail: delivery.recipientEmail }
          : { reason: delivery.reason }),
      },
      at: now,
    });
  }

  return result;
}
