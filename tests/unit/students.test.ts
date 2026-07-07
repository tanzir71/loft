import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parentLinks, schema, users } from "@/db/schema";
import {
  archiveStudent,
  createStudent,
  listStudentsWithParents,
  updateStudent,
} from "@/lib/students";
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

describe("students", () => {
  it("creates a student record with normalized email and a non-usable generated password", async () => {
    const { client, db } = await createMigratedDb();

    const student = await createStudent(db, {
      email: " Student@Example.com ",
      makeId: () => "student_id",
      makePassword: () => "temporary random password",
      name: " Student One ",
      now: () => 2000,
    });
    const [storedStudent] = await db.select().from(users).where(eq(users.id, "student_id"));
    client.close();

    expect(student).toMatchObject({
      email: "student@example.com",
      id: "student_id",
      name: "Student One",
      role: "student",
      status: "active",
    });
    expect(storedStudent.passwordHash).not.toBe("temporary random password");
  });

  it("updates a student without changing their role", async () => {
    const { client, db } = await createMigratedDb();
    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
      now: () => 2000,
    });

    const updated = await updateStudent(db, {
      email: "updated@example.com",
      id: "student_id",
      name: "Updated Student",
      now: () => 3000,
      status: "active",
    });
    client.close();

    expect(updated).toMatchObject({
      email: "updated@example.com",
      id: "student_id",
      name: "Updated Student",
      role: "student",
      status: "active",
      updatedAt: 3000,
    });
  });

  it("archives students instead of deleting them", async () => {
    const { client, db } = await createMigratedDb();
    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
      now: () => 2000,
    });

    const archived = await archiveStudent(db, {
      id: "student_id",
      now: () => 3000,
    });
    const rows = await db.select().from(users).where(eq(users.id, "student_id"));
    client.close();

    expect(archived.status).toBe("archived");
    expect(rows).toHaveLength(1);
  });

  it("lists students with linked parent accounts", async () => {
    const { client, db } = await createMigratedDb();
    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
      now: () => 2000,
    });
    await db.insert(users).values({
      id: "parent_id",
      name: "Parent One",
      email: "parent@example.com",
      passwordHash: "hash",
      role: "parent",
      status: "active",
      createdAt: 2000,
      updatedAt: 2000,
    });
    await db.insert(parentLinks).values({
      parentId: "parent_id",
      studentId: "student_id",
    });

    const students = await listStudentsWithParents(db);
    client.close();

    expect(students).toEqual([
      expect.objectContaining({
        email: "student@example.com",
        id: "student_id",
        parents: [
          {
            email: "parent@example.com",
            id: "parent_id",
            name: "Parent One",
          },
        ],
      }),
    ]);
  });
});
