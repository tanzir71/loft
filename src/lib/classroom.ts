import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  announcements,
  assignments,
  attachments,
  commentBank,
  comments,
  courses,
  enrollments,
  parentLinks,
  schema,
  submissions,
  users,
} from "@/db/schema";
import type { UserRole } from "@/lib/user-types";

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

type AssignmentStatus = "draft" | "published";

type CreateAssignmentInput = {
  allowFile?: boolean;
  allowLink?: boolean;
  allowText?: boolean;
  bodyMd: string;
  courseId: string;
  dueAt?: number | null;
  makeId?: () => string;
  now?: () => number;
  points?: number | null;
  rubricMd?: string | null;
  status?: AssignmentStatus;
  title: string;
};

type UpdateAssignmentInput = CreateAssignmentInput & {
  id: string;
};

type SubmitAssignmentInput = {
  assignmentId: string;
  bodyText?: string | null;
  file?: { blobUrl: string; filename: string; size: number } | null;
  linkUrl?: string | null;
  makeAttachmentId?: () => string;
  makeId?: () => string;
  now?: () => number;
  studentId: string;
};

type ClassroomActor = {
  id: string;
  role: UserRole;
};

type GradeSubmissionInput = {
  actor: ClassroomActor;
  feedbackMd?: string | null;
  grade: number;
  now?: () => number;
  submissionId: string;
};

type CreateCommentBankItemInput = {
  makeId?: () => string;
  now?: () => number;
  sortOrder?: number;
  text: string;
};

type SubmissionCommentInput = {
  actor: ClassroomActor;
  body: string;
  makeId?: () => string;
  now?: () => number;
  submissionId: string;
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
const assignmentSchema = z.object({
  allowFile: z.boolean().optional(),
  allowLink: z.boolean().optional(),
  allowText: z.boolean().optional(),
  bodyMd: z.string().trim(),
  courseId: z.string().trim().min(1),
  dueAt: z.number().int().nullable().optional(),
  points: z.number().int().min(0).nullable().optional(),
  rubricMd: z.string().trim().nullable().optional(),
  status: z.enum(["draft", "published"]).optional(),
  title: z.string().trim().min(1),
});
const updateAssignmentSchema = assignmentSchema.extend({
  id: z.string().trim().min(1),
});
const submitAssignmentSchema = z.object({
  assignmentId: z.string().trim().min(1),
  bodyText: z.string().trim().nullable().optional(),
  file: z
    .object({
      blobUrl: z.string().trim().url(),
      filename: z.string().trim().min(1),
      size: z.number().int().min(0),
    })
    .nullable()
    .optional(),
  linkUrl: z.string().trim().url().nullable().optional(),
  studentId: z.string().trim().min(1),
});
const actorSchema = z.object({
  id: z.string().trim().min(1),
  role: z.enum(["tutor", "student", "parent"]),
});
const gradeSubmissionSchema = z.object({
  actor: actorSchema,
  feedbackMd: z.string().trim().nullable().optional(),
  grade: z.number().int().min(0),
  submissionId: z.string().trim().min(1),
});
const commentBankItemSchema = z.object({
  sortOrder: z.number().int().optional(),
  text: z.string().trim().min(1),
});
const submissionCommentSchema = z.object({
  actor: actorSchema,
  body: z.string().trim().min(1),
  submissionId: z.string().trim().min(1),
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

async function requireActiveCourse(database: AppDb, id: string) {
  const [course] = await database
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, id), eq(courses.status, "active")));

  if (!course) {
    throw new Error("Active course not found.");
  }
}

export async function createAssignment(database: AppDb, input: CreateAssignmentInput) {
  const parsed = assignmentSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireActiveCourse(database, parsed.courseId);
  const [assignment] = await database
    .insert(assignments)
    .values({
      id: input.makeId?.() ?? createId(),
      courseId: parsed.courseId,
      title: parsed.title,
      bodyMd: parsed.bodyMd,
      rubricMd: parsed.rubricMd ?? null,
      dueAt: parsed.dueAt ?? null,
      points: parsed.points ?? null,
      status: parsed.status ?? "draft",
      allowText: parsed.allowText ?? true,
      allowLink: parsed.allowLink ?? true,
      allowFile: parsed.allowFile ?? false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return assignment;
}

export async function updateAssignment(database: AppDb, input: UpdateAssignmentInput) {
  const parsed = updateAssignmentSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireActiveCourse(database, parsed.courseId);
  const [assignment] = await database
    .update(assignments)
    .set({
      courseId: parsed.courseId,
      title: parsed.title,
      bodyMd: parsed.bodyMd,
      rubricMd: parsed.rubricMd ?? null,
      dueAt: parsed.dueAt ?? null,
      points: parsed.points ?? null,
      status: parsed.status ?? "draft",
      allowText: parsed.allowText ?? true,
      allowLink: parsed.allowLink ?? true,
      allowFile: parsed.allowFile ?? false,
      updatedAt: now,
    })
    .where(eq(assignments.id, parsed.id))
    .returning();

  if (!assignment) {
    throw new Error("Assignment not found.");
  }

  return assignment;
}

export async function listStudentAssignments(
  database: AppDb,
  input: { now?: number; studentId: string },
) {
  const parsed = studentFeedSchema.parse(input);
  const courseIds = await activeCourseIdsForStudent(database, parsed.studentId);

  if (courseIds.length === 0) {
    return [];
  }

  return database
    .select()
    .from(assignments)
    .where(and(eq(assignments.status, "published"), inArray(assignments.courseId, courseIds)))
    .orderBy(asc(assignments.dueAt), asc(assignments.title));
}

export async function listTutorAssignments(database: AppDb) {
  return database
    .select()
    .from(assignments)
    .orderBy(desc(assignments.createdAt), asc(assignments.title));
}

export async function submitAssignment(database: AppDb, input: SubmitAssignmentInput) {
  const parsed = submitAssignmentSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [assignment] = await database
    .select()
    .from(assignments)
    .where(eq(assignments.id, parsed.assignmentId));

  if (!assignment || assignment.status !== "published") {
    throw new Error("Assignment not found.");
  }

  const courseIds = await activeCourseIdsForStudent(database, parsed.studentId);

  if (!courseIds.includes(assignment.courseId)) {
    throw new Error("Assignment unavailable.");
  }

  if (parsed.bodyText && !assignment.allowText) {
    throw new Error("Text submissions are disabled.");
  }

  if (parsed.linkUrl && !assignment.allowLink) {
    throw new Error("Link submissions are disabled.");
  }

  if (parsed.file && !assignment.allowFile) {
    throw new Error("File submissions are disabled.");
  }

  const [existing] = await database
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignment.id), eq(submissions.studentId, parsed.studentId)));

  if (existing?.grade !== null && existing?.grade !== undefined) {
    throw new Error("Submission has already been graded.");
  }

  const late = assignment.dueAt !== null && now > assignment.dueAt;
  const values = {
    bodyText: parsed.bodyText ?? null,
    linkUrl: parsed.linkUrl ?? null,
    submittedAt: now,
    status: "submitted" as const,
    updatedAt: now,
  };
  const [submission] = existing
    ? await database
        .update(submissions)
        .set(values)
        .where(eq(submissions.id, existing.id))
        .returning()
    : await database
        .insert(submissions)
        .values({
          id: input.makeId?.() ?? createId(),
          assignmentId: assignment.id,
          studentId: parsed.studentId,
          grade: null,
          feedbackMd: null,
          createdAt: now,
          ...values,
        })
        .returning();

  if (parsed.file) {
    await database.insert(attachments).values({
      id: input.makeAttachmentId?.() ?? createId(),
      ownerType: "submission",
      ownerId: submission.id,
      blobUrl: parsed.file.blobUrl,
      filename: parsed.file.filename,
      size: parsed.file.size,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { ...submission, late };
}

async function requireSubmissionAccess(
  database: AppDb,
  submissionId: string,
  actor: ClassroomActor,
) {
  const [row] = await database
    .select({
      assignmentId: assignments.id,
      assignmentTitle: assignments.title,
      courseId: courses.id,
      courseTitle: courses.title,
      points: assignments.points,
      studentId: submissions.studentId,
      submissionId: submissions.id,
    })
    .from(submissions)
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .innerJoin(courses, eq(assignments.courseId, courses.id))
    .where(eq(submissions.id, submissionId));

  if (!row) {
    throw new Error("Submission unavailable.");
  }

  if (actor.role === "tutor") {
    return row;
  }

  if (actor.role === "student" && row.studentId === actor.id) {
    return row;
  }

  throw new Error("Submission unavailable.");
}

export async function createCommentBankItem(
  database: AppDb,
  input: CreateCommentBankItemInput,
) {
  const parsed = commentBankItemSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [item] = await database
    .insert(commentBank)
    .values({
      id: input.makeId?.() ?? createId(),
      text: parsed.text,
      sortOrder: parsed.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return item;
}

export async function listCommentBank(database: AppDb) {
  return database.select().from(commentBank).orderBy(asc(commentBank.sortOrder), asc(commentBank.text));
}

export async function listGradingSubmissions(database: AppDb) {
  const rows = await database
    .select({
      assignmentId: assignments.id,
      assignmentTitle: assignments.title,
      bodyText: submissions.bodyText,
      courseTitle: courses.title,
      dueAt: assignments.dueAt,
      feedbackMd: submissions.feedbackMd,
      grade: submissions.grade,
      id: submissions.id,
      linkUrl: submissions.linkUrl,
      points: assignments.points,
      status: submissions.status,
      studentEmail: users.email,
      studentId: users.id,
      studentName: users.name,
      submittedAt: submissions.submittedAt,
    })
    .from(submissions)
    .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
    .innerJoin(courses, eq(assignments.courseId, courses.id))
    .innerJoin(users, eq(submissions.studentId, users.id))
    .orderBy(desc(submissions.submittedAt), asc(assignments.title), asc(users.name));

  return rows.map((row) => ({
    ...row,
    late: row.dueAt !== null && row.submittedAt > row.dueAt,
  }));
}

export async function gradeSubmission(database: AppDb, input: GradeSubmissionInput) {
  const parsed = gradeSubmissionSchema.parse(input);
  const now = input.now?.() ?? Date.now();

  if (parsed.actor.role !== "tutor") {
    throw new Error("Tutor access required.");
  }

  const submissionContext = await requireSubmissionAccess(database, parsed.submissionId, parsed.actor);

  if (submissionContext.points !== null && parsed.grade > submissionContext.points) {
    throw new Error("Grade cannot exceed assignment points.");
  }

  const [submission] = await database
    .update(submissions)
    .set({
      feedbackMd: parsed.feedbackMd ?? null,
      grade: parsed.grade,
      status: "returned",
      updatedAt: now,
    })
    .where(eq(submissions.id, parsed.submissionId))
    .returning();

  if (!submission) {
    throw new Error("Submission unavailable.");
  }

  return submission;
}

export async function listStudentAssignmentCards(
  database: AppDb,
  input: { now?: number; studentId: string },
) {
  const assignmentRows = await listStudentAssignments(database, input);
  const assignmentIds = assignmentRows.map((assignment) => assignment.id);

  if (assignmentIds.length === 0) {
    return [];
  }

  const submissionRows = await database
    .select()
    .from(submissions)
    .where(and(eq(submissions.studentId, input.studentId), inArray(submissions.assignmentId, assignmentIds)));
  const submissionsByAssignment = new Map(
    submissionRows.map((submission) => [submission.assignmentId, submission]),
  );

  return assignmentRows.map((assignment) => {
    const submission = submissionsByAssignment.get(assignment.id) ?? null;

    return {
      ...assignment,
      late: submission ? assignment.dueAt !== null && submission.submittedAt > assignment.dueAt : false,
      submission,
    };
  });
}

export async function addSubmissionComment(database: AppDb, input: SubmissionCommentInput) {
  const parsed = submissionCommentSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireSubmissionAccess(database, parsed.submissionId, parsed.actor);
  const [comment] = await database
    .insert(comments)
    .values({
      id: input.makeId?.() ?? createId(),
      entityType: "submission",
      entityId: parsed.submissionId,
      authorId: parsed.actor.id,
      body: parsed.body,
      createdAt: now,
    })
    .returning();

  return comment;
}

export async function listSubmissionComments(
  database: AppDb,
  input: { actor: ClassroomActor; submissionId: string },
) {
  const parsed = z
    .object({
      actor: actorSchema,
      submissionId: z.string().trim().min(1),
    })
    .parse(input);
  await requireSubmissionAccess(database, parsed.submissionId, parsed.actor);

  return database
    .select({
      authorId: users.id,
      authorName: users.name,
      authorRole: users.role,
      body: comments.body,
      createdAt: comments.createdAt,
      id: comments.id,
    })
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(and(eq(comments.entityType, "submission"), eq(comments.entityId, parsed.submissionId)))
    .orderBy(asc(comments.createdAt));
}
