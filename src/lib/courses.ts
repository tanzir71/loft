import { and, asc, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { courses, enrollments, schema, users } from "@/db/schema";

type AppDb = LibSQLDatabase<typeof schema>;
type CourseStatus = "active" | "archived";
type CourseRow = typeof courses.$inferSelect;
type EnrollmentRow = typeof enrollments.$inferSelect;

type CourseSummary = {
  createdAt: number;
  defaultRatePlanId: string | null;
  description: string;
  id: string;
  status: CourseStatus;
  subject: string;
  title: string;
  updatedAt: number;
};

type EnrolledStudentSummary = {
  email: string;
  enrollmentId: string;
  id: string;
  name: string;
};

export type CourseWithEnrollments = CourseSummary & {
  students: EnrolledStudentSummary[];
};

type CreateCourseInput = {
  description: string;
  makeId?: () => string;
  now?: () => number;
  subject: string;
  title: string;
};

type UpdateCourseInput = {
  description: string;
  id: string;
  now?: () => number;
  status: CourseStatus;
  subject: string;
  title: string;
};

type ArchiveCourseInput = {
  id: string;
  now?: () => number;
};

type EnrollStudentInput = {
  courseId: string;
  makeId?: () => string;
  now?: () => number;
  studentId: string;
};

type UnenrollStudentInput = {
  courseId: string;
  now?: () => number;
  studentId: string;
};

const courseFieldsSchema = z.object({
  description: z.string().trim(),
  subject: z.string().trim().min(1),
  title: z.string().trim().min(1),
});

const updateCourseSchema = courseFieldsSchema.extend({
  id: z.string().trim().min(1),
  status: z.enum(["active", "archived"]),
});

const enrollmentSchema = z.object({
  courseId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
});

function createId() {
  return randomBytes(12).toString("base64url");
}

function toCourseSummary(row: CourseRow): CourseSummary {
  return {
    createdAt: row.createdAt,
    defaultRatePlanId: row.defaultRatePlanId,
    description: row.description,
    id: row.id,
    status: row.status,
    subject: row.subject,
    title: row.title,
    updatedAt: row.updatedAt,
  };
}

async function requireActiveCourse(database: AppDb, id: string) {
  const [course] = await database
    .select()
    .from(courses)
    .where(and(eq(courses.id, id), eq(courses.status, "active")));

  if (!course) {
    throw new Error("Active course not found.");
  }

  return course;
}

async function requireActiveStudent(database: AppDb, id: string) {
  const [student] = await database
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "student"), eq(users.status, "active")));

  if (!student) {
    throw new Error("Active student not found.");
  }

  return student;
}

function requireEnrollment(row: EnrollmentRow | undefined) {
  if (!row) {
    throw new Error("Enrollment not found.");
  }

  return row;
}

export async function createCourse(database: AppDb, input: CreateCourseInput) {
  const parsed = courseFieldsSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [course] = await database
    .insert(courses)
    .values({
      id: input.makeId?.() ?? createId(),
      title: parsed.title,
      subject: parsed.subject,
      description: parsed.description,
      status: "active",
      defaultRatePlanId: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return toCourseSummary(course);
}

export async function updateCourse(database: AppDb, input: UpdateCourseInput) {
  const parsed = updateCourseSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [course] = await database
    .update(courses)
    .set({
      title: parsed.title,
      subject: parsed.subject,
      description: parsed.description,
      status: parsed.status,
      updatedAt: now,
    })
    .where(eq(courses.id, parsed.id))
    .returning();

  if (!course) {
    throw new Error("Course not found.");
  }

  return toCourseSummary(course);
}

export async function archiveCourse(database: AppDb, input: ArchiveCourseInput) {
  const id = z.string().trim().min(1).parse(input.id);
  const now = input.now?.() ?? Date.now();
  const [course] = await database
    .update(courses)
    .set({ status: "archived", updatedAt: now })
    .where(eq(courses.id, id))
    .returning();

  if (!course) {
    throw new Error("Course not found.");
  }

  return toCourseSummary(course);
}

export async function enrollStudent(database: AppDb, input: EnrollStudentInput) {
  const parsed = enrollmentSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireActiveCourse(database, parsed.courseId);
  await requireActiveStudent(database, parsed.studentId);

  const [existingEnrollment] = await database
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.courseId, parsed.courseId),
        eq(enrollments.studentId, parsed.studentId),
      ),
    );

  if (existingEnrollment) {
    const [enrollment] = await database
      .update(enrollments)
      .set({ status: "active", updatedAt: now })
      .where(eq(enrollments.id, existingEnrollment.id))
      .returning();

    return enrollment;
  }

  const [enrollment] = await database
    .insert(enrollments)
    .values({
      id: input.makeId?.() ?? createId(),
      courseId: parsed.courseId,
      studentId: parsed.studentId,
      ratePlanId: null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return enrollment;
}

export async function unenrollStudent(database: AppDb, input: UnenrollStudentInput) {
  const parsed = enrollmentSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [enrollment] = await database
    .update(enrollments)
    .set({ status: "archived", updatedAt: now })
    .where(
      and(
        eq(enrollments.courseId, parsed.courseId),
        eq(enrollments.studentId, parsed.studentId),
      ),
    )
    .returning();

  return requireEnrollment(enrollment);
}

export async function listCoursesWithEnrollments(
  database: AppDb,
): Promise<CourseWithEnrollments[]> {
  const courseRows = await database.select().from(courses).orderBy(asc(courses.title));
  const courseIds = courseRows.map((course) => course.id);

  if (courseIds.length === 0) {
    return [];
  }

  const enrollmentRows = await database
    .select({
      courseId: enrollments.courseId,
      enrollmentId: enrollments.id,
      studentId: users.id,
      studentName: users.name,
      studentEmail: users.email,
    })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .where(
      and(
        inArray(enrollments.courseId, courseIds),
        eq(enrollments.status, "active"),
        eq(users.status, "active"),
      ),
    )
    .orderBy(asc(users.name));
  const studentsByCourse = new Map<string, EnrolledStudentSummary[]>();

  for (const enrollment of enrollmentRows) {
    const students = studentsByCourse.get(enrollment.courseId) ?? [];
    students.push({
      email: enrollment.studentEmail,
      enrollmentId: enrollment.enrollmentId,
      id: enrollment.studentId,
      name: enrollment.studentName,
    });
    studentsByCourse.set(enrollment.courseId, students);
  }

  return courseRows.map((course) => ({
    ...toCourseSummary(course),
    students: studentsByCourse.get(course.id) ?? [],
  }));
}
