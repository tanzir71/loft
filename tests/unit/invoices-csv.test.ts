import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createRatePlan, invoicesCsv, sellPackage } from "@/lib/billing";
import { schema } from "@/db/schema";
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
    password: "correct horse battery staple",
  });

  return { client, db };
}

describe("invoice CSV export", () => {
  it("exports invoice summaries as CSV", async () => {
    const { client, db } = await createMigratedDb();
    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
    });
    const plan = await createRatePlan(db, {
      amount: 300000,
      makeId: () => "plan_id",
      name: "Starter package",
      sessionsCount: 2,
      type: "package",
    });
    await sellPackage(db, {
      makeId: (kind) => `${kind}_id`,
      purchasedAt: Date.UTC(2026, 6, 1),
      ratePlanId: plan.id,
      studentId: "student_id",
    });

    const csv = await invoicesCsv(db);
    client.close();

    expect(csv).toContain("Invoice,Student,Email,Status,Total,Paid,Balance,Due date");
    expect(csv).toContain("TL-202607-0001,Student One,student@example.com,draft,300000,0,300000,2026-07-01");
  });
});
