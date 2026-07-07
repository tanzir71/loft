import { and, asc, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { courses, quizQuestions, quizzes, schema } from "@/db/schema";

type AppDb = LibSQLDatabase<typeof schema>;
type QuestionType = "mcq_single" | "mcq_multi" | "true_false" | "short_answer";
type QuizStatus = "draft" | "published" | "closed";

type CreateQuizInput = {
  closeAt?: number | null;
  courseId: string;
  instructionsMd?: string;
  makeId?: () => string;
  maxAttempts?: number;
  now?: () => number;
  openAt?: number | null;
  shuffle?: boolean;
  status?: QuizStatus;
  timeLimitMin?: number | null;
  title: string;
};

type UpdateQuizInput = Omit<CreateQuizInput, "courseId" | "makeId" | "now"> & {
  id: string;
  now?: () => number;
  status: QuizStatus;
};

type QuestionInput = {
  answerJson: unknown;
  makeId?: () => string;
  optionsJson: unknown;
  points?: number;
  promptMd: string;
  quizId: string;
  sortOrder?: number;
  type: QuestionType;
};

type UpdateQuestionInput = Omit<QuestionInput, "makeId" | "quizId"> & {
  id: string;
  now?: () => number;
  sortOrder: number;
};

const quizStatusSchema = z.enum(["draft", "published", "closed"]);
const questionTypeSchema = z.enum(["mcq_single", "mcq_multi", "true_false", "short_answer"]);
const quizFieldsSchema = z.object({
  closeAt: z.number().int().nullable().optional(),
  courseId: z.string().trim().min(1),
  instructionsMd: z.string().trim().optional(),
  maxAttempts: z.number().int().min(1).optional(),
  openAt: z.number().int().nullable().optional(),
  shuffle: z.boolean().optional(),
  status: quizStatusSchema.optional(),
  timeLimitMin: z.number().int().min(1).nullable().optional(),
  title: z.string().trim().min(1),
});
const updateQuizSchema = quizFieldsSchema.omit({ courseId: true }).extend({
  id: z.string().trim().min(1),
  status: quizStatusSchema,
});
const questionSchema = z.object({
  answerJson: z.unknown(),
  optionsJson: z.unknown(),
  points: z.number().int().min(1).optional(),
  promptMd: z.string().trim().min(1),
  quizId: z.string().trim().min(1),
  sortOrder: z.number().int().min(0).optional(),
  type: questionTypeSchema,
});
const updateQuestionSchema = questionSchema.omit({ quizId: true }).extend({
  id: z.string().trim().min(1),
  sortOrder: z.number().int().min(0),
});
const optionSchema = z.object({
  id: z.string().trim().min(1),
  text: z.string().trim().min(1),
});
const mcqOptionsSchema = z.object({
  options: z.array(optionSchema).min(2),
});
const singleAnswerSchema = z.object({ correctOptionId: z.string().trim().min(1) });
const multiAnswerSchema = z.object({ correctOptionIds: z.array(z.string().trim().min(1)).min(1) });
const trueFalseAnswerSchema = z.object({ value: z.boolean() });
const shortAnswerSchema = z.object({ acceptedAnswers: z.array(z.string().trim().min(1)).min(1) });
function createId() {
  return randomBytes(12).toString("base64url");
}

async function requireActiveCourse(database: AppDb, id: string) {
  const [course] = await database
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, id), eq(courses.status, "active")));

  if (!course) {
    throw new Error("Active course not found.");
  }
}

async function requireQuiz(database: AppDb, id: string) {
  const [quiz] = await database.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.id, id));

  if (!quiz) {
    throw new Error("Quiz not found.");
  }

  return quiz;
}

async function nextQuestionSortOrder(database: AppDb, quizId: string) {
  const rows = await database
    .select({ sortOrder: quizQuestions.sortOrder })
    .from(quizQuestions)
    .where(eq(quizQuestions.quizId, quizId));

  return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
}

export function parseQuestionOptions(type: QuestionType, optionsJson: unknown) {
  if (type === "mcq_single" || type === "mcq_multi") {
    return mcqOptionsSchema.parse(optionsJson);
  }

  return null;
}

export function parseQuestionAnswer(type: QuestionType, answerJson: unknown) {
  if (type === "mcq_single") {
    return singleAnswerSchema.parse(answerJson);
  }

  if (type === "mcq_multi") {
    return multiAnswerSchema.parse(answerJson);
  }

  if (type === "true_false") {
    return trueFalseAnswerSchema.parse(answerJson);
  }

  return shortAnswerSchema.parse(answerJson);
}

function validateQuestionPayload(type: QuestionType, optionsJson: unknown, answerJson: unknown) {
  const options = parseQuestionOptions(type, optionsJson);

  if (options && type === "mcq_single") {
    const answer = singleAnswerSchema.parse(answerJson);
    const optionIds = new Set(options.options.map((option) => option.id));

    if (!optionIds.has(answer.correctOptionId)) {
      throw new Error("Correct option must exist in the options list.");
    }

    return {
      answer,
      options,
    };
  }

  if (options && type === "mcq_multi") {
    const answer = multiAnswerSchema.parse(answerJson);
    const optionIds = new Set(options.options.map((option) => option.id));

    for (const correctId of answer.correctOptionIds) {
      if (!optionIds.has(correctId)) {
        throw new Error("Correct options must exist in the options list.");
      }
    }

    return {
      answer,
      options,
    };
  }

  const answer = parseQuestionAnswer(type, answerJson);

  return {
    answer,
    options,
  };
}

export function answerSummary(type: QuestionType, answerJson: unknown) {
  if (type === "mcq_single") {
    const answer = singleAnswerSchema.parse(answerJson);
    return `Correct option: ${answer.correctOptionId}`;
  }

  if (type === "mcq_multi") {
    const answer = multiAnswerSchema.parse(answerJson);
    return `Correct options: ${answer.correctOptionIds.join(", ")}`;
  }

  if (type === "true_false") {
    const answer = trueFalseAnswerSchema.parse(answerJson);
    return answer.value ? "True" : "False";
  }

  const answer = shortAnswerSchema.parse(answerJson);
  return `Accepted: ${answer.acceptedAnswers.join("; ")}`;
}

export async function createQuiz(database: AppDb, input: CreateQuizInput) {
  const parsed = quizFieldsSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireActiveCourse(database, parsed.courseId);
  const [quiz] = await database
    .insert(quizzes)
    .values({
      id: input.makeId?.() ?? createId(),
      courseId: parsed.courseId,
      title: parsed.title,
      instructionsMd: parsed.instructionsMd ?? "",
      status: parsed.status ?? "draft",
      openAt: parsed.openAt ?? null,
      closeAt: parsed.closeAt ?? null,
      timeLimitMin: parsed.timeLimitMin ?? null,
      maxAttempts: parsed.maxAttempts ?? 1,
      shuffle: parsed.shuffle ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return quiz;
}

export async function updateQuiz(database: AppDb, input: UpdateQuizInput) {
  const parsed = updateQuizSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [quiz] = await database
    .update(quizzes)
    .set({
      title: parsed.title,
      instructionsMd: parsed.instructionsMd ?? "",
      status: parsed.status,
      openAt: parsed.openAt ?? null,
      closeAt: parsed.closeAt ?? null,
      timeLimitMin: parsed.timeLimitMin ?? null,
      maxAttempts: parsed.maxAttempts ?? 1,
      shuffle: parsed.shuffle ?? false,
      updatedAt: now,
    })
    .where(eq(quizzes.id, parsed.id))
    .returning();

  if (!quiz) {
    throw new Error("Quiz not found.");
  }

  return quiz;
}

export async function createQuizQuestion(database: AppDb, input: QuestionInput) {
  const parsed = questionSchema.parse(input);
  const now = Date.now();
  await requireQuiz(database, parsed.quizId);
  const payload = validateQuestionPayload(parsed.type, parsed.optionsJson, parsed.answerJson);
  const [question] = await database
    .insert(quizQuestions)
    .values({
      id: input.makeId?.() ?? createId(),
      quizId: parsed.quizId,
      type: parsed.type,
      promptMd: parsed.promptMd,
      optionsJson: payload.options,
      answerJson: payload.answer,
      points: parsed.points ?? 1,
      sortOrder: parsed.sortOrder ?? (await nextQuestionSortOrder(database, parsed.quizId)),
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return question;
}

export async function updateQuizQuestion(database: AppDb, input: UpdateQuestionInput) {
  const parsed = updateQuestionSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const payload = validateQuestionPayload(parsed.type, parsed.optionsJson, parsed.answerJson);
  const [question] = await database
    .update(quizQuestions)
    .set({
      type: parsed.type,
      promptMd: parsed.promptMd,
      optionsJson: payload.options,
      answerJson: payload.answer,
      points: parsed.points ?? 1,
      sortOrder: parsed.sortOrder,
      updatedAt: now,
    })
    .where(eq(quizQuestions.id, parsed.id))
    .returning();

  if (!question) {
    throw new Error("Question not found.");
  }

  return question;
}

export async function listQuizBuilder(database: AppDb, courseId: string) {
  const parsedCourseId = z.string().trim().min(1).parse(courseId);
  const quizRows = await database
    .select()
    .from(quizzes)
    .where(eq(quizzes.courseId, parsedCourseId))
    .orderBy(asc(quizzes.title));
  const questionRows = await database
    .select()
    .from(quizQuestions)
    .orderBy(asc(quizQuestions.sortOrder), asc(quizQuestions.promptMd));

  return quizRows.map((quiz) => ({
    quiz,
    questions: questionRows.filter((question) => question.quizId === quiz.id),
  }));
}
