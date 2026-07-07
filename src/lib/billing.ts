import { and, asc, eq, gte, inArray, like, lt, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import {
  attendance,
  classSessions,
  courses,
  enrollments,
  invoiceItems,
  invoices,
  packagePurchases,
  parentLinks,
  payments,
  ratePlans,
  schema,
  settings,
  users,
} from "@/db/schema";

type AppDb = LibSQLDatabase<typeof schema>;
type RatePlanType = "per_session" | "monthly_flat" | "package";

type CreateRatePlanInput = {
  amount: number;
  makeId?: () => string;
  name: string;
  now?: () => number;
  sessionsCount?: number | null;
  type: RatePlanType;
};

type UpdateRatePlanInput = {
  active: boolean;
  amount: number;
  id: string;
  name: string;
  now?: () => number;
  sessionsCount?: number | null;
  type: RatePlanType;
};

type ArchiveRatePlanInput = {
  id: string;
  now?: () => number;
};

type CourseRatePlanInput = {
  courseId: string;
  ratePlanId: string;
  now?: () => number;
};

type EnrollmentRatePlanInput = {
  courseId: string;
  ratePlanId: string;
  studentId: string;
  now?: () => number;
};

type ResolveRatePlanInput = {
  courseId: string;
  studentId: string;
};

type BillingIdKind = "invoice" | "invoiceItem" | "packagePurchase";

type SellPackageInput = {
  dueDate?: number;
  makeId?: (kind: BillingIdKind) => string;
  now?: () => number;
  purchasedAt?: number;
  ratePlanId: string;
  studentId: string;
};

type ConsumePackageCreditsInput = {
  now?: () => number;
  periodEnd: number;
  periodStart: number;
  studentId: string;
};

type GenerateMonthlyInvoiceInput = {
  dueDate?: number;
  makeId?: (kind: BillingIdKind) => string;
  now?: () => number;
  periodEnd: number;
  periodStart: number;
  studentId: string;
};

type InvoiceActionInput = {
  id: string;
  now?: () => number;
};

type PaymentMethod = "cash" | "bank" | "bkash" | "nagad" | "other";

type RecordPaymentInput = {
  amount: number;
  invoiceId: string;
  makeId?: () => string;
  method: PaymentMethod;
  notes?: string | null;
  now?: () => number;
  paidAt?: number;
  reference?: string | null;
};

type PackageCreditSummary = {
  id: string;
  invoiceId: string;
  lowCredit: boolean;
  planName: string;
  purchasedAt: number;
  ratePlanId: string;
  remaining: number;
  sessionsTotal: number;
  sessionsUsed: number;
  status: "active" | "exhausted" | "expired";
  studentId: string;
  studentName?: string;
};

type InvoiceStatus = "draft" | "sent" | "paid" | "partial" | "void";

type TutorInvoiceSummary = typeof invoices.$inferSelect & {
  balance: number;
  displayStatus: InvoiceStatus;
  paidTotal: number;
  studentName: string;
};

type InvoiceItemDraft = {
  amount: number;
  courseId: string | null;
  description: string;
  quantity: number;
  sessionId: string | null;
  unitAmount: number;
};

type SessionCandidate = {
  courseId: string;
  courseTitle: string;
  sessionId: string;
  startsAt: number;
  unitAmount: number;
};

const ratePlanFieldsSchema = z.object({
  amount: z.number().int().min(0),
  name: z.string().trim().min(1),
  sessionsCount: z.number().int().min(1).nullable().optional(),
  type: z.enum(["per_session", "monthly_flat", "package"]),
});

const updateRatePlanSchema = ratePlanFieldsSchema.extend({
  active: z.boolean(),
  id: z.string().trim().min(1),
});

const courseRatePlanSchema = z.object({
  courseId: z.string().trim().min(1),
  ratePlanId: z.string().trim().min(1),
});

const enrollmentRatePlanSchema = courseRatePlanSchema.extend({
  studentId: z.string().trim().min(1),
});

const sellPackageSchema = z.object({
  dueDate: z.number().int().optional(),
  purchasedAt: z.number().int().optional(),
  ratePlanId: z.string().trim().min(1),
  studentId: z.string().trim().min(1),
});

const consumePackageCreditsSchema = z
  .object({
    periodEnd: z.number().int(),
    periodStart: z.number().int(),
    studentId: z.string().trim().min(1),
  })
  .refine((input) => input.periodEnd > input.periodStart, {
    message: "Period end must be after period start.",
  });

const generateMonthlyInvoiceSchema = consumePackageCreditsSchema.extend({
  dueDate: z.number().int().optional(),
});

const invoiceActionSchema = z.object({
  id: z.string().trim().min(1),
});

const paymentMethodSchema = z.enum(["cash", "bank", "bkash", "nagad", "other"]);

const recordPaymentSchema = z.object({
  amount: z.number().int().min(1),
  invoiceId: z.string().trim().min(1),
  method: paymentMethodSchema,
  notes: z.string().trim().nullable().optional(),
  paidAt: z.number().int().optional(),
  reference: z.string().trim().nullable().optional(),
});

const monthlyInvoiceNotes = "Generated monthly invoice";
const packageCreditPattern = /^Package credit \(([^)]+)\): /;

function createId() {
  return randomBytes(12).toString("base64url");
}

function normalizedSessionsCount(input: { sessionsCount?: number | null; type: RatePlanType }) {
  if (input.type === "package") {
    return input.sessionsCount ?? 1;
  }

  return null;
}

async function requireActiveRatePlan(database: AppDb, id: string) {
  const [plan] = await database
    .select()
    .from(ratePlans)
    .where(and(eq(ratePlans.id, id), eq(ratePlans.active, true)));

  if (!plan) {
    throw new Error("Active rate plan not found.");
  }

  return plan;
}

async function requireActivePackagePlan(database: AppDb, id: string) {
  const plan = await requireActiveRatePlan(database, id);

  if (plan.type !== "package" || !plan.sessionsCount) {
    throw new Error("Active package rate plan not found.");
  }

  return plan;
}

async function requireActiveStudent(database: AppDb, id: string) {
  const [student] = await database
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, id), eq(users.role, "student"), eq(users.status, "active")));

  if (!student) {
    throw new Error("Active student not found.");
  }
}

async function readSetting(database: AppDb, key: string, fallback: string) {
  const [row] = await database
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key));

  return row?.value ?? fallback;
}

function utcMonthStamp(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function utcMonthStart(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function utcNextMonthStart(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

async function nextInvoiceNumber(database: AppDb, timestamp: number) {
  const prefix = await readSetting(database, "invoice_prefix", "TL");
  const stem = `${prefix}-${utcMonthStamp(timestamp)}-`;
  const rows = await database
    .select({ number: invoices.number })
    .from(invoices)
    .where(like(invoices.number, `${stem}%`));
  const currentMax = rows.reduce((max, row) => {
    const numeric = Number(row.number.slice(stem.length));
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);

  return `${stem}${String(currentMax + 1).padStart(4, "0")}`;
}

function makeBillingId(input: { makeId?: (kind: BillingIdKind) => string }, kind: BillingIdKind) {
  return input.makeId?.(kind) ?? createId();
}

function packageCreditDescription(input: { courseTitle: string; packagePurchaseId: string }) {
  return `Package credit (${input.packagePurchaseId}): ${input.courseTitle}`;
}

function packagePurchaseIdFromDescription(description: string) {
  return packageCreditPattern.exec(description)?.[1] ?? null;
}

function formatUtcDate(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function sessionUnitAmount(plan: typeof ratePlans.$inferSelect) {
  if (plan.type === "package") {
    return Math.round(plan.amount / (plan.sessionsCount ?? 1));
  }

  return plan.amount;
}

async function requireInvoice(database: AppDb, id: string) {
  const [invoice] = await database.select().from(invoices).where(eq(invoices.id, id));

  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  return invoice;
}

async function paidTotalForInvoice(database: AppDb, invoiceId: string) {
  const rows = await database
    .select({ amount: payments.amount })
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId));

  return rows.reduce((sum, row) => sum + row.amount, 0);
}

function deriveInvoiceStatus(
  invoice: typeof invoices.$inferSelect,
  paidTotal: number,
): InvoiceStatus {
  if (invoice.status === "void") {
    return "void";
  }

  if (paidTotal >= invoice.total && invoice.total > 0) {
    return "paid";
  }

  if (paidTotal > 0) {
    return "partial";
  }

  if (invoice.status === "paid" || invoice.status === "partial") {
    return "sent";
  }

  return invoice.status;
}

function invoiceBalance(invoice: typeof invoices.$inferSelect, paidTotal: number) {
  return Math.max(0, invoice.total - paidTotal);
}

function toPackageCreditSummary(row: {
  id: string;
  invoiceId: string;
  planName: string;
  purchasedAt: number;
  ratePlanId: string;
  sessionsTotal: number;
  sessionsUsed: number;
  status: "active" | "exhausted" | "expired";
  studentId: string;
  studentName?: string | null;
}): PackageCreditSummary {
  const remaining = Math.max(0, row.sessionsTotal - row.sessionsUsed);

  return {
    id: row.id,
    invoiceId: row.invoiceId,
    lowCredit: remaining > 0 && remaining <= 2,
    planName: row.planName,
    purchasedAt: row.purchasedAt,
    ratePlanId: row.ratePlanId,
    remaining,
    sessionsTotal: row.sessionsTotal,
    sessionsUsed: row.sessionsUsed,
    status: row.status,
    studentId: row.studentId,
    studentName: row.studentName ?? undefined,
  };
}

export async function createRatePlan(database: AppDb, input: CreateRatePlanInput) {
  const parsed = ratePlanFieldsSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [plan] = await database
    .insert(ratePlans)
    .values({
      id: input.makeId?.() ?? createId(),
      name: parsed.name,
      type: parsed.type,
      amount: parsed.amount,
      sessionsCount: normalizedSessionsCount(parsed),
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return plan;
}

export async function updateRatePlan(database: AppDb, input: UpdateRatePlanInput) {
  const parsed = updateRatePlanSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [plan] = await database
    .update(ratePlans)
    .set({
      name: parsed.name,
      type: parsed.type,
      amount: parsed.amount,
      sessionsCount: normalizedSessionsCount(parsed),
      active: parsed.active,
      updatedAt: now,
    })
    .where(eq(ratePlans.id, parsed.id))
    .returning();

  if (!plan) {
    throw new Error("Rate plan not found.");
  }

  return plan;
}

export async function archiveRatePlan(database: AppDb, input: ArchiveRatePlanInput) {
  const id = z.string().trim().min(1).parse(input.id);
  const now = input.now?.() ?? Date.now();
  const [plan] = await database
    .update(ratePlans)
    .set({ active: false, updatedAt: now })
    .where(eq(ratePlans.id, id))
    .returning();

  if (!plan) {
    throw new Error("Rate plan not found.");
  }

  return plan;
}

export async function setCourseDefaultRatePlan(database: AppDb, input: CourseRatePlanInput) {
  const parsed = courseRatePlanSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireActiveRatePlan(database, parsed.ratePlanId);
  const [course] = await database
    .update(courses)
    .set({ defaultRatePlanId: parsed.ratePlanId, updatedAt: now })
    .where(eq(courses.id, parsed.courseId))
    .returning();

  if (!course) {
    throw new Error("Course not found.");
  }

  return course;
}

export async function setEnrollmentRatePlan(database: AppDb, input: EnrollmentRatePlanInput) {
  const parsed = enrollmentRatePlanSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireActiveRatePlan(database, parsed.ratePlanId);
  const [enrollment] = await database
    .update(enrollments)
    .set({ ratePlanId: parsed.ratePlanId, updatedAt: now })
    .where(
      and(
        eq(enrollments.courseId, parsed.courseId),
        eq(enrollments.studentId, parsed.studentId),
        eq(enrollments.status, "active"),
      ),
    )
    .returning();

  if (!enrollment) {
    throw new Error("Enrollment not found.");
  }

  return enrollment;
}

export async function resolveEnrollmentRatePlan(database: AppDb, input: ResolveRatePlanInput) {
  const parsed = enrollmentRatePlanSchema.omit({ ratePlanId: true }).parse(input);
  const [enrollment] = await database
    .select()
    .from(enrollments)
    .where(
      and(
        eq(enrollments.courseId, parsed.courseId),
        eq(enrollments.studentId, parsed.studentId),
        eq(enrollments.status, "active"),
      ),
    );

  if (!enrollment) {
    return null;
  }

  if (enrollment.ratePlanId) {
    return requireActiveRatePlan(database, enrollment.ratePlanId);
  }

  const [course] = await database
    .select()
    .from(courses)
    .where(eq(courses.id, parsed.courseId));

  if (!course?.defaultRatePlanId) {
    return null;
  }

  return requireActiveRatePlan(database, course.defaultRatePlanId);
}

export async function sellPackage(database: AppDb, input: SellPackageInput) {
  const parsed = sellPackageSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const purchasedAt = parsed.purchasedAt ?? now;
  const dueDate = parsed.dueDate ?? purchasedAt;
  await requireActiveStudent(database, parsed.studentId);
  const plan = await requireActivePackagePlan(database, parsed.ratePlanId);
  const sessionsTotal = plan.sessionsCount ?? 0;

  if (sessionsTotal < 1) {
    throw new Error("Package rate plan must include sessions.");
  }

  const invoiceNumber = await nextInvoiceNumber(database, purchasedAt);
  const invoiceId = makeBillingId(input, "invoice");
  const invoiceItemId = makeBillingId(input, "invoiceItem");
  const packagePurchaseId = makeBillingId(input, "packagePurchase");
  const [invoice] = await database
    .insert(invoices)
    .values({
      id: invoiceId,
      studentId: parsed.studentId,
      periodStart: utcMonthStart(purchasedAt),
      periodEnd: utcNextMonthStart(purchasedAt),
      status: "draft",
      total: plan.amount,
      number: invoiceNumber,
      notes: "Prepaid package purchase",
      dueDate,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const [item] = await database
    .insert(invoiceItems)
    .values({
      id: invoiceItemId,
      invoiceId,
      description: `${plan.name} (${sessionsTotal} sessions)`,
      quantity: 1,
      unitAmount: plan.amount,
      amount: plan.amount,
      sessionId: null,
      courseId: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const [purchase] = await database
    .insert(packagePurchases)
    .values({
      id: packagePurchaseId,
      studentId: parsed.studentId,
      ratePlanId: parsed.ratePlanId,
      invoiceId,
      sessionsTotal,
      sessionsUsed: 0,
      status: "active",
      purchasedAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return { invoice, invoiceItem: item, packagePurchase: purchase };
}

export async function consumePackageCreditsForAttendedSessions(
  database: AppDb,
  input: ConsumePackageCreditsInput,
) {
  const parsed = consumePackageCreditsSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const attendedSessions = await database
    .select({
      sessionId: classSessions.id,
      startsAt: classSessions.startsAt,
    })
    .from(attendance)
    .innerJoin(classSessions, eq(attendance.sessionId, classSessions.id))
    .where(
      and(
        eq(attendance.studentId, parsed.studentId),
        inArray(attendance.status, ["present", "late"]),
        gte(classSessions.startsAt, parsed.periodStart),
        lt(classSessions.startsAt, parsed.periodEnd),
      ),
    )
    .orderBy(asc(classSessions.startsAt));
  const purchases = await database
    .select()
    .from(packagePurchases)
    .where(
      and(
        eq(packagePurchases.studentId, parsed.studentId),
        eq(packagePurchases.status, "active"),
        sql`${packagePurchases.sessionsUsed} < ${packagePurchases.sessionsTotal}`,
      ),
    )
    .orderBy(asc(packagePurchases.purchasedAt), asc(packagePurchases.createdAt));
  const trackedPurchases = purchases.map((purchase) => ({
    ...purchase,
    nextSessionsUsed: purchase.sessionsUsed,
  }));
  const covered: { packagePurchaseId: string; sessionId: string }[] = [];
  const billableSessionIds: string[] = [];
  let purchaseIndex = 0;

  for (const session of attendedSessions) {
    while (
      purchaseIndex < trackedPurchases.length &&
      trackedPurchases[purchaseIndex].nextSessionsUsed >=
        trackedPurchases[purchaseIndex].sessionsTotal
    ) {
      purchaseIndex += 1;
    }

    const purchase = trackedPurchases[purchaseIndex];

    if (!purchase) {
      billableSessionIds.push(session.sessionId);
      continue;
    }

    purchase.nextSessionsUsed += 1;
    covered.push({ packagePurchaseId: purchase.id, sessionId: session.sessionId });
  }

  for (const purchase of trackedPurchases) {
    if (purchase.nextSessionsUsed === purchase.sessionsUsed) {
      continue;
    }

    await database
      .update(packagePurchases)
      .set({
        sessionsUsed: purchase.nextSessionsUsed,
        status: purchase.nextSessionsUsed >= purchase.sessionsTotal ? "exhausted" : "active",
        updatedAt: now,
      })
      .where(eq(packagePurchases.id, purchase.id));
  }

  return { billableSessionIds, covered };
}

async function listInvoiceItems(database: AppDb, invoiceId: string) {
  return database.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, invoiceId));
}

async function findMonthlyInvoice(
  database: AppDb,
  input: { periodEnd: number; periodStart: number; studentId: string },
) {
  const rows = await database
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.studentId, input.studentId),
        eq(invoices.periodStart, input.periodStart),
        eq(invoices.periodEnd, input.periodEnd),
        eq(invoices.notes, monthlyInvoiceNotes),
      ),
    )
    .orderBy(asc(invoices.createdAt));
  const draft = rows.find((invoice) => invoice.status === "draft");

  return {
    draft,
    locked: draft ? undefined : rows[0],
  };
}

async function restorePackageCreditsForDraftInvoice(
  database: AppDb,
  input: { invoiceId: string; now: number },
) {
  const items = await database
    .select({ description: invoiceItems.description })
    .from(invoiceItems)
    .where(and(eq(invoiceItems.invoiceId, input.invoiceId), eq(invoiceItems.amount, 0)));
  const counts = new Map<string, number>();

  for (const item of items) {
    const purchaseId = packagePurchaseIdFromDescription(item.description);

    if (purchaseId) {
      counts.set(purchaseId, (counts.get(purchaseId) ?? 0) + 1);
    }
  }

  for (const [purchaseId, count] of counts) {
    const [purchase] = await database
      .select()
      .from(packagePurchases)
      .where(eq(packagePurchases.id, purchaseId));

    if (!purchase) {
      continue;
    }

    const sessionsUsed = Math.max(0, purchase.sessionsUsed - count);
    await database
      .update(packagePurchases)
      .set({
        sessionsUsed,
        status: sessionsUsed >= purchase.sessionsTotal ? "exhausted" : "active",
        updatedAt: input.now,
      })
      .where(eq(packagePurchases.id, purchaseId));
  }
}

async function activePackagePurchases(database: AppDb, studentId: string) {
  const purchases = await database
    .select()
    .from(packagePurchases)
    .where(
      and(
        eq(packagePurchases.studentId, studentId),
        eq(packagePurchases.status, "active"),
        sql`${packagePurchases.sessionsUsed} < ${packagePurchases.sessionsTotal}`,
      ),
    )
    .orderBy(asc(packagePurchases.purchasedAt), asc(packagePurchases.createdAt));

  return purchases.map((purchase) => ({
    ...purchase,
    nextSessionsUsed: purchase.sessionsUsed,
  }));
}

async function buildMonthlyInvoiceItemDrafts(
  database: AppDb,
  input: { periodEnd: number; periodStart: number; studentId: string },
) {
  const enrollmentRows = await database
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
    })
    .from(enrollments)
    .innerJoin(courses, eq(enrollments.courseId, courses.id))
    .where(
      and(
        eq(enrollments.studentId, input.studentId),
        eq(enrollments.status, "active"),
        eq(courses.status, "active"),
      ),
    )
    .orderBy(asc(courses.title));
  const planByCourse = new Map<
    string,
    { courseTitle: string; plan: typeof ratePlans.$inferSelect }
  >();
  const items: InvoiceItemDraft[] = [];

  for (const enrollment of enrollmentRows) {
    const plan = await resolveEnrollmentRatePlan(database, {
      courseId: enrollment.courseId,
      studentId: input.studentId,
    });

    if (!plan) {
      continue;
    }

    planByCourse.set(enrollment.courseId, {
      courseTitle: enrollment.courseTitle,
      plan,
    });

    if (plan.type === "monthly_flat") {
      items.push({
        amount: plan.amount,
        courseId: enrollment.courseId,
        description: `${enrollment.courseTitle} monthly tuition`,
        quantity: 1,
        sessionId: null,
        unitAmount: plan.amount,
      });
    }
  }

  const attendedSessions = await database
    .select({
      courseId: classSessions.courseId,
      courseTitle: courses.title,
      sessionId: classSessions.id,
      startsAt: classSessions.startsAt,
    })
    .from(attendance)
    .innerJoin(classSessions, eq(attendance.sessionId, classSessions.id))
    .innerJoin(courses, eq(classSessions.courseId, courses.id))
    .where(
      and(
        eq(attendance.studentId, input.studentId),
        inArray(attendance.status, ["present", "late"]),
        gte(classSessions.startsAt, input.periodStart),
        lt(classSessions.startsAt, input.periodEnd),
      ),
    )
    .orderBy(asc(classSessions.startsAt));
  const candidates: SessionCandidate[] = [];

  for (const session of attendedSessions) {
    const resolved = planByCourse.get(session.courseId);

    if (!resolved || resolved.plan.type === "monthly_flat") {
      continue;
    }

    candidates.push({
      courseId: session.courseId,
      courseTitle: session.courseTitle,
      sessionId: session.sessionId,
      startsAt: session.startsAt,
      unitAmount: sessionUnitAmount(resolved.plan),
    });
  }

  const purchases = await activePackagePurchases(database, input.studentId);
  const coveredSessionIds: string[] = [];
  const billableSessionIds: string[] = [];
  let purchaseIndex = 0;

  for (const session of candidates) {
    while (
      purchaseIndex < purchases.length &&
      purchases[purchaseIndex].nextSessionsUsed >= purchases[purchaseIndex].sessionsTotal
    ) {
      purchaseIndex += 1;
    }

    const purchase = purchases[purchaseIndex];

    if (purchase) {
      purchase.nextSessionsUsed += 1;
      coveredSessionIds.push(session.sessionId);
      items.push({
        amount: 0,
        courseId: session.courseId,
        description: packageCreditDescription({
          courseTitle: session.courseTitle,
          packagePurchaseId: purchase.id,
        }),
        quantity: 1,
        sessionId: session.sessionId,
        unitAmount: 0,
      });
      continue;
    }

    billableSessionIds.push(session.sessionId);
    items.push({
      amount: session.unitAmount,
      courseId: session.courseId,
      description: `${session.courseTitle} session - ${formatUtcDate(session.startsAt)}`,
      quantity: 1,
      sessionId: session.sessionId,
      unitAmount: session.unitAmount,
    });
  }

  return { billableSessionIds, coveredSessionIds, items, purchases };
}

export async function generateMonthlyInvoice(
  database: AppDb,
  input: GenerateMonthlyInvoiceInput,
) {
  const parsed = generateMonthlyInvoiceSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  await requireActiveStudent(database, parsed.studentId);
  const existing = await findMonthlyInvoice(database, parsed);

  if (existing.locked) {
    return {
      billableSessionIds: [],
      coveredSessionIds: [],
      invoice: existing.locked,
      items: await listInvoiceItems(database, existing.locked.id),
      skipped: true,
    };
  }

  let invoice = existing.draft;

  if (invoice) {
    await restorePackageCreditsForDraftInvoice(database, { invoiceId: invoice.id, now });
    await database.delete(invoiceItems).where(eq(invoiceItems.invoiceId, invoice.id));
  } else {
    const invoiceNumber = await nextInvoiceNumber(database, parsed.periodStart);
    const [createdInvoice] = await database
      .insert(invoices)
      .values({
        id: makeBillingId(input, "invoice"),
        studentId: parsed.studentId,
        periodStart: parsed.periodStart,
        periodEnd: parsed.periodEnd,
        status: "draft",
        total: 0,
        number: invoiceNumber,
        notes: monthlyInvoiceNotes,
        dueDate: parsed.dueDate ?? parsed.periodEnd,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    invoice = createdInvoice;
  }

  const built = await buildMonthlyInvoiceItemDrafts(database, parsed);
  const insertedItems = [];

  for (const item of built.items) {
    const [inserted] = await database
      .insert(invoiceItems)
      .values({
        id: makeBillingId(input, "invoiceItem"),
        invoiceId: invoice.id,
        description: item.description,
        quantity: item.quantity,
        unitAmount: item.unitAmount,
        amount: item.amount,
        sessionId: item.sessionId,
        courseId: item.courseId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    insertedItems.push(inserted);
  }

  for (const purchase of built.purchases) {
    if (purchase.nextSessionsUsed === purchase.sessionsUsed) {
      continue;
    }

    await database
      .update(packagePurchases)
      .set({
        sessionsUsed: purchase.nextSessionsUsed,
        status: purchase.nextSessionsUsed >= purchase.sessionsTotal ? "exhausted" : "active",
        updatedAt: now,
      })
      .where(eq(packagePurchases.id, purchase.id));
  }

  const total = built.items.reduce((sum, item) => sum + item.amount, 0);
  const [updatedInvoice] = await database
    .update(invoices)
    .set({
      dueDate: parsed.dueDate ?? invoice.dueDate,
      status: "draft",
      total,
      updatedAt: now,
    })
    .where(eq(invoices.id, invoice.id))
    .returning();

  return {
    billableSessionIds: built.billableSessionIds,
    coveredSessionIds: built.coveredSessionIds,
    invoice: updatedInvoice,
    items: insertedItems,
    skipped: false,
  };
}

export async function markInvoiceSent(database: AppDb, input: InvoiceActionInput) {
  const parsed = invoiceActionSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const invoice = await requireInvoice(database, parsed.id);

  if (invoice.status === "void") {
    throw new Error("Voided invoices cannot be sent.");
  }

  const paidTotal = await paidTotalForInvoice(database, invoice.id);
  const status = paidTotal > 0 ? deriveInvoiceStatus(invoice, paidTotal) : "sent";
  const [updated] = await database
    .update(invoices)
    .set({ status, updatedAt: now })
    .where(eq(invoices.id, invoice.id))
    .returning();

  return updated;
}

export async function voidInvoice(database: AppDb, input: InvoiceActionInput) {
  const parsed = invoiceActionSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const [invoice] = await database
    .update(invoices)
    .set({ status: "void", updatedAt: now })
    .where(eq(invoices.id, parsed.id))
    .returning();

  if (!invoice) {
    throw new Error("Invoice not found.");
  }

  return invoice;
}

export async function recordPayment(database: AppDb, input: RecordPaymentInput) {
  const parsed = recordPaymentSchema.parse(input);
  const now = input.now?.() ?? Date.now();
  const paidAt = parsed.paidAt ?? now;
  const invoice = await requireInvoice(database, parsed.invoiceId);

  if (invoice.status === "void") {
    throw new Error("Voided invoices cannot receive payments.");
  }

  const [payment] = await database
    .insert(payments)
    .values({
      id: input.makeId?.() ?? createId(),
      invoiceId: invoice.id,
      amount: parsed.amount,
      method: parsed.method,
      reference: parsed.reference ?? null,
      paidAt,
      notes: parsed.notes ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const paidTotal = await paidTotalForInvoice(database, invoice.id);
  const status = deriveInvoiceStatus(invoice, paidTotal);
  const [updatedInvoice] = await database
    .update(invoices)
    .set({ status, updatedAt: now })
    .where(eq(invoices.id, invoice.id))
    .returning();

  return {
    balance: invoiceBalance(updatedInvoice, paidTotal),
    invoice: updatedInvoice,
    paidTotal,
    payment,
  };
}

export async function listTutorInvoices(database: AppDb): Promise<TutorInvoiceSummary[]> {
  const rows = await database
    .select({
      invoice: invoices,
      studentName: users.name,
    })
    .from(invoices)
    .innerJoin(users, eq(invoices.studentId, users.id))
    .orderBy(asc(invoices.number));
  const summaries: TutorInvoiceSummary[] = [];

  for (const row of rows) {
    const paidTotal = await paidTotalForInvoice(database, row.invoice.id);
    summaries.push({
      ...row.invoice,
      balance: invoiceBalance(row.invoice, paidTotal),
      displayStatus: deriveInvoiceStatus(row.invoice, paidTotal),
      paidTotal,
      studentName: row.studentName,
    });
  }

  return summaries;
}

export async function listPackageCreditsForStudent(database: AppDb, studentId: string) {
  const parsedStudentId = z.string().trim().min(1).parse(studentId);
  const rows = await database
    .select({
      id: packagePurchases.id,
      invoiceId: packagePurchases.invoiceId,
      planName: ratePlans.name,
      purchasedAt: packagePurchases.purchasedAt,
      ratePlanId: packagePurchases.ratePlanId,
      sessionsTotal: packagePurchases.sessionsTotal,
      sessionsUsed: packagePurchases.sessionsUsed,
      status: packagePurchases.status,
      studentId: packagePurchases.studentId,
    })
    .from(packagePurchases)
    .innerJoin(ratePlans, eq(packagePurchases.ratePlanId, ratePlans.id))
    .where(eq(packagePurchases.studentId, parsedStudentId))
    .orderBy(asc(packagePurchases.purchasedAt));

  return rows.map(toPackageCreditSummary);
}

export async function listPackageCreditsForParent(database: AppDb, parentId: string) {
  const parsedParentId = z.string().trim().min(1).parse(parentId);
  const rows = await database
    .select({
      id: packagePurchases.id,
      invoiceId: packagePurchases.invoiceId,
      planName: ratePlans.name,
      purchasedAt: packagePurchases.purchasedAt,
      ratePlanId: packagePurchases.ratePlanId,
      sessionsTotal: packagePurchases.sessionsTotal,
      sessionsUsed: packagePurchases.sessionsUsed,
      status: packagePurchases.status,
      studentId: packagePurchases.studentId,
      studentName: users.name,
    })
    .from(parentLinks)
    .innerJoin(users, eq(parentLinks.studentId, users.id))
    .innerJoin(packagePurchases, eq(parentLinks.studentId, packagePurchases.studentId))
    .innerJoin(ratePlans, eq(packagePurchases.ratePlanId, ratePlans.id))
    .where(eq(parentLinks.parentId, parsedParentId))
    .orderBy(asc(users.name), asc(packagePurchases.purchasedAt));

  return rows.map(toPackageCreditSummary);
}

export async function listPackageCredits(database: AppDb) {
  const rows = await database
    .select({
      id: packagePurchases.id,
      invoiceId: packagePurchases.invoiceId,
      planName: ratePlans.name,
      purchasedAt: packagePurchases.purchasedAt,
      ratePlanId: packagePurchases.ratePlanId,
      sessionsTotal: packagePurchases.sessionsTotal,
      sessionsUsed: packagePurchases.sessionsUsed,
      status: packagePurchases.status,
      studentId: packagePurchases.studentId,
      studentName: users.name,
    })
    .from(packagePurchases)
    .innerJoin(users, eq(packagePurchases.studentId, users.id))
    .innerJoin(ratePlans, eq(packagePurchases.ratePlanId, ratePlans.id))
    .orderBy(asc(users.name), asc(packagePurchases.purchasedAt));

  return rows.map(toPackageCreditSummary);
}
