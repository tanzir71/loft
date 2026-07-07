import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { courses, enrollments, ratePlans, schema } from "@/db/schema";
import {
  archiveRatePlan,
  createRatePlan,
  resolveEnrollmentRatePlan,
  setCourseDefaultRatePlan,
  setEnrollmentRatePlan,
  updateRatePlan,
} from "@/lib/billing";
import { createCourse, enrollStudent } from "@/lib/courses";
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

describe("billing rate plans", () => {
  it("creates, updates, and archives rate plans without deleting them", async () => {
    const { client, db } = await createMigratedDb();
    const plan = await createRatePlan(db, {
      amount: 150000,
      makeId: () => "plan_id",
      name: "Per session",
      now: () => 2000,
      type: "per_session",
    });
    const updated = await updateRatePlan(db, {
      active: true,
      amount: 175000,
      id: "plan_id",
      name: "Updated per session",
      now: () => 3000,
      sessionsCount: null,
      type: "per_session",
    });
    const archived = await archiveRatePlan(db, {
      id: "plan_id",
      now: () => 4000,
    });
    const rows = await db.select().from(ratePlans).where(eq(ratePlans.id, "plan_id"));
    client.close();

    expect(plan).toMatchObject({
      active: true,
      amount: 150000,
      name: "Per session",
      type: "per_session",
    });
    expect(updated).toMatchObject({
      amount: 175000,
      name: "Updated per session",
      updatedAt: 3000,
    });
    expect(archived.active).toBe(false);
    expect(rows).toHaveLength(1);
  });

  it("resolves enrollment rate plan override before course default", async () => {
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
    await createRatePlan(db, {
      amount: 100000,
      makeId: () => "course_plan_id",
      name: "Course default",
      type: "monthly_flat",
    });
    await createRatePlan(db, {
      amount: 150000,
      makeId: () => "override_plan_id",
      name: "Student override",
      type: "per_session",
    });
    await setCourseDefaultRatePlan(db, {
      courseId: "course_id",
      ratePlanId: "course_plan_id",
    });

    const courseDefault = await resolveEnrollmentRatePlan(db, {
      courseId: "course_id",
      studentId: "student_id",
    });
    await setEnrollmentRatePlan(db, {
      courseId: "course_id",
      ratePlanId: "override_plan_id",
      studentId: "student_id",
    });
    const override = await resolveEnrollmentRatePlan(db, {
      courseId: "course_id",
      studentId: "student_id",
    });
    const [course] = await db.select().from(courses).where(eq(courses.id, "course_id"));
    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, "enrollment_id"));
    client.close();

    expect(course.defaultRatePlanId).toBe("course_plan_id");
    expect(enrollment.ratePlanId).toBe("override_plan_id");
    expect(courseDefault?.id).toBe("course_plan_id");
    expect(override?.id).toBe("override_plan_id");
  });
});
