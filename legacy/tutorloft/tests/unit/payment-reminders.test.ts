import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { activityLog, invoices, schema } from "@/db/schema";
import { paymentReminderMessage, sendPaymentReminders } from "@/lib/payment-reminders";
import { seedTutor } from "@/lib/seed";
import { createStudent } from "@/lib/students";

async function applyInitialMigration(client: Client) {
  const migrationDir = path.join(process.cwd(), "drizzle");
  const migrationFile = readdirSync(migrationDir).find(
    (file) => file.startsWith("0000_") && file.endsWith(".sql"),
  );

  if (!migrationFile) {
    throw new Error("Initial migration was not generated.");
  }

  const sql = readFileSync(path.join(migrationDir, migrationFile), "utf8");

  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) {
      await client.execute(trimmed);
    }
  }
}

async function createMigratedDb() {
  const client = createClient({ url: "file::memory:" });
  await applyInitialMigration(client);
  const db = drizzle(client, { schema });
  await seedTutor(db, {
    email: "tutor@example.com",
    makeId: () => "tutor_id",
    password: "correct horse battery staple",
  });

  return { client, db };
}

const dayMs = 24 * 60 * 60 * 1000;

describe("payment reminders", () => {
  it("sends due+3 and due+10 reminders once per invoice per cron day and logs them", async () => {
    const { client, db } = await createMigratedDb();
    const now = Date.UTC(2026, 6, 13, 12);
    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
    });
    await db.insert(invoices).values([
      {
        id: "invoice_due_3",
        createdAt: now,
        dueDate: now - 3 * dayMs,
        notes: "Sent invoice",
        number: "TL-202607-0001",
        periodEnd: now,
        periodStart: now - 30 * dayMs,
        status: "sent",
        studentId: "student_id",
        total: 1000,
        updatedAt: now,
      },
      {
        id: "invoice_due_10",
        createdAt: now,
        dueDate: now - 10 * dayMs,
        notes: "Sent invoice",
        number: "TL-202607-0002",
        periodEnd: now,
        periodStart: now - 30 * dayMs,
        status: "sent",
        studentId: "student_id",
        total: 2000,
        updatedAt: now,
      },
    ]);
    const sentPayloads: unknown[] = [];
    const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sentPayloads.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 202 });
    }) as typeof fetch;

    const first = await sendPaymentReminders(db, {
      env: { RESEND_API_KEY: "key" },
      fetchFn,
      now,
      origin: "https://tutorloft.test",
    });
    const second = await sendPaymentReminders(db, {
      env: { RESEND_API_KEY: "key" },
      fetchFn,
      now,
      origin: "https://tutorloft.test",
    });
    const logs = await db.select().from(activityLog);
    client.close();

    expect(first).toMatchObject({ eligible: 2, sent: 2, skipped: 0 });
    expect(second).toMatchObject({ eligible: 2, sent: 0, skipped: 2 });
    expect(logs).toHaveLength(2);
    expect(logs.map((log) => log.action)).toEqual(["payment_reminder", "payment_reminder"]);
    expect(sentPayloads).toHaveLength(2);
    expect(sentPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subject: "TutorLoft payment reminder TL-202607-0001",
          text: expect.stringContaining("https://tutorloft.test/invoices/invoice_due_3"),
        }),
        expect.objectContaining({
          subject: "TutorLoft payment reminder TL-202607-0002",
          text: expect.stringContaining("due+10"),
        }),
      ]),
    );
  });

  it("builds a copyable Bangla and English reminder message", () => {
    const message = paymentReminderMessage({
      balance: 1500,
      dueDate: Date.UTC(2026, 6, 10),
      invoiceNumber: "TL-202607-0001",
      invoiceUrl: "https://tutorloft.test/invoices/invoice_due_3",
      studentName: "Student One",
    });

    expect(message).toContain("Payment reminder");
    expect(message).toContain("পেমেন্ট রিমাইন্ডার");
    expect(message).toContain("1500");
    expect(message).toContain("https://tutorloft.test/invoices/invoice_due_3");
  });
});
