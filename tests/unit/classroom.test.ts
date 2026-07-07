import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parentLinks, schema, users } from "@/db/schema";
import { createCourse, enrollStudent } from "@/lib/courses";
import {
  addAnnouncementComment,
  createAnnouncement,
  listAnnouncementComments,
  listParentAnnouncements,
  listStudentAnnouncements,
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
});
