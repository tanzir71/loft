import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";

import { courses, materials, schema } from "@/db/schema";
import { generateAiJson } from "@/lib/ai/provider";
import { savePromptHistory } from "@/lib/ai/sources";

type AppDb = LibSQLDatabase<typeof schema>;
type FetchFn = typeof fetch;

type RefineMaterialInput = {
  action: string;
  apiKey: string;
  bloomLevel?: string;
  customInstruction?: string;
  differentiationLevel?: string;
  fetchFn?: FetchFn;
  materialId: string;
  model?: string;
  now?: () => number;
  provider?: string;
  readingLevel?: string;
  translateTo?: string;
};

const refineActionSchema = z.enum(["expand", "simplify", "examples"]);
const refineInputSchema = z.object({
  action: refineActionSchema,
  bloomLevel: z.string().trim().optional(),
  customInstruction: z.string().trim().optional(),
  differentiationLevel: z.string().trim().optional(),
  materialId: z.string().trim().min(1),
  readingLevel: z.string().trim().optional(),
  translateTo: z.string().trim().optional(),
});
const refinedMaterialSchema = z.object({
  bodyMd: z.string().trim().min(1),
});
const refinedMaterialJsonSchema = {
  additionalProperties: false,
  properties: {
    bodyMd: { type: "string" },
  },
  required: ["bodyMd"],
  type: "object",
};

async function requireMaterialContext(database: AppDb, materialId: string) {
  const [row] = await database
    .select({
      bodyMd: materials.bodyMd,
      courseId: materials.courseId,
      courseSubject: courses.subject,
      courseTitle: courses.title,
      id: materials.id,
      planJson: materials.planJson,
      title: materials.title,
      type: materials.type,
    })
    .from(materials)
    .innerJoin(courses, eq(materials.courseId, courses.id))
    .where(and(eq(materials.id, materialId), eq(courses.status, "active")));

  if (!row) {
    throw new Error("Material not found.");
  }

  return row;
}

function actionLabel(action: z.infer<typeof refineActionSchema>) {
  if (action === "expand") {
    return "expand the material with more explanation and teacher-ready detail";
  }

  if (action === "simplify") {
    return "simplify the material while preserving the key learning goal";
  }

  return "add worked examples and concrete practice prompts";
}

function refinePrompt(input: {
  action: z.infer<typeof refineActionSchema>;
  bloomLevel?: string;
  customInstruction?: string;
  differentiationLevel?: string;
  material: Awaited<ReturnType<typeof requireMaterialContext>>;
  readingLevel?: string;
  translateTo?: string;
}) {
  return [
    `Refine the markdown material "${input.material.title}".`,
    `Course: ${input.material.courseTitle}`,
    `Subject: ${input.material.courseSubject}`,
    `Material type: ${input.material.type}`,
    `Action: ${actionLabel(input.action)}.`,
    input.differentiationLevel ? `Level: ${input.differentiationLevel}` : "",
    input.bloomLevel ? `Bloom target: ${input.bloomLevel}` : "",
    input.readingLevel ? `Reading level: ${input.readingLevel}` : "",
    input.translateTo ? `Translate to: ${input.translateTo}` : "",
    input.customInstruction ? `Custom instruction: ${input.customInstruction}` : "",
    "",
    "Return JSON with bodyMd only. Preserve useful markdown structure.",
    input.material.planJson ? `\nPlan JSON:\n${JSON.stringify(input.material.planJson)}` : "",
    `\nCurrent markdown:\n${input.material.bodyMd}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function refineMaterialContent(database: AppDb, input: RefineMaterialInput) {
  const parsed = refineInputSchema.parse(input);
  const material = await requireMaterialContext(database, parsed.materialId);
  const generated = await generateAiJson<unknown>({
    apiKey: input.apiKey,
    fetchFn: input.fetchFn,
    jsonSchema: refinedMaterialJsonSchema,
    model: input.model,
    prompt: refinePrompt({
      action: parsed.action,
      bloomLevel: parsed.bloomLevel,
      customInstruction: parsed.customInstruction,
      differentiationLevel: parsed.differentiationLevel,
      material,
      readingLevel: parsed.readingLevel,
      translateTo: parsed.translateTo,
    }),
    provider: input.provider,
    schemaName: "refined_material",
    system: "You refine tutoring LMS materials. Return only JSON.",
  });
  const refined = refinedMaterialSchema.parse(generated.json);
  const now = input.now?.() ?? Date.now();
  const [updated] = await database
    .update(materials)
    .set({
      bodyMd: refined.bodyMd,
      updatedAt: now,
    })
    .where(eq(materials.id, material.id))
    .returning();

  if (!updated) {
    throw new Error("Material not found.");
  }

  const history = await savePromptHistory(database, {
    feature: "refine",
    input: {
      action: parsed.action,
      bloomLevel: parsed.bloomLevel ?? "",
      customInstruction: parsed.customInstruction ?? "",
      differentiationLevel: parsed.differentiationLevel ?? "",
      feature: "refine",
      materialId: material.id,
      model: generated.model,
      output: refined,
      provider: generated.provider,
      readingLevel: parsed.readingLevel ?? "",
      translateTo: parsed.translateTo ?? "",
    },
    now: input.now,
  });

  return {
    history,
    material: updated,
    refined,
  };
}
