import {
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
};

const id = text("id").primaryKey();

export const users = sqliteTable(
  "users",
  {
    id,
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["tutor", "student", "parent"] }).notNull(),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    icsToken: text("ics_token"),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const invites = sqliteTable(
  "invites",
  {
    id,
    code: text("code").notNull(),
    role: text("role", { enum: ["student", "parent"] }).notNull(),
    studentId: text("student_id").references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    usedBy: text("used_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("invites_code_unique").on(table.code)],
);

export const parentLinks = sqliteTable(
  "parent_links",
  {
    parentId: text("parent_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.parentId, table.studentId] })],
);

export const ratePlans = sqliteTable("rate_plans", {
  id,
  name: text("name").notNull(),
  type: text("type", { enum: ["per_session", "monthly_flat", "package"] }).notNull(),
  amount: integer("amount").notNull(),
  sessionsCount: integer("sessions_count"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

export const courses = sqliteTable("courses", {
  id,
  title: text("title").notNull(),
  subject: text("subject").notNull(),
  description: text("description").notNull().default(""),
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  defaultRatePlanId: text("default_rate_plan_id").references(() => ratePlans.id, {
    onDelete: "set null",
  }),
  ...timestamps,
});

export const enrollments = sqliteTable(
  "enrollments",
  {
    id,
    courseId: text("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ratePlanId: text("rate_plan_id").references(() => ratePlans.id, { onDelete: "set null" }),
    status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
    ...timestamps,
  },
  (table) => [uniqueIndex("enrollments_course_student_unique").on(table.courseId, table.studentId)],
);

export const scheduleSlots = sqliteTable("schedule_slots", {
  id,
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  weekday: integer("weekday").notNull(),
  startMin: integer("start_min").notNull(),
  durationMin: integer("duration_min").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

export const classSessions = sqliteTable("class_sessions", {
  id,
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  startsAt: integer("starts_at").notNull(),
  durationMin: integer("duration_min").notNull(),
  status: text("status", { enum: ["scheduled", "done", "cancelled"] })
    .notNull()
    .default("scheduled"),
  topic: text("topic"),
  notesPrivate: text("notes_private"),
  notesShared: text("notes_shared"),
  generatedFromSlot: text("generated_from_slot").references(() => scheduleSlots.id, {
    onDelete: "set null",
  }),
  ...timestamps,
});

export const attendance = sqliteTable(
  "attendance",
  {
    id,
    sessionId: text("session_id")
      .notNull()
      .references(() => classSessions.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["present", "absent", "late", "excused"] }).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("attendance_session_student_unique").on(table.sessionId, table.studentId)],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id,
    studentId: text("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodStart: integer("period_start").notNull(),
    periodEnd: integer("period_end").notNull(),
    status: text("status", { enum: ["draft", "sent", "paid", "partial", "void"] })
      .notNull()
      .default("draft"),
    total: integer("total").notNull().default(0),
    number: text("number").notNull(),
    notes: text("notes"),
    dueDate: integer("due_date").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("invoices_number_unique").on(table.number)],
);

export const packagePurchases = sqliteTable("package_purchases", {
  id,
  studentId: text("student_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ratePlanId: text("rate_plan_id")
    .notNull()
    .references(() => ratePlans.id, { onDelete: "restrict" }),
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  sessionsTotal: integer("sessions_total").notNull(),
  sessionsUsed: integer("sessions_used").notNull().default(0),
  status: text("status", { enum: ["active", "exhausted", "expired"] }).notNull().default("active"),
  purchasedAt: integer("purchased_at").notNull(),
  ...timestamps,
});

export const invoiceItems = sqliteTable("invoice_items", {
  id,
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitAmount: integer("unit_amount").notNull(),
  amount: integer("amount").notNull(),
  sessionId: text("session_id").references(() => classSessions.id, { onDelete: "set null" }),
  courseId: text("course_id").references(() => courses.id, { onDelete: "set null" }),
  ...timestamps,
});

export const payments = sqliteTable("payments", {
  id,
  invoiceId: text("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  method: text("method", { enum: ["cash", "bank", "bkash", "nagad", "other"] }).notNull(),
  reference: text("reference"),
  paidAt: integer("paid_at").notNull(),
  notes: text("notes"),
  ...timestamps,
});

export const modules = sqliteTable("modules", {
  id,
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  ...timestamps,
});

export const materials = sqliteTable("materials", {
  id,
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  moduleId: text("module_id").references(() => modules.id, { onDelete: "set null" }),
  type: text("type", { enum: ["lecture", "study", "lesson_plan", "worksheet"] }).notNull(),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull(),
  planJson: text("plan_json", { mode: "json" }),
  visibility: text("visibility", { enum: ["students", "tutor_only"] }).notNull(),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  publishAt: integer("publish_at"),
  sortOrder: integer("sort_order").notNull().default(0),
  requiresMaterialId: text("requires_material_id"),
  ...timestamps,
});

export const standards = sqliteTable("standards", {
  id,
  framework: text("framework").notNull(),
  code: text("code").notNull(),
  description: text("description").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
});

export const materialStandards = sqliteTable(
  "material_standards",
  {
    materialId: text("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    standardId: text("standard_id")
      .notNull()
      .references(() => standards.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.materialId, table.standardId] })],
);

export const quizzes = sqliteTable("quizzes", {
  id,
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  instructionsMd: text("instructions_md").notNull().default(""),
  status: text("status", { enum: ["draft", "published", "closed"] }).notNull().default("draft"),
  openAt: integer("open_at"),
  closeAt: integer("close_at"),
  timeLimitMin: integer("time_limit_min"),
  maxAttempts: integer("max_attempts").notNull().default(1),
  shuffle: integer("shuffle", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

export const quizStandards = sqliteTable(
  "quiz_standards",
  {
    quizId: text("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    standardId: text("standard_id")
      .notNull()
      .references(() => standards.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.quizId, table.standardId] })],
);

export const promptHistory = sqliteTable("prompt_history", {
  id,
  feature: text("feature").notNull(),
  inputJson: text("input_json", { mode: "json" }).notNull(),
  createdAt: integer("created_at").notNull(),
});

export const materialLinks = sqliteTable("material_links", {
  id,
  materialId: text("material_id")
    .notNull()
    .references(() => materials.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  label: text("label").notNull(),
  kind: text("kind", { enum: ["link", "youtube", "pdf"] }).notNull(),
  ...timestamps,
});

export const materialProgress = sqliteTable(
  "material_progress",
  {
    id,
    materialId: text("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    completedAt: integer("completed_at").notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("material_progress_material_student_unique").on(table.materialId, table.studentId)],
);

export const attachments = sqliteTable("attachments", {
  id,
  ownerType: text("owner_type", { enum: ["material", "submission", "assignment"] }).notNull(),
  ownerId: text("owner_id").notNull(),
  blobUrl: text("blob_url").notNull(),
  filename: text("filename").notNull(),
  size: integer("size").notNull(),
  ...timestamps,
});

export const quizQuestions = sqliteTable("quiz_questions", {
  id,
  quizId: text("quiz_id")
    .notNull()
    .references(() => quizzes.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["mcq_single", "mcq_multi", "true_false", "short_answer"],
  }).notNull(),
  promptMd: text("prompt_md").notNull(),
  optionsJson: text("options_json", { mode: "json" }),
  answerJson: text("answer_json", { mode: "json" }).notNull(),
  points: integer("points").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const quizAttempts = sqliteTable("quiz_attempts", {
  id,
  quizId: text("quiz_id")
    .notNull()
    .references(() => quizzes.id, { onDelete: "cascade" }),
  studentId: text("student_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  startedAt: integer("started_at").notNull(),
  submittedAt: integer("submitted_at"),
  autoScore: integer("auto_score"),
  finalScore: integer("final_score"),
  status: text("status", { enum: ["in_progress", "submitted", "graded"] })
    .notNull()
    .default("in_progress"),
  ...timestamps,
});

export const quizAnswers = sqliteTable("quiz_answers", {
  id,
  attemptId: text("attempt_id")
    .notNull()
    .references(() => quizAttempts.id, { onDelete: "cascade" }),
  questionId: text("question_id")
    .notNull()
    .references(() => quizQuestions.id, { onDelete: "cascade" }),
  answerJson: text("answer_json", { mode: "json" }).notNull(),
  isCorrect: integer("is_correct", { mode: "boolean" }),
  pointsAwarded: integer("points_awarded"),
  ...timestamps,
});

export const announcements = sqliteTable("announcements", {
  id,
  courseId: text("course_id").references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull(),
  publishAt: integer("publish_at"),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  allowComments: integer("allow_comments", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

export const assignments = sqliteTable("assignments", {
  id,
  courseId: text("course_id")
    .notNull()
    .references(() => courses.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull(),
  rubricMd: text("rubric_md"),
  dueAt: integer("due_at"),
  points: integer("points"),
  status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  allowText: integer("allow_text", { mode: "boolean" }).notNull().default(true),
  allowLink: integer("allow_link", { mode: "boolean" }).notNull().default(true),
  allowFile: integer("allow_file", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

export const submissions = sqliteTable(
  "submissions",
  {
    id,
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bodyText: text("body_text"),
    linkUrl: text("link_url"),
    submittedAt: integer("submitted_at").notNull(),
    status: text("status", { enum: ["submitted", "returned"] }).notNull().default("submitted"),
    grade: integer("grade"),
    feedbackMd: text("feedback_md"),
    ...timestamps,
  },
  (table) => [uniqueIndex("submissions_assignment_student_unique").on(table.assignmentId, table.studentId)],
);

export const comments = sqliteTable("comments", {
  id,
  entityType: text("entity_type", { enum: ["announcement", "submission"] }).notNull(),
  entityId: text("entity_id").notNull(),
  authorId: text("author_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const commentBank = sqliteTable("comment_bank", {
  id,
  text: text("text").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const progressReports = sqliteTable("progress_reports", {
  id,
  studentId: text("student_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  periodStart: integer("period_start").notNull(),
  periodEnd: integer("period_end").notNull(),
  bodyMd: text("body_md").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const activityLog = sqliteTable("activity_log", {
  id,
  actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metaJson: text("meta_json", { mode: "json" }),
  at: integer("at").notNull(),
});

export const schema = {
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
};
