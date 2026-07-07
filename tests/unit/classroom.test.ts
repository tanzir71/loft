import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parentLinks, schema, users } from "@/db/schema";
import { createCourse, enrollStudent } from "@/lib/courses";
import {
  addAnnouncementComment,
  addSubmissionComment,
  createCommentBankItem,
  createAssignment,
  createAnnouncement,
  gradeSubmission,
  listAnnouncementComments,
  listCommentBank,
  listGradingSubmissions,
  listParentAnnouncements,
  listStudentAnnouncements,
  listStudentAssignmentCards,
  listStudentAssignments,
  listSubmissionComments,
  submitAssignment,
  updateAssignment,
} from "@/lib/classroom";
import { seedTutor } from "@/lib/seed";
import { createStudent } from "@/lib/students";

async function applyInitialMigration(client: Client) {
  const migrationDir = path.join(process.cwd(), "drizzle");
  const migrationFile = readdirSync(migrationDir).find(
    (file) => file.startsWith("0000_") && file.endsWith(".sql"),
  );

  if (!migrationFile) {
    throw new Error("Initial migration was not generated.");
  }

  const sql = readFileSync(path.join(migrationDir, migrationFile), "utf8");

  for (const statement of sql.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) {
      await client.execute(trimmed);
    }
  }
}

async function createMigratedDb() {
  const client = createClient({ url: "file::memory:" });
  await applyInitialMigration(client);
  const db = drizzle(client, { schema });
  await seedTutor(db, {
    email: "tutor@example.com",
    makeId: () => "tutor_id",
    password: "correct horse battery staple",
  });

  return { client, db };
}

describe("classroom announcements", () => {
  it("publishes scheduled global/course announcements to student and parent feeds with comments", async () => {
    const { client, db } = await createMigratedDb();
    const now = Date.UTC(2026, 6, 7, 12);
    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
    });
    await db.insert(users).values({
      id: "parent_id",
      name: "Parent One",
      email: "parent@example.com",
      passwordHash: "hash",
      role: "parent",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(parentLinks).values({ parentId: "parent_id", studentId: "student_id" });
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    await createCourse(db, {
      description: "",
      makeId: () => "other_course_id",
      subject: "Science",
      title: "Biology",
    });
    await enrollStudent(db, {
      courseId: "course_id",
      makeId: () => "enrollment_id",
      studentId: "student_id",
    });
    await createAnnouncement(db, {
      bodyMd: "Global note",
      makeId: () => "global_id",
      publishAt: now - 1,
      status: "published",
      title: "Global",
    });
    await createAnnouncement(db, {
      allowComments: true,
      bodyMd: "Course note",
      courseId: "course_id",
      makeId: () => "course_note_id",
      publishAt: now - 1,
      status: "published",
      title: "Course note",
    });
    await createAnnouncement(db, {
      bodyMd: "Future note",
      courseId: "course_id",
      makeId: () => "future_id",
      publishAt: now + 60_000,
      status: "published",
      title: "Future",
    });
    await createAnnouncement(db, {
      bodyMd: "Other course",
      courseId: "other_course_id",
      makeId: () => "other_id",
      publishAt: now - 1,
      status: "published",
      title: "Other",
    });
    await addAnnouncementComment(db, {
      announcementId: "course_note_id",
      authorId: "student_id",
      body: "I have a question.",
      makeId: () => "comment_id",
      now: () => now,
    });

    const studentNow = await listStudentAnnouncements(db, { now, studentId: "student_id" });
    const studentLater = await listStudentAnnouncements(db, {
      now: now + 120_000,
      studentId: "student_id",
    });
    const parentFeed = await listParentAnnouncements(db, { now, parentId: "parent_id" });
    const comments = await listAnnouncementComments(db, "course_note_id");
    client.close();

    expect(studentNow.map((item) => item.title)).toEqual(["Course note", "Global"]);
    expect(studentLater.map((item) => item.title)).toEqual(["Future", "Course note", "Global"]);
    expect(parentFeed.map((item) => item.title)).toEqual(["Course note", "Global"]);
    expect(comments).toMatchObject([
      {
        authorName: "Student One",
        body: "I have a question.",
      },
    ]);
  });

  it("manages assignments, shows rubrics to students, and supports late resubmission until graded", async () => {
    const { client, db } = await createMigratedDb();
    const now = Date.UTC(2026, 6, 7, 12);
    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
    });
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    await enrollStudent(db, {
      courseId: "course_id",
      makeId: () => "enrollment_id",
      studentId: "student_id",
    });
    const assignment = await createAssignment(db, {
      allowFile: true,
      allowLink: true,
      allowText: true,
      bodyMd: "Solve the worksheet.",
      courseId: "course_id",
      dueAt: now - 60_000,
      makeId: () => "assignment_id",
      points: 10,
      rubricMd: "Show each step.",
      status: "published",
      title: "Linear practice",
    });
    await updateAssignment(db, {
      ...assignment,
      bodyMd: "Solve all worksheet questions.",
      rubricMd: "Show each algebra step.",
      status: "published",
    });

    const visible = await listStudentAssignments(db, {
      now,
      studentId: "student_id",
    });
    const firstSubmission = await submitAssignment(db, {
      assignmentId: "assignment_id",
      bodyText: "My first answer",
      file: {
        blobUrl: "https://example.com/work.pdf",
        filename: "work.pdf",
        size: 1200,
      },
      linkUrl: "https://example.com/work",
      makeAttachmentId: () => "attachment_id",
      makeId: () => "submission_id",
      now: () => now,
      studentId: "student_id",
    });
    const resubmission = await submitAssignment(db, {
      assignmentId: "assignment_id",
      bodyText: "My revised answer",
      linkUrl: "https://example.com/revised",
      now: () => now + 30_000,
      studentId: "student_id",
    });
    client.close();

    expect(visible).toMatchObject([
      {
        bodyMd: "Solve all worksheet questions.",
        rubricMd: "Show each algebra step.",
        title: "Linear practice",
      },
    ]);
    expect(firstSubmission).toMatchObject({
      bodyText: "My first answer",
      late: true,
      linkUrl: "https://example.com/work",
    });
    expect(resubmission).toMatchObject({
      bodyText: "My revised answer",
      id: "submission_id",
      late: true,
      linkUrl: "https://example.com/revised",
    });
  });

  it("returns graded submissions with banked feedback and private submission comments", async () => {
    const { client, db } = await createMigratedDb();
    const now = Date.UTC(2026, 6, 7, 12);
    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
    });
    await createStudent(db, {
      email: "other@example.com",
      makeId: () => "other_student_id",
      name: "Other Student",
    });
    await db.insert(users).values({
      id: "parent_id",
      name: "Parent One",
      email: "parent@example.com",
      passwordHash: "hash",
      role: "parent",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await createCourse(db, {
      description: "",
      makeId: () => "course_id",
      subject: "Math",
      title: "Algebra I",
    });
    await enrollStudent(db, {
      courseId: "course_id",
      makeId: () => "enrollment_id",
      studentId: "student_id",
    });
    await createAssignment(db, {
      bodyMd: "Solve the worksheet.",
      courseId: "course_id",
      dueAt: now + 60_000,
      makeId: () => "assignment_id",
      points: 10,
      rubricMd: "Show each step.",
      status: "published",
      title: "Linear practice",
    });
    await submitAssignment(db, {
      assignmentId: "assignment_id",
      bodyText: "My solution",
      makeId: () => "submission_id",
      now: () => now,
      studentId: "student_id",
    });
    await createCommentBankItem(db, {
      makeId: () => "bank_id",
      sortOrder: 1,
      text: "Strong setup; add one more justification.",
    });
    const bank = await listCommentBank(db);
    const queue = await listGradingSubmissions(db);
    const returned = await gradeSubmission(db, {
      actor: { id: "tutor_id", role: "tutor" },
      feedbackMd: `${bank[0].text}\n\nReturned with next steps.`,
      grade: 8,
      now: () => now + 1,
      submissionId: "submission_id",
    });
    await addSubmissionComment(db, {
      actor: { id: "student_id", role: "student" },
      body: "Can you check my second line?",
      makeId: () => "student_comment_id",
      now: () => now + 2,
      submissionId: "submission_id",
    });
    await addSubmissionComment(db, {
      actor: { id: "tutor_id", role: "tutor" },
      body: "Yes, use the distributive property there.",
      makeId: () => "tutor_comment_id",
      now: () => now + 3,
      submissionId: "submission_id",
    });
    const studentCards = await listStudentAssignmentCards(db, {
      studentId: "student_id",
    });
    const studentThread = await listSubmissionComments(db, {
      actor: { id: "student_id", role: "student" },
      submissionId: "submission_id",
    });

    await expect(
      listSubmissionComments(db, {
        actor: { id: "other_student_id", role: "student" },
        submissionId: "submission_id",
      }),
    ).rejects.toThrow("Submission unavailable.");
    await expect(
      addSubmissionComment(db, {
        actor: { id: "parent_id", role: "parent" },
        body: "Can I see this?",
        submissionId: "submission_id",
      }),
    ).rejects.toThrow("Submission unavailable.");
    await expect(
      submitAssignment(db, {
        assignmentId: "assignment_id",
        bodyText: "Late revision after return",
        studentId: "student_id",
      }),
    ).rejects.toThrow("Submission has already been graded.");
    client.close();

    expect(bank).toMatchObject([{ text: "Strong setup; add one more justification." }]);
    expect(queue).toMatchObject([
      {
        assignmentTitle: "Linear practice",
        bodyText: "My solution",
        studentName: "Student One",
      },
    ]);
    expect(returned).toMatchObject({
      feedbackMd: "Strong setup; add one more justification.\n\nReturned with next steps.",
      grade: 8,
      status: "returned",
    });
    expect(studentCards).toMatchObject([
      {
        submission: {
          feedbackMd: "Strong setup; add one more justification.\n\nReturned with next steps.",
          grade: 8,
          status: "returned",
        },
        title: "Linear practice",
      },
    ]);
    expect(studentThread.map((comment) => comment.body)).toEqual([
      "Can you check my second line?",
      "Yes, use the distributive property there.",
    ]);
  });
});
