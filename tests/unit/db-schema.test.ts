import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  activityLog,
  announcements,
  assignments,
  attachments,
  attendance,
  classSessions,
  commentBank,
  comments,
  courses,
  enrollments,
  invites,
  invoiceItems,
  invoices,
  materialLinks,
  materialProgress,
  materialStandards,
  materials,
  modules,
  packagePurchases,
  parentLinks,
  payments,
  progressReports,
  promptHistory,
  quizAnswers,
  quizAttempts,
  quizQuestions,
  quizStandards,
  quizzes,
  ratePlans,
  scheduleSlots,
  settings,
  standards,
  submissions,
  users,
} from "@/db/schema";

const expectedTableNames = [
  "activity_log",
  "announcements",
  "assignments",
  "attachments",
  "attendance",
  "class_sessions",
  "comment_bank",
  "comments",
  "courses",
  "enrollments",
  "invites",
  "invoice_items",
  "invoices",
  "material_links",
  "material_progress",
  "material_standards",
  "materials",
  "modules",
  "package_purchases",
  "parent_links",
  "payments",
  "progress_reports",
  "prompt_history",
  "quiz_answers",
  "quiz_attempts",
  "quiz_questions",
  "quiz_standards",
  "quizzes",
  "rate_plans",
  "schedule_slots",
  "settings",
  "standards",
  "submissions",
  "users",
] as const;

const schemaTables = [
  activityLog,
  announcements,
  assignments,
  attachments,
  attendance,
  classSessions,
  commentBank,
  comments,
  courses,
  enrollments,
  invites,
  invoiceItems,
  invoices,
  materialLinks,
  materialProgress,
  materialStandards,
  materials,
  modules,
  packagePurchases,
  parentLinks,
  payments,
  progressReports,
  promptHistory,
  quizAnswers,
  quizAttempts,
  quizQuestions,
  quizStandards,
  quizzes,
  ratePlans,
  scheduleSlots,
  settings,
  standards,
  submissions,
  users,
];

describe("database schema", () => {
  it("exports every table from the handoff data model", () => {
    expect(schemaTables.map((table) => getTableName(table))).toEqual(expectedTableNames);
  });

  it("uses integer columns for money and unix-millisecond timestamps", () => {
    expect(ratePlans.amount.columnType).toBe("SQLiteInteger");
    expect(invoices.total.columnType).toBe("SQLiteInteger");
    expect(invoiceItems.unitAmount.columnType).toBe("SQLiteInteger");
    expect(invoiceItems.amount.columnType).toBe("SQLiteInteger");
    expect(payments.amount.columnType).toBe("SQLiteInteger");
    expect(users.createdAt.columnType).toBe("SQLiteInteger");
    expect(users.updatedAt.columnType).toBe("SQLiteInteger");
  });
});
