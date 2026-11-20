import { and, asc, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  materialStandards,
  materials,
  quizStandards,
  quizzes,
  schema,
  standards,
} from "@/db/schema";

type AppDb = LibSQLDatabase<typeof schema>;

type CreateStandardInput = {
  code: string;
  description: string;
  framework: string;
  makeId?: () => string;
  now?: () => number;
};

type UpdateStandardInput = CreateStandardInput & {
  active: boolean;
  id: string;
};

type BulkImportStandardsInput = {
  defaultFramework?: string;
  makeId?: (index: number) => string;
  now?: () => number;
  text: string;
};

type TagMaterialStandardsInput = {
  materialId: string;
  standardIds: string[];
};

type TagQuizStandardsInput = {
  quizId: string;
  standardIds: string[];
};

const standardFieldsSchema = z.object({
  code: z.string().trim().min(1),
  description: z.string().trim().min(1),
  framework: z.string().trim().min(1),
});

const updateStandardSchema = standardFieldsSchema.extend({
  active: z.boolean(),
  id: z.string().trim().min(1),
});

const bulkImportStandardsSchema = z.object({
  defaultFramework: z.string().trim().min(1).optional(),
  text: z.string().trim().min(1),
});

const tagMaterialStandardsSchema = z.object({
  materialId: z.string().trim().min(1),
  standardIds: z.array(z.string().trim().min(1)),
});

const tagQuizStandardsSchema = z.object({
  quizId: z.string().trim().min(1),
  standardIds: z.array(z.string().trim().min(1)),
});

function createId() {
  return randomBytes(12).toString("base64url");
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

function parseStandardLine(line: string, defaultFramework?: string) {
  const parts = line
    .split(/[|\t]/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 3) {
    const [framework, code, ...descriptionParts] = parts;
    return {
      code,
      description: descriptionParts.join(" "),
      framework,
    };
  }

  if (parts.length === 2 && defaultFramework) {
    const [code, description] = parts;
    return {
      code,
      description,
      framework: defaultFramework,
    };
  }

  throw new Error(`Invalid standard line: ${line}`);
}

async function requireMaterial(database: AppDb, id: string) {
  const [material] = await database.select({ id: materials.id }).from(materials).where(eq(materials.id, id));

  if (!material) {
    throw new Error("Material not found.");
  }
}

async function requireQuiz(database: AppDb, id: string) {
  const [quiz] = await database.select({ id: quizzes.id }).from(quizzes).where(eq(quizzes.id, id));

  if (!quiz) {
    throw new Error("Quiz not found.");
  }
}

async function requireStandards(database: AppDb, ids: string[]) {
  if (ids.length === 0) {
    return;
  }

  const rows = await database.select({ id: standards.id }).from(standards).where(inArray(standards.id, ids));

  if (rows.length !== ids.length) {
    throw new Error("Standard not found.");
  }
}

export async function createStandard(database: AppDb, input: CreateStandardInput) {
  const parsed = standardFieldsSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [standard] = await database
    .insert(standards)
    .values({
      id: input.makeId?.() ?? createId(),
      framework: parsed.framework,
      code: parsed.code,
      description: parsed.description,
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return standard;
}

export async function updateStandard(database: AppDb, input: UpdateStandardInput) {
  const parsed = updateStandardSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [standard] = await database
    .update(standards)
    .set({
      framework: parsed.framework,
      code: parsed.code,
      description: parsed.description,
      active: parsed.active,
      updatedAt: now,
    })
    .where(eq(standards.id, parsed.id))
    .returning();

  if (!standard) {
    throw new Error("Standard not found.");
  }

  return standard;
}

export async function bulkImportStandards(database: AppDb, input: BulkImportStandardsInput) {
  const parsed = bulkImportStandardsSchema.parse(input);
  const rows = parsed.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseStandardLine(line, parsed.defaultFramework));
  const imported = [];

  for (const [index, row] of rows.entries()) {
    imported.push(
      await createStandard(database, {
        ...row,
        makeId: input.makeId ? () => input.makeId?.(index) ?? createId() : undefined,
        now: input.now,
      }),
    );
  }

  return imported;
}

export async function listStandards(
  database: AppDb,
  input: { activeOnly?: boolean } = {},
) {
  const query = database
    .select()
    .from(standards)
    .where(input.activeOnly ? eq(standards.active, true) : undefined)
    .orderBy(asc(standards.framework), asc(standards.code));

  return query;
}

export async function tagMaterialStandards(database: AppDb, input: TagMaterialStandardsInput) {
  const parsed = tagMaterialStandardsSchema.parse(input);
  const ids = uniqueIds(parsed.standardIds);
  await requireMaterial(database, parsed.materialId);
  await requireStandards(database, ids);
  await database.delete(materialStandards).where(eq(materialStandards.materialId, parsed.materialId));

  if (ids.length > 0) {
    await database.insert(materialStandards).values(
      ids.map((standardId) => ({
        materialId: parsed.materialId,
        standardId,
      })),
    );
  }

  return ids;
}

export async function tagQuizStandards(database: AppDb, input: TagQuizStandardsInput) {
  const parsed = tagQuizStandardsSchema.parse(input);
  const ids = uniqueIds(parsed.standardIds);
  await requireQuiz(database, parsed.quizId);
  await requireStandards(database, ids);
  await database.delete(quizStandards).where(eq(quizStandards.quizId, parsed.quizId));

  if (ids.length > 0) {
    await database.insert(quizStandards).values(
      ids.map((standardId) => ({
        quizId: parsed.quizId,
        standardId,
      })),
    );
  }

  return ids;
}

export async function materialStandardIdsByMaterial(database: AppDb, materialIds: string[]) {
  const ids = uniqueIds(materialIds);
  const tags: Record<string, string[]> = {};

  if (ids.length === 0) {
    return tags;
  }

  const rows = await database
    .select({
      materialId: materialStandards.materialId,
      standardId: materialStandards.standardId,
    })
    .from(materialStandards)
    .where(inArray(materialStandards.materialId, ids));

  for (const row of rows) {
    const current = tags[row.materialId] ?? [];
    current.push(row.standardId);
    tags[row.materialId] = current;
  }

  return tags;
}

export async function quizStandardIdsByQuiz(database: AppDb, quizIds: string[]) {
  const ids = uniqueIds(quizIds);
  const tags: Record<string, string[]> = {};

  if (ids.length === 0) {
    return tags;
  }

  const rows = await database
    .select({
      quizId: quizStandards.quizId,
      standardId: quizStandards.standardId,
    })
    .from(quizStandards)
    .where(inArray(quizStandards.quizId, ids));

  for (const row of rows) {
    const current = tags[row.quizId] ?? [];
    current.push(row.standardId);
    tags[row.quizId] = current;
  }

  return tags;
}

export async function courseCoverageMatrix(database: AppDb, courseId: string) {
  const parsedCourseId = z.string().trim().min(1).parse(courseId);
  const activeStandards = await listStandards(database, { activeOnly: true });
  const standardIds = activeStandards.map((standard) => standard.id);

  if (standardIds.length === 0) {
    return [];
  }

  const [materialRows, quizRows] = await Promise.all([
    database
      .select({
        standardId: materialStandards.standardId,
        title: materials.title,
      })
      .from(materialStandards)
      .innerJoin(materials, eq(materialStandards.materialId, materials.id))
      .where(and(eq(materials.courseId, parsedCourseId), inArray(materialStandards.standardId, standardIds)))
      .orderBy(asc(materials.title)),
    database
      .select({
        standardId: quizStandards.standardId,
        title: quizzes.title,
      })
      .from(quizStandards)
      .innerJoin(quizzes, eq(quizStandards.quizId, quizzes.id))
      .where(and(eq(quizzes.courseId, parsedCourseId), inArray(quizStandards.standardId, standardIds)))
      .orderBy(asc(quizzes.title)),
  ]);

  return activeStandards.map((standard) => {
    const materialTitles = materialRows
      .filter((row) => row.standardId === standard.id)
      .map((row) => row.title);
    const quizTitles = quizRows.filter((row) => row.standardId === standard.id).map((row) => row.title);
    const covered = materialTitles.length > 0 || quizTitles.length > 0;

    return {
      id: standard.id,
      framework: standard.framework,
      code: standard.code,
      description: standard.description,
      active: standard.active,
      standard,
      materialTitles,
      quizTitles,
      covered,
      gap: !covered,
    };
  });
}
