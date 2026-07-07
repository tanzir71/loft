import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
  users,
} from "@/db/schema";
import {
  archiveRatePlan,
  consumePackageCreditsForAttendedSessions,
  createRatePlan,
  generateMonthlyInvoice,
  listPackageCreditsForParent,
  listPackageCreditsForStudent,
  listTutorInvoices,
  markInvoiceSent,
  recordPayment,
  resolveEnrollmentRatePlan,
  sellPackage,
  setCourseDefaultRatePlan,
  setEnrollmentRatePlan,
  updateRatePlan,
  voidInvoice,
} from "@/lib/billing";
import { createCourse, enrollStudent } from "@/lib/courses";
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
    now: () => 1000,
    makeId: () => "tutor_id",
  });

  return { client, db };
}

describe("billing rate plans", () => {
  it("creates, updates, and archives rate plans without deleting them", async () => {
    const { client, db } = await createMigratedDb();
    const plan = await createRatePlan(db, {
      amount: 150000,
      makeId: () => "plan_id",
      name: "Per session",
      now: () => 2000,
      type: "per_session",
    });
    const updated = await updateRatePlan(db, {
      active: true,
      amount: 175000,
      id: "plan_id",
      name: "Updated per session",
      now: () => 3000,
      sessionsCount: null,
      type: "per_session",
    });
    const archived = await archiveRatePlan(db, {
      id: "plan_id",
      now: () => 4000,
    });
    const rows = await db.select().from(ratePlans).where(eq(ratePlans.id, "plan_id"));
    client.close();

    expect(plan).toMatchObject({
      active: true,
      amount: 150000,
      name: "Per session",
      type: "per_session",
    });
    expect(updated).toMatchObject({
      amount: 175000,
      name: "Updated per session",
      updatedAt: 3000,
    });
    expect(archived.active).toBe(false);
    expect(rows).toHaveLength(1);
  });

  it("resolves enrollment rate plan override before course default", async () => {
    const { client, db } = await createMigratedDb();
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
    await createRatePlan(db, {
      amount: 100000,
      makeId: () => "course_plan_id",
      name: "Course default",
      type: "monthly_flat",
    });
    await createRatePlan(db, {
      amount: 150000,
      makeId: () => "override_plan_id",
      name: "Student override",
      type: "per_session",
    });
    await setCourseDefaultRatePlan(db, {
      courseId: "course_id",
      ratePlanId: "course_plan_id",
    });

    const courseDefault = await resolveEnrollmentRatePlan(db, {
      courseId: "course_id",
      studentId: "student_id",
    });
    await setEnrollmentRatePlan(db, {
      courseId: "course_id",
      ratePlanId: "override_plan_id",
      studentId: "student_id",
    });
    const override = await resolveEnrollmentRatePlan(db, {
      courseId: "course_id",
      studentId: "student_id",
    });
    const [course] = await db.select().from(courses).where(eq(courses.id, "course_id"));
    const [enrollment] = await db
      .select()
      .from(enrollments)
      .where(eq(enrollments.id, "enrollment_id"));
    client.close();

    expect(course.defaultRatePlanId).toBe("course_plan_id");
    expect(enrollment.ratePlanId).toBe("override_plan_id");
    expect(courseDefault?.id).toBe("course_plan_id");
    expect(override?.id).toBe("override_plan_id");
  });

  it("sells a prepaid package as an invoice-backed purchase and lists remaining credits", async () => {
    const { client, db } = await createMigratedDb();
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
      createdAt: 1000,
      updatedAt: 1000,
    });
    await db.insert(parentLinks).values({ parentId: "parent_id", studentId: "student_id" });
    await createRatePlan(db, {
      amount: 450000,
      makeId: () => "package_plan_id",
      name: "Starter package",
      sessionsCount: 3,
      type: "package",
    });

    const sale = await sellPackage(db, {
      dueDate: Date.UTC(2026, 6, 15),
      makeId: (kind) => `${kind}_id`,
      now: () => 7000,
      purchasedAt: Date.UTC(2026, 6, 1),
      ratePlanId: "package_plan_id",
      studentId: "student_id",
    });
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, "invoice_id"));
    const [item] = await db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, "invoice_id"));
    const [purchase] = await db
      .select()
      .from(packagePurchases)
      .where(eq(packagePurchases.id, "packagePurchase_id"));
    const studentCredits = await listPackageCreditsForStudent(db, "student_id");
    const parentCredits = await listPackageCreditsForParent(db, "parent_id");
    client.close();

    expect(sale.invoice.number).toBe("TL-202607-0001");
    expect(invoice).toMatchObject({
      number: "TL-202607-0001",
      status: "draft",
      studentId: "student_id",
      total: 450000,
    });
    expect(item).toMatchObject({
      amount: 450000,
      description: "Starter package (3 sessions)",
      quantity: 1,
      unitAmount: 450000,
    });
    expect(purchase).toMatchObject({
      invoiceId: "invoice_id",
      ratePlanId: "package_plan_id",
      sessionsTotal: 3,
      sessionsUsed: 0,
      status: "active",
    });
    expect(studentCredits).toMatchObject([
      {
        lowCredit: false,
        planName: "Starter package",
        remaining: 3,
        sessionsTotal: 3,
        sessionsUsed: 0,
      },
    ]);
    expect(parentCredits).toMatchObject([
      {
        planName: "Starter package",
        remaining: 3,
        studentName: "Student One",
      },
    ]);
  });

  it("consumes attended sessions from the oldest package before returning billable sessions", async () => {
    const { client, db } = await createMigratedDb();
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
    await createRatePlan(db, {
      amount: 150000,
      makeId: () => "single_package_plan_id",
      name: "Single package",
      sessionsCount: 1,
      type: "package",
    });
    await createRatePlan(db, {
      amount: 300000,
      makeId: () => "double_package_plan_id",
      name: "Double package",
      sessionsCount: 2,
      type: "package",
    });
    await sellPackage(db, {
      makeId: (kind) => `${kind}_old`,
      purchasedAt: 1000,
      ratePlanId: "single_package_plan_id",
      studentId: "student_id",
    });
    await sellPackage(db, {
      makeId: (kind) => `${kind}_new`,
      purchasedAt: 2000,
      ratePlanId: "double_package_plan_id",
      studentId: "student_id",
    });

    for (let index = 1; index <= 4; index += 1) {
      await db.insert(classSessions).values({
        id: `session_${index}`,
        courseId: "course_id",
        startsAt: index * 1000,
        durationMin: 60,
        status: "done",
        topic: null,
        notesPrivate: null,
        notesShared: null,
        generatedFromSlot: null,
        createdAt: 3000,
        updatedAt: 3000,
      });
      await db.insert(attendance).values({
        id: `attendance_${index}`,
        sessionId: `session_${index}`,
        studentId: "student_id",
        status: index === 2 ? "late" : "present",
        createdAt: 3000,
        updatedAt: 3000,
      });
    }

    const result = await consumePackageCreditsForAttendedSessions(db, {
      now: () => 9000,
      periodEnd: 5000,
      periodStart: 0,
      studentId: "student_id",
    });
    const purchases = await db
      .select()
      .from(packagePurchases)
      .orderBy(packagePurchases.purchasedAt);
    const credits = await listPackageCreditsForStudent(db, "student_id");
    client.close();

    expect(result).toEqual({
      billableSessionIds: ["session_4"],
      covered: [
        { packagePurchaseId: "packagePurchase_old", sessionId: "session_1" },
        { packagePurchaseId: "packagePurchase_new", sessionId: "session_2" },
        { packagePurchaseId: "packagePurchase_new", sessionId: "session_3" },
      ],
    });
    expect(purchases).toMatchObject([
      { id: "packagePurchase_old", sessionsUsed: 1, status: "exhausted" },
      { id: "packagePurchase_new", sessionsUsed: 2, status: "exhausted" },
    ]);
    expect(credits.map((credit) => credit.remaining)).toEqual([0, 0]);
  });

  it("generates monthly draft invoices with line math, package credits, and idempotent regeneration", async () => {
    const { client, db } = await createMigratedDb();
    const julyStart = Date.UTC(2026, 6, 1);
    const julyEnd = Date.UTC(2026, 7, 1);
    let idCounter = 0;
    const makeBillingId = (kind: "invoice" | "invoiceItem" | "packagePurchase") =>
      `${kind}_${idCounter++}`;

    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
    });
    await createCourse(db, {
      description: "",
      makeId: () => "algebra_course_id",
      subject: "Math",
      title: "Algebra I",
    });
    await createCourse(db, {
      description: "",
      makeId: () => "geometry_course_id",
      subject: "Math",
      title: "Geometry",
    });
    await enrollStudent(db, {
      courseId: "algebra_course_id",
      makeId: () => "algebra_enrollment_id",
      studentId: "student_id",
    });
    await enrollStudent(db, {
      courseId: "geometry_course_id",
      makeId: () => "geometry_enrollment_id",
      studentId: "student_id",
    });
    await createRatePlan(db, {
      amount: 100000,
      makeId: () => "per_session_plan_id",
      name: "Per session",
      type: "per_session",
    });
    await createRatePlan(db, {
      amount: 400000,
      makeId: () => "monthly_plan_id",
      name: "Monthly",
      type: "monthly_flat",
    });
    await createRatePlan(db, {
      amount: 200000,
      makeId: () => "package_plan_id",
      name: "Two-pack",
      sessionsCount: 2,
      type: "package",
    });
    await setCourseDefaultRatePlan(db, {
      courseId: "algebra_course_id",
      ratePlanId: "per_session_plan_id",
    });
    await setCourseDefaultRatePlan(db, {
      courseId: "geometry_course_id",
      ratePlanId: "monthly_plan_id",
    });
    await sellPackage(db, {
      makeId: makeBillingId,
      purchasedAt: julyStart,
      ratePlanId: "package_plan_id",
      studentId: "student_id",
    });

    for (let index = 1; index <= 3; index += 1) {
      await db.insert(classSessions).values({
        id: `algebra_session_${index}`,
        courseId: "algebra_course_id",
        startsAt: julyStart + index * 24 * 60 * 60 * 1000,
        durationMin: 60,
        status: "done",
        topic: null,
        notesPrivate: null,
        notesShared: null,
        generatedFromSlot: null,
        createdAt: julyStart,
        updatedAt: julyStart,
      });
      await db.insert(attendance).values({
        id: `algebra_attendance_${index}`,
        sessionId: `algebra_session_${index}`,
        studentId: "student_id",
        status: index === 2 ? "late" : "present",
        createdAt: julyStart,
        updatedAt: julyStart,
      });
    }

    await db.insert(classSessions).values({
      id: "geometry_session",
      courseId: "geometry_course_id",
      startsAt: julyStart + 4 * 24 * 60 * 60 * 1000,
      durationMin: 60,
      status: "done",
      topic: null,
      notesPrivate: null,
      notesShared: null,
      generatedFromSlot: null,
      createdAt: julyStart,
      updatedAt: julyStart,
    });
    await db.insert(attendance).values({
      id: "geometry_attendance",
      sessionId: "geometry_session",
      studentId: "student_id",
      status: "present",
      createdAt: julyStart,
      updatedAt: julyStart,
    });

    const generated = await generateMonthlyInvoice(db, {
      dueDate: Date.UTC(2026, 7, 10),
      makeId: makeBillingId,
      now: () => julyEnd,
      periodEnd: julyEnd,
      periodStart: julyStart,
      studentId: "student_id",
    });
    const regenerated = await generateMonthlyInvoice(db, {
      makeId: makeBillingId,
      now: () => julyEnd + 1000,
      periodEnd: julyEnd,
      periodStart: julyStart,
      studentId: "student_id",
    });
    const [packagePurchase] = await db
      .select()
      .from(packagePurchases)
      .where(eq(packagePurchases.id, "packagePurchase_2"));
    const invoiceRows = await db.select().from(invoices).orderBy(invoices.number);
    const monthlyItems = await db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, generated.invoice.id));

    await db
      .update(invoices)
      .set({ status: "sent", updatedAt: julyEnd + 2000 })
      .where(eq(invoices.id, generated.invoice.id));
    const locked = await generateMonthlyInvoice(db, {
      makeId: makeBillingId,
      now: () => julyEnd + 3000,
      periodEnd: julyEnd,
      periodStart: julyStart,
      studentId: "student_id",
    });
    const lockedItems = await db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, generated.invoice.id));
    client.close();

    expect(generated.invoice).toMatchObject({
      number: "TL-202607-0002",
      status: "draft",
      total: 500000,
    });
    expect(regenerated.invoice.id).toBe(generated.invoice.id);
    expect(regenerated.invoice.number).toBe("TL-202607-0002");
    expect(regenerated.invoice.total).toBe(500000);
    expect(packagePurchase).toMatchObject({
      sessionsUsed: 2,
      status: "exhausted",
    });
    expect(invoiceRows.map((invoice) => invoice.number)).toEqual([
      "TL-202607-0001",
      "TL-202607-0002",
    ]);
    expect(monthlyItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: 400000,
          courseId: "geometry_course_id",
          description: "Geometry monthly tuition",
          quantity: 1,
          unitAmount: 400000,
        }),
        expect.objectContaining({
          amount: 0,
          courseId: "algebra_course_id",
          description: "Package credit (packagePurchase_2): Algebra I",
          sessionId: "algebra_session_1",
        }),
        expect.objectContaining({
          amount: 0,
          courseId: "algebra_course_id",
          description: "Package credit (packagePurchase_2): Algebra I",
          sessionId: "algebra_session_2",
        }),
        expect.objectContaining({
          amount: 100000,
          courseId: "algebra_course_id",
          description: "Algebra I session - 2026-07-04",
          sessionId: "algebra_session_3",
          unitAmount: 100000,
        }),
      ]),
    );
    expect(locked.skipped).toBe(true);
    expect(lockedItems.map((item) => item.id).sort()).toEqual(
      monthlyItems.map((item) => item.id).sort(),
    );
  });

  it("records payments and derives partial and paid invoice statuses", async () => {
    const { client, db } = await createMigratedDb();
    await createStudent(db, {
      email: "student@example.com",
      makeId: () => "student_id",
      name: "Student One",
    });
    await createRatePlan(db, {
      amount: 300000,
      makeId: () => "package_plan_id",
      name: "Starter package",
      sessionsCount: 2,
      type: "package",
    });
    await sellPackage(db, {
      makeId: (kind) => `${kind}_id`,
      purchasedAt: Date.UTC(2026, 6, 1),
      ratePlanId: "package_plan_id",
      studentId: "student_id",
    });

    const sent = await markInvoiceSent(db, {
      id: "invoice_id",
      now: () => 8000,
    });
    const partial = await recordPayment(db, {
      amount: 100000,
      invoiceId: "invoice_id",
      makeId: () => "payment_1",
      method: "cash",
      now: () => 9000,
      paidAt: 9000,
      reference: "cash-partial",
    });
    const paid = await recordPayment(db, {
      amount: 200000,
      invoiceId: "invoice_id",
      makeId: () => "payment_2",
      method: "bkash",
      now: () => 10000,
      paidAt: 10000,
      reference: "bkash-final",
    });
    const summaries = await listTutorInvoices(db);
    const paymentRows = await db.select().from(payments).orderBy(payments.paidAt);
    const voided = await voidInvoice(db, {
      id: "invoice_id",
      now: () => 11000,
    });
    client.close();

    expect(sent.status).toBe("sent");
    expect(partial.invoice.status).toBe("partial");
    expect(partial.paidTotal).toBe(100000);
    expect(partial.balance).toBe(200000);
    expect(paid.invoice.status).toBe("paid");
    expect(paid.paidTotal).toBe(300000);
    expect(paid.balance).toBe(0);
    expect(paymentRows).toMatchObject([
      { amount: 100000, method: "cash", reference: "cash-partial" },
      { amount: 200000, method: "bkash", reference: "bkash-final" },
    ]);
    expect(summaries).toMatchObject([
      {
        balance: 0,
        displayStatus: "paid",
        number: "TL-202607-0001",
        paidTotal: 300000,
        studentName: "Student One",
      },
    ]);
    expect(voided.status).toBe("void");
  });
});
