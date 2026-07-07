import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  announcements,
  comments,
  courses,
  enrollments,
  parentLinks,
  schema,
  users,
} from "@/db/schema";

type AppDb = LibSQLDatabase<typeof schema>;
type PublishStatus = "draft" | "published";

type CreateAnnouncementInput = {
  allowComments?: boolean;
  bodyMd: string;
  courseId?: string | null;
  makeId?: () => string;
  now?: () => number;
  publishAt?: number | null;
  status?: PublishStatus;
  title: string;
};

type UpdateAnnouncementInput = CreateAnnouncementInput & {
  id: string;
};

type AddAnnouncementCommentInput = {
  announcementId: string;
  authorId: string;
  body: string;
  makeId?: () => string;
  now?: () => number;
};

const announcementSchema = z.object({
  allowComments: z.boolean().optional(),
  bodyMd: z.string().trim(),
  courseId: z.string().trim().min(1).nullable().optional(),
  publishAt: z.number().int().nullable().optional(),
  status: z.enum(["draft", "published"]).optional(),
  title: z.string().trim().min(1),
});
const updateAnnouncementSchema = announcementSchema.extend({
  id: z.string().trim().min(1),
});

const studentFeedSchema = z.object({
  now: z.number().int().optional(),
  studentId: z.string().trim().min(1),
});

const parentFeedSchema = z.object({
  now: z.number().int().optional(),
  parentId: z.string().trim().min(1),
});

const addCommentSchema = z.object({
  announcementId: z.string().trim().min(1),
  authorId: z.string().trim().min(1),
  body: z.string().trim().min(1),
});

function createId() {
  return randomBytes(12).toString("base64url");
}

export async function createAnnouncement(database: AppDb, input: CreateAnnouncementInput) {
  const parsed = announcementSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [announcement] = await database
    .insert(announcements)
    .values({
      id: input.makeId?.() ?? createId(),
      courseId: parsed.courseId ?? null,
      title: parsed.title,
      bodyMd: parsed.bodyMd,
      publishAt: parsed.publishAt ?? null,
      status: parsed.status ?? "draft",
      allowComments: parsed.allowComments ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return announcement;
}

export async function updateAnnouncement(database: AppDb, input: UpdateAnnouncementInput) {
  const parsed = updateAnnouncementSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [announcement] = await database
    .update(announcements)
    .set({
      courseId: parsed.courseId ?? null,
      title: parsed.title,
      bodyMd: parsed.bodyMd,
      publishAt: parsed.publishAt ?? null,
      status: parsed.status ?? "draft",
      allowComments: parsed.allowComments ?? false,
      updatedAt: now,
    })
    .where(eq(announcements.id, parsed.id))
    .returning();

  if (!announcement) {
    throw new Error("Announcement not found.");
  }

  return announcement;
}

export async function listTutorAnnouncements(database: AppDb) {
  return database
    .select()
    .from(announcements)
    .orderBy(desc(announcements.createdAt), asc(announcements.title));
}

async function activeCourseIdsForStudent(database: AppDb, studentId: string) {
  const rows = await database
    .select({ courseId: enrollments.courseId })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(
      and(
        eq(enrollments.studentId, studentId),
        eq(enrollments.status, "active"),
        eq(courses.status, "active"),
      ),
    );

  return rows.map((row) => row.courseId);
}

async function activeCourseIdsForParent(database: AppDb, parentId: string) {
  const rows = await database
    .select({ courseId: enrollments.courseId })
    .from(parentLinks)
    .innerJoin(enrollments, eq(parentLinks.studentId, enrollments.studentId))
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(
      and(
        eq(parentLinks.parentId, parentId),
        eq(enrollments.status, "active"),
        eq(courses.status, "active"),
      ),
    );

  return [...new Set(rows.map((row) => row.courseId))];
}

async function visibleAnnouncements(database: AppDb, courseIds: string[], now: number) {
  const scopeClause =
    courseIds.length > 0
      ? or(isNull(announcements.courseId), inArray(announcements.courseId, courseIds))
      : isNull(announcements.courseId);

  return database
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.status, "published"),
        or(isNull(announcements.publishAt), lte(announcements.publishAt, now)),
        scopeClause,
      ),
    )
    .orderBy(desc(announcements.publishAt), asc(announcements.title));
}

export async function listStudentAnnouncements(
  database: AppDb,
  input: { now?: number; studentId: string },
) {
  const parsed = studentFeedSchema.parse(input);
  const courseIds = await activeCourseIdsForStudent(database, parsed.studentId);

  return visibleAnnouncements(database, courseIds, parsed.now ?? Date.now());
}

export async function listParentAnnouncements(
  database: AppDb,
  input: { now?: number; parentId: string },
) {
  const parsed = parentFeedSchema.parse(input);
  const courseIds = await activeCourseIdsForParent(database, parsed.parentId);

  return visibleAnnouncements(database, courseIds, parsed.now ?? Date.now());
}

export async function addAnnouncementComment(database: AppDb, input: AddAnnouncementCommentInput) {
  const parsed = addCommentSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [announcement] = await database
    .select({ allowComments: announcements.allowComments })
    .from(announcements)
    .where(eq(announcements.id, parsed.announcementId));

  if (!announcement) {
    throw new Error("Announcement not found.");
  }

  if (!announcement.allowComments) {
    throw new Error("Announcement comments are closed.");
  }

  const [comment] = await database
    .insert(comments)
    .values({
      id: input.makeId?.() ?? createId(),
      entityType: "announcement",
      entityId: parsed.announcementId,
      authorId: parsed.authorId,
      body: parsed.body,
      createdAt: now,
    })
    .returning();

  return comment;
}

export async function listAnnouncementComments(database: AppDb, announcementId: string) {
  const parsedId = z.string().trim().min(1).parse(announcementId);

  return database
    .select({
      authorId: users.id,
      authorName: users.name,
      body: comments.body,
      createdAt: comments.createdAt,
      id: comments.id,
    })
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(and(eq(comments.entityType, "announcement"), eq(comments.entityId, parsedId)))
    .orderBy(asc(comments.createdAt));
}
