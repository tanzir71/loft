import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  assignments,
  attendance,
  classSessions,
  courses,
  enrollments,
  progressReports,
  quizAttempts,
  quizzes,
  schema,
  submissions,
  users,
} from "@/db/schema";
import { generateAiJson } from "@/lib/ai/provider";
import { savePromptHistory } from "@/lib/ai/sources";

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

function createId() {
  return randomBytes(12).toString("base64url");
}

async function requireStudent(database: AppDb, studentId: string) {
  const [student] = await database
    .select({
      email: users.email,
      id: users.id,
      name: users.name,
    })
    .from(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")));

  if (!student) {
    throw new Error("Student not found.");
  }

  return student;
}

function emptyAttendance() {
  return {
    absent: 0,
    excused: 0,
    late: 0,
    present: 0,
    total: 0,
  };
}

async function collectProgressFacts(
  database: AppDb,
  input: { periodEnd: number; periodStart: number; studentId: string },
) {
  const student = await requireStudent(database, input.studentId);
  const courseRows = await database
    .select({
      id: courses.id,
      subject: courses.subject,
      title: courses.title,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(
      and(
        eq(enrollments.studentId, input.studentId),
        eq(enrollments.status, "active"),
        eq(courses.status, "active"),
      ),
    );
  const courseIds = courseRows.map((course) => course.id);
  const attendanceRows =
    courseIds.length === 0
      ? []
      : await database
          .select({
            courseTitle: courses.title,
            notesShared: classSessions.notesShared,
            startsAt: classSessions.startsAt,
            status: attendance.status,
            topic: classSessions.topic,
          })
          .from(attendance)
          .innerJoin(classSessions, eq(attendance.sessionId, classSessions.id))
          .innerJoin(courses, eq(classSessions.courseId, courses.id))
          .where(
            and(
              eq(attendance.studentId, input.studentId),
              inArray(classSessions.courseId, courseIds),
              gte(classSessions.startsAt, input.periodStart),
              lte(classSessions.startsAt, input.periodEnd),
            ),
          );
  const attendanceSummary = emptyAttendance();

  for (const row of attendanceRows) {
    attendanceSummary.total += 1;
    attendanceSummary[row.status] += 1;
  }

  const assignmentRows =
    courseIds.length === 0
      ? []
      : await database
          .select({
            courseTitle: courses.title,
            feedbackMd: submissions.feedbackMd,
            grade: submissions.grade,
            points: assignments.points,
            submittedAt: submissions.submittedAt,
            title: assignments.title,
          })
          .from(submissions)
          .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
          .innerJoin(courses, eq(assignments.courseId, courses.id))
          .where(
            and(
              eq(submissions.studentId, input.studentId),
              inArray(assignments.courseId, courseIds),
              gte(submissions.submittedAt, input.periodStart),
              lte(submissions.submittedAt, input.periodEnd),
            ),
          );
  const quizRows =
    courseIds.length === 0
      ? []
      : await database
          .select({
            courseTitle: courses.title,
            score: quizAttempts.finalScore,
            submittedAt: quizAttempts.submittedAt,
            title: quizzes.title,
          })
          .from(quizAttempts)
          .innerJoin(quizzes, eq(quizAttempts.quizId, quizzes.id))
          .innerJoin(courses, eq(quizzes.courseId, courses.id))
          .where(
            and(
              eq(quizAttempts.studentId, input.studentId),
              inArray(quizzes.courseId, courseIds),
              gte(quizAttempts.submittedAt, input.periodStart),
              lte(quizAttempts.submittedAt, input.periodEnd),
            ),
          );

  return {
    assignments: assignmentRows,
    attendance: attendanceSummary,
    attendanceNotes: attendanceRows
      .filter((row) => row.notesShared || row.topic)
      .map((row) => ({
        courseTitle: row.courseTitle,
        notesShared: row.notesShared,
        topic: row.topic,
      })),
    courses: courseRows,
    periodEnd: input.periodEnd,
    periodStart: input.periodStart,
    quizzes: quizRows,
    student,
  };
}

function progressReportPrompt(facts: Awaited<ReturnType<typeof collectProgressFacts>>) {
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

  const facts = await collectProgressFacts(database, parsed);
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
  const now = input.now?.() ?? Date.now();
  const [report] = await database
    .insert(progressReports)
    .values({
      id: input.makeId?.() ?? createId(),
      studentId: facts.student.id,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      bodyMd: draft.bodyMd,
      createdAt: now,
    })
    .returning();
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
