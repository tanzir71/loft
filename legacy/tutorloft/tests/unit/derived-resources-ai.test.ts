import { createClient, type Client } from "@libsql/client";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assignments,
  materialStandards,
  materials,
  quizQuestions,
  quizStandards,
  quizzes,
  schema,
} from "@/db/schema";
import {
  generateDerivedResourcePlan,
  materializeDerivedResourcePlan,
} from "@/lib/ai/derived-resources";
import { createCourse } from "@/lib/courses";
import { createMaterial, createModule, lessonPlanSectionDefinitions } from "@/lib/content";
import { seedTutor } from "@/lib/seed";
import { createStandard, tagMaterialStandards } from "@/lib/standards";

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

const derivedPayload = {
  lecture: {
    bodyMd: "# Explain one-step equations\nUse balance language.",
    title: "AI lecture: one-step equations",
  },
  quiz: {
    instructionsMd: "Check equation fluency.",
    questions: [
      {
        correctOptionId: "a",
        options: [
          { id: "a", text: "5" },
          { id: "b", text: "11" },
        ],
        points: 1,
        promptMd: "Solve x + 3 = 8.",
        type: "mcq_single",
      },
    ],
    title: "AI quiz: one-step equations",
  },
  rubric: {
    bodyMd: "Show your equation steps.",
    points: 10,
    rubricMd: "- Accuracy: 5\n- Reasoning: 5",
    title: "AI equation practice",
  },
  study: {
    bodyMd: "Key idea: inverse operations undo each other.",
    title: "AI study notes: one-step equations",
  },
  worksheet: {
    bodyMd: "1. Solve x + 3 = 8\n2. Solve y - 4 = 9",
    title: "AI worksheet: one-step equations",
  },
};

async function seedSourceMaterial(
  db: Awaited<ReturnType<typeof createMigratedDb>>["db"],
) {
  await createCourse(db, {
    description: "",
    makeId: () => "course_id",
    subject: "Math",
    title: "Algebra I",
  });
  await createModule(db, {
    courseId: "course_id",
    makeId: () => "module_id",
    title: "Linear foundations",
  });
  await createStandard(db, {
    code: "A1",
    description: "Solve one-step equations",
    framework: "Custom",
    makeId: () => "standard_id",
  });
  await createMaterial(db, {
    bodyMd: "Use inverse operations.",
    courseId: "course_id",
    makeId: () => "source_material_id",
    moduleId: "module_id",
    planJson: {
      sections: lessonPlanSectionDefinitions.map((section) => ({
        body: section.id === "objectives" ? "Students solve equations." : "",
        enabled: section.id === "objectives",
        id: section.id,
        title: section.title,
      })),
    },
    title: "One-step equations plan",
    type: "lesson_plan",
  });
  await tagMaterialStandards(db, {
    materialId: "source_material_id",
    standardIds: ["standard_id"],
  });
}

describe("AI derived resources", () => {
  it("generates a structured resource plan with inherited standard context", async () => {
    const { client, db } = await createMigratedDb();
    await seedSourceMaterial(db);
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(derivedPayload) } }],
        }),
      )) as typeof fetch;

    const result = await generateDerivedResourcePlan(db, {
      apiKey: "openrouter-key",
      fetchFn,
      materialId: "source_material_id",
      provider: "openrouter",
      resourceKinds: ["lecture", "study", "worksheet", "quiz", "rubric"],
    });
    client.close();

    expect(result.plan.lecture?.title).toBe("AI lecture: one-step equations");
    expect(result.plan.quiz?.questions[0]).toMatchObject({
      correctOptionId: "a",
      promptMd: "Solve x + 3 = 8.",
      type: "mcq_single",
    });
    expect(result.history.inputJson).toMatchObject({
      feature: "derived_resources",
      materialId: "source_material_id",
      resourceKinds: ["lecture", "study", "worksheet", "quiz", "rubric"],
      standardCodes: ["Custom A1"],
    });
  });

  it("materializes draft resources beside the source material and inherits standards", async () => {
    const { client, db } = await createMigratedDb();
    await seedSourceMaterial(db);

    const result = await materializeDerivedResourcePlan(db, {
      makeId: (kind, index) => `${kind}_${index ?? 0}`,
      materialId: "source_material_id",
      plan: derivedPayload,
    });
    const materialRows = await db
      .select()
      .from(materials)
      .where(inArray(materials.id, ["lecture_0", "study_0", "worksheet_0"]));
    const materialTagRows = await db
      .select()
      .from(materialStandards)
      .where(
        and(
          inArray(materialStandards.materialId, ["lecture_0", "study_0", "worksheet_0"]),
          eq(materialStandards.standardId, "standard_id"),
        ),
      );
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, "quiz_0"));
    const [question] = await db
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.id, "question_0"));
    const [quizTag] = await db
      .select()
      .from(quizStandards)
      .where(and(eq(quizStandards.quizId, "quiz_0"), eq(quizStandards.standardId, "standard_id")));
    const [assignment] = await db
      .select()
      .from(assignments)
      .where(eq(assignments.id, "assignment_0"));
    client.close();

    expect(result).toMatchObject({
      assignmentId: "assignment_0",
      materialIds: ["lecture_0", "study_0", "worksheet_0"],
      quizId: "quiz_0",
    });
    expect(materialRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          moduleId: "module_id",
          status: "draft",
          title: "AI lecture: one-step equations",
          type: "lecture",
          visibility: "students",
        }),
        expect.objectContaining({
          moduleId: "module_id",
          status: "draft",
          title: "AI study notes: one-step equations",
          type: "study",
        }),
        expect.objectContaining({
          moduleId: "module_id",
          status: "draft",
          title: "AI worksheet: one-step equations",
          type: "worksheet",
        }),
      ]),
    );
    expect(materialTagRows).toHaveLength(3);
    expect(quiz).toMatchObject({
      courseId: "course_id",
      instructionsMd: "Check equation fluency.",
      status: "draft",
      title: "AI quiz: one-step equations",
    });
    expect(question).toMatchObject({
      points: 1,
      promptMd: "Solve x + 3 = 8.",
      type: "mcq_single",
    });
    expect(quizTag).toMatchObject({ standardId: "standard_id" });
    expect(assignment).toMatchObject({
      bodyMd: "Show your equation steps.",
      courseId: "course_id",
      points: 10,
      rubricMd: "- Accuracy: 5\n- Reasoning: 5",
      status: "draft",
      title: "AI equation practice",
    });
  });
});
