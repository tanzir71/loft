import { and, asc, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  attendance,
  classSessions,
  courses,
  enrollments,
  parentLinks,
  scheduleSlots,
  schema,
  users,
} from "@/db/schema";
import { AuthzError } from "@/lib/authz";
import type { AuthenticatedUser } from "@/lib/user-types";

type AppDb = LibSQLDatabase<typeof schema>;

type CreateScheduleSlotInput = {
  courseId: string;
  durationMin: number;
  makeId?: () => string;
  now?: () => number;
  startMin: number;
  weekday: number;
};

type UpdateScheduleSlotInput = {
  durationMin: number;
  id: string;
  now?: () => number;
  startMin: number;
  weekday: number;
};

type DeactivateScheduleSlotInput = {
  id: string;
  now?: () => number;
};

type GenerateSessionsInput = {
  from: number;
  makeId?: (index: number) => string;
  now?: () => number;
  weeks: number;
};

type UpdateSessionStatusInput = {
  id: string;
  now?: () => number;
  status: "scheduled" | "done" | "cancelled";
};

type DefaultAttendanceInput = {
  makeId?: (index: number) => string;
  now?: () => number;
  sessionId: string;
};

type MarkAttendanceInput = {
  makeId?: () => string;
  now?: () => number;
  sessionId: string;
  status: "present" | "absent" | "late" | "excused";
  studentId: string;
};

type UpdateSessionNotesInput = {
  id: string;
  notesPrivate?: string | null;
  notesShared?: string | null;
  now?: () => number;
};

type GetSessionNotesInput = {
  sessionId: string;
  user: AuthenticatedUser;
};

export type PortalSessionSummary = {
  attendanceStatus: "present" | "absent" | "late" | "excused" | null;
  courseTitle: string;
  durationMin: number;
  id: string;
  notesShared: string | null;
  startsAt: number;
  status: "scheduled" | "done" | "cancelled";
  studentName?: string;
};

const minuteMs = 60 * 1000;
const dayMs = 24 * 60 * minuteMs;
const weekMs = 7 * dayMs;
const sessionStatusSchema = z.enum(["scheduled", "done", "cancelled"]);
const attendanceStatusSchema = z.enum(["present", "absent", "late", "excused"]);

const slotFieldsSchema = z.object({
  durationMin: z.number().int().min(1).max(24 * 60),
  startMin: z.number().int().min(0).max(24 * 60 - 1),
  weekday: z.number().int().min(0).max(6),
});

const createSlotSchema = slotFieldsSchema.extend({
  courseId: z.string().trim().min(1),
});

const updateSlotSchema = slotFieldsSchema.extend({
  id: z.string().trim().min(1),
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

function startOfUtcDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function occurrenceForSlot(input: {
  from: number;
  startMin: number;
  weekday: number;
  weekOffset: number;
}) {
  const dayStart = startOfUtcDay(input.from);
  const fromWeekday = new Date(dayStart).getUTCDay();
  const daysUntil = (input.weekday - fromWeekday + 7) % 7;
  let firstOccurrence = dayStart + daysUntil * dayMs + input.startMin * minuteMs;

  if (firstOccurrence < input.from) {
    firstOccurrence += weekMs;
  }

  return firstOccurrence + input.weekOffset * weekMs;
}

export async function createScheduleSlot(database: AppDb, input: CreateScheduleSlotInput) {
  const parsed = createSlotSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireActiveCourse(database, parsed.courseId);
  const [slot] = await database
    .insert(scheduleSlots)
    .values({
      id: input.makeId?.() ?? createId(),
      courseId: parsed.courseId,
      weekday: parsed.weekday,
      startMin: parsed.startMin,
      durationMin: parsed.durationMin,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return slot;
}

export async function updateScheduleSlot(database: AppDb, input: UpdateScheduleSlotInput) {
  const parsed = updateSlotSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [slot] = await database
    .update(scheduleSlots)
    .set({
      weekday: parsed.weekday,
      startMin: parsed.startMin,
      durationMin: parsed.durationMin,
      updatedAt: now,
    })
    .where(eq(scheduleSlots.id, parsed.id))
    .returning();

  if (!slot) {
    throw new Error("Schedule slot not found.");
  }

  return slot;
}

export async function deactivateScheduleSlot(
  database: AppDb,
  input: DeactivateScheduleSlotInput,
) {
  const id = z.string().trim().min(1).parse(input.id);
  const now = input.now?.() ?? Date.now();
  const [slot] = await database
    .update(scheduleSlots)
    .set({ active: false, updatedAt: now })
    .where(eq(scheduleSlots.id, id))
    .returning();

  if (!slot) {
    throw new Error("Schedule slot not found.");
  }

  return slot;
}

export async function generateSessions(database: AppDb, input: GenerateSessionsInput) {
  const parsed = z
    .object({
      from: z.number().int(),
      weeks: z.number().int().min(1).max(52),
    })
    .parse(input);
  const activeSlots = await database
    .select()
    .from(scheduleSlots)
    .where(eq(scheduleSlots.active, true));
  const now = input.now?.() ?? Date.now();
  let created = 0;
  let skipped = 0;

  for (const slot of activeSlots) {
    for (let weekOffset = 0; weekOffset < parsed.weeks; weekOffset += 1) {
      const startsAt = occurrenceForSlot({
        from: parsed.from,
        startMin: slot.startMin,
        weekday: slot.weekday,
        weekOffset,
      });
      const [existing] = await database
        .select({ id: classSessions.id })
        .from(classSessions)
        .where(
          and(
            eq(classSessions.generatedFromSlot, slot.id),
            eq(classSessions.startsAt, startsAt),
          ),
        );

      if (existing) {
        skipped += 1;
        continue;
      }

      await database.insert(classSessions).values({
        id: input.makeId?.(created) ?? createId(),
        courseId: slot.courseId,
        startsAt,
        durationMin: slot.durationMin,
        status: "scheduled",
        topic: null,
        notesPrivate: null,
        notesShared: null,
        generatedFromSlot: slot.id,
        createdAt: now,
        updatedAt: now,
      });
      created += 1;
    }
  }

  return { created, skipped };
}

export async function updateSessionStatus(database: AppDb, input: UpdateSessionStatusInput) {
  const parsed = z
    .object({
      id: z.string().trim().min(1),
      status: sessionStatusSchema,
    })
    .parse(input);
  const now = input.now?.() ?? Date.now();
  const [session] = await database
    .update(classSessions)
    .set({ status: parsed.status, updatedAt: now })
    .where(eq(classSessions.id, parsed.id))
    .returning();

  if (!session) {
    throw new Error("Session not found.");
  }

  return session;
}

export async function defaultAttendanceForSession(
  database: AppDb,
  input: DefaultAttendanceInput,
) {
  const sessionId = z.string().trim().min(1).parse(input.sessionId);
  const [session] = await database
    .select({ id: classSessions.id, courseId: classSessions.courseId })
    .from(classSessions)
    .where(eq(classSessions.id, sessionId));

  if (!session) {
    throw new Error("Session not found.");
  }

  const enrolledStudents = await database
    .select({ studentId: enrollments.studentId })
    .from(enrollments)
    .innerJoin(users, eq(enrollments.studentId, users.id))
    .where(
      and(
        eq(enrollments.courseId, session.courseId),
        eq(enrollments.status, "active"),
        eq(users.status, "active"),
      ),
    );
  const now = input.now?.() ?? Date.now();
  let created = 0;
  let skipped = 0;

  for (const enrolled of enrolledStudents) {
    const [existing] = await database
      .select({ id: attendance.id })
      .from(attendance)
      .where(
        and(
          eq(attendance.sessionId, session.id),
          eq(attendance.studentId, enrolled.studentId),
        ),
      );

    if (existing) {
      skipped += 1;
      continue;
    }

    await database.insert(attendance).values({
      id: input.makeId?.(created) ?? createId(),
      sessionId: session.id,
      studentId: enrolled.studentId,
      status: "present",
      createdAt: now,
      updatedAt: now,
    });
    created += 1;
  }

  return { created, skipped };
}

export async function markAttendance(database: AppDb, input: MarkAttendanceInput) {
  const parsed = z
    .object({
      sessionId: z.string().trim().min(1),
      studentId: z.string().trim().min(1),
      status: attendanceStatusSchema,
    })
    .parse(input);
  const now = input.now?.() ?? Date.now();
  const [row] = await database
    .insert(attendance)
    .values({
      id: input.makeId?.() ?? createId(),
      sessionId: parsed.sessionId,
      studentId: parsed.studentId,
      status: parsed.status,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [attendance.sessionId, attendance.studentId],
      set: {
        status: parsed.status,
        updatedAt: now,
      },
    })
    .returning();

  return row;
}

export async function updateSessionNotes(database: AppDb, input: UpdateSessionNotesInput) {
  const parsed = z
    .object({
      id: z.string().trim().min(1),
      notesPrivate: z.string().trim().nullable().optional(),
      notesShared: z.string().trim().nullable().optional(),
    })
    .parse(input);
  const now = input.now?.() ?? Date.now();
  const [session] = await database
    .update(classSessions)
    .set({
      notesPrivate: parsed.notesPrivate ?? null,
      notesShared: parsed.notesShared ?? null,
      updatedAt: now,
    })
    .where(eq(classSessions.id, parsed.id))
    .returning();

  if (!session) {
    throw new Error("Session not found.");
  }

  return session;
}

async function canStudentViewSession(database: AppDb, input: { courseId: string; userId: string }) {
  const [enrollment] = await database
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.courseId, input.courseId),
        eq(enrollments.studentId, input.userId),
        eq(enrollments.status, "active"),
      ),
    );

  return Boolean(enrollment);
}

async function canParentViewSession(database: AppDb, input: { courseId: string; userId: string }) {
  const [link] = await database
    .select({ studentId: parentLinks.studentId })
    .from(parentLinks)
    .innerJoin(enrollments, eq(parentLinks.studentId, enrollments.studentId))
    .where(
      and(
        eq(parentLinks.parentId, input.userId),
        eq(enrollments.courseId, input.courseId),
        eq(enrollments.status, "active"),
      ),
    );

  return Boolean(link);
}

export async function getSessionNotesForUser(database: AppDb, input: GetSessionNotesInput) {
  const sessionId = z.string().trim().min(1).parse(input.sessionId);
  const [session] = await database
    .select({
      courseId: classSessions.courseId,
      notesPrivate: classSessions.notesPrivate,
      notesShared: classSessions.notesShared,
    })
    .from(classSessions)
    .where(eq(classSessions.id, sessionId));

  if (!session) {
    throw new Error("Session not found.");
  }

  if (input.user.role === "tutor") {
    return {
      notesPrivate: session.notesPrivate,
      notesShared: session.notesShared,
    };
  }

  const canView =
    input.user.role === "student"
      ? await canStudentViewSession(database, {
          courseId: session.courseId,
          userId: input.user.id,
        })
      : await canParentViewSession(database, {
          courseId: session.courseId,
          userId: input.user.id,
        });

  if (!canView) {
    throw new AuthzError("Session notes forbidden", 403);
  }

  return {
    notesShared: session.notesShared,
  };
}

export async function listStudentPortalSessions(
  database: AppDb,
  studentId: string,
): Promise<PortalSessionSummary[]> {
  const parsedStudentId = z.string().trim().min(1).parse(studentId);
  return database
    .select({
      id: classSessions.id,
      courseTitle: courses.title,
      startsAt: classSessions.startsAt,
      durationMin: classSessions.durationMin,
      status: classSessions.status,
      notesShared: classSessions.notesShared,
      attendanceStatus: attendance.status,
    })
    .from(enrollments)
    .innerJoin(classSessions, eq(enrollments.courseId, classSessions.courseId))
    .innerJoin(courses, eq(classSessions.courseId, courses.id))
    .leftJoin(
      attendance,
      and(
        eq(attendance.sessionId, classSessions.id),
        eq(attendance.studentId, enrollments.studentId),
      ),
    )
    .where(and(eq(enrollments.studentId, parsedStudentId), eq(enrollments.status, "active")))
    .orderBy(asc(classSessions.startsAt));
}

export async function listParentPortalSessions(
  database: AppDb,
  parentId: string,
): Promise<PortalSessionSummary[]> {
  const parsedParentId = z.string().trim().min(1).parse(parentId);
  return database
    .select({
      id: classSessions.id,
      courseTitle: courses.title,
      startsAt: classSessions.startsAt,
      durationMin: classSessions.durationMin,
      status: classSessions.status,
      notesShared: classSessions.notesShared,
      attendanceStatus: attendance.status,
      studentName: users.name,
    })
    .from(parentLinks)
    .innerJoin(users, eq(parentLinks.studentId, users.id))
    .innerJoin(enrollments, eq(parentLinks.studentId, enrollments.studentId))
    .innerJoin(classSessions, eq(enrollments.courseId, classSessions.courseId))
    .innerJoin(courses, eq(classSessions.courseId, courses.id))
    .leftJoin(
      attendance,
      and(
        eq(attendance.sessionId, classSessions.id),
        eq(attendance.studentId, parentLinks.studentId),
      ),
    )
    .where(and(eq(parentLinks.parentId, parsedParentId), eq(enrollments.status, "active")))
    .orderBy(asc(classSessions.startsAt));
}
