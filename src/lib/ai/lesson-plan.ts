import { and, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";

import { courses, materials, schema, standards } from "@/db/schema";
import {
  lessonPlanSectionDefinitions,
  lessonPlanSections,
  type LessonPlanJson,
} from "@/lib/content";
import { generateAiJson } from "@/lib/ai/provider";
import { collectAiSources, savePromptHistory } from "@/lib/ai/sources";

type AppDb = LibSQLDatabase<typeof schema>;
type FetchFn = typeof fetch;

type GenerateLessonPlanInput = {
  apiKey: string;
  componentIds?: string[];
  courseId: string;
  fetchFn?: FetchFn;
  lessonTitle: string;
  makeHistoryId?: () => string;
  materialIds?: string[];
  model?: string;
  now?: () => number;
  pastedText?: string;
  provider?: string;
  standardIds?: string[];
  urls?: string[];
  youtubeTranscript?: string;
  youtubeUrl?: string;
};

type RegenerateLessonPlanSectionInput = {
  apiKey: string;
  fetchFn?: FetchFn;
  materialId: string;
  materialIds?: string[];
  model?: string;
  now?: () => number;
  pastedText?: string;
  provider?: string;
  sectionId: string;
  urls?: string[];
  youtubeTranscript?: string;
  youtubeUrl?: string;
};

const lessonPlanInputSchema = z.object({
  componentIds: z.array(z.string().trim().min(1)).optional(),
  courseId: z.string().trim().min(1),
  lessonTitle: z.string().trim().min(1),
  materialIds: z.array(z.string().trim().min(1)).optional(),
  pastedText: z.string().optional(),
  standardIds: z.array(z.string().trim().min(1)).optional(),
  urls: z.array(z.string().trim().url()).optional(),
  youtubeTranscript: z.string().optional(),
  youtubeUrl: z.string().trim().url().optional(),
});

const regenerateInputSchema = z.object({
  materialId: z.string().trim().min(1),
  materialIds: z.array(z.string().trim().min(1)).optional(),
  pastedText: z.string().optional(),
  sectionId: z.string().trim().min(1),
  urls: z.array(z.string().trim().url()).optional(),
  youtubeTranscript: z.string().optional(),
  youtubeUrl: z.string().trim().url().optional(),
});

const generatedLessonPlanSchema = z.object({
  sections: z.array(
    z.object({
      body: z.string().trim(),
      id: z.string().trim().min(1),
    }),
  ),
});

const generatedSectionSchema = z.object({
  body: z.string().trim(),
});

const lessonPlanJsonSchema = {
  additionalProperties: false,
  properties: {
    sections: {
      items: {
        additionalProperties: false,
        properties: {
          body: { type: "string" },
          id: { type: "string" },
        },
        required: ["id", "body"],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["sections"],
  type: "object",
};

const lessonPlanSectionJsonSchema = {
  additionalProperties: false,
  properties: {
    body: { type: "string" },
  },
  required: ["body"],
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

function unique(values: string[] = []) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function selectedStandards(database: AppDb, standardIds: string[] = []) {
  const ids = unique(standardIds);

  if (ids.length === 0) {
    return [];
  }

  const rows = await database
    .select({
      code: standards.code,
      description: standards.description,
      framework: standards.framework,
      id: standards.id,
    })
    .from(standards)
    .where(and(inArray(standards.id, ids), eq(standards.active, true)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = ids.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (ordered.length !== ids.length) {
    throw new Error("Standard not found.");
  }

  return ordered;
}

function standardCode(standard: Awaited<ReturnType<typeof selectedStandards>>[number]) {
  return `${standard.framework} ${standard.code}`.trim();
}

function sectionLabelList(sectionIds: string[]) {
  const selected = new Set(sectionIds);

  return lessonPlanSectionDefinitions
    .filter((section) => selected.has(section.id))
    .map((section) => `${section.id}: ${section.title}`)
    .join("\n");
}

function selectedComponentIds(componentIds: string[] | undefined) {
  const allowed = new Set<string>(lessonPlanSectionDefinitions.map((section) => section.id));
  const ids = unique(componentIds).filter((id) => allowed.has(id));

  return ids.length > 0
    ? ids
    : lessonPlanSectionDefinitions
        .filter((section) => section.id !== "notes")
        .map((section) => section.id);
}

function lessonPlanPrompt(input: {
  componentIds: string[];
  course: Awaited<ReturnType<typeof requireActiveCourse>>;
  lessonTitle: string;
  sourceText: string;
  standards: Awaited<ReturnType<typeof selectedStandards>>;
}) {
  const standardLines = input.standards
    .map((standard) => `- ${standardCode(standard)}: ${standard.description}`)
    .join("\n");

  return [
    `Create a structured tutoring lesson plan for "${input.lessonTitle}".`,
    `Course: ${input.course.title}`,
    `Subject: ${input.course.subject}`,
    input.course.description ? `Course description: ${input.course.description}` : "",
    "",
    "Return JSON with a sections array. Only include these section ids:",
    sectionLabelList(input.componentIds),
    "",
    "Keep each section concise, classroom-ready, and aligned to the selected standards.",
    standardLines ? `Selected standards:\n${standardLines}` : "",
    input.sourceText ? `\nSource material:\n${input.sourceText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function regeneratePrompt(input: {
  currentBody: string;
  lessonTitle: string;
  sectionTitle: string;
  sourceText: string;
}) {
  return [
    `Regenerate only the "${input.sectionTitle}" section for the lesson plan "${input.lessonTitle}".`,
    "Return JSON with one body string.",
    "Keep it practical for a tutoring session and do not rewrite other sections.",
    input.currentBody ? `Current section:\n${input.currentBody}` : "",
    input.sourceText ? `\nAdditional source material:\n${input.sourceText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPlanJson(componentIds: string[], generated: z.infer<typeof generatedLessonPlanSchema>) {
  const enabled = new Set(componentIds);
  const bodies = new Map(generated.sections.map((section) => [section.id, section.body]));

  return {
    sections: lessonPlanSectionDefinitions.map((section) => ({
      body: enabled.has(section.id) ? bodies.get(section.id) ?? "" : "",
      enabled: enabled.has(section.id),
      id: section.id,
      title: section.title,
    })),
  } satisfies LessonPlanJson;
}

function normalizedPlan(planJson: unknown): LessonPlanJson {
  const saved = new Map(lessonPlanSections(planJson).map((section) => [section.id, section]));

  return {
    sections: lessonPlanSectionDefinitions.map((section) => {
      const existing = saved.get(section.id);

      return {
        body: existing?.body ?? "",
        enabled: existing?.enabled ?? false,
        id: section.id,
        title: section.title,
      };
    }),
  };
}

export async function generateLessonPlanDraft(
  database: AppDb,
  input: GenerateLessonPlanInput,
) {
  const parsed = lessonPlanInputSchema.parse(input);
  const course = await requireActiveCourse(database, parsed.courseId);
  const componentIds = selectedComponentIds(parsed.componentIds);
  const [sources, standardsRows] = await Promise.all([
    collectAiSources(database, {
      fetchFn: input.fetchFn,
      materialIds: parsed.materialIds,
      pastedText: parsed.pastedText,
      urls: parsed.urls,
      youtubeTranscript: parsed.youtubeTranscript,
      youtubeUrl: parsed.youtubeUrl,
    }),
    selectedStandards(database, parsed.standardIds),
  ]);
  const generated = await generateAiJson<unknown>({
    apiKey: input.apiKey,
    fetchFn: input.fetchFn,
    jsonSchema: lessonPlanJsonSchema,
    model: input.model,
    prompt: lessonPlanPrompt({
      componentIds,
      course,
      lessonTitle: parsed.lessonTitle,
      sourceText: sources.combinedText,
      standards: standardsRows,
    }),
    provider: input.provider,
    schemaName: "lesson_plan",
    system: "You design practical tutoring lesson plans. Return only JSON.",
  });
  const generatedPlan = generatedLessonPlanSchema.parse(generated.json);
  const planJson = buildPlanJson(componentIds, generatedPlan);
  const standardCodes = standardsRows.map(standardCode);
  const history = await savePromptHistory(database, {
    feature: "lesson_plan",
    input: {
      componentIds,
      courseId: course.id,
      feature: "lesson_plan",
      lessonTitle: parsed.lessonTitle,
      model: generated.model,
      output: planJson,
      provider: generated.provider,
      sourceLabels: sources.sources.map((source) => source.label),
      standardCodes,
      standardIds: standardsRows.map((standard) => standard.id),
    },
    makeId: input.makeHistoryId,
    now: input.now,
  });

  return {
    history,
    planJson,
    sources: sources.sources,
    standards: standardsRows,
  };
}

export async function regenerateLessonPlanSection(
  database: AppDb,
  input: RegenerateLessonPlanSectionInput,
) {
  const parsed = regenerateInputSchema.parse(input);
  const [material] = await database
    .select({
      bodyMd: materials.bodyMd,
      courseId: materials.courseId,
      id: materials.id,
      planJson: materials.planJson,
      title: materials.title,
      type: materials.type,
    })
    .from(materials)
    .where(eq(materials.id, parsed.materialId));

  if (!material || material.type !== "lesson_plan") {
    throw new Error("Lesson plan material not found.");
  }

  await requireActiveCourse(database, material.courseId);

  const definition = lessonPlanSectionDefinitions.find((section) => section.id === parsed.sectionId);

  if (!definition) {
    throw new Error("Lesson plan section not found.");
  }

  const planJson = normalizedPlan(material.planJson);
  const current = planJson.sections.find((section) => section.id === definition.id);
  const sources = await collectAiSources(database, {
    fetchFn: input.fetchFn,
    materialIds: parsed.materialIds,
    pastedText: parsed.pastedText,
    urls: parsed.urls,
    youtubeTranscript: parsed.youtubeTranscript,
    youtubeUrl: parsed.youtubeUrl,
  });
  const generated = await generateAiJson<unknown>({
    apiKey: input.apiKey,
    fetchFn: input.fetchFn,
    jsonSchema: lessonPlanSectionJsonSchema,
    model: input.model,
    prompt: regeneratePrompt({
      currentBody: current?.body ?? "",
      lessonTitle: material.title,
      sectionTitle: definition.title,
      sourceText: sources.combinedText,
    }),
    provider: input.provider,
    schemaName: "lesson_plan_section",
    system: "You revise one tutoring lesson-plan section. Return only JSON.",
  });
  const section = generatedSectionSchema.parse(generated.json);
  const updatedPlan = {
    sections: planJson.sections.map((existing) =>
      existing.id === definition.id
        ? { ...existing, body: section.body, enabled: true, title: definition.title }
        : existing,
    ),
  } satisfies LessonPlanJson;
  const now = input.now?.() ?? Date.now();
  const [updated] = await database
    .update(materials)
    .set({
      planJson: updatedPlan,
      updatedAt: now,
    })
    .where(eq(materials.id, material.id))
    .returning();

  if (!updated) {
    throw new Error("Lesson plan material not found.");
  }

  return {
    material: updated,
    planJson: updatedPlan,
  };
}
