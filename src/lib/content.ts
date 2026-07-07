import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  courses,
  enrollments,
  materialLinks,
  materialProgress,
  materials,
  modules,
  schema,
} from "@/db/schema";
import { AuthzError } from "@/lib/authz";

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
  publishAt?: number | null;
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

type MarkMaterialCompleteInput = {
  makeId?: () => string;
  materialId: string;
  now?: () => number;
  studentId: string;
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
  publishAt: z.number().int().nullable().optional(),
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

const markMaterialCompleteSchema = z.object({
  materialId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
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

async function requireActiveEnrollment(
  database: AppDb,
  input: { courseId: string; studentId: string },
) {
  const [enrollment] = await database
    .select({ id: enrollments.id })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(
      and(
        eq(enrollments.courseId, input.courseId),
        eq(enrollments.studentId, input.studentId),
        eq(enrollments.status, "active"),
        eq(courses.status, "active"),
      ),
    );

  if (!enrollment) {
    throw new Error("Enrollment not found.");
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

  await database
    .update(materials)
    .set({ status: parsed.status, updatedAt: now })
    .where(eq(materials.moduleId, parsed.id));

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
      publishAt: parsed.publishAt ?? null,
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
      publishAt: parsed.publishAt ?? null,
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

export async function listStudentVisibleMaterials(
  database: AppDb,
  input: { courseId: string; now?: number; studentId: string },
) {
  const parsed = z
    .object({
      courseId: z.string().trim().min(1),
      now: z.number().int().optional(),
      studentId: z.string().trim().min(1),
    })
    .parse(input);
  const now = parsed.now ?? Date.now();
  await requireActiveEnrollment(database, {
    courseId: parsed.courseId,
    studentId: parsed.studentId,
  });
  const content = await listCourseContent(database, parsed.courseId);
  const moduleStatus = new Map(content.modules.map((module) => [module.id, module.status]));

  return content.materials.filter((material) => {
    if (material.visibility !== "students" || material.status !== "published") {
      return false;
    }

    if (material.publishAt !== null && material.publishAt > now) {
      return false;
    }

    if (material.moduleId && moduleStatus.get(material.moduleId) !== "published") {
      return false;
    }

    return true;
  });
}

async function completedMaterialIds(database: AppDb, studentId: string) {
  const rows = await database
    .select({ materialId: materialProgress.materialId })
    .from(materialProgress)
    .where(eq(materialProgress.studentId, studentId));

  return new Set(rows.map((row) => row.materialId));
}

export async function listStudentCurriculum(
  database: AppDb,
  input: { courseId: string; now?: number; studentId: string },
) {
  const visibleMaterials = await listStudentVisibleMaterials(database, input);
  const completed = await completedMaterialIds(database, input.studentId);

  return visibleMaterials.map((material, index) => ({
    completed: completed.has(material.id),
    locked: Boolean(material.requiresMaterialId && !completed.has(material.requiresMaterialId)),
    material,
    nextId: visibleMaterials[index + 1]?.id ?? null,
    previousId: visibleMaterials[index - 1]?.id ?? null,
  }));
}

export async function getStudentMaterial(
  database: AppDb,
  input: { materialId: string; now?: number; studentId: string },
) {
  const parsed = z
    .object({
      materialId: z.string().trim().min(1),
      now: z.number().int().optional(),
      studentId: z.string().trim().min(1),
    })
    .parse(input);
  const [material] = await database
    .select()
    .from(materials)
    .where(eq(materials.id, parsed.materialId));

  if (!material) {
    throw new Error("Material not found.");
  }

  const visibleMaterials = await listStudentVisibleMaterials(database, {
    courseId: material.courseId,
    now: parsed.now,
    studentId: parsed.studentId,
  });
  const visible = visibleMaterials.find((row) => row.id === material.id);

  if (!visible) {
    throw new AuthzError("Material forbidden", 403);
  }

  if (material.requiresMaterialId) {
    const completed = await completedMaterialIds(database, parsed.studentId);

    if (!completed.has(material.requiresMaterialId)) {
      throw new AuthzError("Prerequisite material required", 403);
    }
  }

  return material;
}

export async function markMaterialComplete(database: AppDb, input: MarkMaterialCompleteInput) {
  const parsed = markMaterialCompleteSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await getStudentMaterial(database, {
    materialId: parsed.materialId,
    now,
    studentId: parsed.studentId,
  });
  const [progress] = await database
    .insert(materialProgress)
    .values({
      id: input.makeId?.() ?? createId(),
      materialId: parsed.materialId,
      studentId: parsed.studentId,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [materialProgress.materialId, materialProgress.studentId],
      set: { completedAt: now, updatedAt: now },
    })
    .returning();

  return progress;
}
