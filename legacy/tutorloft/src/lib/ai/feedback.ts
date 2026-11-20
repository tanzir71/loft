import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";

import { assignments, courses, schema, submissions, users } from "@/db/schema";
import { generateAiJson } from "@/lib/ai/provider";
import { savePromptHistory } from "@/lib/ai/sources";

type AppDb = LibSQLDatabase<typeof schema>;
type FetchFn = typeof fetch;

type DraftSubmissionFeedbackInput = {
  apiKey: string;
  fetchFn?: FetchFn;
  model?: string;
  now?: () => number;
  provider?: string;
  submissionId: string;
};

const feedbackInputSchema = z.object({
  submissionId: z.string().trim().min(1),
});
const feedbackDraftSchema = z.object({
  feedbackMd: z.string().trim().min(1),
});
const feedbackDraftJsonSchema = {
  additionalProperties: false,
  properties: {
    feedbackMd: { type: "string" },
  },
  required: ["feedbackMd"],
  type: "object",
};

async function requireSubmissionContext(database: AppDb, submissionId: string) {
  const [row] = await database
    .select({
      assignmentBodyMd: assignments.bodyMd,
      assignmentId: assignments.id,
      assignmentTitle: assignments.title,
      bodyText: submissions.bodyText,
      courseId: courses.id,
      courseTitle: courses.title,
      feedbackMd: submissions.feedbackMd,
      grade: submissions.grade,
      linkUrl: submissions.linkUrl,
      points: assignments.points,
      rubricMd: assignments.rubricMd,
      status: submissions.status,
      studentName: users.name,
      submissionId: submissions.id,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .innerJoin(courses, eq(assignments.courseId, courses.id))
    .innerJoin(users, eq(submissions.studentId, users.id))
    .where(eq(submissions.id, submissionId));

  if (!row) {
    throw new Error("Submission not found.");
  }

  return row;
}

function feedbackPrompt(context: Awaited<ReturnType<typeof requireSubmissionContext>>) {
  return [
    `Draft concise tutor feedback for ${context.studentName}'s submission.`,
    `Course: ${context.courseTitle}`,
    `Assignment: ${context.assignmentTitle}`,
    context.points !== null ? `Possible points: ${context.points}` : "",
    "",
    `Assignment instructions:\n${context.assignmentBodyMd}`,
    context.rubricMd ? `\nRubric:\n${context.rubricMd}` : "",
    context.bodyText ? `\nStudent submission:\n${context.bodyText}` : "",
    context.linkUrl ? `\nSubmitted link: ${context.linkUrl}` : "",
    context.feedbackMd ? `\nExisting feedback draft:\n${context.feedbackMd}` : "",
    "",
    "Return JSON with feedbackMd only. Be specific, encouraging, and action-oriented.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function draftSubmissionFeedback(
  database: AppDb,
  input: DraftSubmissionFeedbackInput,
) {
  const parsed = feedbackInputSchema.parse(input);
  const context = await requireSubmissionContext(database, parsed.submissionId);
  const generated = await generateAiJson<unknown>({
    apiKey: input.apiKey,
    fetchFn: input.fetchFn,
    jsonSchema: feedbackDraftJsonSchema,
    model: input.model,
    prompt: feedbackPrompt(context),
    provider: input.provider,
    schemaName: "submission_feedback",
    system: "You draft helpful tutoring feedback. Return only JSON.",
  });
  const draft = feedbackDraftSchema.parse(generated.json);
  const now = input.now?.() ?? Date.now();
  const [submission] = await database
    .update(submissions)
    .set({
      feedbackMd: draft.feedbackMd,
      updatedAt: now,
    })
    .where(eq(submissions.id, context.submissionId))
    .returning();

  if (!submission) {
    throw new Error("Submission not found.");
  }

  const history = await savePromptHistory(database, {
    feature: "feedback",
    input: {
      assignmentId: context.assignmentId,
      courseId: context.courseId,
      feature: "feedback",
      model: generated.model,
      output: draft,
      provider: generated.provider,
      submissionId: context.submissionId,
    },
    now: input.now,
  });

  return {
    draft,
    history,
    submission,
  };
}
