import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { quizzes, schema } from "@/db/schema";
import { createCourse } from "@/lib/courses";
import { createMaterial } from "@/lib/content";
import { seedTutor } from "@/lib/seed";
import {
  bulkImportStandards,
  courseCoverageMatrix,
  createStandard,
  listStandards,
  tagMaterialStandards,
  tagQuizStandards,
  updateStandard,
} from "@/lib/standards";

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

describe("standards library", () => {
  it("imports, edits, tags materials and quizzes, and reports course coverage gaps", async () => {
    const { client, db } = await createMigratedDb();
    const now = Date.UTC(2026, 6, 7);
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    await createMaterial(db, {
      bodyMd: "Solve equations.",
      courseId: "course_id",
      makeId: () => "material_id",
      status: "published",
      title: "Equation notes",
      type: "lecture",
    });
    await db.insert(quizzes).values({
      id: "quiz_id",
      courseId: "course_id",
      title: "Equation check",
      instructionsMd: "",
      status: "draft",
      openAt: null,
      closeAt: null,
      timeLimitMin: null,
      maxAttempts: 1,
      shuffle: false,
      createdAt: now,
      updatedAt: now,
    });
    const imported = await bulkImportStandards(db, {
      makeId: (index) => `standard_${index}`,
      text: "CCSS|6.EE.A.1|Write expressions\nCCSS|6.EE.A.2|Solve equations",
    });
    const gap = await createStandard(db, {
      code: "6.EE.A.3",
      description: "Apply properties",
      framework: "CCSS",
      makeId: () => "gap_standard",
    });
    await updateStandard(db, {
      active: true,
      code: "6.EE.A.3",
      description: "Apply properties to equivalent expressions",
      framework: "CCSS",
      id: gap.id,
    });
    await tagMaterialStandards(db, {
      materialId: "material_id",
      standardIds: [imported[0].id],
    });
    await tagQuizStandards(db, {
      quizId: "quiz_id",
      standardIds: [imported[1].id],
    });

    const standards = await listStandards(db);
    const matrix = await courseCoverageMatrix(db, "course_id");
    client.close();

    expect(standards.map((standard) => standard.code)).toEqual([
      "6.EE.A.1",
      "6.EE.A.2",
      "6.EE.A.3",
    ]);
    expect(matrix).toMatchObject([
      {
        code: "6.EE.A.1",
        covered: true,
        gap: false,
        materialTitles: ["Equation notes"],
        quizTitles: [],
      },
      {
        code: "6.EE.A.2",
        covered: true,
        gap: false,
        materialTitles: [],
        quizTitles: ["Equation check"],
      },
      {
        code: "6.EE.A.3",
        covered: false,
        gap: true,
        materialTitles: [],
        quizTitles: [],
      },
    ]);
  });
});
