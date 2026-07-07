import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { courses, materialLinks, materialProgress, materials, modules, schema } from "@/db/schema";

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

type DuplicateMaterialInput = {
  id: string;
  makeId?: () => string;
  now?: () => number;
  targetCourseId: string;
  targetModuleId?: string | null;
};

type DuplicateModuleInput = {
  id: string;
  makeId?: (kind: "module" | "material", index: number) => string;
  now?: () => number;
  targetCourseId: string;
};

type MaterialLinkKind = "link" | "youtube" | "pdf";

type AddMaterialLinkInput = {
  kind: MaterialLinkKind;
  label: string;
  makeId?: () => string;
  materialId: string;
  now?: () => number;
  url: string;
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

const duplicateMaterialSchema = z.object({
  id: z.string().trim().min(1),
  targetCourseId: z.string().trim().min(1),
  targetModuleId: z.string().trim().min(1).nullable().optional(),
});

const duplicateModuleSchema = z.object({
  id: z.string().trim().min(1),
  targetCourseId: z.string().trim().min(1),
});

const addMaterialLinkSchema = z.object({
  kind: z.enum(["link", "youtube", "pdf"]),
  label: z.string().trim().min(1),
  materialId: z.string().trim().min(1),
  url: z.string().trim().url(),
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

export async function duplicateMaterial(database: AppDb, input: DuplicateMaterialInput) {
  const parsed = duplicateMaterialSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireActiveCourse(database, parsed.targetCourseId);
  const [source] = await database.select().from(materials).where(eq(materials.id, parsed.id));

  if (!source) {
    throw new Error("Material not found.");
  }

  const targetModuleId = parsed.targetModuleId ?? null;
  const [copy] = await database
    .insert(materials)
    .values({
      id: input.makeId?.() ?? createId(),
      courseId: parsed.targetCourseId,
      moduleId: targetModuleId,
      type: source.type,
      title: `${source.title} copy`,
      bodyMd: source.bodyMd,
      planJson: source.planJson,
      visibility: source.visibility,
      status: "draft",
      publishAt: null,
      sortOrder: await nextMaterialSortOrder(database, parsed.targetCourseId, targetModuleId),
      requiresMaterialId: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return copy;
}

export async function duplicateModule(database: AppDb, input: DuplicateModuleInput) {
  const parsed = duplicateModuleSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireActiveCourse(database, parsed.targetCourseId);
  const [source] = await database.select().from(modules).where(eq(modules.id, parsed.id));

  if (!source) {
    throw new Error("Module not found.");
  }

  const [moduleCopy] = await database
    .insert(modules)
    .values({
      id: input.makeId?.("module", 0) ?? createId(),
      courseId: parsed.targetCourseId,
      title: `${source.title} copy`,
      description: source.description,
      sortOrder: await nextModuleSortOrder(database, parsed.targetCourseId),
      status: "draft",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const sourceMaterials = await database
    .select()
    .from(materials)
    .where(eq(materials.moduleId, source.id))
    .orderBy(asc(materials.sortOrder), asc(materials.title));

  for (const [index, material] of sourceMaterials.entries()) {
    await database.insert(materials).values({
      id: input.makeId?.("material", index) ?? createId(),
      courseId: parsed.targetCourseId,
      moduleId: moduleCopy.id,
      type: material.type,
      title: material.title,
      bodyMd: material.bodyMd,
      planJson: material.planJson,
      visibility: material.visibility,
      status: "draft",
      publishAt: null,
      sortOrder: index,
      requiresMaterialId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return moduleCopy;
}

export async function addMaterialLink(database: AppDb, input: AddMaterialLinkInput) {
  const parsed = addMaterialLinkSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [material] = await database
    .select({ id: materials.id })
    .from(materials)
    .where(eq(materials.id, parsed.materialId));

  if (!material) {
    throw new Error("Material not found.");
  }

  const [link] = await database
    .insert(materialLinks)
    .values({
      id: input.makeId?.() ?? createId(),
      materialId: parsed.materialId,
      url: parsed.url,
      label: parsed.label,
      kind: parsed.kind,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return link;
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
  const materialIds = materialRows.map((material) => material.id);
  const completionCounts: Record<string, number> = {};
  const linksByMaterial: Record<string, (typeof materialLinks.$inferSelect)[]> = {};

  if (materialIds.length > 0) {
    const [completionRows, linkRows] = await Promise.all([
      database
        .select({ materialId: materialProgress.materialId })
        .from(materialProgress)
        .where(inArray(materialProgress.materialId, materialIds)),
      database
        .select()
        .from(materialLinks)
        .where(inArray(materialLinks.materialId, materialIds))
        .orderBy(asc(materialLinks.label)),
    ]);

    for (const row of completionRows) {
      completionCounts[row.materialId] = (completionCounts[row.materialId] ?? 0) + 1;
    }

    for (const row of linkRows) {
      const links = linksByMaterial[row.materialId] ?? [];
      links.push(row);
      linksByMaterial[row.materialId] = links;
    }
  }

  return { completionCounts, linksByMaterial, materials: materialRows, modules: moduleRows };
}
