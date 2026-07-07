import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { z } from "zod";

import {
  assignments,
  courses,
  enrollments,
  quizAttempts,
  quizQuestions,
  quizzes,
  schema,
  submissions,
  users,
} from "@/db/schema";

type AppDb = LibSQLDatabase<typeof schema>;
type GradebookColumnKind = "assignment" | "quiz";
type GradebookCellStatus = "graded" | "missing" | "pending";

type GradebookColumn = {
  id: string;
  kind: GradebookColumnKind;
  points: number | null;
  title: string;
};

type GradebookCell = {
  columnId: string;
  earned: number | null;
  possible: number | null;
  status: GradebookCellStatus;
};

type GradebookRow = {
  averagePercent: number | null;
  cells: GradebookCell[];
  studentEmail: string;
  studentId: string;
  studentName: string;
};

const courseGradebookSchema = z.object({
  courseId: z.string().trim().min(1),
});

function cellAverage(cells: GradebookCell[]) {
  let earned = 0;
  let possible = 0;

  for (const cell of cells) {
    if (!cell.possible || cell.possible <= 0) {
      continue;
    }

    if (cell.status === "graded" && cell.earned !== null) {
      earned += cell.earned;
      possible += cell.possible;
    }

    if (cell.status === "missing") {
      possible += cell.possible;
    }
  }

  return possible === 0 ? null : Math.round((earned / possible) * 100);
}

function key(left: string, right: string) {
  return `${left}:${right}`;
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);

  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function columnHeader(column: GradebookColumn) {
  const prefix = column.kind === "assignment" ? "Assignment" : "Quiz";
  const points = column.points === null ? "" : ` (${column.points})`;
  return `${prefix}: ${column.title}${points}`;
}

function csvValue(cell: GradebookCell) {
  if (cell.status === "missing") {
    return "Missing";
  }

  if (cell.status === "pending") {
    return "Pending";
  }

  return cell.possible === null ? String(cell.earned ?? "") : `${cell.earned}/${cell.possible}`;
}

export async function getCourseGradebook(database: AppDb, input: { courseId: string }) {
  const parsed = courseGradebookSchema.parse(input);
  const [course] = await database
    .select()
    .from(courses)
    .where(eq(courses.id, parsed.courseId));

  if (!course) {
    throw new Error("Course not found.");
  }

  const [studentRows, assignmentRows, quizRows] = await Promise.all([
    database
      .select({
        email: users.email,
        id: users.id,
        name: users.name,
      })
      .from(enrollments)
      .innerJoin(users, eq(enrollments.studentId, users.id))
      .where(
        and(
          eq(enrollments.courseId, parsed.courseId),
          eq(enrollments.status, "active"),
          eq(users.role, "student"),
          eq(users.status, "active"),
        ),
      )
      .orderBy(asc(users.name)),
    database
      .select()
      .from(assignments)
      .where(and(eq(assignments.courseId, parsed.courseId), eq(assignments.status, "published")))
      .orderBy(asc(assignments.createdAt), asc(assignments.title)),
    database
      .select()
      .from(quizzes)
      .where(
        and(
          eq(quizzes.courseId, parsed.courseId),
          or(eq(quizzes.status, "published"), eq(quizzes.status, "closed")),
        ),
      )
      .orderBy(asc(quizzes.createdAt), asc(quizzes.title)),
  ]);
  const quizIds = quizRows.map((quiz) => quiz.id);
  const quizQuestionRows =
    quizIds.length === 0
      ? []
      : await database.select().from(quizQuestions).where(inArray(quizQuestions.quizId, quizIds));
  const quizPoints = new Map<string, number>();

  for (const question of quizQuestionRows) {
    quizPoints.set(question.quizId, (quizPoints.get(question.quizId) ?? 0) + question.points);
  }

  const assignmentColumns: GradebookColumn[] = assignmentRows.map((assignment) => ({
    id: assignment.id,
    kind: "assignment",
    points: assignment.points,
    title: assignment.title,
  }));
  const quizColumns: GradebookColumn[] = quizRows.map((quiz) => ({
    id: quiz.id,
    kind: "quiz",
    points: quizPoints.get(quiz.id) ?? 0,
    title: quiz.title,
  }));
  const columns = [...assignmentColumns, ...quizColumns];
  const studentIds = studentRows.map((student) => student.id);
  const assignmentIds = assignmentRows.map((assignment) => assignment.id);
  const submissionRows =
    assignmentIds.length === 0 || studentIds.length === 0
      ? []
      : await database
          .select()
          .from(submissions)
          .where(
            and(
              inArray(submissions.assignmentId, assignmentIds),
              inArray(submissions.studentId, studentIds),
            ),
          );
  const attemptRows =
    quizIds.length === 0 || studentIds.length === 0
      ? []
      : await database
          .select()
          .from(quizAttempts)
          .where(and(inArray(quizAttempts.quizId, quizIds), inArray(quizAttempts.studentId, studentIds)));
  const submissionsByAssignmentStudent = new Map(
    submissionRows.map((submission) => [key(submission.assignmentId, submission.studentId), submission]),
  );
  const attemptsByQuizStudent = new Map<string, typeof attemptRows>();

  for (const attempt of attemptRows) {
    const mapKey = key(attempt.quizId, attempt.studentId);
    attemptsByQuizStudent.set(mapKey, [...(attemptsByQuizStudent.get(mapKey) ?? []), attempt]);
  }

  const rows: GradebookRow[] = studentRows.map((student) => {
    const assignmentCells: GradebookCell[] = assignmentRows.map((assignment) => {
      const submission = submissionsByAssignmentStudent.get(key(assignment.id, student.id));

      if (!submission) {
        return {
          columnId: assignment.id,
          earned: null,
          possible: assignment.points,
          status: "missing",
        };
      }

      if (submission.grade === null) {
        return {
          columnId: assignment.id,
          earned: null,
          possible: assignment.points,
          status: "pending",
        };
      }

      return {
        columnId: assignment.id,
        earned: submission.grade,
        possible: assignment.points,
        status: "graded",
      };
    });
    const quizCells: GradebookCell[] = quizRows.map((quiz) => {
      const attempts = attemptsByQuizStudent.get(key(quiz.id, student.id)) ?? [];
      const pending = attempts.some((attempt) => attempt.status === "submitted");
      const scores = attempts
        .filter((attempt) => attempt.status === "graded")
        .map((attempt) => attempt.finalScore ?? attempt.autoScore)
        .filter((score): score is number => score !== null);
      const bestScore = scores.length === 0 ? null : Math.max(...scores);
      const possible = quizPoints.get(quiz.id) ?? 0;

      if (bestScore !== null) {
        return {
          columnId: quiz.id,
          earned: bestScore,
          possible,
          status: "graded",
        };
      }

      return {
        columnId: quiz.id,
        earned: null,
        possible,
        status: pending ? "pending" : "missing",
      };
    });
    const cells = [...assignmentCells, ...quizCells];

    return {
      averagePercent: cellAverage(cells),
      cells,
      studentEmail: student.email,
      studentId: student.id,
      studentName: student.name,
    };
  });

  return {
    columns,
    course,
    rows,
  };
}

export async function gradebookCsv(database: AppDb, input: { courseId: string }) {
  const gradebook = await getCourseGradebook(database, input);
  const lines = [
    ["Student", ...gradebook.columns.map(columnHeader), "Average"].map(csvCell).join(","),
  ];

  for (const row of gradebook.rows) {
    lines.push(
      [
        row.studentName,
        ...row.cells.map(csvValue),
        row.averagePercent === null ? "" : `${row.averagePercent}%`,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}
