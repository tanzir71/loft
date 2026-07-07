import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { classSessions, courses, scheduleSlots, schema } from "@/db/schema";

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

const minuteMs = 60 * 1000;
const dayMs = 24 * 60 * minuteMs;
const weekMs = 7 * dayMs;

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
