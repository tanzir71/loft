import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { materials, schema } from "@/db/schema";
import {
  generateLessonPlanDraft,
  regenerateLessonPlanSection,
} from "@/lib/ai/lesson-plan";
import { createCourse } from "@/lib/courses";
import { createMaterial, lessonPlanSectionDefinitions } from "@/lib/content";
import { seedTutor } from "@/lib/seed";
import { createStandard } from "@/lib/standards";

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

describe("AI lesson plans", () => {
  it("generates selected lesson-plan sections aligned to standards", async () => {
    const { client, db } = await createMigratedDb();
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    await createStandard(db, {
      code: "A1",
      description: "Solve one-step equations",
      framework: "Custom",
      makeId: () => "standard_id",
    });
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  sections: [
                    { body: "Students solve one-step equations.", id: "objectives" },
                    { body: "Guided equation practice.", id: "practice" },
                  ],
                }),
              },
            },
          ],
        }),
      )) as typeof fetch;

    const result = await generateLessonPlanDraft(db, {
      apiKey: "openrouter-key",
      componentIds: ["objectives", "practice"],
      courseId: "course_id",
      fetchFn,
      lessonTitle: "One-step equations",
      provider: "openrouter",
      standardIds: ["standard_id"],
    });
    client.close();

    expect(result.planJson.sections).toEqual(
      expect.arrayContaining([
        {
          body: "Students solve one-step equations.",
          enabled: true,
          id: "objectives",
          title: "Objectives",
        },
        {
          body: "Guided equation practice.",
          enabled: true,
          id: "practice",
          title: "Practice",
        },
      ]),
    );
    expect(result.planJson.sections.find((section) => section.id === "warmup")?.enabled).toBe(
      false,
    );
    expect(result.history.inputJson).toMatchObject({
      feature: "lesson_plan",
      lessonTitle: "One-step equations",
      standardCodes: ["Custom A1"],
    });
  });

  it("regenerates one lesson-plan section without replacing the rest", async () => {
    const { client, db } = await createMigratedDb();
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    await createMaterial(db, {
      bodyMd: "Lesson overview.",
      courseId: "course_id",
      makeId: () => "material_id",
      planJson: {
        sections: lessonPlanSectionDefinitions.map((section) => ({
          body: section.id === "objectives" ? "Old objective." : "Keep me.",
          enabled: section.id === "objectives" || section.id === "practice",
          id: section.id,
          title: section.title,
        })),
      },
      title: "One-step equations",
      type: "lesson_plan",
    });
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ body: "New objective." }) } }],
        }),
      )) as typeof fetch;

    const updated = await regenerateLessonPlanSection(db, {
      apiKey: "openrouter-key",
      fetchFn,
      materialId: "material_id",
      provider: "openrouter",
      sectionId: "objectives",
    });
    const [material] = await db.select().from(materials).where(eq(materials.id, "material_id"));
    client.close();

    expect(updated.planJson.sections.find((section) => section.id === "objectives")?.body).toBe(
      "New objective.",
    );
    expect(updated.planJson.sections.find((section) => section.id === "practice")?.body).toBe(
      "Keep me.",
    );
    expect(material.planJson).toMatchObject(updated.planJson);
  });
});
