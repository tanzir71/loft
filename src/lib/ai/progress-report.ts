import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";

import { schema } from "@/db/schema";
import { generateAiJson } from "@/lib/ai/provider";
import { savePromptHistory } from "@/lib/ai/sources";
import {
  collectProgressReportFacts,
  createProgressReport,
} from "@/lib/progress-reports";

type AppDb = LibSQLDatabase<typeof schema>;
type FetchFn = typeof fetch;

type GenerateProgressReportInput = {
  apiKey: string;
  fetchFn?: FetchFn;
  makeId?: () => string;
  model?: string;
  now?: () => number;
  periodEnd: number;
  periodStart: number;
  provider?: string;
  studentId: string;
};

const progressReportInputSchema = z.object({
  periodEnd: z.number().int(),
  periodStart: z.number().int(),
  studentId: z.string().trim().min(1),
});
const progressReportDraftSchema = z.object({
  bodyMd: z.string().trim().min(1),
});
const progressReportJsonSchema = {
  additionalProperties: false,
  properties: {
    bodyMd: { type: "string" },
  },
  required: ["bodyMd"],
  type: "object",
};

function progressReportPrompt(facts: Awaited<ReturnType<typeof collectProgressReportFacts>>) {
  return [
    `Write a parent-ready progress report narrative for ${facts.student.name}.`,
    "Use only the structured facts. Do not invent scores, attendance, or courses.",
    "Keep the tone warm, specific, and practical. Mention next steps when useful.",
    "",
    `Structured facts:\n${JSON.stringify(facts, null, 2)}`,
  ].join("\n");
}

export async function generateProgressReportNarrative(
  database: AppDb,
  input: GenerateProgressReportInput,
) {
  const parsed = progressReportInputSchema.parse(input);

  if (parsed.periodEnd < parsed.periodStart) {
    throw new Error("Report period is invalid.");
  }

  const facts = await collectProgressReportFacts(database, parsed);
  const generated = await generateAiJson<unknown>({
    apiKey: input.apiKey,
    fetchFn: input.fetchFn,
    jsonSchema: progressReportJsonSchema,
    model: input.model,
    prompt: progressReportPrompt(facts),
    provider: input.provider,
    schemaName: "progress_report",
    system: "You write concise tutoring progress reports from structured facts. Return only JSON.",
  });
  const draft = progressReportDraftSchema.parse(generated.json);
  const report = await createProgressReport(database, {
    bodyMd: draft.bodyMd,
    makeId: input.makeId,
    now: input.now,
    periodEnd: parsed.periodEnd,
    periodStart: parsed.periodStart,
    studentId: facts.student.id,
  });
  const history = await savePromptHistory(database, {
    feature: "progress_report",
    input: {
      facts,
      feature: "progress_report",
      model: generated.model,
      output: draft,
      provider: generated.provider,
      studentId: facts.student.id,
    },
    now: input.now,
  });

  return {
    facts,
    history,
    report,
  };
}
