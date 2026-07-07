import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { materials, schema } from "@/db/schema";
import { refineMaterialContent } from "@/lib/ai/refine";
import { createCourse } from "@/lib/courses";
import { createMaterial } from "@/lib/content";
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

describe("AI refine actions", () => {
  it("refines and persists a material body with differentiation controls", async () => {
    const { client, db } = await createMigratedDb();
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    await createMaterial(db, {
      bodyMd: "Solve x + 3 = 8.",
      courseId: "course_id",
      makeId: () => "material_id",
      title: "Equation notes",
      type: "lecture",
    });
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  bodyMd: "### Worked examples\nSolve x + 3 = 8 by subtracting 3.",
                }),
              },
            },
          ],
        }),
      )) as typeof fetch;

    const result = await refineMaterialContent(db, {
      action: "examples",
      apiKey: "openrouter-key",
      bloomLevel: "analyze",
      customInstruction: "Use local context.",
      differentiationLevel: "support",
      fetchFn,
      materialId: "material_id",
      provider: "openrouter",
      readingLevel: "simple",
      translateTo: "Bangla",
    });
    const [material] = await db.select().from(materials).where(eq(materials.id, "material_id"));
    client.close();

    expect(result.material.bodyMd).toBe(
      "### Worked examples\nSolve x + 3 = 8 by subtracting 3.",
    );
    expect(material.bodyMd).toBe(result.material.bodyMd);
    expect(result.history.inputJson).toMatchObject({
      action: "examples",
      bloomLevel: "analyze",
      customInstruction: "Use local context.",
      differentiationLevel: "support",
      feature: "refine",
      materialId: "material_id",
      readingLevel: "simple",
      translateTo: "Bangla",
    });
  });
});
