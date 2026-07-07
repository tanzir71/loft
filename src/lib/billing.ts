import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { courses, enrollments, ratePlans, schema } from "@/db/schema";

type AppDb = LibSQLDatabase<typeof schema>;
type RatePlanType = "per_session" | "monthly_flat" | "package";

type CreateRatePlanInput = {
  amount: number;
  makeId?: () => string;
  name: string;
  now?: () => number;
  sessionsCount?: number | null;
  type: RatePlanType;
};

type UpdateRatePlanInput = {
  active: boolean;
  amount: number;
  id: string;
  name: string;
  now?: () => number;
  sessionsCount?: number | null;
  type: RatePlanType;
};

type ArchiveRatePlanInput = {
  id: string;
  now?: () => number;
};

type CourseRatePlanInput = {
  courseId: string;
  ratePlanId: string;
  now?: () => number;
};

type EnrollmentRatePlanInput = {
  courseId: string;
  ratePlanId: string;
  studentId: string;
  now?: () => number;
};

type ResolveRatePlanInput = {
  courseId: string;
  studentId: string;
};

const ratePlanFieldsSchema = z.object({
  amount: z.number().int().min(0),
  name: z.string().trim().min(1),
  sessionsCount: z.number().int().min(1).nullable().optional(),
  type: z.enum(["per_session", "monthly_flat", "package"]),
});

const updateRatePlanSchema = ratePlanFieldsSchema.extend({
  active: z.boolean(),
  id: z.string().trim().min(1),
});

const courseRatePlanSchema = z.object({
  courseId: z.string().trim().min(1),
  ratePlanId: z.string().trim().min(1),
});

const enrollmentRatePlanSchema = courseRatePlanSchema.extend({
  studentId: z.string().trim().min(1),
});

function createId() {
  return randomBytes(12).toString("base64url");
}

function normalizedSessionsCount(input: { sessionsCount?: number | null; type: RatePlanType }) {
  if (input.type === "package") {
    return input.sessionsCount ?? 1;
  }

  return null;
}

async function requireActiveRatePlan(database: AppDb, id: string) {
  const [plan] = await database
    .select()
    .from(ratePlans)
    .where(and(eq(ratePlans.id, id), eq(ratePlans.active, true)));

  if (!plan) {
    throw new Error("Active rate plan not found.");
  }

  return plan;
}

export async function createRatePlan(database: AppDb, input: CreateRatePlanInput) {
  const parsed = ratePlanFieldsSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [plan] = await database
    .insert(ratePlans)
    .values({
      id: input.makeId?.() ?? createId(),
      name: parsed.name,
      type: parsed.type,
      amount: parsed.amount,
      sessionsCount: normalizedSessionsCount(parsed),
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return plan;
}

export async function updateRatePlan(database: AppDb, input: UpdateRatePlanInput) {
  const parsed = updateRatePlanSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [plan] = await database
    .update(ratePlans)
    .set({
      name: parsed.name,
      type: parsed.type,
      amount: parsed.amount,
      sessionsCount: normalizedSessionsCount(parsed),
      active: parsed.active,
      updatedAt: now,
    })
    .where(eq(ratePlans.id, parsed.id))
    .returning();

  if (!plan) {
    throw new Error("Rate plan not found.");
  }

  return plan;
}

export async function archiveRatePlan(database: AppDb, input: ArchiveRatePlanInput) {
  const id = z.string().trim().min(1).parse(input.id);
  const now = input.now?.() ?? Date.now();
  const [plan] = await database
    .update(ratePlans)
    .set({ active: false, updatedAt: now })
    .where(eq(ratePlans.id, id))
    .returning();

  if (!plan) {
    throw new Error("Rate plan not found.");
  }

  return plan;
}

export async function setCourseDefaultRatePlan(database: AppDb, input: CourseRatePlanInput) {
  const parsed = courseRatePlanSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireActiveRatePlan(database, parsed.ratePlanId);
  const [course] = await database
    .update(courses)
    .set({ defaultRatePlanId: parsed.ratePlanId, updatedAt: now })
    .where(eq(courses.id, parsed.courseId))
    .returning();

  if (!course) {
    throw new Error("Course not found.");
  }

  return course;
}

export async function setEnrollmentRatePlan(database: AppDb, input: EnrollmentRatePlanInput) {
  const parsed = enrollmentRatePlanSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireActiveRatePlan(database, parsed.ratePlanId);
  const [enrollment] = await database
    .update(enrollments)
    .set({ ratePlanId: parsed.ratePlanId, updatedAt: now })
    .where(
      and(
        eq(enrollments.courseId, parsed.courseId),
        eq(enrollments.studentId, parsed.studentId),
        eq(enrollments.status, "active"),
      ),
    )
    .returning();

  if (!enrollment) {
    throw new Error("Enrollment not found.");
  }

  return enrollment;
}

export async function resolveEnrollmentRatePlan(database: AppDb, input: ResolveRatePlanInput) {
  const parsed = enrollmentRatePlanSchema.omit({ ratePlanId: true }).parse(input);
  const [enrollment] = await database
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.courseId, parsed.courseId),
        eq(enrollments.studentId, parsed.studentId),
        eq(enrollments.status, "active"),
      ),
    );

  if (!enrollment) {
    return null;
  }

  if (enrollment.ratePlanId) {
    return requireActiveRatePlan(database, enrollment.ratePlanId);
  }

  const [course] = await database
    .select()
    .from(courses)
    .where(eq(courses.id, parsed.courseId));

  if (!course?.defaultRatePlanId) {
    return null;
  }

  return requireActiveRatePlan(database, course.defaultRatePlanId);
}
