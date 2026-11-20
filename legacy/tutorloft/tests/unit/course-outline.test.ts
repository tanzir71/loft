import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { materials, modules, promptHistory, schema } from "@/db/schema";
import {
  generateCourseOutlinePlan,
  getCourseOutlineDraft,
  materializeCourseOutlinePlan,
} from "@/lib/ai/course-outline";
import { createCourse } from "@/lib/courses";
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

const outlinePayload = {
  modules: [
    {
      description: "Linear equation foundations.",
      materials: [
        {
          bodyMd: "Diagnostic prompts and vocabulary.",
          title: "Entry diagnostic",
          type: "study",
        },
      ],
      title: "Linear foundations",
    },
    {
      materials: [{ title: "Practice set", type: "worksheet" }],
      title: "Equation practice",
    },
  ],
};

describe("AI course outlines", () => {
  it("generates a course outline plan and stores the editable draft in prompt history", async () => {
    const { client, db } = await createMigratedDb();
    await createCourse(db, {
      description: "Algebra foundations",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(outlinePayload) } }],
        }),
      )) as typeof fetch;

    const result = await generateCourseOutlinePlan(db, {
      apiKey: "openrouter-key",
      courseId: "course_id",
      fetchFn,
      goal: "Build a four-week algebra intro.",
      makeHistoryId: () => "history_id",
      now: () => Date.UTC(2026, 6, 7, 12),
      pastedText: "Students know arithmetic.",
      provider: "openrouter",
    });
    const [history] = await db
      .select()
      .from(promptHistory)
      .where(eq(promptHistory.id, "history_id"));
    const draft = await getCourseOutlineDraft(db, "history_id");
    client.close();

    expect(result.plan.modules).toHaveLength(2);
    expect(result.history.id).toBe("history_id");
    expect(history.feature).toBe("course_outline");
    expect(history.inputJson).toMatchObject({
      courseId: "course_id",
      goal: "Build a four-week algebra intro.",
      output: outlinePayload,
    });
    expect(draft?.plan.modules[0].title).toBe("Linear foundations");
  });

  it("materializes edited outline modules and draft stub materials", async () => {
    const { client, db } = await createMigratedDb();
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });

    const result = await materializeCourseOutlinePlan(db, {
      courseId: "course_id",
      makeId: (kind, moduleIndex, materialIndex) =>
        materialIndex === undefined
          ? `${kind}_${moduleIndex}`
          : `${kind}_${moduleIndex}_${materialIndex}`,
      plan: {
        modules: [
          {
            description: "Edited module description.",
            materials: [
              {
                bodyMd: "Edited source notes.",
                title: "Edited lecture",
                type: "lecture",
              },
              {
                title: "Stub worksheet",
                type: "worksheet",
              },
            ],
            title: "Edited foundations",
          },
        ],
      },
      now: () => Date.UTC(2026, 6, 7, 12),
    });
    const [moduleRow] = await db.select().from(modules).where(eq(modules.id, "module_0"));
    const materialRows = await db
      .select()
      .from(materials)
      .where(eq(materials.moduleId, "module_0"));
    client.close();

    expect(result).toMatchObject({ materialsCreated: 2, modulesCreated: 1 });
    expect(moduleRow).toMatchObject({
      description: "Edited module description.",
      sortOrder: 0,
      status: "draft",
      title: "Edited foundations",
    });
    expect(materialRows.map((material) => material.title)).toEqual([
      "Edited lecture",
      "Stub worksheet",
    ]);
    expect(materialRows[1]).toMatchObject({
      bodyMd: "Draft notes for Stub worksheet.",
      status: "draft",
      type: "worksheet",
      visibility: "students",
    });
  });
});
