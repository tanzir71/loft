import { desc } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";

import { activityLog, schema } from "@/db/schema";

type AppDb = LibSQLDatabase<typeof schema>;
type ActivityRow = typeof activityLog.$inferSelect;

type LogActivityInput = {
  action: string;
  actorId?: string | null;
  entityId: string;
  entityType: string;
  makeId?: () => string;
  meta?: unknown;
  now?: () => number;
};

type ListRecentActivityInput = {
  limit?: number;
};

type ActivityDisplayInput = Pick<ActivityRow, "action" | "metaJson">;

const knownActionTitles: Record<string, string> = {
  course_created: "Course created",
  daily_digest: "Daily digest",
  payment_reminder: "Payment reminder",
  student_created: "Student created",
};

const detailKeys = [
  "label",
  "title",
  "name",
  "invoiceNumber",
  "studentName",
  "courseTitle",
  "materialTitle",
  "assignmentTitle",
];

function createId() {
  return randomBytes(12).toString("base64url");
}

function actionTitle(action: string) {
  const knownTitle = knownActionTitles[action];

  if (knownTitle) {
    return knownTitle;
  }

  const normalized = action.replaceAll("_", " ").trim();
  return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : "Activity";
}

function recordFromMeta(meta: unknown) {
  return typeof meta === "object" && meta !== null && !Array.isArray(meta)
    ? (meta as Record<string, unknown>)
    : {};
}

function detailFromMeta(meta: unknown) {
  const record = recordFromMeta(meta);

  for (const key of detailKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function boundedLimit(limit: number | undefined) {
  if (!limit || !Number.isFinite(limit)) {
    return 8;
  }

  return Math.max(1, Math.min(50, Math.floor(limit)));
}

export async function logActivity(database: AppDb, input: LogActivityInput) {
  const [activity] = await database
    .insert(activityLog)
    .values({
      id: input.makeId?.() ?? createId(),
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metaJson: input.meta ?? null,
      at: input.now?.() ?? Date.now(),
    })
    .returning();

  return activity;
}

export async function listRecentActivity(
  database: AppDb,
  input: ListRecentActivityInput = {},
) {
  return database
    .select()
    .from(activityLog)
    .orderBy(desc(activityLog.at), desc(activityLog.id))
    .limit(boundedLimit(input.limit));
}

export function activityDisplay(activity: ActivityDisplayInput) {
  return {
    detail: detailFromMeta(activity.metaJson),
    title: actionTitle(activity.action),
  };
}
