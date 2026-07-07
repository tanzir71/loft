import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";

import { courses, promptHistory, schema } from "@/db/schema";
import { createMaterial, createModule } from "@/lib/content";
import { generateAiJson } from "@/lib/ai/provider";
import { collectAiSources, savePromptHistory } from "@/lib/ai/sources";

type AppDb = LibSQLDatabase<typeof schema>;
type FetchFn = typeof fetch;

type GenerateCourseOutlineInput = {
  apiKey: string;
  courseId: string;
  fetchFn?: FetchFn;
  goal: string;
  makeHistoryId?: () => string;
  materialIds?: string[];
  model?: string;
  now?: () => number;
  pastedText?: string;
  provider?: string;
  urls?: string[];
  youtubeTranscript?: string;
  youtubeUrl?: string;
};

type MaterializeCourseOutlineInput = {
  courseId: string;
  makeId?: (kind: "material" | "module", moduleIndex: number, materialIndex?: number) => string;
  now?: () => number;
  plan: CourseOutlinePlan;
};

const outlineMaterialSchema = z.object({
  bodyMd: z.string().trim().optional(),
  title: z.string().trim().min(1),
  type: z.enum(["lecture", "study", "lesson_plan", "worksheet"]).default("study"),
});

const outlineModuleSchema = z.object({
  description: z.string().trim().optional(),
  materials: z.array(outlineMaterialSchema).default([]),
  title: z.string().trim().min(1),
});

export const courseOutlinePlanSchema = z.object({
  modules: z.array(outlineModuleSchema).min(1).max(12),
});

export type CourseOutlinePlan = z.infer<typeof courseOutlinePlanSchema>;

const courseOutlineJsonSchema = {
  additionalProperties: false,
  properties: {
    modules: {
      items: {
        additionalProperties: false,
        properties: {
          description: { type: "string" },
          materials: {
            items: {
              additionalProperties: false,
              properties: {
                bodyMd: { type: "string" },
                title: { type: "string" },
                type: {
                  enum: ["lecture", "study", "lesson_plan", "worksheet"],
                  type: "string",
                },
              },
              required: ["title", "type"],
              type: "object",
            },
            type: "array",
          },
          title: { type: "string" },
        },
        required: ["title", "materials"],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["modules"],
  type: "object",
};

async function requireActiveCourse(database: AppDb, courseId: string) {
  const [course] = await database
    .select({
      description: courses.description,
      id: courses.id,
      subject: courses.subject,
      title: courses.title,
    })
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.status, "active")));

  if (!course) {
    throw new Error("Active course not found.");
  }

  return course;
}

function outlinePrompt(input: {
  course: Awaited<ReturnType<typeof requireActiveCourse>>;
  goal: string;
  sourceText: string;
}) {
  return [
    `Create an editable course outline for ${input.course.title}.`,
    `Subject: ${input.course.subject}`,
    input.course.description ? `Course description: ${input.course.description}` : "",
    `Tutor goal: ${input.goal}`,
    "",
    "Return concise module titles with draft material stubs the tutor can edit.",
    "Prefer practical lesson sequencing for a one-tutor LMS.",
    input.sourceText ? `\nSource material:\n${input.sourceText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateCourseOutlinePlan(
  database: AppDb,
  input: GenerateCourseOutlineInput,
) {
  const course = await requireActiveCourse(database, input.courseId);
  const sources = await collectAiSources(database, {
    fetchFn: input.fetchFn,
    materialIds: input.materialIds,
    pastedText: input.pastedText,
    urls: input.urls,
    youtubeTranscript: input.youtubeTranscript,
    youtubeUrl: input.youtubeUrl,
  });
  const generated = await generateAiJson<CourseOutlinePlan>({
    apiKey: input.apiKey,
    fetchFn: input.fetchFn,
    jsonSchema: courseOutlineJsonSchema,
    model: input.model,
    prompt: outlinePrompt({
      course,
      goal: input.goal,
      sourceText: sources.combinedText,
    }),
    provider: input.provider,
    schemaName: "course_outline",
    system: "You design practical tutoring curricula. Return only JSON.",
  });
  const plan = courseOutlinePlanSchema.parse(generated.json);
  const history = await savePromptHistory(database, {
    feature: "course_outline",
    input: {
      courseId: course.id,
      goal: input.goal,
      model: generated.model,
      output: plan,
      provider: generated.provider,
      sourceLabels: sources.sources.map((source) => source.label),
    },
    makeId: input.makeHistoryId,
    now: input.now,
  });

  return { history, plan, sources: sources.sources };
}

export async function getCourseOutlineDraft(database: AppDb, historyId: string) {
  const [row] = await database
    .select()
    .from(promptHistory)
    .where(and(eq(promptHistory.id, historyId), eq(promptHistory.feature, "course_outline")));

  if (!row) {
    return null;
  }

  const parsed = z.object({ output: courseOutlinePlanSchema }).safeParse(row.inputJson);

  if (!parsed.success) {
    return null;
  }

  return {
    createdAt: row.createdAt,
    id: row.id,
    plan: parsed.data.output,
  };
}

export async function materializeCourseOutlinePlan(
  database: AppDb,
  input: MaterializeCourseOutlineInput,
) {
  const plan = courseOutlinePlanSchema.parse(input.plan);
  const now = input.now ?? (() => Date.now());
  let materialsCreated = 0;

  await requireActiveCourse(database, input.courseId);

  for (const [moduleIndex, modulePlan] of plan.modules.entries()) {
    const createdModule = await createModule(database, {
      courseId: input.courseId,
      description: modulePlan.description ?? "",
      makeId: input.makeId ? () => input.makeId?.("module", moduleIndex) ?? "" : undefined,
      now,
      sortOrder: moduleIndex,
      title: modulePlan.title,
    });

    for (const [materialIndex, materialPlan] of modulePlan.materials.entries()) {
      await createMaterial(database, {
        bodyMd: materialPlan.bodyMd?.trim() || `Draft notes for ${materialPlan.title}.`,
        courseId: input.courseId,
        makeId: input.makeId
          ? () => input.makeId?.("material", moduleIndex, materialIndex) ?? ""
          : undefined,
        moduleId: createdModule.id,
        now,
        sortOrder: materialIndex,
        status: "draft",
        title: materialPlan.title,
        type: materialPlan.type,
        visibility: "students",
      });
      materialsCreated += 1;
    }
  }

  return {
    materialsCreated,
    modulesCreated: plan.modules.length,
  };
}
