// M8 resources: quick checks (builder, attempts with autosave and timing, integrity snapshots from
// tinyproctorjs, auto-grading, manual review of short answers) and the gradebook. Mirrors /api/v1.
import {
  attemptScore,
  cellAverage,
  integrityReview,
  newId,
  remainingSeconds,
  scoreAnswer,
  shuffled,
  sortableId,
  validateQuestion,
  windowError,
  type CheckQuestion,
  type CheckWindow,
  type GradeCell,
  type IntegritySnapshot,
  type User
} from "@loft/core";
import { ForbiddenError, NotFoundError } from "../types";
import type { Row } from "./db";
import { requireMe, routes, str, type LocalCtx } from "./routes";

export interface CheckRow extends Row, CheckWindow {
  spaceId: string;
  title: string;
  instructions: string;
  questions: CheckQuestion[];
  shuffle: boolean;
  integrity: boolean;
  createdAt: string;
  createdBy: string;
}
export interface AttemptRow extends Row {
  checkId: string;
  userId: string;
  startedAt: string;
  submittedAt: string | null;
  status: "in_progress" | "submitted" | "graded";
  answers: Record<string, string[]>;
  scores: Record<string, { isCorrect: boolean | null; points: number | null }>;
  integrity: (IntegritySnapshot & { recent?: { t: string; violationKey: string | null }[] }) | null;
}
interface MemberRow extends Row { spaceId: string; userId: string; role: string }
interface UserRow extends User, Row {}
interface PostRow extends Row { spaceId: string; kind: string; title: string; dueAt?: string }
interface SubRow extends Row { postId: string; userId: string; status: string; at: string }

const nowIso = (ctx: LocalCtx) => ctx.now().toISOString();
/** A published check whose close time has passed reads as closed. */
const effective = (c: CheckRow, now: number): CheckRow["status"] => (c.status === "published" && c.closeAt && Date.parse(c.closeAt) < now ? "closed" : c.status);

async function role(ctx: LocalCtx, spaceId: string) {
  const me = await requireMe(ctx);
  const m = await ctx.db.get<MemberRow>("memberships", `${spaceId}:${me.id}`);
  if (!m) throw new ForbiddenError("You're not in this space");
  return { me, isHost: m.role === "host" || m.role === "cohost" };
}

async function checkOr404(ctx: LocalCtx, id: string) {
  const c = await ctx.db.get<CheckRow>("checks", id);
  if (!c) throw new NotFoundError("Check not found");
  return c;
}

/** Members never receive the answer key. */
function forMember(c: CheckRow, userId: string) {
  const qs = c.shuffle ? shuffled(c.questions, userId) : c.questions;
  return { ...c, questions: qs.map((q) => ({ ...q, answer: [], options: c.shuffle && q.type !== "true_false" ? shuffled(q.options, userId + q.id) : q.options })) };
}

function grade(c: CheckRow, a: AttemptRow): AttemptRow {
  const scores: AttemptRow["scores"] = {};
  for (const q of c.questions) {
    const manual = a.scores[q.id];
    const auto = scoreAnswer(q, a.answers[q.id]);
    scores[q.id] = q.type === "short_answer" && auto.points === null && manual && manual.points !== null ? manual : auto;
  }
  const s = attemptScore(c.questions, scores);
  return { ...a, scores, status: s.pending ? "submitted" : "graded" };
}

function attemptView(c: CheckRow, a: AttemptRow, now: number) {
  const s = attemptScore(c.questions, a.scores);
  return {
    id: a.id,
    checkId: c.id,
    status: a.status,
    startedAt: a.startedAt,
    submittedAt: a.submittedAt,
    answers: a.answers,
    remaining: a.status === "in_progress" ? remainingSeconds(c, a.startedAt, now) : null,
    score: a.status === "in_progress" ? null : s,
    results: a.status === "in_progress" ? null : Object.fromEntries(Object.entries(a.scores).map(([k, v]) => [k, v.isCorrect]))
  };
}

const QUESTION_TYPES = ["mcq_single", "mcq_multi", "true_false", "short_answer"] as const;
function cleanQuestions(raw: unknown): CheckQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).map((q: Partial<CheckQuestion>) => {
    const type = QUESTION_TYPES.find((t) => t === q.type) ?? "mcq_single";
    return {
      id: str(q.id, 40) || newId("q"),
      type,
      prompt: str(q.prompt, 1000),
      points: Math.max(1, Math.min(100, Math.round(Number(q.points) || 1))),
      options: type === "true_false" ? [{ id: "true", text: "True" }, { id: "false", text: "False" }] : type === "short_answer" ? [] : (Array.isArray(q.options) ? q.options : []).slice(0, 8).map((o) => ({ id: str(o.id, 40) || newId("o"), text: str(o.text, 300) })),
      answer: (Array.isArray(q.answer) ? q.answer : []).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 200))
    };
  });
}

/** To review: short answers waiting for a mark, per check. */
export async function checksReviewItems(ctx: LocalCtx, hostId: string) {
  const hosted = new Set((await ctx.db.list<MemberRow>("memberships", (m) => m.userId === hostId && (m.role === "host" || m.role === "cohost"))).map((m) => m.spaceId));
  const items: { id: string; kind: string; title: string; sub: string; action: string; link: string }[] = [];
  for (const c of await ctx.db.list<CheckRow>("checks", (x) => hosted.has(x.spaceId) && x.status !== "draft")) {
    const waiting = await ctx.db.list<AttemptRow>("check_attempts", (a) => a.checkId === c.id && a.status === "submitted");
    if (!waiting.length) continue;
    const flagged = waiting.filter((a) => c.integrity && integrityReview(a.integrity).level === "flagged").length;
    items.push({ id: `check:${c.id}`, kind: "check", title: `${waiting.length} answer${waiting.length === 1 ? "" : "s"} to mark · ${c.title}`, sub: flagged ? `${flagged} with integrity signals to look at` : "Short answers that didn't match", action: "Mark", link: `/checks/${c.id}` });
  }
  return items;
}

routes
  .get("spaces/:id/checks", async (ctx, p) => {
    const { me, isHost } = await role(ctx, p.id!);
    const checks = (await ctx.db.list<CheckRow>("checks", (c) => c.spaceId === p.id && (isHost || c.status !== "draft"))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const members = (await ctx.db.list<MemberRow>("memberships", (m) => m.spaceId === p.id && m.role === "member")).length;
    const out = [];
    for (const c of checks) {
      const attempts = await ctx.db.list<AttemptRow>("check_attempts", (a) => a.checkId === c.id);
      const done = attempts.filter((a) => a.status !== "in_progress");
      const mine = attempts.filter((a) => a.userId === me.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      const pct = done.map((a) => attemptScore(c.questions, a.scores).percent).filter((x): x is number => x !== null);
      out.push({
        id: c.id,
        title: c.title,
        status: effective(c, ctx.now().getTime()),
        closeAt: c.closeAt,
        timeLimitMin: c.timeLimitMin,
        integrity: c.integrity,
        questions: c.questions.length,
        points: c.questions.reduce((n, q) => n + q.points, 0),
        ...(isHost
          ? { submitted: done.length, members, average: pct.length ? Math.round(pct.reduce((n, x) => n + x, 0) / pct.length) : null, toReview: done.filter((a) => a.status === "submitted").length, flagged: done.filter((a) => integrityReview(a.integrity).level === "flagged").length }
          : { mine: mine ? attemptView(c, mine, ctx.now().getTime()) : null, open: !windowError(c, ctx.now().getTime()) })
      });
    }
    return { isHost, checks: out };
  })
  .post("spaces/:id/checks", async (ctx, p, input) => {
    const { me, isHost } = await role(ctx, p.id!);
    if (!isHost) throw new ForbiddenError("Only hosts make checks");
    const c: CheckRow = {
      id: newId("ck"),
      spaceId: p.id!,
      title: str(input.title, 120) || "Quick check",
      instructions: str(input.instructions, 1000),
      questions: cleanQuestions(input.questions).length ? cleanQuestions(input.questions) : [{ id: newId("q"), type: "mcq_single", prompt: "", points: 1, options: [{ id: newId("o"), text: "" }, { id: newId("o"), text: "" }], answer: [] }],
      status: "draft",
      openAt: null,
      closeAt: null,
      timeLimitMin: 15,
      maxAttempts: 1,
      shuffle: true,
      integrity: true,
      createdAt: nowIso(ctx),
      createdBy: me.id
    };
    await ctx.db.put("checks", c);
    ctx.changed("checks");
    return c;
  })
  .get("checks/:id", async (ctx, p) => {
    const c = await checkOr404(ctx, p.id!);
    const { me, isHost } = await role(ctx, c.spaceId);
    const space = await ctx.db.get<Row & { name: string; slug: string; code: string }>("spaces", c.spaceId);
    return { ...(isHost ? c : forMember(c, me.id)), status: effective(c, ctx.now().getTime()), isHost, space: { id: c.spaceId, name: space?.name ?? "", slug: space?.slug ?? "", code: space?.code ?? "" } };
  })
  .post("checks/:id", async (ctx, p, input) => {
    const c = await checkOr404(ctx, p.id!);
    const { isHost } = await role(ctx, c.spaceId);
    if (!isHost) throw new ForbiddenError("Only hosts edit checks");
    const next: CheckRow = { ...c };
    if (typeof input.title === "string") next.title = str(input.title, 120) || c.title;
    if (typeof input.instructions === "string") next.instructions = str(input.instructions, 1000);
    if (Array.isArray(input.questions)) next.questions = cleanQuestions(input.questions);
    if (input.timeLimitMin === null || typeof input.timeLimitMin === "number") next.timeLimitMin = input.timeLimitMin === null ? null : Math.max(1, Math.min(240, Math.round(input.timeLimitMin)));
    if (input.closeAt === null || typeof input.closeAt === "string") next.closeAt = input.closeAt ? new Date(input.closeAt).toISOString() : null;
    if (input.openAt === null || typeof input.openAt === "string") next.openAt = input.openAt ? new Date(input.openAt).toISOString() : null;
    if (typeof input.maxAttempts === "number") next.maxAttempts = Math.max(1, Math.min(10, Math.round(input.maxAttempts)));
    if (typeof input.shuffle === "boolean") next.shuffle = input.shuffle;
    if (typeof input.integrity === "boolean") next.integrity = input.integrity;
    await ctx.db.put("checks", next);
    ctx.changed("checks");
    return next;
  })
  .post("checks/:id/status", async (ctx, p, input) => {
    const c = await checkOr404(ctx, p.id!);
    const { isHost } = await role(ctx, c.spaceId);
    if (!isHost) throw new ForbiddenError("Only hosts publish checks");
    const status = input.status === "closed" ? "closed" : input.status === "draft" ? "draft" : "published";
    if (status === "published") {
      if (!c.questions.length) throw new Error("Add a question first");
      for (const [i, q] of c.questions.entries()) {
        const err = validateQuestion(q);
        if (err) throw new Error(`Question ${i + 1}: ${err}`);
      }
    }
    const past = !!c.closeAt && Date.parse(c.closeAt) < ctx.now().getTime();
    const next = { ...c, status, ...(status === "closed" && (!c.closeAt || !past) ? { closeAt: nowIso(ctx) } : {}), ...(status === "published" && past ? { closeAt: null } : {}) } as CheckRow;
    await ctx.db.put("checks", next);
    if (status === "published" && c.status === "draft") {
      for (const m of await ctx.db.list<MemberRow>("memberships", (x) => x.spaceId === c.spaceId && x.role === "member")) {
        await ctx.db.put("notifications", { id: sortableId("nt"), userId: m.userId, kind: "check", title: `New check: ${c.title}`, sub: `${c.questions.length} questions${c.timeLimitMin ? ` · ${c.timeLimitMin} min` : ""}${c.closeAt ? ` · closes ${new Date(c.closeAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}` : ""}`, link: `/checks/${c.id}/take`, createdAt: nowIso(ctx), readAt: null });
      }
      ctx.changed("notifications");
    }
    ctx.changed("checks");
    return next;
  })
  .post("checks/:id/start", async (ctx, p) => {
    const c = await checkOr404(ctx, p.id!);
    const { me } = await role(ctx, c.spaceId);
    const t = ctx.now().getTime();
    const mine = (await ctx.db.list<AttemptRow>("check_attempts", (a) => a.checkId === c.id && a.userId === me.id)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const open = mine.find((a) => a.status === "in_progress");
    if (open) return attemptView(c, open, t);
    const err = windowError(c, t);
    if (err) throw new Error(err);
    if (mine.length >= c.maxAttempts) throw new Error(c.maxAttempts === 1 ? "You've already done this check" : `You've used all ${c.maxAttempts} attempts`);
    const a: AttemptRow = { id: newId("at"), checkId: c.id, userId: me.id, startedAt: nowIso(ctx), submittedAt: null, status: "in_progress", answers: {}, scores: {}, integrity: null };
    await ctx.db.put("check_attempts", a);
    ctx.changed("check_attempts");
    return attemptView(c, a, t);
  })
  .get("attempts/:id", async (ctx, p) => {
    const me = await requireMe(ctx);
    const a = await ctx.db.get<AttemptRow>("check_attempts", p.id!);
    if (!a) throw new NotFoundError("Attempt not found");
    const c = await checkOr404(ctx, a.checkId);
    const { isHost } = await role(ctx, c.spaceId);
    if (!isHost && a.userId !== me.id) throw new ForbiddenError("Not your attempt");
    return attemptView(c, a, ctx.now().getTime());
  })
  .post("attempts/:id/answer", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const a = await ctx.db.get<AttemptRow>("check_attempts", p.id!);
    if (!a || a.userId !== me.id) throw new NotFoundError("Attempt not found");
    const c = await checkOr404(ctx, a.checkId);
    if (a.status !== "in_progress") throw new Error("This attempt is already submitted");
    if (remainingSeconds(c, a.startedAt, ctx.now().getTime()) === 0) throw new Error("Time's up");
    const qid = str(input.questionId, 40);
    if (!c.questions.some((q) => q.id === qid)) throw new NotFoundError("Question not found");
    const answer = (Array.isArray(input.answer) ? input.answer : []).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 2000));
    await ctx.db.update<AttemptRow>("check_attempts", a.id, (cur) => ({ ...cur, answers: { ...cur.answers, [qid]: answer } }));
    return { ok: true };
  })
  .post("attempts/:id/integrity", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const a = await ctx.db.get<AttemptRow>("check_attempts", p.id!);
    if (!a || a.userId !== me.id || a.status !== "in_progress") return { ok: false };
    const counts = (input.violationCounts && typeof input.violationCounts === "object" ? input.violationCounts : {}) as Record<string, unknown>;
    const snap = {
      integrityScore: Math.max(0, Math.min(100, Number(input.integrityScore) || 0)),
      violationCounts: Object.fromEntries(Object.entries(counts).filter(([, v]) => typeof v === "number").slice(0, 30)) as Record<string, number>,
      awayMs: Math.max(0, Number(input.awayMs) || 0),
      recent: (Array.isArray(input.recent) ? input.recent : []).slice(-10).map((r: { t?: unknown; violationKey?: unknown }) => ({ t: String(r.t ?? ""), violationKey: typeof r.violationKey === "string" ? r.violationKey : null }))
    };
    await ctx.db.patch<AttemptRow>("check_attempts", a.id, { integrity: snap });
    return { ok: true };
  })
  .post("attempts/:id/submit", async (ctx, p) => {
    const me = await requireMe(ctx);
    const a = await ctx.db.get<AttemptRow>("check_attempts", p.id!);
    if (!a || a.userId !== me.id) throw new NotFoundError("Attempt not found");
    const c = await checkOr404(ctx, a.checkId);
    if (a.status !== "in_progress") return attemptView(c, a, ctx.now().getTime());
    const done = await ctx.db.update<AttemptRow>("check_attempts", a.id, (cur) => grade(c, { ...cur, submittedAt: nowIso(ctx) }));
    ctx.changed("check_attempts");
    return attemptView(c, done, ctx.now().getTime());
  })
  .get("checks/:id/results", async (ctx, p) => {
    const c = await checkOr404(ctx, p.id!);
    const { isHost } = await role(ctx, c.spaceId);
    if (!isHost) throw new ForbiddenError("Only hosts see results");
    const users = new Map((await ctx.db.list<UserRow>("users")).map((u) => [u.id, u]));
    const attempts = (await ctx.db.list<AttemptRow>("check_attempts", (a) => a.checkId === c.id)).sort((a, b) => (users.get(a.userId)?.name ?? "").localeCompare(users.get(b.userId)?.name ?? ""));
    const members = await ctx.db.list<MemberRow>("memberships", (m) => m.spaceId === c.spaceId && m.role === "member");
    const done = attempts.filter((a) => a.status !== "in_progress");
    return {
      attempts: attempts.map((a) => {
        const s = attemptScore(c.questions, a.scores);
        const r = integrityReview(c.integrity ? a.integrity : null);
        return { id: a.id, userId: a.userId, name: users.get(a.userId)?.name ?? "?", status: a.status, score: a.status === "in_progress" ? null : s, startedAt: a.startedAt, submittedAt: a.submittedAt, minutes: a.submittedAt ? Math.max(1, Math.round((Date.parse(a.submittedAt) - Date.parse(a.startedAt)) / 60_000)) : null, integrity: { ...r, score: a.integrity?.integrityScore ?? null } };
      }),
      notStarted: members.filter((m) => !attempts.some((a) => a.userId === m.userId)).map((m) => ({ userId: m.userId, name: users.get(m.userId)?.name ?? "?" })),
      questions: c.questions.map((q) => {
        const answered = done.filter((a) => a.scores[q.id]?.isCorrect !== undefined);
        const right = answered.filter((a) => a.scores[q.id]?.isCorrect === true).length;
        return { id: q.id, prompt: q.prompt, type: q.type, correctRate: answered.length ? Math.round((right / answered.length) * 100) : null };
      }),
      review: done.flatMap((a) => c.questions.filter((q) => q.type === "short_answer" && a.scores[q.id]?.points === null).map((q) => ({ attemptId: a.id, name: users.get(a.userId)?.name ?? "?", questionId: q.id, prompt: q.prompt, points: q.points, response: a.answers[q.id]?.[0] ?? "", accepted: q.answer })))
    };
  })
  .post("attempts/:id/grade", async (ctx, p, input) => {
    const a = await ctx.db.get<AttemptRow>("check_attempts", p.id!);
    if (!a) throw new NotFoundError("Attempt not found");
    const c = await checkOr404(ctx, a.checkId);
    const { isHost } = await role(ctx, c.spaceId);
    if (!isHost) throw new ForbiddenError("Only hosts grade");
    const q = c.questions.find((x) => x.id === input.questionId);
    if (!q) throw new NotFoundError("Question not found");
    const points = Math.max(0, Math.min(q.points, Math.round(Number(input.points) || 0)));
    // A partial mark is still a mark: it counts as graded, and only full marks count as correct.
    const scores = { ...a.scores, [q.id]: { isCorrect: points === q.points, points } };
    const next: AttemptRow = { ...a, scores, status: attemptScore(c.questions, scores).pending ? "submitted" : "graded" };
    await ctx.db.put("check_attempts", next);
    ctx.changed("check_attempts");
    return { ok: true };
  })
  .get("spaces/:id/grades", async (ctx, p) => {
    const { isHost, me } = await role(ctx, p.id!);
    const t = ctx.now().toISOString();
    const users = new Map((await ctx.db.list<UserRow>("users")).map((u) => [u.id, u]));
    const members = (await ctx.db.list<MemberRow>("memberships", (m) => m.spaceId === p.id && m.role === "member")).filter((m) => isHost || m.userId === me.id);
    const tasks = (await ctx.db.list<PostRow>("posts", (x) => x.spaceId === p.id && x.kind === "task" && !!x.dueAt)).sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
    const checks = (await ctx.db.list<CheckRow>("checks", (c) => c.spaceId === p.id && c.status !== "draft")).sort((a, b) => (a.closeAt ?? a.createdAt).localeCompare(b.closeAt ?? b.createdAt));
    const subs = await ctx.db.list<SubRow>("submissions", (s) => tasks.some((x) => x.id === s.postId));
    const attempts = await ctx.db.list<AttemptRow>("check_attempts", (a) => checks.some((c) => c.id === a.checkId));
    const columns = [
      ...tasks.map((x) => ({ id: x.id, kind: "task" as const, title: x.title, points: null as number | null, dueAt: x.dueAt ?? null })),
      ...checks.map((c) => ({ id: c.id, kind: "check" as const, title: c.title, points: c.questions.reduce((n, q) => n + q.points, 0), dueAt: c.closeAt }))
    ];
    const rows = members.map((m) => {
      const cells: (GradeCell & { columnId: string })[] = columns.map((col) => {
        const past = !!col.dueAt && col.dueAt < t;
        if (col.kind === "task") {
          const s = subs.find((x) => x.postId === col.id && x.userId === m.userId);
          return { columnId: col.id, earned: null, possible: null, status: s ? (s.status === "handed-in" ? "pending" : "graded") : past ? "missing" : "not_due" };
        }
        const c = checks.find((x) => x.id === col.id)!;
        const a = attempts.filter((x) => x.checkId === col.id && x.userId === m.userId && x.status !== "in_progress").sort((x, y) => (y.submittedAt ?? "").localeCompare(x.submittedAt ?? ""))[0];
        if (!a) return { columnId: col.id, earned: null, possible: col.points, status: past || c.status === "closed" ? "missing" : "not_due" };
        const s = attemptScore(c.questions, a.scores);
        return { columnId: col.id, earned: s.pending ? null : s.earned, possible: col.points, status: s.pending ? "pending" : "graded" };
      });
      return { userId: m.userId, name: users.get(m.userId)?.name ?? "?", average: cellAverage(cells), cells };
    });
    return { isHost, columns, rows };
  });
