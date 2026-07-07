import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { invites, parentLinks, schema, users } from "@/db/schema";
import { createInvite, registerWithInvite } from "@/lib/invites";
import { seedTutor } from "@/lib/seed";

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
    now: () => 1000,
    makeId: () => "tutor_id",
  });

  return { client, db };
}

describe("invites", () => {
  it("creates a student invite and consumes it exactly once", async () => {
    const { client, db } = await createMigratedDb();
    const invite = await createInvite(db, {
      role: "student",
      now: () => 2000,
      makeId: () => "invite_id",
      makeCode: () => "STUDENTCODE",
    });

    const student = await registerWithInvite(db, {
      code: "STUDENTCODE",
      name: "Student One",
      email: "student@example.com",
      password: "student password",
      now: () => 3000,
      makeId: () => "student_id",
    });
    const [storedInvite] = await db.select().from(invites).where(eq(invites.id, invite.id));
    const [storedStudent] = await db.select().from(users).where(eq(users.id, "student_id"));

    expect(invite).toMatchObject({
      id: "invite_id",
      code: "STUDENTCODE",
      role: "student",
      expiresAt: 604802000,
    });
    expect(student).toMatchObject({ id: "student_id", role: "student" });
    expect(storedStudent.passwordHash).not.toBe("student password");
    expect(storedInvite.usedBy).toBe("student_id");
    await expect(
      registerWithInvite(db, {
        code: "STUDENTCODE",
        name: "Second Student",
        email: "student2@example.com",
        password: "student password",
      }),
    ).rejects.toThrow("Invite has already been used");
    client.close();
  });

  it("creates a parent invite that links the new parent to the selected student", async () => {
    const { client, db } = await createMigratedDb();
    await db.insert(users).values({
      id: "student_id",
      name: "Student One",
      email: "student@example.com",
      passwordHash: "hash",
      role: "student",
      status: "active",
      createdAt: 1000,
      updatedAt: 1000,
    });
    await createInvite(db, {
      role: "parent",
      studentId: "student_id",
      now: () => 2000,
      makeId: () => "parent_invite_id",
      makeCode: () => "PARENTCODE",
    });

    const parent = await registerWithInvite(db, {
      code: "PARENTCODE",
      name: "Parent One",
      email: "parent@example.com",
      password: "parent password",
      now: () => 3000,
      makeId: () => "parent_id",
    });
    const links = await db.select().from(parentLinks);
    client.close();

    expect(parent).toMatchObject({ id: "parent_id", role: "parent" });
    expect(links).toEqual([{ parentId: "parent_id", studentId: "student_id" }]);
  });

  it("accepts invite codes case-insensitively during registration", async () => {
    const { client, db } = await createMigratedDb();
    await createInvite(db, {
      role: "student",
      now: () => 2000,
      makeId: () => "invite_id",
      makeCode: () => "STUDENTCODE",
    });

    const student = await registerWithInvite(db, {
      code: "studentcode",
      name: "Student One",
      email: "student@example.com",
      password: "student password",
      now: () => 3000,
      makeId: () => "student_id",
    });
    client.close();

    expect(student).toMatchObject({ id: "student_id", role: "student" });
  });

  it("rejects parent invites for missing students", async () => {
    const { client, db } = await createMigratedDb();

    await expect(
      createInvite(db, {
        role: "parent",
        studentId: "missing_student_id",
      }),
    ).rejects.toThrow("Parent invites require an active student.");
    client.close();
  });
});
