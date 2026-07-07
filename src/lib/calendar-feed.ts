import { and, asc, eq, gte, lt, ne } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";

import { classSessions, courses, enrollments, parentLinks, schema, users } from "@/db/schema";
import type { IcsEvent } from "@/lib/ics";
import type { UserRole } from "@/lib/user-types";

type AppDb = LibSQLDatabase<typeof schema>;
type CalendarUser = {
  id: string;
  name: string;
  role: UserRole;
};

const calendarWindowMs = 180 * 24 * 60 * 60 * 1000;

function createToken() {
  return randomBytes(24).toString("base64url");
}

function toEvents(
  rows: Array<{
    courseTitle: string;
    durationMin: number;
    id: string;
    notesShared: string | null;
    startsAt: number;
  }>,
): IcsEvent[] {
  const events = new Map<string, IcsEvent>();

  for (const row of rows) {
    events.set(row.id, {
      description: row.notesShared,
      endsAt: row.startsAt + row.durationMin * 60 * 1000,
      id: row.id,
      startsAt: row.startsAt,
      summary: row.courseTitle,
    });
  }

  return [...events.values()];
}

export async function regenerateIcsToken(database: AppDb, userId: string) {
  const token = createToken();
  const [user] = await database
    .update(users)
    .set({ icsToken: token, updatedAt: Date.now() })
    .where(eq(users.id, userId))
    .returning();

  if (!user) {
    throw new Error("User not found.");
  }

  return token;
}

export async function calendarEventsForUser(
  database: AppDb,
  user: CalendarUser,
  now = Date.now(),
) {
  const windowEnd = now + calendarWindowMs;

  if (user.role === "tutor") {
    const rows = await database
      .select({
        id: classSessions.id,
        courseTitle: courses.title,
        startsAt: classSessions.startsAt,
        durationMin: classSessions.durationMin,
        notesShared: classSessions.notesShared,
      })
      .from(classSessions)
      .innerJoin(courses, eq(classSessions.courseId, courses.id))
      .where(
        and(
          gte(classSessions.startsAt, now),
          lt(classSessions.startsAt, windowEnd),
          ne(classSessions.status, "cancelled"),
        ),
      )
      .orderBy(asc(classSessions.startsAt));

    return toEvents(rows);
  }

  if (user.role === "student") {
    const rows = await database
      .select({
        id: classSessions.id,
        courseTitle: courses.title,
        startsAt: classSessions.startsAt,
        durationMin: classSessions.durationMin,
        notesShared: classSessions.notesShared,
      })
      .from(enrollments)
      .innerJoin(classSessions, eq(enrollments.courseId, classSessions.courseId))
      .innerJoin(courses, eq(classSessions.courseId, courses.id))
      .where(
        and(
          eq(enrollments.studentId, user.id),
          eq(enrollments.status, "active"),
          gte(classSessions.startsAt, now),
          lt(classSessions.startsAt, windowEnd),
          ne(classSessions.status, "cancelled"),
        ),
      )
      .orderBy(asc(classSessions.startsAt));

    return toEvents(rows);
  }

  const rows = await database
    .select({
      id: classSessions.id,
      courseTitle: courses.title,
      startsAt: classSessions.startsAt,
      durationMin: classSessions.durationMin,
      notesShared: classSessions.notesShared,
    })
    .from(parentLinks)
    .innerJoin(enrollments, eq(parentLinks.studentId, enrollments.studentId))
    .innerJoin(classSessions, eq(enrollments.courseId, classSessions.courseId))
    .innerJoin(courses, eq(classSessions.courseId, courses.id))
    .where(
      and(
        eq(parentLinks.parentId, user.id),
        eq(enrollments.status, "active"),
        gte(classSessions.startsAt, now),
        lt(classSessions.startsAt, windowEnd),
        ne(classSessions.status, "cancelled"),
      ),
    )
    .orderBy(asc(classSessions.startsAt));

  return toEvents(rows);
}
