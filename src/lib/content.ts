import { and, asc, eq, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { courses, materials, modules, schema } from "@/db/schema";

type AppDb = LibSQLDatabase<typeof schema>;
type MaterialType = "lecture" | "study" | "lesson_plan" | "worksheet";
type MaterialVisibility = "students" | "tutor_only";
type PublishStatus = "draft" | "published";

type CreateModuleInput = {
  courseId: string;
  description?: string | null;
  makeId?: () => string;
  now?: () => number;
  sortOrder?: number;
  title: string;
};

type UpdateModuleInput = {
  description?: string | null;
  id: string;
  now?: () => number;
  sortOrder: number;
  status: PublishStatus;
  title: string;
};

type CreateMaterialInput = {
  bodyMd: string;
  courseId: string;
  makeId?: () => string;
  moduleId?: string | null;
  now?: () => number;
  sortOrder?: number;
  status?: PublishStatus;
  title: string;
  type: MaterialType;
  visibility?: MaterialVisibility;
};

type UpdateMaterialInput = CreateMaterialInput & {
  id: string;
  sortOrder: number;
  status: PublishStatus;
  visibility: MaterialVisibility;
};

const publishStatusSchema = z.enum(["draft", "published"]);
const materialTypeSchema = z.enum(["lecture", "study", "lesson_plan", "worksheet"]);
const visibilitySchema = z.enum(["students", "tutor_only"]);

const moduleFieldsSchema = z.object({
  courseId: z.string().trim().min(1),
  description: z.string().trim().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  title: z.string().trim().min(1),
});

const updateModuleSchema = moduleFieldsSchema.omit({ courseId: true }).extend({
  id: z.string().trim().min(1),
  sortOrder: z.number().int().min(0),
  status: publishStatusSchema,
});

const materialFieldsSchema = z.object({
  bodyMd: z.string().trim(),
  courseId: z.string().trim().min(1),
  moduleId: z.string().trim().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  status: publishStatusSchema.optional(),
  title: z.string().trim().min(1),
  type: materialTypeSchema,
  visibility: visibilitySchema.optional(),
});

const updateMaterialSchema = materialFieldsSchema.extend({
  id: z.string().trim().min(1),
  sortOrder: z.number().int().min(0),
  status: publishStatusSchema,
  visibility: visibilitySchema,
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

async function nextModuleSortOrder(database: AppDb, courseId: string) {
  const rows = await database.select({ sortOrder: modules.sortOrder }).from(modules).where(eq(modules.courseId, courseId));
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
}

async function nextMaterialSortOrder(database: AppDb, courseId: string, moduleId: string | null) {
  const rows = await database
    .select({ sortOrder: materials.sortOrder })
    .from(materials)
    .where(
      moduleId
        ? and(eq(materials.courseId, courseId), eq(materials.moduleId, moduleId))
        : and(eq(materials.courseId, courseId), isNull(materials.moduleId)),
    );
  return rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
}

export async function createModule(database: AppDb, input: CreateModuleInput) {
  const parsed = moduleFieldsSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireActiveCourse(database, parsed.courseId);
  const [module] = await database
    .insert(modules)
    .values({
      id: input.makeId?.() ?? createId(),
      courseId: parsed.courseId,
      title: parsed.title,
      description: parsed.description ?? null,
      sortOrder: parsed.sortOrder ?? (await nextModuleSortOrder(database, parsed.courseId)),
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return module;
}

export async function updateModule(database: AppDb, input: UpdateModuleInput) {
  const parsed = updateModuleSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [module] = await database
    .update(modules)
    .set({
      title: parsed.title,
      description: parsed.description ?? null,
      sortOrder: parsed.sortOrder,
      status: parsed.status,
      updatedAt: now,
    })
    .where(eq(modules.id, parsed.id))
    .returning();

  if (!module) {
    throw new Error("Module not found.");
  }

  return module;
}

export async function createMaterial(database: AppDb, input: CreateMaterialInput) {
  const parsed = materialFieldsSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const moduleId = parsed.moduleId ?? null;
  await requireActiveCourse(database, parsed.courseId);
  const [material] = await database
    .insert(materials)
    .values({
      id: input.makeId?.() ?? createId(),
      courseId: parsed.courseId,
      moduleId,
      type: parsed.type,
      title: parsed.title,
      bodyMd: parsed.bodyMd,
      planJson: null,
      visibility: parsed.visibility ?? (parsed.type === "lesson_plan" ? "tutor_only" : "students"),
      status: parsed.status ?? "draft",
      publishAt: null,
      sortOrder: parsed.sortOrder ?? (await nextMaterialSortOrder(database, parsed.courseId, moduleId)),
      requiresMaterialId: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return material;
}

export async function updateMaterial(database: AppDb, input: UpdateMaterialInput) {
  const parsed = updateMaterialSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [material] = await database
    .update(materials)
    .set({
      moduleId: parsed.moduleId ?? null,
      type: parsed.type,
      title: parsed.title,
      bodyMd: parsed.bodyMd,
      visibility: parsed.visibility,
      status: parsed.status,
      sortOrder: parsed.sortOrder,
      updatedAt: now,
    })
    .where(eq(materials.id, parsed.id))
    .returning();

  if (!material) {
    throw new Error("Material not found.");
  }

  return material;
}

export async function listCourseContent(database: AppDb, courseId: string) {
  const parsedCourseId = z.string().trim().min(1).parse(courseId);
  const [moduleRows, materialRows] = await Promise.all([
    database
      .select()
      .from(modules)
      .where(eq(modules.courseId, parsedCourseId))
      .orderBy(asc(modules.sortOrder), asc(modules.title)),
    database
      .select()
      .from(materials)
      .where(eq(materials.courseId, parsedCourseId))
      .orderBy(asc(materials.sortOrder), asc(materials.title)),
  ]);

  return { materials: materialRows, modules: moduleRows };
}
