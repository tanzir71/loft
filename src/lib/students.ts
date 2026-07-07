import { hash } from "bcryptjs";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { parentLinks, schema, users } from "@/db/schema";

type AppDb = LibSQLDatabase<typeof schema>;
type StudentStatus = "active" | "archived";
type StudentRow = typeof users.$inferSelect;

type StudentSummary = {
  createdAt: number;
  email: string;
  id: string;
  name: string;
  role: "student";
  status: StudentStatus;
  updatedAt: number;
};

type ParentSummary = {
  email: string;
  id: string;
  name: string;
};

export type StudentWithParents = StudentSummary & {
  parents: ParentSummary[];
};

type CreateStudentInput = {
  email: string;
  makeId?: () => string;
  makePassword?: () => string;
  name: string;
  now?: () => number;
};

type UpdateStudentInput = {
  email: string;
  id: string;
  name: string;
  now?: () => number;
  status: StudentStatus;
};

type ArchiveStudentInput = {
  id: string;
  now?: () => number;
};

const studentFieldsSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  name: z.string().trim().min(1),
});

const updateStudentSchema = studentFieldsSchema.extend({
  id: z.string().trim().min(1),
  status: z.enum(["active", "archived"]),
});

function createId() {
  return randomBytes(12).toString("base64url");
}

function createTemporaryPassword() {
  return randomBytes(24).toString("base64url");
}

function toStudentSummary(row: StudentRow): StudentSummary {
  if (row.role !== "student") {
    throw new Error("Expected a student row.");
  }

  return {
    createdAt: row.createdAt,
    email: row.email,
    id: row.id,
    name: row.name,
    role: row.role,
    status: row.status,
    updatedAt: row.updatedAt,
  };
}

async function requireStudent(database: AppDb, id: string) {
  const [student] = await database
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "student")));

  if (!student) {
    throw new Error("Student not found.");
  }

  return student;
}

export async function createStudent(database: AppDb, input: CreateStudentInput) {
  const parsed = studentFieldsSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const temporaryPassword = input.makePassword?.() ?? createTemporaryPassword();
  const passwordHash = await hash(temporaryPassword, 12);
  const [student] = await database
    .insert(users)
    .values({
      id: input.makeId?.() ?? createId(),
      name: parsed.name,
      email: parsed.email,
      passwordHash,
      role: "student",
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return toStudentSummary(student);
}

export async function updateStudent(database: AppDb, input: UpdateStudentInput) {
  const parsed = updateStudentSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [student] = await database
    .update(users)
    .set({
      name: parsed.name,
      email: parsed.email,
      status: parsed.status,
      updatedAt: now,
    })
    .where(and(eq(users.id, parsed.id), eq(users.role, "student")))
    .returning();

  if (!student) {
    throw new Error("Student not found.");
  }

  return toStudentSummary(student);
}

export async function archiveStudent(database: AppDb, input: ArchiveStudentInput) {
  const id = z.string().trim().min(1).parse(input.id);
  const now = input.now?.() ?? Date.now();
  await requireStudent(database, id);
  const [student] = await database
    .update(users)
    .set({
      status: "archived",
      updatedAt: now,
    })
    .where(and(eq(users.id, id), eq(users.role, "student")))
    .returning();

  return toStudentSummary(student);
}

export async function listStudentsWithParents(database: AppDb): Promise<StudentWithParents[]> {
  const studentRows = await database
    .select()
    .from(users)
    .where(eq(users.role, "student"))
    .orderBy(asc(users.name));
  const studentIds = studentRows.map((student) => student.id);

  if (studentIds.length === 0) {
    return [];
  }

  const parentRows = await database
    .select({
      studentId: parentLinks.studentId,
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(parentLinks)
    .innerJoin(users, eq(parentLinks.parentId, users.id))
    .where(inArray(parentLinks.studentId, studentIds))
    .orderBy(asc(users.name));
  const parentsByStudent = new Map<string, ParentSummary[]>();

  for (const parent of parentRows) {
    const parents = parentsByStudent.get(parent.studentId) ?? [];
    parents.push({
      email: parent.email,
      id: parent.id,
      name: parent.name,
    });
    parentsByStudent.set(parent.studentId, parents);
  }

  return studentRows.map((student) => ({
    ...toStudentSummary(student),
    parents: parentsByStudent.get(student.id) ?? [],
  }));
}

export async function listParentLinkedStudents(database: AppDb, parentId: string) {
  const parsedParentId = z.string().trim().min(1).parse(parentId);

  return database
    .select({
      email: users.email,
      id: users.id,
      name: users.name,
      status: users.status,
    })
    .from(parentLinks)
    .innerJoin(users, eq(parentLinks.studentId, users.id))
    .where(and(eq(parentLinks.parentId, parsedParentId), eq(users.role, "student")))
    .orderBy(asc(users.name));
}
