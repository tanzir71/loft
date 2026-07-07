import { createClient, type Client } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { courses, enrollments, schema } from "@/db/schema";
import {
  archiveCourse,
  createCourse,
  enrollStudent,
  listCoursesWithEnrollments,
  updateCourse,
  unenrollStudent,
} from "@/lib/courses";
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
    now: () => 1000,
    makeId: () => "tutor_id",
  });

  return { client, db };
}

describe("courses", () => {
  it("creates and updates a course", async () => {
    const { client, db } = await createMigratedDb();
    const course = await createCourse(db, {
      description: "  Algebra foundations  ",
      makeId: () => "course_id",
      now: () => 2000,
      subject: " Math ",
      title: " Algebra I ",
    });

    const updated = await updateCourse(db, {
      description: "Linear equations",
      id: "course_id",
      now: () => 3000,
      status: "active",
      subject: "Mathematics",
      title: "Algebra IA",
    });
    client.close();

    expect(course).toMatchObject({
      description: "Algebra foundations",
      id: "course_id",
      status: "active",
      subject: "Math",
      title: "Algebra I",
    });
    expect(updated).toMatchObject({
      description: "Linear equations",
      id: "course_id",
      status: "active",
      subject: "Mathematics",
      title: "Algebra IA",
      updatedAt: 3000,
    });
  });

  it("archives courses instead of deleting them", async () => {
    const { client, db } = await createMigratedDb();
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });

    const archived = await archiveCourse(db, {
      id: "course_id",
      now: () => 3000,
    });
    const rows = await db.select().from(courses).where(eq(courses.id, "course_id"));
    client.close();

    expect(archived.status).toBe("archived");
    expect(rows).toHaveLength(1);
  });

  it("enrolls and unenrolls active students without deleting enrollment history", async () => {
    const { client, db } = await createMigratedDb();
    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
    });
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });

    const enrollment = await enrollStudent(db, {
      courseId: "course_id",
      makeId: () => "enrollment_id",
      now: () => 3000,
      studentId: "student_id",
    });
    const archived = await unenrollStudent(db, {
      courseId: "course_id",
      now: () => 4000,
      studentId: "student_id",
    });
    const rows = await db
      .select()
      .from(enrollments)
      .where(
        and(
          eq(enrollments.courseId, "course_id"),
          eq(enrollments.studentId, "student_id"),
        ),
      );
    client.close();

    expect(enrollment).toMatchObject({
      id: "enrollment_id",
      status: "active",
    });
    expect(archived.status).toBe("archived");
    expect(rows).toHaveLength(1);
  });

  it("lists courses with active enrolled students", async () => {
    const { client, db } = await createMigratedDb();
    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
    });
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    await enrollStudent(db, {
      courseId: "course_id",
      makeId: () => "enrollment_id",
      studentId: "student_id",
    });

    const listed = await listCoursesWithEnrollments(db);
    client.close();

    expect(listed).toEqual([
      expect.objectContaining({
        id: "course_id",
        students: [
          {
            email: "student@example.com",
            enrollmentId: "enrollment_id",
            id: "student_id",
            name: "Student One",
          },
        ],
      }),
    ]);
  });
});
