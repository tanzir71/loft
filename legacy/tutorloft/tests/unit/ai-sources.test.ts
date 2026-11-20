import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { promptHistory, schema } from "@/db/schema";
import {
  collectAiSources,
  listPromptHistory,
  savePromptHistory,
} from "@/lib/ai/sources";
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

describe("AI sources and prompt history", () => {
  it("collects pasted text, fetched URL text, material bodies, and pasted YouTube notes", async () => {
    const { client, db } = await createMigratedDb();
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    await createMaterial(db, {
      bodyMd: "## Slope\nRise over run.",
      courseId: "course_id",
      makeId: () => "material_id",
      status: "published",
      title: "Slope lecture",
      type: "lecture",
    });
    const fetchFn = (async () =>
      new Response(
        "<html><head><title>Linear notes</title><script>ignore()</script></head><body><h1>Reference</h1><p>One-step equations.</p></body></html>",
      )) as typeof fetch;

    const bundle = await collectAiSources(db, {
      fetchFn,
      materialIds: ["material_id"],
      pastedText: "Tutor paste: emphasize checking work.",
      urls: ["https://example.com/linear"],
      youtubeTranscript: "Video notes: isolate the variable.",
      youtubeUrl: "https://youtu.be/abcDEF123_4",
    });
    client.close();

    expect(bundle.sources.map((source) => source.kind)).toEqual([
      "paste",
      "url",
      "material",
      "youtube",
    ]);
    expect(bundle.sources[1]).toMatchObject({
      content: expect.stringContaining("One-step equations."),
      label: "https://example.com/linear",
    });
    expect(bundle.sources[1].content).not.toContain("ignore()");
    expect(bundle.sources[2]).toMatchObject({
      content: expect.stringContaining("Rise over run."),
      label: "Slope lecture",
      materialId: "material_id",
    });
    expect(bundle.combinedText).toContain("Tutor paste");
    expect(bundle.combinedText).toContain("https://example.com/linear");
    expect(bundle.combinedText).toContain("Slope lecture");
    expect(bundle.combinedText).toContain("https://youtu.be/abcDEF123_4");
  });

  it("keeps the latest 20 prompt history rows per feature", async () => {
    const { client, db } = await createMigratedDb();
    const start = Date.UTC(2026, 6, 7, 12);

    for (let index = 0; index < 22; index += 1) {
      await savePromptHistory(db, {
        feature: "lesson_plan",
        input: { index },
        makeId: () => `lesson_${index}`,
        now: () => start + index,
      });
    }

    await savePromptHistory(db, {
      feature: "quiz",
      input: { index: "quiz" },
      makeId: () => "quiz_0",
      now: () => start + 100,
    });
    const lessonHistory = await listPromptHistory(db, "lesson_plan");
    const quizRows = await db
      .select()
      .from(promptHistory)
      .where(eq(promptHistory.feature, "quiz"));
    client.close();

    expect(lessonHistory).toHaveLength(20);
    expect(lessonHistory[0].inputJson).toEqual({ index: 21 });
    expect(lessonHistory.at(-1)?.inputJson).toEqual({ index: 2 });
    expect(lessonHistory.some((row) => row.id === "lesson_0")).toBe(false);
    expect(quizRows).toHaveLength(1);
  });
});
