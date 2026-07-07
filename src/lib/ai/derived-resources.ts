import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";

import { courses, materialStandards, materials, schema, standards } from "@/db/schema";
import { generateAiJson } from "@/lib/ai/provider";
import { collectAiSources, savePromptHistory } from "@/lib/ai/sources";
import { createAssignment } from "@/lib/classroom";
import { createMaterial } from "@/lib/content";
import { createQuiz, createQuizQuestion } from "@/lib/quizzes";
import { tagMaterialStandards, tagQuizStandards } from "@/lib/standards";

type AppDb = LibSQLDatabase<typeof schema>;
type FetchFn = typeof fetch;
type DerivedMaterialKind = "lecture" | "study" | "worksheet";
type DerivedResourceKind = DerivedMaterialKind | "quiz" | "rubric";
type MaterializeKind = DerivedResourceKind | "assignment" | "question";

type GenerateDerivedResourceInput = {
  apiKey: string;
  fetchFn?: FetchFn;
  materialId: string;
  materialIds?: string[];
  model?: string;
  now?: () => number;
  pastedText?: string;
  provider?: string;
  resourceKinds: DerivedResourceKind[];
  urls?: string[];
  youtubeTranscript?: string;
  youtubeUrl?: string;
};

type MaterializeDerivedResourceInput = {
  makeId?: (kind: MaterializeKind, index?: number) => string;
  materialId: string;
  now?: () => number;
  plan: unknown;
};

const resourceKindSchema = z.enum(["lecture", "study", "worksheet", "quiz", "rubric"]);
const generateInputSchema = z.object({
  materialId: z.string().trim().min(1),
  materialIds: z.array(z.string().trim().min(1)).optional(),
  pastedText: z.string().optional(),
  resourceKinds: z.array(resourceKindSchema).min(1),
  urls: z.array(z.string().trim().url()).optional(),
  youtubeTranscript: z.string().optional(),
  youtubeUrl: z.string().trim().url().optional(),
});
const materializeInputSchema = z.object({
  materialId: z.string().trim().min(1),
});
const materialDraftSchema = z.object({
  bodyMd: z.string().trim().min(1),
  title: z.string().trim().min(1),
});
const optionSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1),
});
const questionDraftSchema = z.discriminatedUnion("type", [
  z.object({
    correctOptionId: z.string().trim().min(1),
    options: z.array(optionSchema).min(2),
    points: z.number().int().min(1).default(1),
    promptMd: z.string().trim().min(1),
    type: z.literal("mcq_single"),
  }),
  z.object({
    correctOptionIds: z.array(z.string().trim().min(1)).min(1),
    options: z.array(optionSchema).min(2),
    points: z.number().int().min(1).default(1),
    promptMd: z.string().trim().min(1),
    type: z.literal("mcq_multi"),
  }),
  z.object({
    points: z.number().int().min(1).default(1),
    promptMd: z.string().trim().min(1),
    trueFalseAnswer: z.boolean(),
    type: z.literal("true_false"),
  }),
  z.object({
    acceptedAnswers: z.array(z.string().trim().min(1)).min(1),
    points: z.number().int().min(1).default(1),
    promptMd: z.string().trim().min(1),
    type: z.literal("short_answer"),
  }),
]);
const quizDraftSchema = z.object({
  instructionsMd: z.string().trim(),
  questions: z.array(questionDraftSchema).min(1).max(12),
  title: z.string().trim().min(1),
});
const rubricDraftSchema = z.object({
  bodyMd: z.string().trim().min(1),
  points: z.number().int().min(0).nullable().optional(),
  rubricMd: z.string().trim().min(1),
  title: z.string().trim().min(1),
});

export const derivedResourcePlanSchema = z.object({
  lecture: materialDraftSchema.optional(),
  quiz: quizDraftSchema.optional(),
  rubric: rubricDraftSchema.optional(),
  study: materialDraftSchema.optional(),
  worksheet: materialDraftSchema.optional(),
});

export type DerivedResourcePlan = z.infer<typeof derivedResourcePlanSchema>;

const derivedResourceJsonSchema = {
  additionalProperties: false,
  properties: {
    lecture: {
      additionalProperties: false,
      properties: {
        bodyMd: { type: "string" },
        title: { type: "string" },
      },
      required: ["title", "bodyMd"],
      type: "object",
    },
    quiz: {
      additionalProperties: false,
      properties: {
        instructionsMd: { type: "string" },
        questions: {
          items: {
            additionalProperties: false,
            properties: {
              acceptedAnswers: { items: { type: "string" }, type: "array" },
              correctOptionId: { type: "string" },
              correctOptionIds: { items: { type: "string" }, type: "array" },
              options: {
                items: {
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    text: { type: "string" },
                  },
                  required: ["id", "text"],
                  type: "object",
                },
                type: "array",
              },
              points: { type: "number" },
              promptMd: { type: "string" },
              trueFalseAnswer: { type: "boolean" },
              type: {
                enum: ["mcq_single", "mcq_multi", "true_false", "short_answer"],
                type: "string",
              },
            },
            required: ["type", "promptMd", "points"],
            type: "object",
          },
          type: "array",
        },
        title: { type: "string" },
      },
      required: ["title", "instructionsMd", "questions"],
      type: "object",
    },
    rubric: {
      additionalProperties: false,
      properties: {
        bodyMd: { type: "string" },
        points: { type: "number" },
        rubricMd: { type: "string" },
        title: { type: "string" },
      },
      required: ["title", "bodyMd", "rubricMd"],
      type: "object",
    },
    study: {
      additionalProperties: false,
      properties: {
        bodyMd: { type: "string" },
        title: { type: "string" },
      },
      required: ["title", "bodyMd"],
      type: "object",
    },
    worksheet: {
      additionalProperties: false,
      properties: {
        bodyMd: { type: "string" },
        title: { type: "string" },
      },
      required: ["title", "bodyMd"],
      type: "object",
    },
  },
  type: "object",
};

async function requireSourceMaterial(database: AppDb, materialId: string) {
  const [row] = await database
    .select({
      bodyMd: materials.bodyMd,
      courseDescription: courses.description,
      courseId: materials.courseId,
      courseSubject: courses.subject,
      courseTitle: courses.title,
      id: materials.id,
      moduleId: materials.moduleId,
      planJson: materials.planJson,
      title: materials.title,
      type: materials.type,
    })
    .from(materials)
    .innerJoin(courses, eq(materials.courseId, courses.id))
    .where(and(eq(materials.id, materialId), eq(courses.status, "active")));

  if (!row) {
    throw new Error("Source material not found.");
  }

  return row;
}

async function inheritedStandards(database: AppDb, materialId: string) {
  return database
    .select({
      code: standards.code,
      description: standards.description,
      framework: standards.framework,
      id: standards.id,
    })
    .from(materialStandards)
    .innerJoin(standards, eq(materialStandards.standardId, standards.id))
    .where(and(eq(materialStandards.materialId, materialId), eq(standards.active, true)));
}

function unique(values: string[] = []) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function standardCode(standard: Awaited<ReturnType<typeof inheritedStandards>>[number]) {
  return `${standard.framework} ${standard.code}`.trim();
}

function resourceLabel(kind: DerivedResourceKind) {
  if (kind === "study") {
    return "study notes material";
  }

  if (kind === "rubric") {
    return "assignment with rubricMd";
  }

  return kind;
}

function derivedResourcePrompt(input: {
  resourceKinds: DerivedResourceKind[];
  source: Awaited<ReturnType<typeof requireSourceMaterial>>;
  sourceText: string;
  standards: Awaited<ReturnType<typeof inheritedStandards>>;
}) {
  const standardLines = input.standards
    .map((standard) => `- ${standardCode(standard)}: ${standard.description}`)
    .join("\n");

  return [
    `Create derived teaching resources from "${input.source.title}".`,
    `Course: ${input.source.courseTitle}`,
    `Subject: ${input.source.courseSubject}`,
    input.source.courseDescription ? `Course description: ${input.source.courseDescription}` : "",
    `Source type: ${input.source.type}`,
    "",
    `Return JSON keys for: ${input.resourceKinds.map(resourceLabel).join(", ")}.`,
    "Keep every resource draft editable and suitable for a one-tutor LMS.",
    "For quiz questions, use the requested question JSON shape with stable option ids.",
    standardLines ? `Inherited standards:\n${standardLines}` : "",
    input.sourceText ? `\nSource material:\n${input.sourceText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function questionPayload(question: z.infer<typeof questionDraftSchema>) {
  if (question.type === "mcq_single") {
    return {
      answerJson: { correctOptionId: question.correctOptionId },
      optionsJson: { options: question.options },
    };
  }

  if (question.type === "mcq_multi") {
    return {
      answerJson: { correctOptionIds: question.correctOptionIds },
      optionsJson: { options: question.options },
    };
  }

  if (question.type === "true_false") {
    return {
      answerJson: { value: question.trueFalseAnswer },
      optionsJson: null,
    };
  }

  return {
    answerJson: { acceptedAnswers: question.acceptedAnswers },
    optionsJson: null,
  };
}

export async function generateDerivedResourcePlan(
  database: AppDb,
  input: GenerateDerivedResourceInput,
) {
  const parsed = generateInputSchema.parse(input);
  const source = await requireSourceMaterial(database, parsed.materialId);
  const materialIds = unique([source.id, ...(parsed.materialIds ?? [])]);
  const [sources, standardRows] = await Promise.all([
    collectAiSources(database, {
      fetchFn: input.fetchFn,
      materialIds,
      pastedText: parsed.pastedText,
      urls: parsed.urls,
      youtubeTranscript: parsed.youtubeTranscript,
      youtubeUrl: parsed.youtubeUrl,
    }),
    inheritedStandards(database, source.id),
  ]);
  const generated = await generateAiJson<unknown>({
    apiKey: input.apiKey,
    fetchFn: input.fetchFn,
    jsonSchema: derivedResourceJsonSchema,
    model: input.model,
    prompt: derivedResourcePrompt({
      resourceKinds: parsed.resourceKinds,
      source,
      sourceText: sources.combinedText,
      standards: standardRows,
    }),
    provider: input.provider,
    schemaName: "derived_resources",
    system: "You turn lesson materials into editable LMS resources. Return only JSON.",
  });
  const plan = derivedResourcePlanSchema.parse(generated.json);
  const history = await savePromptHistory(database, {
    feature: "derived_resources",
    input: {
      feature: "derived_resources",
      materialId: source.id,
      model: generated.model,
      output: plan,
      provider: generated.provider,
      resourceKinds: parsed.resourceKinds,
      sourceLabels: sources.sources.map((sourceItem) => sourceItem.label),
      standardCodes: standardRows.map(standardCode),
      standardIds: standardRows.map((standard) => standard.id),
    },
    now: input.now,
  });

  return {
    history,
    plan,
    sources: sources.sources,
    standards: standardRows,
  };
}

export async function materializeDerivedResourcePlan(
  database: AppDb,
  input: MaterializeDerivedResourceInput,
) {
  const parsed = materializeInputSchema.parse(input);
  const source = await requireSourceMaterial(database, parsed.materialId);
  const plan = derivedResourcePlanSchema.parse(input.plan);
  const standardIds = (await inheritedStandards(database, source.id)).map((standard) => standard.id);
  const materialIds: string[] = [];
  const questionIds: string[] = [];

  async function createDerivedMaterial(kind: DerivedMaterialKind, draft: z.infer<typeof materialDraftSchema> | undefined) {
    if (!draft) {
      return;
    }

    const material = await createMaterial(database, {
      bodyMd: draft.bodyMd,
      courseId: source.courseId,
      makeId: input.makeId ? () => input.makeId?.(kind) ?? "" : undefined,
      moduleId: source.moduleId,
      now: input.now,
      status: "draft",
      title: draft.title,
      type: kind,
      visibility: "students",
    });
    materialIds.push(material.id);

    if (standardIds.length > 0) {
      await tagMaterialStandards(database, {
        materialId: material.id,
        standardIds,
      });
    }
  }

  await createDerivedMaterial("lecture", plan.lecture);
  await createDerivedMaterial("study", plan.study);
  await createDerivedMaterial("worksheet", plan.worksheet);

  let quizId: string | null = null;

  if (plan.quiz) {
    const quiz = await createQuiz(database, {
      courseId: source.courseId,
      instructionsMd: plan.quiz.instructionsMd,
      makeId: input.makeId ? () => input.makeId?.("quiz") ?? "" : undefined,
      maxAttempts: 1,
      now: input.now,
      status: "draft",
      title: plan.quiz.title,
    });
    quizId = quiz.id;

    for (const [index, question] of plan.quiz.questions.entries()) {
      const payload = questionPayload(question);
      const createdQuestion = await createQuizQuestion(database, {
        ...payload,
        makeId: input.makeId ? () => input.makeId?.("question", index) ?? "" : undefined,
        points: question.points,
        promptMd: question.promptMd,
        quizId: quiz.id,
        sortOrder: index,
        type: question.type,
      });
      questionIds.push(createdQuestion.id);
    }

    if (standardIds.length > 0) {
      await tagQuizStandards(database, {
        quizId: quiz.id,
        standardIds,
      });
    }
  }

  let assignmentId: string | null = null;

  if (plan.rubric) {
    const assignment = await createAssignment(database, {
      allowFile: false,
      allowLink: true,
      allowText: true,
      bodyMd: plan.rubric.bodyMd,
      courseId: source.courseId,
      makeId: input.makeId ? () => input.makeId?.("assignment") ?? "" : undefined,
      now: input.now,
      points: plan.rubric.points ?? null,
      rubricMd: plan.rubric.rubricMd,
      status: "draft",
      title: plan.rubric.title,
    });
    assignmentId = assignment.id;
  }

  return {
    assignmentId,
    materialIds,
    questionIds,
    quizId,
  };
}
