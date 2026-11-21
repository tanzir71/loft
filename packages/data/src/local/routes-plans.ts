// M6 resources: plans library, block editor (autosave + history), attach & prepare, room rail,
// attendance from presence, and wrap-up (the hinge that writes session_log lines). Mirrors /api/v1.
import {
  attendanceFromPresence,
  carryOver,
  DEFAULT_POLICY,
  derivePlanStatus,
  memberAgenda,
  newId,
  roomCode,
  ROOM_CAPACITY,
  sessionLogLines,
  sortableId,
  TEMPLATES,
  type AttendanceStatus,
  type BillingPolicy,
  type PlanBlock,
  type PlanStatus,
  type User
} from "@loft/core";
import { ForbiddenError, NotFoundError } from "../types";
import type { Row } from "./db";
import { requireMe, routes, str, type LocalCtx } from "./routes";

interface PlanRow extends Row { spaceId: string; title: string; minutes: number; objective: string; tags: string[]; unit: string; order: number; status: PlanStatus; aiDraft?: boolean; blocks: PlanBlock[]; sessionId: string | null; version: number; createdAt: string; updatedAt: string }
interface SessionRow extends Row { spaceId: string; title: string; startsAt: string; minutes: number; status: string; planId?: string | null; rail?: { current: number; startedAt: string | null; extensions: Record<string, number> } | null; wrapped?: boolean; prepared?: { roomId?: string; pages?: Record<string, string>; agendaPostId?: string; reminderId?: string } }
interface SpaceRow extends Row { name: string; slug: string; mode: string; billing?: Partial<BillingPolicy> & { mode?: string } }
interface MemberRow extends Row { spaceId: string; userId: string; role: string; payerUserId?: string | null }
interface RoomRow extends Row { code: string; sessionId?: string | null; spaceId: string | null; createdBy: string; endedAt: string | null }

const now = (ctx: LocalCtx) => ctx.now().toISOString();

async function hostOf(ctx: LocalCtx, spaceId: string) {
  const me = await requireMe(ctx);
  const m = await ctx.db.get<MemberRow>("memberships", `${spaceId}:${me.id}`);
  if (!m || (m.role !== "host" && m.role !== "cohost")) throw new ForbiddenError("Plans are for hosts");
  return me;
}

async function planOr404(ctx: LocalCtx, id: string) {
  const p = await ctx.db.get<PlanRow>("plans", id);
  if (!p) throw new NotFoundError("Plan not found");
  return p;
}

function policyFor(space: SpaceRow | undefined): BillingPolicy {
  return { unitPriceCents: space?.billing?.unitPriceCents ?? DEFAULT_POLICY.unitPriceCents, billable: (space?.billing?.billable as AttendanceStatus[] | undefined) ?? DEFAULT_POLICY.billable };
}

/** Ensure the session has a room, then create/update one board page per Board/Hand-out block (idempotent). */
async function prepare(ctx: LocalCtx, plan: PlanRow, session: SessionRow, hostId: string) {
  const prepared = { ...(session.prepared ?? {}) };
  let room = prepared.roomId ? await ctx.db.get<RoomRow>("rooms", prepared.roomId) : undefined;
  if (!room) {
    const code = roomCode();
    room = { id: newId("rm"), spaceId: session.spaceId, sessionId: session.id, slug: code.toLowerCase(), code, name: session.title, capacity: ROOM_CAPACITY, guestJoin: false, createdBy: hostId, createdAt: now(ctx), endedAt: null } as RoomRow;
    await ctx.db.put("rooms", room);
    prepared.roomId = room.id;
  }
  const pages = { ...(prepared.pages ?? {}) };
  const ops: { actor: string; ts: number; kind: string; payload: unknown }[] = [];
  let order = 1 + Object.keys(pages).length;
  for (const b of plan.blocks.filter((x) => x.type === "board" || x.type === "handout")) {
    if (pages[b.id]) {
      ops.push({ actor: hostId, ts: Date.now(), kind: "update", payload: { id: pages[b.id], target: "page", patch: { title: b.title } } });
    } else {
      const id = `pg_${b.id}`;
      pages[b.id] = id;
      ops.push({ actor: hostId, ts: Date.now(), kind: "add", payload: { page: { id, title: b.title, order, x: order * 1280, y: 0, w: 1200, h: 750, bg: null } } });
      order++;
    }
  }
  if (ops.length) await ctx.db.appendOps(room.id, ops as never);
  prepared.pages = pages;
  // Agenda post at start − 1 h (titles + times only).
  const agenda = memberAgenda(plan.blocks, session.startsAt);
  const publishAt = new Date(Date.parse(session.startsAt) - 3600_000).toISOString();
  const agendaPost = { id: prepared.agendaPostId ?? sortableId("po"), spaceId: session.spaceId, kind: "agenda", title: `Agenda · ${session.title}`, body: agenda.map((a) => `${a.time}  ${a.title}`).join("\n"), mustRead: false, createdBy: hostId, createdAt: publishAt, publishAt, attachments: [] };
  await ctx.db.put("posts", agendaPost);
  prepared.agendaPostId = agendaPost.id;
  // Reminder at start − 24 h (delivered by the first request after that time).
  const reminder = { id: prepared.reminderId ?? sortableId("nt"), userId: "*space", spaceId: session.spaceId, kind: "notice", title: `Tomorrow: ${session.title}`, sub: plan.title, link: "/calendar", createdAt: new Date(Date.parse(session.startsAt) - 86_400_000).toISOString(), deliverAt: new Date(Date.parse(session.startsAt) - 86_400_000).toISOString(), readAt: null };
  await ctx.db.put("scheduled_reminders", reminder);
  prepared.reminderId = reminder.id;
  return prepared;
}

/** Sessions with a plan that ended without a wrap-up (shown on Home and To review). */
export async function wrapupsPending(ctx: LocalCtx, hostId: string) {
  const hosted = new Set((await ctx.db.list<MemberRow>("memberships", (m) => m.userId === hostId && (m.role === "host" || m.role === "cohost"))).map((m) => m.spaceId));
  const t = ctx.now().getTime();
  return (await ctx.db.list<SessionRow>("sessions", (s) => hosted.has(s.spaceId) && !!s.planId && !s.wrapped && s.status !== "cancelled" && Date.parse(s.startsAt) + s.minutes * 60_000 < t)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

async function attendanceMinutes(ctx: LocalCtx, sessionId: string): Promise<Record<string, number>> {
  const rooms = await ctx.db.list<RoomRow>("rooms", (r) => r.sessionId === sessionId);
  const ids = new Set(rooms.map((r) => r.id));
  const out: Record<string, number> = {};
  for (const e of await ctx.db.list<Row & { roomId: string; userId: string; joinedAt: string; leftAt: string | null }>("attendance_events", (x) => ids.has(x.roomId))) {
    const end = e.leftAt ? Date.parse(e.leftAt) : ctx.now().getTime();
    out[e.userId] = (out[e.userId] ?? 0) + Math.max(0, (end - Date.parse(e.joinedAt)) / 60_000);
  }
  return out;
}

async function writeLogLines(ctx: LocalCtx, s: SessionRow, rows: { memberId: string; minutes: number; status: AttendanceStatus }[]) {
  const space = await ctx.db.get<SpaceRow>("spaces", s.spaceId);
  const members = new Map((await ctx.db.list<MemberRow>("memberships", (m) => m.spaceId === s.spaceId)).map((m) => [m.userId, m]));
  for (const line of sessionLogLines(rows, policyFor(space))) {
    await ctx.db.put("session_log", { id: `${s.id}:${line.memberId}`, sessionId: s.id, spaceId: s.spaceId, memberId: line.memberId, payerId: members.get(line.memberId)?.payerUserId ?? line.memberId, minutes: line.minutes, status: line.status, billable: line.billable, unitPriceCents: line.unitPriceCents, amountCents: line.amountCents, invoiceId: null, at: s.startsAt });
  }
}

/** If the host never wraps up, billable lines are still written from presence with default statuses after 24 h. */
export async function autoWrapStale(ctx: LocalCtx, hostId: string) {
  const t = ctx.now().getTime();
  for (const s of await wrapupsPending(ctx, hostId)) {
    if (Date.parse(s.startsAt) + s.minutes * 60_000 + 86_400_000 > t) continue;
    const members = (await ctx.db.list<MemberRow>("memberships", (m) => m.spaceId === s.spaceId && m.role !== "host" && m.role !== "cohost")).map((m) => m.userId);
    await writeLogLines(ctx, s, attendanceFromPresence(members, await attendanceMinutes(ctx, s.id)));
    await ctx.db.patch<SessionRow>("sessions", s.id, { wrapped: true });
  }
}

routes
  .get("spaces/:id/plans", async (ctx, p) => {
    await hostOf(ctx, p.id!);
    const plans = (await ctx.db.list<PlanRow>("plans", (x) => x.spaceId === p.id)).sort((a, b) => a.unit.localeCompare(b.unit) || a.order - b.order);
    const sessions = await ctx.db.list<SessionRow>("sessions", (s) => s.spaceId === p.id && s.status !== "cancelled");
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const t = ctx.now().getTime();
    const unplanned = sessions.filter((s) => !s.planId && Date.parse(s.startsAt) > t && Date.parse(s.startsAt) < t + 14 * 86_400_000).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const units = new Map<string, { objectives: number; covered: number }>();
    for (const pl of plans) {
      const u = units.get(pl.unit) ?? { objectives: 0, covered: 0 };
      u.objectives += pl.tags.length || 1;
      if (pl.status === "taught") u.covered += pl.tags.length || 1;
      units.set(pl.unit, u);
    }
    return {
      plans: plans.map((pl) => ({ ...pl, status: derivePlanStatus(pl), session: pl.sessionId ? byId.get(pl.sessionId) ?? null : null, planned: pl.blocks.reduce((n, b) => n + b.minutes, 0) })),
      unplanned: unplanned.slice(0, 5),
      units: [...units.entries()].map(([unit, v]) => ({ unit, ...v }))
    };
  })
  .post("spaces/:id/plans", async (ctx, p, input) => {
    await hostOf(ctx, p.id!);
    const from = str(input.from, 40) || "blank";
    const tpl = from.startsWith("template:") ? TEMPLATES[from.slice(9)] : undefined;
    const blocks: PlanBlock[] = Array.isArray(input.blocks) ? (input.blocks as PlanBlock[]) : tpl ? tpl.blocks() : [];
    const count = (await ctx.db.list<PlanRow>("plans", (x) => x.spaceId === p.id)).length;
    const plan: PlanRow = { id: newId("pl"), spaceId: p.id!, title: str(input.title, 120) || "Untitled plan", minutes: Number(input.minutes) || tpl?.minutes || 60, objective: str(input.objective, 300), tags: Array.isArray(input.tags) ? (input.tags as string[]).map((t) => String(t).slice(0, 40)).slice(0, 10) : [], unit: str(input.unit, 60) || "Unit 1", order: count, status: "draft", aiDraft: from === "ai", blocks, sessionId: null, version: 1, createdAt: now(ctx), updatedAt: now(ctx) };
    await ctx.db.put("plans", plan);
    await ctx.db.put("plan_versions", { id: `${plan.id}:1`, planId: plan.id, version: 1, blocks, at: now(ctx) });
    ctx.changed("plans");
    return plan;
  })
  .get("plans/:id", async (ctx, p) => {
    const plan = await planOr404(ctx, p.id!);
    await hostOf(ctx, plan.spaceId);
    const space = await ctx.db.get<SpaceRow>("spaces", plan.spaceId);
    const t = ctx.now().getTime();
    const sessions = (await ctx.db.list<SessionRow>("sessions", (s) => s.spaceId === plan.spaceId && s.status !== "cancelled" && Date.parse(s.startsAt) > t - 3600_000)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 12);
    const versions = (await ctx.db.list<Row & { planId: string; version: number; at: string }>("plan_versions", (v) => v.planId === plan.id)).sort((a, b) => b.version - a.version);
    return { ...plan, status: derivePlanStatus(plan), space: { id: space?.id, name: space?.name, slug: space?.slug }, sessions: sessions.map((s) => ({ id: s.id, title: s.title, startsAt: s.startsAt, minutes: s.minutes, planId: s.planId ?? null })), versions: versions.slice(0, 10).map((v) => ({ version: v.version, at: v.at })), agenda: memberAgenda(plan.blocks) };
  })
  .post("plans/:id", async (ctx, p, input) => {
    const plan = await planOr404(ctx, p.id!);
    await hostOf(ctx, plan.spaceId);
    const patch: Partial<PlanRow> = { updatedAt: now(ctx) };
    if (input.title !== undefined) patch.title = str(input.title, 120) || plan.title;
    if (input.minutes !== undefined) patch.minutes = Math.max(5, Math.min(480, Number(input.minutes) || plan.minutes));
    if (input.objective !== undefined) patch.objective = str(input.objective, 300);
    if (input.unit !== undefined) patch.unit = str(input.unit, 60) || plan.unit;
    if (Array.isArray(input.tags)) patch.tags = (input.tags as string[]).map((t) => String(t).slice(0, 40)).slice(0, 10);
    if (Array.isArray(input.blocks)) {
      patch.blocks = (input.blocks as PlanBlock[]).slice(0, 60);
      patch.version = plan.version + 1;
      patch.aiDraft = false; // an edited AI draft is no longer "AI draft"
      await ctx.db.put("plan_versions", { id: `${plan.id}:${patch.version}`, planId: plan.id, version: patch.version, blocks: patch.blocks, at: now(ctx) });
    }
    const next = await ctx.db.patch<PlanRow>("plans", plan.id, patch);
    // Re-prepare an attached session so pages and the agenda follow edits (idempotent).
    if (next.sessionId && Array.isArray(input.blocks)) {
      const s = await ctx.db.get<SessionRow>("sessions", next.sessionId);
      if (s) await ctx.db.patch<SessionRow>("sessions", s.id, { prepared: await prepare(ctx, next, s, (await requireMe(ctx)).id) });
    }
    ctx.changed("plans");
    return { ...next, status: derivePlanStatus(next) };
  })
  .post("plans/:id/restore", async (ctx, p, input) => {
    const plan = await planOr404(ctx, p.id!);
    await hostOf(ctx, plan.spaceId);
    const v = await ctx.db.get<Row & { blocks: PlanBlock[] }>("plan_versions", `${plan.id}:${Number(input.version)}`);
    if (!v) throw new NotFoundError("Version not found");
    const version = plan.version + 1;
    await ctx.db.put("plan_versions", { id: `${plan.id}:${version}`, planId: plan.id, version, blocks: v.blocks, at: now(ctx) });
    const next = await ctx.db.patch<PlanRow>("plans", plan.id, { blocks: v.blocks, version, updatedAt: now(ctx) });
    ctx.changed("plans");
    return next;
  })
  .post("plans/:id/reorder", async (ctx, p, input) => {
    const plan = await planOr404(ctx, p.id!);
    await hostOf(ctx, plan.spaceId);
    const ids = Array.isArray(input.ids) ? (input.ids as string[]) : [];
    for (const [i, id] of ids.entries()) if (await ctx.db.get("plans", id)) await ctx.db.patch<PlanRow>("plans", id, { order: i });
    ctx.changed("plans");
    return { ok: true };
  })
  .post("plans/:id/attach", async (ctx, p, input) => {
    const plan = await planOr404(ctx, p.id!);
    const me = await hostOf(ctx, plan.spaceId);
    const s = await ctx.db.get<SessionRow>("sessions", str(input.sessionId, 60));
    if (!s || s.spaceId !== plan.spaceId) throw new NotFoundError("Pick a session in this space");
    if (s.planId && s.planId !== plan.id) throw new Error("That session already has a plan");
    if (plan.sessionId && plan.sessionId !== s.id) {
      const old = await ctx.db.get<SessionRow>("sessions", plan.sessionId);
      if (old) await ctx.db.patch<SessionRow>("sessions", old.id, { planId: null });
    }
    const prepared = await prepare(ctx, plan, s, me.id);
    await ctx.db.patch<SessionRow>("sessions", s.id, { planId: plan.id, prepared });
    const next = await ctx.db.patch<PlanRow>("plans", plan.id, { sessionId: s.id, updatedAt: now(ctx) });
    // "Also copy to…": an independent copy for another space's session.
    for (const target of Array.isArray(input.copyTo) ? (input.copyTo as string[]) : []) {
      const ts = await ctx.db.get<SessionRow>("sessions", target);
      if (!ts || ts.planId) continue;
      await hostOf(ctx, ts.spaceId);
      const copy: PlanRow = { ...plan, id: newId("pl"), spaceId: ts.spaceId, sessionId: ts.id, status: "draft", version: 1, createdAt: now(ctx), updatedAt: now(ctx), blocks: plan.blocks.map((b) => ({ ...b, id: newId("b") })) };
      await ctx.db.put("plans", copy);
      await ctx.db.patch<SessionRow>("sessions", ts.id, { planId: copy.id, prepared: await prepare(ctx, copy, ts, me.id) });
    }
    ctx.changed("plans", "sessions", "posts");
    return { ...next, status: derivePlanStatus(next), prepared };
  })
  .post("plans/:id/detach", async (ctx, p) => {
    const plan = await planOr404(ctx, p.id!);
    await hostOf(ctx, plan.spaceId);
    if (plan.sessionId) {
      const s = await ctx.db.get<SessionRow>("sessions", plan.sessionId);
      if (s) {
        if (s.prepared?.agendaPostId) await ctx.db.del("posts", s.prepared.agendaPostId);
        if (s.prepared?.reminderId) await ctx.db.del("scheduled_reminders", s.prepared.reminderId);
        await ctx.db.patch<SessionRow>("sessions", s.id, { planId: null, prepared: { roomId: s.prepared?.roomId } });
      }
    }
    await ctx.db.patch<PlanRow>("plans", plan.id, { sessionId: null });
    ctx.changed("plans", "sessions", "posts");
    return { ok: true };
  })
  .post("plans/:id/delete", async (ctx, p) => {
    const plan = await planOr404(ctx, p.id!);
    await hostOf(ctx, plan.spaceId);
    if (plan.sessionId) {
      const s = await ctx.db.get<SessionRow>("sessions", plan.sessionId);
      if (s) await ctx.db.patch<SessionRow>("sessions", s.id, { planId: null });
    }
    await ctx.db.del("plans", plan.id);
    ctx.changed("plans");
    return { ok: true };
  })
  .get("sessions/:id/plan", async (ctx, p) => {
    const me = await requireMe(ctx);
    const s = await ctx.db.get<SessionRow>("sessions", p.id!);
    if (!s?.planId) return null;
    const plan = await ctx.db.get<PlanRow>("plans", s.planId);
    if (!plan) return null;
    const m = await ctx.db.get<MemberRow>("memberships", `${s.spaceId}:${me.id}`);
    const isHost = !!m && (m.role === "host" || m.role === "cohost");
    // Host notes never leave the host; members get titles of visible blocks only.
    const blocks = plan.blocks.filter((b) => isHost || b.visible).map((b) => (isHost ? b : { ...b, hostNotes: "", resources: [] }));
    return { planId: plan.id, title: plan.title, blocks, rail: s.rail ?? { current: 0, startedAt: null, extensions: {} }, isHost, sessionId: s.id, pages: s.prepared?.pages ?? {} };
  })
  .post("sessions/:id/rail", async (ctx, p, input) => {
    const s = await ctx.db.get<SessionRow>("sessions", p.id!);
    if (!s) throw new NotFoundError("Session not found");
    await hostOf(ctx, s.spaceId);
    const rail = { current: Math.max(0, Number(input.current) || 0), startedAt: str(input.startedAt, 40) || null, extensions: (input.extensions as Record<string, number>) ?? {} };
    await ctx.db.patch<SessionRow>("sessions", s.id, { rail });
    ctx.changed("sessions");
    return rail;
  })
  // "Open board" for a session: its prepared room, created on first use.
  .post("sessions/:id/room", async (ctx, p) => {
    const me = await requireMe(ctx);
    const s = await ctx.db.get<SessionRow>("sessions", p.id!);
    if (!s) throw new NotFoundError("Session not found");
    if (!(await ctx.db.get("memberships", `${s.spaceId}:${me.id}`))) throw new ForbiddenError("You're not in this space");
    let room = s.prepared?.roomId ? await ctx.db.get<RoomRow>("rooms", s.prepared.roomId) : undefined;
    if (room?.endedAt) room = undefined;
    if (!room) {
      const plan = s.planId ? await ctx.db.get<PlanRow>("plans", s.planId) : null;
      const host = (await ctx.db.list<MemberRow>("memberships", (m) => m.spaceId === s.spaceId && m.role === "host"))[0]?.userId ?? me.id;
      if (plan) {
        const prepared = await prepare(ctx, plan, { ...s, prepared: { ...(s.prepared ?? {}), roomId: undefined } }, host);
        await ctx.db.patch<SessionRow>("sessions", s.id, { prepared });
        room = await ctx.db.get<RoomRow>("rooms", prepared.roomId!);
      } else {
        const code = roomCode();
        room = { id: newId("rm"), spaceId: s.spaceId, sessionId: s.id, slug: code.toLowerCase(), code, name: s.title, capacity: ROOM_CAPACITY, guestJoin: false, createdBy: host, createdAt: now(ctx), endedAt: null } as RoomRow;
        await ctx.db.put("rooms", room);
        await ctx.db.patch<SessionRow>("sessions", s.id, { prepared: { ...(s.prepared ?? {}), roomId: room.id } });
      }
    }
    ctx.changed("rooms");
    return room;
  })
  .post("rooms/:id/attendance", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const id = `${p.id}:${me.id}`;
    const cur = await ctx.db.get<Row & { joinedAt: string; leftAt: string | null }>("attendance_events", id);
    if (input.event === "leave") {
      if (cur && !cur.leftAt) await ctx.db.patch("attendance_events", id, { leftAt: now(ctx) });
    } else if (!cur) await ctx.db.put("attendance_events", { id, roomId: p.id!, userId: me.id, joinedAt: now(ctx), leftAt: null });
    else if (cur.leftAt) await ctx.db.patch("attendance_events", id, { leftAt: null });
    return { ok: true };
  })
  .get("sessions/:id/wrapup", async (ctx, p) => {
    const s = await ctx.db.get<SessionRow>("sessions", p.id!);
    if (!s) throw new NotFoundError("Session not found");
    await hostOf(ctx, s.spaceId);
    const plan = s.planId ? await ctx.db.get<PlanRow>("plans", s.planId) : null;
    const space = await ctx.db.get<SpaceRow>("spaces", s.spaceId);
    const members = await ctx.db.list<MemberRow>("memberships", (m) => m.spaceId === s.spaceId && m.role !== "host" && m.role !== "cohost");
    const users = new Map((await ctx.db.list<User & Row>("users")).map((u) => [u.id, u]));
    const late = new Set((await ctx.db.list<Row & { sessionId: string; userId: string }>("attendance_exceptions", (x) => x.sessionId === s.id)).map((x) => x.userId));
    const att = attendanceFromPresence(members.map((m) => m.userId), await attendanceMinutes(ctx, s.id), late);
    const homework = plan?.blocks.find((b) => b.type === "handout" && /homework/i.test(b.title));
    const nextPlan = (await ctx.db.list<PlanRow>("plans", (x) => x.spaceId === s.spaceId && x.id !== plan?.id && x.status !== "taught")).sort((a, b) => a.order - b.order)[0];
    return { session: s, space: { id: space?.id, name: space?.name, slug: space?.slug }, plan, policy: policyFor(space), attendance: att.map((a) => ({ ...a, name: users.get(a.memberId)?.name ?? "?" })), homework: homework ? { title: homework.memberText || homework.title } : null, nextPlan: nextPlan ? { id: nextPlan.id, title: nextPlan.title } : null };
  })
  .post("sessions/:id/wrapup", async (ctx, p, input) => {
    const s = await ctx.db.get<SessionRow>("sessions", p.id!);
    if (!s) throw new NotFoundError("Session not found");
    const me = await hostOf(ctx, s.spaceId);
    const plan = s.planId ? await ctx.db.get<PlanRow>("plans", s.planId) : null;
    const outcomes = (input.outcomes ?? {}) as Record<string, "done" | "partly" | "skipped">;
    const rows = (Array.isArray(input.attendance) ? input.attendance : []) as { memberId: string; minutes: number; status: AttendanceStatus }[];
    await writeLogLines(ctx, s, rows);
    if (plan && input.markTaught !== false) await ctx.db.patch<PlanRow>("plans", plan.id, { status: "taught" });
    // Carry partly/skipped blocks into the next plan, or keep them in a tray.
    const carried = plan ? carryOver(outcomes, plan.blocks, new Set(Array.isArray(input.carry) ? (input.carry as string[]) : [])) : [];
    if (carried.length) {
      const next = (await ctx.db.list<PlanRow>("plans", (x) => x.spaceId === s.spaceId && x.id !== plan?.id && x.status !== "taught")).sort((a, b) => a.order - b.order)[0];
      if (next) await ctx.db.patch<PlanRow>("plans", next.id, { blocks: [...carried, ...next.blocks], version: next.version + 1 });
      else await ctx.db.put("carry_tray", { id: s.spaceId, blocks: carried });
    }
    if (input.postRecap !== false) {
      const covered = plan ? plan.blocks.filter((b) => (outcomes[b.id] ?? "done") !== "skipped").map((b) => b.title) : [];
      await ctx.db.put("posts", { id: sortableId("po"), spaceId: s.spaceId, kind: "recap", title: `Recap: ${plan?.title ?? s.title}`, body: [`What we covered: ${covered.join(", ") || "—"}.`, str(input.recapText, 2000)].filter(Boolean).join("\n\n"), mustRead: false, createdBy: me.id, createdAt: now(ctx), attachments: [{ name: "Board notes.pdf", meta: "from the room", kind: "file" }] });
    }
    const hw = input.homework as { title?: string; dueAt?: string } | undefined;
    if (hw?.title) await ctx.db.put("posts", { id: sortableId("po"), spaceId: s.spaceId, kind: "task", title: str(hw.title, 160), body: "", mustRead: false, dueAt: str(hw.dueAt, 40) || new Date(ctx.now().getTime() + 2 * 86_400_000).toISOString(), createdBy: me.id, createdAt: now(ctx), attachments: [] });
    await ctx.db.patch<SessionRow>("sessions", s.id, { wrapped: true });
    ctx.changed("posts", "plans", "sessions", "session_log");
    const billable = sessionLogLines(rows, policyFor(await ctx.db.get<SpaceRow>("spaces", s.spaceId))).filter((l) => l.billable);
    return { ok: true, lines: rows.length, billable: billable.length, totalCents: billable.reduce((n, l) => n + l.amountCents, 0), carried: carried.length };
  });
