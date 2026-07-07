import { and, asc, eq, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  courses,
  enrollments,
  quizAnswers,
  quizAttempts,
  quizQuestions,
  quizzes,
  schema,
  users,
} from "@/db/schema";

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

type StartQuizAttemptInput = {
  makeId?: () => string;
  now?: () => number;
  quizId: string;
  studentId: string;
};

type SaveQuizAnswerInput = {
  answerJson: unknown;
  attemptId: string;
  makeId?: () => string;
  now?: () => number;
  questionId: string;
  studentId: string;
};

type SubmitQuizAttemptInput = {
  attemptId: string;
  now?: () => number;
  studentId: string;
};

type QuizAttemptFlowInput = {
  attemptId: string;
  now?: number;
  quizId: string;
  studentId: string;
};

type StudentQuizOverviewInput = {
  now?: number;
  quizId: string;
  studentId: string;
};

type GradeQuizAttemptInput = {
  attemptId: string;
  now?: () => number;
};

type GradeShortAnswerInput = {
  answerId: string;
  isCorrect: boolean;
  now?: () => number;
  pointsAwarded: number;
};

type ManualGradingQueueInput = {
  courseId?: string;
};

type StudentQuizResultInput = {
  attemptId: string;
  studentId: string;
};

type TutorQuizResultsInput = {
  courseId?: string;
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
const singleStudentAnswerSchema = z.object({ selectedOptionId: z.string().trim().min(1) });
const multiStudentAnswerSchema = z.object({
  selectedOptionIds: z.array(z.string().trim().min(1)),
});
const trueFalseStudentAnswerSchema = z.object({ value: z.boolean() });
const shortStudentAnswerSchema = z.object({ response: z.string().trim() });
const startQuizAttemptSchema = z.object({
  quizId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
});
const saveQuizAnswerSchema = z.object({
  answerJson: z.unknown(),
  attemptId: z.string().trim().min(1),
  questionId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
});
const submitQuizAttemptSchema = z.object({
  attemptId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
});
const quizAttemptFlowSchema = z.object({
  attemptId: z.string().trim().min(1),
  now: z.number().int().optional(),
  quizId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
});
const studentQuizOverviewSchema = z.object({
  now: z.number().int().optional(),
  quizId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
});
const gradeQuizAttemptSchema = z.object({
  attemptId: z.string().trim().min(1),
});
const gradeShortAnswerSchema = z.object({
  answerId: z.string().trim().min(1),
  isCorrect: z.boolean(),
  pointsAwarded: z.number().int().min(0),
});
const manualGradingQueueSchema = z.object({
  courseId: z.string().trim().min(1).optional(),
});
const studentQuizResultSchema = z.object({
  attemptId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
});
const tutorQuizResultsSchema = z.object({
  courseId: z.string().trim().min(1).optional(),
});
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
  const [quiz] = await database.select().from(quizzes).where(eq(quizzes.id, id));

  if (!quiz) {
    throw new Error("Quiz not found.");
  }

  return quiz;
}

async function requireActiveEnrollment(database: AppDb, input: { courseId: string; studentId: string }) {
  const [enrollment] = await database
    .select({ id: enrollments.id })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(
      and(
        eq(enrollments.courseId, input.courseId),
        eq(enrollments.studentId, input.studentId),
        eq(enrollments.status, "active"),
        eq(courses.status, "active"),
      ),
    );

  if (!enrollment) {
    throw new Error("Enrollment not found.");
  }
}

async function requireStudentQuiz(database: AppDb, input: { quizId: string; studentId: string }) {
  const quiz = await requireQuiz(database, input.quizId);
  await requireActiveEnrollment(database, {
    courseId: quiz.courseId,
    studentId: input.studentId,
  });

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

export function parseStudentAnswer(type: QuestionType, answerJson: unknown) {
  if (type === "mcq_single") {
    return singleStudentAnswerSchema.parse(answerJson);
  }

  if (type === "mcq_multi") {
    return multiStudentAnswerSchema.parse(answerJson);
  }

  if (type === "true_false") {
    return trueFalseStudentAnswerSchema.parse(answerJson);
  }

  return shortStudentAnswerSchema.parse(answerJson);
}

function assertQuizWindow(quiz: typeof quizzes.$inferSelect, now: number) {
  if (quiz.status !== "published") {
    throw new Error("Quiz is not open.");
  }

  if (quiz.openAt !== null && quiz.openAt > now) {
    throw new Error("Quiz is not open yet.");
  }

  if (quiz.closeAt !== null && quiz.closeAt < now) {
    throw new Error("Quiz is closed.");
  }
}

function attemptDeadline(quiz: typeof quizzes.$inferSelect, attempt: typeof quizAttempts.$inferSelect) {
  const deadlines = [];

  if (quiz.closeAt !== null) {
    deadlines.push(quiz.closeAt);
  }

  if (quiz.timeLimitMin !== null) {
    deadlines.push(attempt.startedAt + quiz.timeLimitMin * 60_000);
  }

  return deadlines.length > 0 ? Math.min(...deadlines) : null;
}

function remainingSeconds(
  quiz: typeof quizzes.$inferSelect,
  attempt: typeof quizAttempts.$inferSelect,
  now: number,
) {
  const deadline = attemptDeadline(quiz, attempt);

  return deadline === null ? null : Math.max(0, Math.floor((deadline - now) / 1000));
}

function assertAttemptWritable(
  quiz: typeof quizzes.$inferSelect,
  attempt: typeof quizAttempts.$inferSelect,
  now: number,
) {
  if (attempt.status !== "in_progress") {
    throw new Error("Quiz attempt is not in progress.");
  }

  assertQuizWindow(quiz, now);

  if (remainingSeconds(quiz, attempt, now) === 0) {
    throw new Error("Quiz timer expired.");
  }
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

export async function startQuizAttempt(database: AppDb, input: StartQuizAttemptInput) {
  const parsed = startQuizAttemptSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const quiz = await requireStudentQuiz(database, parsed);
  assertQuizWindow(quiz, now);
  const attempts = await database
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.quizId, parsed.quizId), eq(quizAttempts.studentId, parsed.studentId)));
  const existing = attempts.find((attempt) => attempt.status === "in_progress");

  if (existing) {
    return existing;
  }

  if (attempts.length >= quiz.maxAttempts) {
    throw new Error("Quiz attempt limit reached.");
  }

  const [attempt] = await database
    .insert(quizAttempts)
    .values({
      id: input.makeId?.() ?? createId(),
      quizId: parsed.quizId,
      studentId: parsed.studentId,
      startedAt: now,
      submittedAt: null,
      autoScore: null,
      finalScore: null,
      status: "in_progress",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return attempt;
}

export async function getStudentQuizOverview(database: AppDb, input: StudentQuizOverviewInput) {
  const parsed = studentQuizOverviewSchema.parse(input);
  const now = parsed.now ?? Date.now();
  const quiz = await requireStudentQuiz(database, parsed);
  const attempts = await database
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.quizId, parsed.quizId), eq(quizAttempts.studentId, parsed.studentId)));
  const inProgressAttempt = attempts.find((attempt) => attempt.status === "in_progress") ?? null;
  let unavailableReason: string | null = null;

  try {
    assertQuizWindow(quiz, now);
    if (!inProgressAttempt && attempts.length >= quiz.maxAttempts) {
      unavailableReason = "Quiz attempt limit reached.";
    }
  } catch (error) {
    unavailableReason = error instanceof Error ? error.message : "Quiz unavailable.";
  }

  return {
    attemptsUsed: attempts.length,
    inProgressAttempt,
    quiz,
    unavailableReason,
  };
}

async function requireAttemptContext(
  database: AppDb,
  input: { attemptId: string; studentId: string },
) {
  const [attempt] = await database
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.id, input.attemptId), eq(quizAttempts.studentId, input.studentId)));

  if (!attempt) {
    throw new Error("Quiz attempt not found.");
  }

  const quiz = await requireStudentQuiz(database, {
    quizId: attempt.quizId,
    studentId: input.studentId,
  });

  return { attempt, quiz };
}

export async function saveQuizAnswer(database: AppDb, input: SaveQuizAnswerInput) {
  const parsed = saveQuizAnswerSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const { attempt, quiz } = await requireAttemptContext(database, parsed);
  assertAttemptWritable(quiz, attempt, now);
  const [question] = await database
    .select()
    .from(quizQuestions)
    .where(and(eq(quizQuestions.id, parsed.questionId), eq(quizQuestions.quizId, attempt.quizId)));

  if (!question) {
    throw new Error("Question not found.");
  }

  const answer = parseStudentAnswer(question.type, parsed.answerJson);
  const [existing] = await database
    .select()
    .from(quizAnswers)
    .where(and(eq(quizAnswers.attemptId, parsed.attemptId), eq(quizAnswers.questionId, parsed.questionId)));

  if (existing) {
    const [updated] = await database
      .update(quizAnswers)
      .set({ answerJson: answer, updatedAt: now })
      .where(eq(quizAnswers.id, existing.id))
      .returning();

    return updated;
  }

  const [created] = await database
    .insert(quizAnswers)
    .values({
      id: input.makeId?.() ?? createId(),
      attemptId: parsed.attemptId,
      questionId: parsed.questionId,
      answerJson: answer,
      isCorrect: null,
      pointsAwarded: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return created;
}

export async function submitQuizAttempt(database: AppDb, input: SubmitQuizAttemptInput) {
  const parsed = submitQuizAttemptSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const { attempt, quiz } = await requireAttemptContext(database, parsed);
  assertAttemptWritable(quiz, attempt, now);
  const [submitted] = await database
    .update(quizAttempts)
    .set({
      submittedAt: now,
      status: "submitted",
      updatedAt: now,
    })
    .where(eq(quizAttempts.id, parsed.attemptId))
    .returning();

  return gradeQuizAttempt(database, { attemptId: submitted.id, now: () => now });
}

export async function getQuizAttemptFlow(database: AppDb, input: QuizAttemptFlowInput) {
  const parsed = quizAttemptFlowSchema.parse(input);
  const now = parsed.now ?? Date.now();
  const { attempt, quiz } = await requireAttemptContext(database, parsed);

  if (attempt.quizId !== parsed.quizId) {
    throw new Error("Quiz attempt mismatch.");
  }

  const [questionRows, answerRows] = await Promise.all([
    database
      .select()
      .from(quizQuestions)
      .where(eq(quizQuestions.quizId, parsed.quizId))
      .orderBy(asc(quizQuestions.sortOrder), asc(quizQuestions.promptMd)),
    database.select().from(quizAnswers).where(eq(quizAnswers.attemptId, parsed.attemptId)),
  ]);
  const answersByQuestion: Record<string, typeof quizAnswers.$inferSelect> = {};

  for (const answer of answerRows) {
    answersByQuestion[answer.questionId] = answer;
  }

  return {
    answersByQuestion,
    attempt,
    questions: questionRows,
    quiz,
    remainingSeconds: remainingSeconds(quiz, attempt, now),
  };
}

function normalizeAnswer(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function sameSet(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

function scoreSavedAnswer(
  question: typeof quizQuestions.$inferSelect,
  answer: typeof quizAnswers.$inferSelect,
) {
  if (question.type === "mcq_single") {
    const key = singleAnswerSchema.parse(question.answerJson);
    const saved = singleStudentAnswerSchema.parse(answer.answerJson);
    const isCorrect = saved.selectedOptionId === key.correctOptionId;

    return { isCorrect, pointsAwarded: isCorrect ? question.points : 0 };
  }

  if (question.type === "mcq_multi") {
    const key = multiAnswerSchema.parse(question.answerJson);
    const saved = multiStudentAnswerSchema.parse(answer.answerJson);
    const isCorrect = sameSet(saved.selectedOptionIds, key.correctOptionIds);

    return { isCorrect, pointsAwarded: isCorrect ? question.points : 0 };
  }

  if (question.type === "true_false") {
    const key = trueFalseAnswerSchema.parse(question.answerJson);
    const saved = trueFalseStudentAnswerSchema.parse(answer.answerJson);
    const isCorrect = saved.value === key.value;

    return { isCorrect, pointsAwarded: isCorrect ? question.points : 0 };
  }

  const key = shortAnswerSchema.parse(question.answerJson);
  const saved = shortStudentAnswerSchema.parse(answer.answerJson);
  const accepted = new Set(key.acceptedAnswers.map(normalizeAnswer));
  const isAutoCorrect = accepted.has(normalizeAnswer(saved.response));

  return isAutoCorrect
    ? { isCorrect: true, pointsAwarded: question.points }
    : { isCorrect: null, pointsAwarded: null };
}

async function recalculateAttemptScore(database: AppDb, attemptId: string, now: number) {
  const answerRows = await database.select().from(quizAnswers).where(eq(quizAnswers.attemptId, attemptId));
  const pendingManual = answerRows.some((answer) => answer.pointsAwarded === null);
  const score = answerRows.reduce((sum, answer) => sum + (answer.pointsAwarded ?? 0), 0);
  const [attempt] = await database
    .update(quizAttempts)
    .set({
      autoScore: score,
      finalScore: pendingManual ? null : score,
      status: pendingManual ? "submitted" : "graded",
      updatedAt: now,
    })
    .where(eq(quizAttempts.id, attemptId))
    .returning();

  return attempt;
}

export async function gradeQuizAttempt(database: AppDb, input: GradeQuizAttemptInput) {
  const parsed = gradeQuizAttemptSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [attempt] = await database.select().from(quizAttempts).where(eq(quizAttempts.id, parsed.attemptId));

  if (!attempt) {
    throw new Error("Quiz attempt not found.");
  }

  if (attempt.status === "in_progress") {
    throw new Error("Quiz attempt must be submitted before grading.");
  }

  const [questionRows, answerRows] = await Promise.all([
    database.select().from(quizQuestions).where(eq(quizQuestions.quizId, attempt.quizId)),
    database.select().from(quizAnswers).where(eq(quizAnswers.attemptId, attempt.id)),
  ]);
  const questionsById = new Map(questionRows.map((question) => [question.id, question]));

  for (const answer of answerRows) {
    const question = questionsById.get(answer.questionId);

    if (!question) {
      continue;
    }

    const score = scoreSavedAnswer(question, answer);
    await database
      .update(quizAnswers)
      .set({
        isCorrect: score.isCorrect,
        pointsAwarded: score.pointsAwarded,
        updatedAt: now,
      })
      .where(eq(quizAnswers.id, answer.id));
  }

  return recalculateAttemptScore(database, attempt.id, now);
}

export async function listManualGradingQueue(database: AppDb, input: ManualGradingQueueInput = {}) {
  const parsed = manualGradingQueueSchema.parse(input);
  const whereClause = parsed.courseId
    ? and(
        eq(quizQuestions.type, "short_answer"),
        isNull(quizAnswers.pointsAwarded),
        eq(quizAttempts.status, "submitted"),
        eq(quizzes.courseId, parsed.courseId),
      )
    : and(
        eq(quizQuestions.type, "short_answer"),
        isNull(quizAnswers.pointsAwarded),
        eq(quizAttempts.status, "submitted"),
      );

  return database
    .select({
      answerId: quizAnswers.id,
      answerJson: quizAnswers.answerJson,
      attemptId: quizAttempts.id,
      points: quizQuestions.points,
      promptMd: quizQuestions.promptMd,
      questionId: quizQuestions.id,
      quizId: quizzes.id,
      quizTitle: quizzes.title,
      studentId: users.id,
      studentName: users.name,
    })
    .from(quizAnswers)
    .innerJoin(quizQuestions, eq(quizAnswers.questionId, quizQuestions.id))
    .innerJoin(quizAttempts, eq(quizAnswers.attemptId, quizAttempts.id))
    .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
    .innerJoin(users, eq(quizAttempts.studentId, users.id))
    .where(whereClause)
    .orderBy(asc(quizzes.title), asc(users.name), asc(quizQuestions.sortOrder));
}

export async function gradeShortAnswer(database: AppDb, input: GradeShortAnswerInput) {
  const parsed = gradeShortAnswerSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [answer] = await database
    .select({
      attemptId: quizAnswers.attemptId,
      points: quizQuestions.points,
      questionType: quizQuestions.type,
    })
    .from(quizAnswers)
    .innerJoin(quizQuestions, eq(quizAnswers.questionId, quizQuestions.id))
    .where(eq(quizAnswers.id, parsed.answerId));

  if (!answer) {
    throw new Error("Answer not found.");
  }

  if (answer.questionType !== "short_answer") {
    throw new Error("Only short answers can be manually graded.");
  }

  if (parsed.pointsAwarded > answer.points) {
    throw new Error("Points awarded exceeds question points.");
  }

  await database
    .update(quizAnswers)
    .set({
      isCorrect: parsed.isCorrect,
      pointsAwarded: parsed.pointsAwarded,
      updatedAt: now,
    })
    .where(eq(quizAnswers.id, parsed.answerId));

  return recalculateAttemptScore(database, answer.attemptId, now);
}

export async function getStudentQuizResult(database: AppDb, input: StudentQuizResultInput) {
  const parsed = studentQuizResultSchema.parse(input);
  const [attempt] = await database
    .select()
    .from(quizAttempts)
    .where(and(eq(quizAttempts.id, parsed.attemptId), eq(quizAttempts.studentId, parsed.studentId)));

  if (!attempt) {
    throw new Error("Quiz attempt not found.");
  }

  if (attempt.status === "in_progress") {
    throw new Error("Quiz attempt is not submitted.");
  }

  const quiz = await requireStudentQuiz(database, {
    quizId: attempt.quizId,
    studentId: parsed.studentId,
  });
  const answers = await database
    .select({
      answerJson: quizAnswers.answerJson,
      answerId: quizAnswers.id,
      isCorrect: quizAnswers.isCorrect,
      points: quizQuestions.points,
      pointsAwarded: quizAnswers.pointsAwarded,
      promptMd: quizQuestions.promptMd,
      questionId: quizQuestions.id,
      sortOrder: quizQuestions.sortOrder,
      type: quizQuestions.type,
    })
    .from(quizAnswers)
    .innerJoin(quizQuestions, eq(quizAnswers.questionId, quizQuestions.id))
    .where(eq(quizAnswers.attemptId, attempt.id))
    .orderBy(asc(quizQuestions.sortOrder), asc(quizQuestions.promptMd));

  return { answers, attempt, quiz };
}

export async function listTutorQuizResults(database: AppDb, input: TutorQuizResultsInput = {}) {
  const parsed = tutorQuizResultsSchema.parse(input);
  const query = database
    .select({
      attemptId: quizAttempts.id,
      autoScore: quizAttempts.autoScore,
      courseId: quizzes.courseId,
      finalScore: quizAttempts.finalScore,
      quizId: quizzes.id,
      quizTitle: quizzes.title,
      status: quizAttempts.status,
      studentId: users.id,
      studentName: users.name,
      submittedAt: quizAttempts.submittedAt,
    })
    .from(quizAttempts)
    .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
    .innerJoin(users, eq(quizAttempts.studentId, users.id))
    .where(parsed.courseId ? eq(quizzes.courseId, parsed.courseId) : undefined)
    .orderBy(asc(quizzes.title), asc(users.name));

  return query;
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);

  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function quizResultsCsv(database: AppDb, input: TutorQuizResultsInput = {}) {
  const rows = await listTutorQuizResults(database, input);
  const lines = ["Quiz,Student,Status,Auto score,Final score,Submitted at"];

  for (const row of rows) {
    lines.push(
      [
        row.quizTitle,
        row.studentName,
        row.status,
        row.autoScore,
        row.finalScore,
        row.submittedAt ? new Date(row.submittedAt).toISOString() : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}
