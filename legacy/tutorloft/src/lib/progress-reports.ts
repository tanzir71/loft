import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  assignments,
  attendance,
  classSessions,
  courses,
  enrollments,
  parentLinks,
  progressReports,
  quizAttempts,
  quizzes,
  schema,
  submissions,
  users,
} from "@/db/schema";
import type { AuthenticatedUser } from "@/lib/user-types";

type AppDb = LibSQLDatabase<typeof schema>;

type ProgressPeriodInput = {
  periodEnd: number;
  periodStart: number;
};

type GenerateNumbersOnlyReportInput = ProgressPeriodInput & {
  makeId?: () => string;
  now?: () => number;
  studentId: string;
};

type GenerateMonthlyReportsInput = ProgressPeriodInput & {
  makeId?: (index: number, studentId: string) => string;
  now?: () => number;
};

type CreateProgressReportInput = GenerateNumbersOnlyReportInput & {
  bodyMd: string;
};

type UpdateProgressReportInput = {
  bodyMd: string;
  id: string;
};

const reportPeriodSchema = z.object({
  periodEnd: z.number().int(),
  periodStart: z.number().int(),
});
const reportStudentPeriodSchema = reportPeriodSchema.extend({
  studentId: z.string().trim().min(1),
});
const createReportSchema = reportStudentPeriodSchema.extend({
  bodyMd: z.string().trim().min(1),
});
const updateReportSchema = z.object({
  bodyMd: z.string().trim().min(1),
  id: z.string().trim().min(1),
});

function createId() {
  return randomBytes(12).toString("base64url");
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

function validatePeriod(input: ProgressPeriodInput) {
  const parsed = reportPeriodSchema.parse(input);

  if (parsed.periodEnd < parsed.periodStart) {
    throw new Error("Report period is invalid.");
  }

  return parsed;
}

async function requireStudent(database: AppDb, studentId: string) {
  const [student] = await database
    .select({
      email: users.email,
      id: users.id,
      name: users.name,
      status: users.status,
    })
    .from(users)
    .where(and(eq(users.id, studentId), eq(users.role, "student")));

  if (!student) {
    throw new Error("Student not found.");
  }

  return student;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(timestamp));
}

function percent(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return "0%";
  }

  return `${Math.round((numerator / denominator) * 100)}%`;
}

function assignmentAverage(
  assignmentsRows: Awaited<ReturnType<typeof collectProgressReportFacts>>["assignments"],
) {
  let earned = 0;
  let possible = 0;

  for (const assignment of assignmentsRows) {
    if (assignment.grade !== null && assignment.points !== null && assignment.points > 0) {
      earned += assignment.grade;
      possible += assignment.points;
    }
  }

  return possible > 0 ? percent(earned, possible) : null;
}

function quizAverage(quizzesRows: Awaited<ReturnType<typeof collectProgressReportFacts>>["quizzes"]) {
  const scores = quizzesRows
    .map((quiz) => quiz.score)
    .filter((score): score is number => typeof score === "number");

  if (scores.length === 0) {
    return null;
  }

  const total = scores.reduce((sum, score) => sum + score, 0);
  return Math.round(total / scores.length).toString();
}

function numbersOnlyReportBody(facts: Awaited<ReturnType<typeof collectProgressReportFacts>>) {
  const attendanceRate = percent(
    facts.attendance.present + facts.attendance.late,
    facts.attendance.total,
  );
  const assignmentAverageLabel = assignmentAverage(facts.assignments);
  const quizAverageLabel = quizAverage(facts.quizzes);
  const courseLines =
    facts.courses.length > 0
      ? facts.courses.map((course) => `- ${course.title} (${course.subject})`)
      : ["- No active courses during this period."];
  const assignmentLines =
    facts.assignments.length > 0
      ? facts.assignments.map((assignment) => {
          const grade =
            assignment.grade === null
              ? "Pending"
              : assignment.points === null
                ? `${assignment.grade}`
                : `${assignment.grade}/${assignment.points}`;
          return `- ${assignment.title} (${assignment.courseTitle}): ${grade}`;
        })
      : ["- No assignment grades recorded."];
  const quizLines =
    facts.quizzes.length > 0
      ? facts.quizzes.map((quiz) => {
          const score = quiz.score === null ? "Pending" : `${quiz.score}`;
          return `- ${quiz.title} (${quiz.courseTitle}): ${score}`;
        })
      : ["- No quiz scores recorded."];
  const noteLines =
    facts.attendanceNotes.length > 0
      ? facts.attendanceNotes.map((note) => {
          const topic = note.topic ? `${note.topic}: ` : "";
          return `- ${note.courseTitle}: ${topic}${note.notesShared ?? ""}`.trim();
        })
      : ["- No shared session notes recorded."];

  return [
    `# Progress report: ${facts.student.name}`,
    "",
    `Period: ${formatDate(facts.periodStart)} - ${formatDate(facts.periodEnd)}`,
    "",
    "## Courses",
    ...courseLines,
    "",
    "## Attendance",
    `- Sessions recorded: ${facts.attendance.total}`,
    `- Present: ${facts.attendance.present}`,
    `- Late: ${facts.attendance.late}`,
    `- Absent: ${facts.attendance.absent}`,
    `- Excused: ${facts.attendance.excused}`,
    `- Attendance rate: ${attendanceRate}`,
    "",
    "## Assignment grades",
    ...(assignmentAverageLabel ? [`- Assignment average: ${assignmentAverageLabel}`] : []),
    ...assignmentLines,
    "",
    "## Quiz scores",
    ...(quizAverageLabel ? [`- Average quiz score: ${quizAverageLabel}`] : []),
    ...quizLines,
    "",
    "## Shared session notes",
    ...noteLines,
  ].join("\n");
}

export async function collectProgressReportFacts(
  database: AppDb,
  input: { periodEnd: number; periodStart: number; studentId: string },
) {
  const parsed = reportStudentPeriodSchema.parse(input);

  if (parsed.periodEnd < parsed.periodStart) {
    throw new Error("Report period is invalid.");
  }

  const student = await requireStudent(database, parsed.studentId);
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
        eq(enrollments.studentId, parsed.studentId),
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
              eq(attendance.studentId, parsed.studentId),
              inArray(classSessions.courseId, courseIds),
              gte(classSessions.startsAt, parsed.periodStart),
              lte(classSessions.startsAt, parsed.periodEnd),
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
              eq(submissions.studentId, parsed.studentId),
              inArray(assignments.courseId, courseIds),
              gte(submissions.submittedAt, parsed.periodStart),
              lte(submissions.submittedAt, parsed.periodEnd),
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
              eq(quizAttempts.studentId, parsed.studentId),
              inArray(quizzes.courseId, courseIds),
              gte(quizAttempts.submittedAt, parsed.periodStart),
              lte(quizAttempts.submittedAt, parsed.periodEnd),
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
    periodEnd: parsed.periodEnd,
    periodStart: parsed.periodStart,
    quizzes: quizRows,
    student,
  };
}

export async function createProgressReport(
  database: AppDb,
  input: CreateProgressReportInput,
) {
  const parsed = createReportSchema.parse(input);
  validatePeriod(parsed);
  await requireStudent(database, parsed.studentId);
  const now = input.now?.() ?? Date.now();
  const [report] = await database
    .insert(progressReports)
    .values({
      id: input.makeId?.() ?? createId(),
      studentId: parsed.studentId,
      periodStart: parsed.periodStart,
      periodEnd: parsed.periodEnd,
      bodyMd: parsed.bodyMd,
      createdAt: now,
    })
    .returning();

  return report;
}

export async function generateNumbersOnlyProgressReport(
  database: AppDb,
  input: GenerateNumbersOnlyReportInput,
) {
  const parsed = reportStudentPeriodSchema.parse(input);
  const facts = await collectProgressReportFacts(database, parsed);
  const report = await createProgressReport(database, {
    bodyMd: numbersOnlyReportBody(facts),
    makeId: input.makeId,
    now: input.now,
    periodEnd: parsed.periodEnd,
    periodStart: parsed.periodStart,
    studentId: parsed.studentId,
  });

  return { facts, report };
}

export async function generateMonthlyProgressReports(
  database: AppDb,
  input: GenerateMonthlyReportsInput,
) {
  const parsed = validatePeriod(input);
  const studentRows = await database
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.role, "student"))
    .orderBy(asc(users.name));
  let created = 0;
  let skipped = 0;

  for (const student of studentRows) {
    if (student.status !== "active") {
      skipped += 1;
      continue;
    }

    await generateNumbersOnlyProgressReport(database, {
      makeId: input.makeId ? () => input.makeId?.(created, student.id) ?? createId() : undefined,
      now: input.now,
      periodEnd: parsed.periodEnd,
      periodStart: parsed.periodStart,
      studentId: student.id,
    });
    created += 1;
  }

  return { created, skipped };
}

export async function updateProgressReport(database: AppDb, input: UpdateProgressReportInput) {
  const parsed = updateReportSchema.parse(input);
  const [report] = await database
    .update(progressReports)
    .set({ bodyMd: parsed.bodyMd })
    .where(eq(progressReports.id, parsed.id))
    .returning();

  if (!report) {
    throw new Error("Progress report not found.");
  }

  return report;
}

export async function getProgressReportDetail(database: AppDb, reportId: string) {
  const parsedId = z.string().trim().min(1).parse(reportId);
  const [report] = await database
    .select({
      bodyMd: progressReports.bodyMd,
      createdAt: progressReports.createdAt,
      id: progressReports.id,
      periodEnd: progressReports.periodEnd,
      periodStart: progressReports.periodStart,
      studentEmail: users.email,
      studentId: progressReports.studentId,
      studentName: users.name,
    })
    .from(progressReports)
    .innerJoin(users, eq(progressReports.studentId, users.id))
    .where(eq(progressReports.id, parsedId));

  if (!report) {
    throw new Error("Progress report not found.");
  }

  return report;
}

export async function listProgressReportsForStudent(database: AppDb, studentId: string) {
  const parsedStudentId = z.string().trim().min(1).parse(studentId);
  return database
    .select({
      bodyMd: progressReports.bodyMd,
      createdAt: progressReports.createdAt,
      id: progressReports.id,
      periodEnd: progressReports.periodEnd,
      periodStart: progressReports.periodStart,
      studentId: progressReports.studentId,
    })
    .from(progressReports)
    .where(eq(progressReports.studentId, parsedStudentId))
    .orderBy(desc(progressReports.createdAt));
}

export async function listProgressReportsForParent(database: AppDb, parentId: string) {
  const parsedParentId = z.string().trim().min(1).parse(parentId);
  return database
    .select({
      bodyMd: progressReports.bodyMd,
      createdAt: progressReports.createdAt,
      id: progressReports.id,
      periodEnd: progressReports.periodEnd,
      periodStart: progressReports.periodStart,
      studentId: progressReports.studentId,
      studentName: users.name,
    })
    .from(progressReports)
    .innerJoin(parentLinks, eq(progressReports.studentId, parentLinks.studentId))
    .innerJoin(users, eq(progressReports.studentId, users.id))
    .where(eq(parentLinks.parentId, parsedParentId))
    .orderBy(desc(progressReports.createdAt), asc(users.name));
}

export async function canViewProgressReport(
  database: AppDb,
  input: { studentId: string; user: AuthenticatedUser },
) {
  if (input.user.role === "tutor") {
    return true;
  }

  if (input.user.role === "student") {
    return input.user.id === input.studentId;
  }

  const [link] = await database
    .select({ studentId: parentLinks.studentId })
    .from(parentLinks)
    .where(
      and(
        eq(parentLinks.parentId, input.user.id),
        eq(parentLinks.studentId, input.studentId),
      ),
    );

  return Boolean(link);
}

export function progressReportPeriodLabel(input: ProgressPeriodInput) {
  return `${formatDate(input.periodStart)} - ${formatDate(input.periodEnd)}`;
}
