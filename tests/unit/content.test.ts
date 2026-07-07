import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { schema } from "@/db/schema";
import { createCourse } from "@/lib/courses";
import { createMaterial, createModule, listCourseContent, updateMaterial, updateModule } from "@/lib/content";
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
  });

  return { client, db };
}

describe("course content", () => {
  it("creates ordered modules and editable materials with safe defaults", async () => {
    const { client, db } = await createMigratedDb();
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    await createModule(db, {
      courseId: "course_id",
      makeId: () => "module_1",
      title: "Foundations",
    });
    await createModule(db, {
      courseId: "course_id",
      makeId: () => "module_2",
      title: "Equations",
    });
    await updateModule(db, {
      description: "Start here",
      id: "module_2",
      sortOrder: 0,
      status: "published",
      title: "Linear equations",
    });
    const material = await createMaterial(db, {
      bodyMd: "# Warm up",
      courseId: "course_id",
      makeId: () => "material_1",
      moduleId: "module_2",
      title: "Lesson notes",
      type: "lesson_plan",
    });
    await updateMaterial(db, {
      bodyMd: "# Updated",
      courseId: "course_id",
      id: "material_1",
      moduleId: "module_1",
      sortOrder: 2,
      status: "published",
      title: "Updated notes",
      type: "lecture",
      visibility: "students",
    });
    const content = await listCourseContent(db, "course_id");
    client.close();

    expect(material.visibility).toBe("tutor_only");
    expect(content.modules.map((module) => module.title)).toEqual([
      "Foundations",
      "Linear equations",
    ]);
    expect(content.materials).toMatchObject([
      {
        bodyMd: "# Updated",
        moduleId: "module_1",
        sortOrder: 2,
        status: "published",
        title: "Updated notes",
        visibility: "students",
      },
    ]);
  });
});
