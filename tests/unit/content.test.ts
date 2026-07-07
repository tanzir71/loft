import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { materials, schema } from "@/db/schema";
import { createCourse, enrollStudent } from "@/lib/courses";
import {
  addMaterialLink,
  createMaterial,
  createModule,
  duplicateMaterial,
  duplicateModule,
  getStudentMaterial,
  lessonPlanToMarkdown,
  listCourseContent,
  listStudentVisibleMaterials,
  markMaterialComplete,
  updateMaterial,
  updateModule,
} from "@/lib/content";
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

describe("course content", () => {
  it("creates ordered modules and editable materials with safe defaults", async () => {
    const { client, db } = await createMigratedDb();
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    await createCourse(db, {
      description: "",
      makeId: () => "target_course_id",
      subject: "Math",
      title: "Algebra II",
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
    await addMaterialLink(db, {
      kind: "youtube",
      label: "Demo video",
      makeId: () => "link_1",
      materialId: "material_1",
      url: "https://youtu.be/abcDEF123_4",
    });
    await duplicateMaterial(db, {
      id: "material_1",
      makeId: () => "material_copy",
      targetCourseId: "target_course_id",
    });
    await duplicateModule(db, {
      id: "module_1",
      makeId: (kind, index) => `${kind}_copy_${index}`,
      targetCourseId: "target_course_id",
    });
    const content = await listCourseContent(db, "course_id");
    const copiedContent = await listCourseContent(db, "target_course_id");
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
    expect(content.completionCounts).toEqual({});
    expect(content.linksByMaterial.material_1).toMatchObject([
      {
        id: "link_1",
        kind: "youtube",
        label: "Demo video",
      },
    ]);
    expect(copiedContent.modules).toMatchObject([
      { id: "module_copy_0", title: "Foundations copy" },
    ]);
    expect(copiedContent.materials.map((row) => row.id).sort()).toEqual([
      "material_copy",
      "material_copy_0",
    ]);
  });

  it("stores structured lesson plans as tutor-only content and exports enabled sections", async () => {
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
    const planJson = {
      sections: [
        { body: "Students solve two warm-up equations.", enabled: true, id: "warmup", title: "Warm-up" },
        { body: "Internal pacing notes.", enabled: false, id: "notes", title: "Tutor notes" },
      ],
    };
    const lessonInput = {
      bodyMd: "Bring algebra tiles.",
      courseId: "course_id",
      makeId: () => "lesson_id",
      planJson,
      status: "published" as const,
      title: "Linear equations plan",
      type: "lesson_plan" as const,
    };
    const worksheet = await createMaterial(db, {
      bodyMd: "1. Solve x + 3 = 8",
      courseId: "course_id",
      makeId: () => "worksheet_id",
      status: "published",
      title: "Equation worksheet",
      type: "worksheet",
    });
    const lesson = await createMaterial(db, lessonInput);
    const markdown = lessonPlanToMarkdown(lesson.title, lesson.bodyMd, lesson.planJson);

    await expect(
      getStudentMaterial(db, {
        materialId: "lesson_id",
        studentId: "student_id",
      }),
    ).rejects.toMatchObject({ status: 403 });
    client.close();

    expect(lesson.visibility).toBe("tutor_only");
    expect(lesson.planJson).toEqual(planJson);
    expect(worksheet.visibility).toBe("students");
    expect(markdown).toContain("# Linear equations plan");
    expect(markdown).toContain("## Warm-up");
    expect(markdown).toContain("Students solve two warm-up equations.");
    expect(markdown).not.toContain("Internal pacing notes.");
  });

  it("enforces student material visibility at read time", async () => {
    const { client, db } = await createMigratedDb();
    const now = Date.UTC(2026, 6, 1);
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
    await createModule(db, {
      courseId: "course_id",
      makeId: () => "module_id",
      title: "Foundations",
    });
    await createMaterial(db, {
      bodyMd: "Visible now",
      courseId: "course_id",
      makeId: () => "visible_id",
      moduleId: "module_id",
      status: "published",
      title: "Visible",
      type: "lecture",
      visibility: "students",
    });
    await createMaterial(db, {
      bodyMd: "Later",
      courseId: "course_id",
      makeId: () => "scheduled_id",
      moduleId: "module_id",
      publishAt: now + 24 * 60 * 60 * 1000,
      status: "published",
      title: "Scheduled",
      type: "lecture",
      visibility: "students",
    });
    await createMaterial(db, {
      bodyMd: "Private",
      courseId: "course_id",
      makeId: () => "private_id",
      moduleId: "module_id",
      status: "published",
      title: "Private",
      type: "lecture",
      visibility: "tutor_only",
    });

    const beforeModulePublish = await listStudentVisibleMaterials(db, {
      courseId: "course_id",
      now,
      studentId: "student_id",
    });
    await updateModule(db, {
      description: "",
      id: "module_id",
      sortOrder: 0,
      status: "published",
      title: "Foundations",
    });
    const visibleNow = await listStudentVisibleMaterials(db, {
      courseId: "course_id",
      now,
      studentId: "student_id",
    });
    const visibleLater = await listStudentVisibleMaterials(db, {
      courseId: "course_id",
      now: now + 2 * 24 * 60 * 60 * 1000,
      studentId: "student_id",
    });
    client.close();

    expect(beforeModulePublish).toEqual([]);
    expect(visibleNow.map((material) => material.title)).toEqual(["Visible"]);
    expect(visibleLater.map((material) => material.title)).toEqual(["Visible", "Scheduled"]);
  });

  it("blocks prerequisite-gated materials until the student completes the prerequisite", async () => {
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
    await createMaterial(db, {
      bodyMd: "First",
      courseId: "course_id",
      makeId: () => "first_id",
      status: "published",
      title: "First",
      type: "lecture",
      visibility: "students",
    });
    await createMaterial(db, {
      bodyMd: "Second",
      courseId: "course_id",
      makeId: () => "second_id",
      status: "published",
      title: "Second",
      type: "lecture",
      visibility: "students",
    });
    await db
      .update(materials)
      .set({ requiresMaterialId: "first_id" })
      .where(eq(materials.id, "second_id"));

    await expect(
      getStudentMaterial(db, {
        materialId: "second_id",
        studentId: "student_id",
      }),
    ).rejects.toMatchObject({ status: 403 });
    await markMaterialComplete(db, {
      makeId: () => "progress_id",
      materialId: "first_id",
      studentId: "student_id",
    });
    const unlocked = await getStudentMaterial(db, {
      materialId: "second_id",
      studentId: "student_id",
    });
    client.close();

    expect(unlocked.id).toBe("second_id");
  });
});
