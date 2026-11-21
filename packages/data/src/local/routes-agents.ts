// M9 resources: the agent link protocol (handoff §12) and the host's side of it: links and seats,
// prep tasks per space, the draft layer, "Needs you" questions and "Ready for you" review.
// Agents create drafts only. Mirrors /api/v1 and the PHP /a/<token> endpoints (M10).
import {
  BUILT_IN,
  DONE_WHEN,
  LINK_DAYS,
  MAX_AGENTS_PER_ROOM,
  monthKey,
  newId,
  nextMarkdown,
  PREP_TEMPLATES,
  redact,
  roomCode,
  ROOM_CAPACITY,
  seatFromRequest,
  sortableId,
  takeToken,
  validateDraft,
  type DraftKind,
  type LinkScope,
  type NextView,
  type PrepStatus,
  type PrepTemplate,
  type User
} from "@loft/core";
import { ForbiddenError, NotFoundError } from "../types";
import type { Row } from "./db";
import { requireMe, routes, str, type LocalCtx } from "./routes";
import { buildDrafts } from "./routes-money";

export interface LinkRow extends Row { hostId: string; scope: LinkScope; scopeId: string | null; token: string; expiresAt: string; paused: boolean; liveEdits: boolean; createdAt: string }
export interface SeatRow extends Row { linkId: string; hostId: string; name: string; runtime: string; version: string; seatNo: number; status: "pending" | "approved" | "revoked"; createdAt: string; lastSeenAt: string; bucket?: { tokens: number; at: number } | null }
export interface TaskRow extends Row {
  hostId: string; spaceId: string; sessionId: string | null; roomId: string | null; template: PrepTemplate; title: string; brief: string; attachments: string[];
  readyBy: string | null; who: string | null; post: boolean; status: PrepStatus; seatId: string | null; claimedAt: string | null; doneAt: string | null; minutes: number;
  report: string; question: { text: string; options: string[]; answer: string | null; at: string } | null; feedback: string | null; createdAt: string;
}
export interface DraftRow extends Row { taskId: string; hostId: string; seatId: string | null; kind: DraftKind; title: string; sub: string; payload: Record<string, unknown>; status: "pending" | "accepted" | "rejected"; reason: string | null; createdAt: string }
interface EventRow extends Row { hostId: string; taskId: string | null; seatId: string | null; linkId: string | null; kind: string; text: string; minutes: number; at: string }
interface SpaceRow extends Row { name: string; slug: string; code: string; mode: string; createdBy: string }
interface SessionRow extends Row { spaceId: string; title: string; startsAt: string; minutes: number; status: string; planId?: string | null; prepared?: { roomId?: string } }
interface MemberRow extends Row { spaceId: string; userId: string; role: string }

const DAY = 86_400_000;
const nowIso = (ctx: LocalCtx) => ctx.now().toISOString();
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

class AgentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type EventInput = { hostId: string; taskId: string | null; seatId: string | null; linkId: string | null; kind: string; text: string; minutes: number };
async function event(ctx: LocalCtx, e: EventInput) {
  const row: EventRow = { id: sortableId("ae"), at: nowIso(ctx), ...e };
  await ctx.db.put("agent_events", row);
}

async function hostSpaces(ctx: LocalCtx, hostId: string) {
  const ids = new Set((await ctx.db.list<MemberRow>("memberships", (m) => m.userId === hostId && (m.role === "host" || m.role === "cohost"))).map((m) => m.spaceId));
  return ctx.db.list<SpaceRow>("spaces", (s) => ids.has(s.id));
}

async function linkLabel(ctx: LocalCtx, l: LinkRow) {
  if (l.scope === "workspace") return "Workspace";
  if (l.scope === "space") return (await ctx.db.get<SpaceRow>("spaces", l.scopeId ?? ""))?.name ?? "Space";
  return (await ctx.db.get<Row & { name: string }>("rooms", l.scopeId ?? ""))?.name ?? "Room";
}

/** Which tasks a link can see: the whole workspace, one space, or one room's session. */
async function tasksFor(ctx: LocalCtx, l: LinkRow) {
  const all = await ctx.db.list<TaskRow>("prep_tasks", (t) => t.hostId === l.hostId);
  if (l.scope === "workspace") return all;
  if (l.scope === "space") return all.filter((t) => t.spaceId === l.scopeId);
  return all.filter((t) => t.roomId === l.scopeId);
}

/** The room a task's board drafts land in: the session's prepared room, created on first use. */
async function roomFor(ctx: LocalCtx, t: TaskRow): Promise<string | null> {
  if (t.roomId) return t.roomId;
  if (!t.sessionId) return null;
  const s = await ctx.db.get<SessionRow>("sessions", t.sessionId);
  if (!s) return null;
  if (s.prepared?.roomId && (await ctx.db.get("rooms", s.prepared.roomId))) return s.prepared.roomId;
  const code = roomCode();
  const room = { id: newId("rm"), spaceId: s.spaceId, sessionId: s.id, slug: code.toLowerCase(), code, name: s.title, capacity: ROOM_CAPACITY, guestJoin: false, createdBy: t.hostId, createdAt: nowIso(ctx), endedAt: null };
  await ctx.db.put("rooms", room);
  await ctx.db.put("sessions", { ...s, prepared: { ...(s.prepared ?? {}), roomId: room.id } });
  return room.id;
}

// ---- the protocol (what an agent calls) ----

interface AgentIdentity { userAgent?: string; name?: string }

/** Resolve token → link + seat, creating the seat on first contact. Enforces expiry, approval, revocation and 60/min. */
async function agentAuth(ctx: LocalCtx, token: string, input: Record<string, unknown>, opts: { allowPending?: boolean } = {}) {
  const link = (await ctx.db.list<LinkRow>("agent_links", (l) => l.token === token))[0];
  if (!link) throw new AgentError("Unknown agent link", 404);
  if (Date.parse(link.expiresAt) < ctx.now().getTime()) throw new AgentError("This agent link expired. Ask the host for a new one.", 410);
  const id = (input.agent ?? {}) as AgentIdentity;
  const who = seatFromRequest(id.userAgent ?? null, id.name ?? null);
  const seats = await ctx.db.list<SeatRow>("agent_seats", (s) => s.linkId === link.id);
  let seat = seats.find((s) => s.runtime === who.runtime && s.name === who.name);
  if (!seat) {
    seat = { id: newId("seat"), linkId: link.id, hostId: link.hostId, ...who, seatNo: seats.filter((s) => s.runtime === who.runtime).length + 1, status: link.scope === "workspace" ? "pending" : "approved", createdAt: nowIso(ctx), lastSeenAt: nowIso(ctx), bucket: null };
    await ctx.db.put("agent_seats", seat);
    await event(ctx, { hostId: link.hostId, taskId: null, seatId: seat.id, linkId: link.id, kind: "seat", text: `${seat.name} connected (${seat.runtime}${seat.version ? ` ${seat.version}` : ""})`, minutes: 0 });
    ctx.changed("agent_seats");
  }
  if (seat.status === "revoked") throw new AgentError("This seat was revoked by the host.", 403);
  if (seat.status === "pending" && !opts.allowPending) throw new AgentError("Waiting for the host to approve this seat.", 403);
  const rate = takeToken(seat.bucket, ctx.now().getTime());
  await ctx.db.patch<SeatRow>("agent_seats", seat.id, { bucket: rate.bucket, lastSeenAt: nowIso(ctx) });
  if (!rate.ok) throw new AgentError(`Too many requests. Try again in ${Math.ceil(rate.retryAfterMs / 1000)} s.`, 429);
  return { link, seat };
}

async function nextView(ctx: LocalCtx, link: LinkRow, seat: SeatRow | null): Promise<NextView> {
  const tasks = (await tasksFor(ctx, link)).sort((a, b) => (a.readyBy ?? "9").localeCompare(b.readyBy ?? "9") || a.createdAt.localeCompare(b.createdAt));
  const queued = tasks.filter((t) => t.status === "queued" || t.status === "changes");
  const first = queued[0];
  const inputs = async (t: TaskRow) => {
    const out = [...t.attachments];
    const recaps = await ctx.db.list<Row & { spaceId: string; kind: string }>("posts", (p) => p.spaceId === t.spaceId && p.kind === "recap");
    if (recaps.length) out.push(`last ${Math.min(3, recaps.length)} recap${recaps.length === 1 ? "" : "s"}`);
    return out;
  };
  const sessionTitle = async (t: TaskRow) => (t.sessionId ? (await ctx.db.get<SessionRow>("sessions", t.sessionId)) : undefined);
  const s = first ? await sessionTitle(first) : undefined;
  return {
    title: await linkLabel(ctx, link),
    seat: seat ? { name: seat.name, runtime: seat.runtime, version: seat.version } : null,
    seatNo: seat?.seatNo ?? null,
    expiresAt: link.expiresAt,
    paused: link.paused,
    next: first ? { title: `${first.title}${s ? ` · ${when(s.startsAt)}` : ""}`, when: s?.startsAt ?? "", readyBy: first.readyBy ? when(first.readyBy) : "when you can", inputs: await inputs(first), doneWhen: first.feedback ? `${DONE_WHEN[first.template]} · host asked: ${first.feedback}` : DONE_WHEN[first.template] } : null,
    queue: queued.slice(1).map((t) => ({ title: t.title, note: t.readyBy ? `ready by ${when(t.readyBy)}` : "queued" })),
    rejected: (await ctx.db.list<DraftRow>("agent_drafts", (d) => d.status === "rejected" && !!d.reason && tasks.some((t) => t.id === d.taskId))).slice(-5).map((d) => ({ title: d.title, reason: d.reason! }))
  };
}

function wrap<T>(fn: () => Promise<T>): Promise<T | { error: string; status: number }> {
  return fn().catch((e: unknown) => {
    if (e instanceof AgentError) return { error: e.message, status: e.status };
    throw e;
  });
}

routes
  .get("a/:token", (ctx, p, input) => wrap(async () => {
    const { link, seat } = await agentAuth(ctx, p.token!, input, { allowPending: true });
    return { markdown: nextMarkdown(await nextView(ctx, link, seat.status === "approved" ? seat : null)) };
  }))
  .get("a/:token/next.json", (ctx, p, input) => wrap(async () => {
    const { link, seat } = await agentAuth(ctx, p.token!, input, { allowPending: true });
    return { capabilities: "v1", ...(await nextView(ctx, link, seat)), seatStatus: seat.status };
  }))
  .post("a/:token/claim", (ctx, p, input) => wrap(async () => {
    const { link, seat } = await agentAuth(ctx, p.token!, input);
    if (link.paused) return { paused: true, task: null };
    const tasks = (await tasksFor(ctx, link)).filter((t) => (t.status === "queued" || t.status === "changes") && (!t.who || t.who === seat.id)).sort((a, b) => (a.readyBy ?? "9").localeCompare(b.readyBy ?? "9") || a.createdAt.localeCompare(b.createdAt));
    const t = tasks[0];
    if (!t) return { paused: false, task: null };
    const roomId = PREP_TEMPLATES.find((x) => x.id === t.template)?.output.includes("board_ops") ? await roomFor(ctx, t) : t.roomId;
    if (roomId) {
      const busy = new Set((await ctx.db.list<TaskRow>("prep_tasks", (x) => x.roomId === roomId && x.status === "working" && x.id !== t.id)).map((x) => x.seatId));
      if (busy.size >= MAX_AGENTS_PER_ROOM && !busy.has(seat.id)) throw new AgentError(`At most ${MAX_AGENTS_PER_ROOM} agents per room. Try another task.`, 409);
    }
    const next: TaskRow = { ...t, status: "working", seatId: seat.id, claimedAt: nowIso(ctx), roomId };
    await ctx.db.put("prep_tasks", next);
    await event(ctx, { hostId: t.hostId, taskId: t.id, seatId: seat.id, linkId: link.id, kind: "claim", text: `claimed ${t.title}`, minutes: 0 });
    ctx.changed("prep_tasks");
    const s = t.sessionId ? await ctx.db.get<SessionRow>("sessions", t.sessionId) : undefined;
    return { paused: false, task: { id: t.id, template: t.template, title: t.title, brief: t.brief, attachments: t.attachments, readyBy: t.readyBy, session: s ? { title: s.title, startsAt: s.startsAt, minutes: s.minutes } : null, feedback: t.feedback, done_when: DONE_WHEN[t.template], context: [`/context/${t.id}`] } };
  }))
  .get("a/:token/context/:id", (ctx, p, input) => wrap(async () => {
    const { link } = await agentAuth(ctx, p.token!, input);
    const t = (await tasksFor(ctx, link)).find((x) => x.id === p.id);
    if (!t) throw new AgentError("No such task on this link", 404);
    const space = await ctx.db.get<SpaceRow>("spaces", t.spaceId);
    const plans = await ctx.db.list<Row & { spaceId: string; title: string; blocks: { title: string; minutes: number; memberText: string }[] }>("plans", (x) => x.spaceId === t.spaceId);
    const recaps = (await ctx.db.list<Row & { spaceId: string; kind: string; title: string; body: string; createdAt: string }>("posts", (x) => x.spaceId === t.spaceId && x.kind === "recap")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3);
    const files = await ctx.db.list<Row & { spaceId: string; name: string }>("files", (x) => x.spaceId === t.spaceId);
    let board: { anchor: { x: number; y: number } } | null = null;
    if (t.roomId) {
      const ops = await ctx.db.opsSince(t.roomId, 0);
      const pages = ops.filter((o) => o.kind === "add" && (o.payload as { page?: unknown }).page).map((o) => (o.payload as { page: { x: number; y: number } }).page);
      board = { anchor: pages[0] ? { x: pages[0].x + 40, y: pages[0].y + 60 } : { x: 80, y: 80 } };
    }
    return redact({ task: { id: t.id, title: t.title, brief: t.brief }, space: { name: space?.name, mode: space?.mode, code: space?.code }, plans: plans.map((x) => ({ title: x.title, blocks: x.blocks.map((b) => ({ title: b.title, minutes: b.minutes, memberText: b.memberText })) })), recaps: recaps.map((r) => ({ title: r.title, body: r.body, at: r.createdAt })), files: files.map((f) => ({ name: f.name })), board });
  }))
  .post("a/:token/drafts", (ctx, p, input) => wrap(async () => {
    const { link, seat } = await agentAuth(ctx, p.token!, input);
    if (link.paused) throw new AgentError("The host paused agents. Stop and check back later.", 423);
    const t = (await tasksFor(ctx, link)).find((x) => x.id === input.taskId);
    if (!t || t.seatId !== seat.id) throw new AgentError("Claim the task first", 409);
    const kind = String(input.kind) as DraftKind;
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const err = validateDraft(kind, payload);
    if (err) throw new AgentError(err, 422);
    if (kind === "board_ops") payload.ops = (payload.ops as { kind: string; payload: Record<string, unknown> }[]).map((o) => (o.kind === "add" && o.payload.obj ? { ...o, payload: { ...o.payload, obj: { ...(o.payload.obj as object), draft: true, by: `agent:${seat.name}` } } } : o));
    const d: DraftRow = { id: newId("dr"), taskId: t.id, hostId: t.hostId, seatId: seat.id, kind, title: str(input.title, 120) || kind, sub: str(input.sub, 160), payload, status: "pending", reason: null, createdAt: nowIso(ctx) };
    await ctx.db.put("agent_drafts", d);
    await event(ctx, { hostId: t.hostId, taskId: t.id, seatId: seat.id, linkId: link.id, kind: "draft", text: `added ${d.title.toLowerCase().startsWith("section") ? `section '${d.title.split(" · ")[1]}'` : d.title}`, minutes: 0 });
    ctx.changed("agent_drafts");
    return { id: d.id, status: "pending" };
  }))
  .post("a/:token/report", (ctx, p, input) => wrap(async () => {
    const { link, seat } = await agentAuth(ctx, p.token!, input);
    const t = (await tasksFor(ctx, link)).find((x) => x.id === input.taskId);
    if (!t || t.seatId !== seat.id) throw new AgentError("Claim the task first", 409);
    const status = input.status === "done" ? "done" : input.status === "blocker" ? "blocker" : "progress";
    const minutes = Math.max(0, Math.min(600, Math.round(Number(input.minutes) || 0)));
    const note = str(input.note, 2000);
    const patch: Partial<TaskRow> = { minutes: t.minutes + minutes };
    if (status === "done") Object.assign(patch, { status: "ready", doneAt: nowIso(ctx), report: note || t.report, feedback: null });
    if (status === "blocker") Object.assign(patch, { status: "needs_you", question: { text: note || "I'm blocked.", options: [], answer: null, at: nowIso(ctx) } });
    await ctx.db.patch<TaskRow>("prep_tasks", t.id, patch);
    await event(ctx, { hostId: t.hostId, taskId: t.id, seatId: seat.id, linkId: link.id, kind: status, text: status === "done" ? `finished ${t.title}` : note || status, minutes });
    ctx.changed("prep_tasks", "agent_events");
    return { ok: true };
  }))
  .post("a/:token/ask", (ctx, p, input) => wrap(async () => {
    const { link, seat } = await agentAuth(ctx, p.token!, input);
    const t = (await tasksFor(ctx, link)).find((x) => x.id === input.taskId);
    if (!t || t.seatId !== seat.id) throw new AgentError("Claim the task first", 409);
    const options = (Array.isArray(input.options) ? input.options : []).filter((o): o is string => typeof o === "string").slice(0, 4);
    await ctx.db.patch<TaskRow>("prep_tasks", t.id, { status: "needs_you", question: { text: str(input.question, 500), options, answer: null, at: nowIso(ctx) } });
    await event(ctx, { hostId: t.hostId, taskId: t.id, seatId: seat.id, linkId: link.id, kind: "ask", text: `asked: ${str(input.question, 120)}`, minutes: 0 });
    await ctx.db.put("notifications", { id: sortableId("nt"), userId: t.hostId, kind: "agent", title: `${seat.name} needs you · ${t.title}`, sub: str(input.question, 120), link: "/agents", createdAt: nowIso(ctx), readAt: null });
    ctx.changed("prep_tasks", "notifications");
    return { ok: true, next: "moved on: claim the next task" };
  }))
  .get("a/:token/changes", (ctx, p, input) => wrap(async () => {
    const { link } = await agentAuth(ctx, p.token!, input);
    const since = str(input.since, 40) || new Date(0).toISOString();
    const ids = new Set((await tasksFor(ctx, link)).map((t) => t.id));
    const evs = await ctx.db.list<EventRow>("agent_events", (e) => !!e.taskId && ids.has(e.taskId) && e.at > since && ["answer", "accept", "reject", "changes", "pause"].includes(e.kind));
    return { paused: link.paused, changes: evs.map((e) => ({ at: e.at, kind: e.kind, taskId: e.taskId, text: e.text })) };
  }));

// ---- the host's side ----

async function seatViews(ctx: LocalCtx, hostId: string) {
  const seats = await ctx.db.list<SeatRow>("agent_seats", (s) => s.hostId === hostId && s.status !== "revoked");
  const links = new Map((await ctx.db.list<LinkRow>("agent_links", (l) => l.hostId === hostId)).map((l) => [l.id, l]));
  const tasks = await ctx.db.list<TaskRow>("prep_tasks", (t) => t.hostId === hostId);
  const weekAgo = new Date(ctx.now().getTime() - 7 * DAY).toISOString();
  const evs = await ctx.db.list<EventRow>("agent_events", (e) => e.hostId === hostId && e.at > weekAgo);
  const out = [];
  for (const s of seats.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const l = links.get(s.linkId);
    const mine = tasks.filter((t) => t.seatId === s.id);
    const state = s.status === "pending" ? "new" : mine.some((t) => t.status === "needs_you") ? "needs you" : mine.some((t) => t.status === "working") ? "active" : "idle";
    out.push({ id: s.id, name: s.name, runtime: s.runtime, version: s.version, seatNo: s.seatNo, status: s.status, linkLabel: l ? `${await linkLabel(ctx, l)} link` : "link", state, lastSeenAt: s.lastSeenAt, minutesWeek: evs.filter((e) => e.seatId === s.id).reduce((n, e) => n + e.minutes, 0) });
  }
  return out;
}

async function taskView(ctx: LocalCtx, t: TaskRow) {
  const seat = t.seatId ? await ctx.db.get<SeatRow>("agent_seats", t.seatId) : undefined;
  const drafts = await ctx.db.list<DraftRow>("agent_drafts", (d) => d.taskId === t.id);
  const s = t.sessionId ? await ctx.db.get<SessionRow>("sessions", t.sessionId) : undefined;
  const space = await ctx.db.get<SpaceRow>("spaces", t.spaceId);
  return {
    id: t.id, template: t.template, title: t.title, status: t.status, brief: t.brief, readyBy: t.readyBy, minutes: t.minutes, report: t.report, question: t.question, feedback: t.feedback,
    seat: seat ? { id: seat.id, name: seat.name } : null,
    session: s ? { id: s.id, title: s.title, startsAt: s.startsAt } : null,
    space: space ? { id: space.id, name: space.name, slug: space.slug, code: space.code } : null,
    roomId: t.roomId,
    pending: drafts.filter((d) => d.status === "pending").length,
    drafts: drafts.length,
    sub: t.status === "working" ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"} so far${t.roomId ? " · drafting in the room" : ""}` : t.status === "queued" ? (t.readyBy ? `ready by ${when(t.readyBy)}` : "queued") : t.status === "needs_you" ? t.question?.text ?? "" : drafts.map((d) => d.sub || d.title).slice(0, 2).join(" · ")
  };
}

async function requireHostSpace(ctx: LocalCtx, spaceId: string) {
  const me = await requireMe(ctx);
  const m = await ctx.db.get<MemberRow>("memberships", `${spaceId}:${me.id}`);
  if (!m || (m.role !== "host" && m.role !== "cohost")) throw new ForbiddenError("Only hosts manage agents");
  return me;
}

async function linkFor(ctx: LocalCtx, hostId: string, scope: LinkScope, scopeId: string | null, create = true) {
  const found = (await ctx.db.list<LinkRow>("agent_links", (l) => l.hostId === hostId && l.scope === scope && l.scopeId === scopeId))[0];
  if (found || !create) return found ?? null;
  const l: LinkRow = { id: newId("al"), hostId, scope, scopeId, token: newId("").replace(/^_/, "") + newId("").replace(/^_/, ""), expiresAt: new Date(ctx.now().getTime() + LINK_DAYS * DAY).toISOString(), paused: false, liveEdits: false, createdAt: nowIso(ctx) };
  await ctx.db.put("agent_links", l);
  return l;
}

async function applyDraft(ctx: LocalCtx, me: User & Row, t: TaskRow, d: DraftRow) {
  if (d.kind === "board_ops") {
    const roomId = (await roomFor(ctx, t)) ?? null;
    if (!roomId) throw new Error("No board for this task");
    const ops = (d.payload.ops as { kind: string; payload: Record<string, unknown> }[]).map((o) => {
      if (o.kind === "add" && o.payload.obj) {
        const { draft: _d, ...obj } = o.payload.obj as Record<string, unknown>;
        return { actor: me.id, ts: Date.now(), kind: "add", payload: { ...o.payload, obj: { ...obj, by: me.id } } };
      }
      return { actor: me.id, ts: Date.now(), kind: o.kind, payload: o.payload };
    });
    await ctx.db.appendOps(roomId, ops as never);
    ctx.opsChanged?.(roomId);
  } else if (d.kind === "plan") {
    const id = newId("pl");
    await ctx.db.put("plans", { id, spaceId: t.spaceId, title: String(d.payload.title ?? t.title), minutes: Number(d.payload.minutes ?? 60), objective: "", tags: [], unit: "Agent drafts", order: 99, status: "draft", aiDraft: true, blocks: d.payload.blocks, sessionId: t.sessionId, version: 1, createdAt: nowIso(ctx), updatedAt: nowIso(ctx) });
    if (t.sessionId) await ctx.db.patch("sessions", t.sessionId, { planId: id });
    ctx.changed("plans", "sessions");
  } else if (d.kind === "post") {
    await ctx.db.put("posts", { id: sortableId("po"), spaceId: t.spaceId, kind: "post", title: String(d.payload.title ?? ""), body: String(d.payload.body ?? ""), mustRead: false, createdBy: me.id, createdAt: nowIso(ctx), attachments: [] });
    ctx.changed("posts");
  } else if (d.kind === "check") {
    await ctx.db.put("checks", { id: newId("ck"), spaceId: t.spaceId, title: String(d.payload.title ?? t.title), instructions: "", questions: d.payload.questions, status: "draft", openAt: null, closeAt: null, timeLimitMin: 10, maxAttempts: 1, shuffle: true, integrity: true, createdAt: nowIso(ctx), createdBy: me.id });
    ctx.changed("checks");
  } else if (d.kind === "invoice_draft") {
    await buildDrafts(ctx, me.id, monthKey(ctx.now()));
  }
}

routes
  .get("agents", async (ctx) => {
    const me = await requireMe(ctx);
    const spaces = await hostSpaces(ctx, me.id);
    const links = await ctx.db.list<LinkRow>("agent_links", (l) => l.hostId === me.id);
    const tasks = await ctx.db.list<TaskRow>("prep_tasks", (t) => t.hostId === me.id);
    const views = await Promise.all(tasks.map((t) => taskView(ctx, t)));
    const today = new Date(ctx.now());
    today.setHours(0, 0, 0, 0);
    const working = views.filter((v) => v.status === "working");
    const ready = views.filter((v) => v.status === "ready" && v.pending > 0);
    const evs = (await ctx.db.list<EventRow>("agent_events", (e) => e.hostId === me.id)).sort((a, b) => b.at.localeCompare(a.at));
    return {
      scopes: [{ scope: "workspace", scopeId: null, label: "Whole workspace" }, ...spaces.map((s) => ({ scope: "space", scopeId: s.id, label: `${s.name} · space` }))],
      links: await Promise.all(links.map(async (l) => ({ id: l.id, scope: l.scope, scopeId: l.scopeId, label: await linkLabel(ctx, l), token: l.token, expiresAt: l.expiresAt, paused: l.paused, liveEdits: l.liveEdits }))),
      seats: await seatViews(ctx, me.id),
      working: working.map((w) => ({ ...w, doneToday: tasks.filter((t) => t.seatId === w.seat?.id && t.doneAt && t.doneAt >= today.toISOString()).length, totalToday: tasks.filter((t) => t.seatId === w.seat?.id && (t.claimedAt ?? "") >= today.toISOString()).length + tasks.filter((t) => t.seatId === w.seat?.id && t.status === "queued").length })),
      needsYou: views.filter((v) => v.status === "needs_you"),
      ready: { count: ready.reduce((n, r) => n + r.pending, 0), tasks: ready },
      queued: views.filter((v) => v.status === "queued" || v.status === "changes").length,
      activity: evs.slice(0, 8).map((e) => ({ at: e.at, text: e.text, kind: e.kind })),
      builtIn: BUILT_IN,
      paused: links.length > 0 && links.every((l) => l.paused)
    };
  })
  .post("agents/links", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const scope = (["workspace", "space", "room"] as const).find((s) => s === input.scope) ?? "workspace";
    const scopeId = scope === "workspace" ? null : str(input.scopeId, 80);
    if (scope === "space") await requireHostSpace(ctx, scopeId!);
    const l = await linkFor(ctx, me.id, scope, scopeId);
    ctx.changed("agent_links");
    return l;
  })
  .post("agents/links/:id", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const l = await ctx.db.get<LinkRow>("agent_links", p.id!);
    if (!l || l.hostId !== me.id) throw new NotFoundError("Link not found");
    const patch: Partial<LinkRow> = {};
    if (typeof input.paused === "boolean") patch.paused = input.paused;
    if (typeof input.liveEdits === "boolean") patch.liveEdits = input.liveEdits;
    if (input.rotate === true) Object.assign(patch, { token: newId("").replace(/^_/, "") + newId("").replace(/^_/, ""), expiresAt: new Date(ctx.now().getTime() + LINK_DAYS * DAY).toISOString() });
    const next = await ctx.db.patch<LinkRow>("agent_links", l.id, patch);
    ctx.changed("agent_links");
    return next;
  })
  .post("agents/pause", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    for (const l of await ctx.db.list<LinkRow>("agent_links", (x) => x.hostId === me.id)) await ctx.db.patch<LinkRow>("agent_links", l.id, { paused: input.paused !== false });
    await event(ctx, { hostId: me.id, taskId: null, seatId: null, linkId: null, kind: "pause", text: input.paused !== false ? "host paused agents" : "host resumed agents", minutes: 0 });
    ctx.changed("agent_links");
    return { paused: input.paused !== false };
  })
  .post("agents/seats/:id", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const s = await ctx.db.get<SeatRow>("agent_seats", p.id!);
    if (!s || s.hostId !== me.id) throw new NotFoundError("Seat not found");
    const patch: Partial<SeatRow> = input.action === "approve" ? { status: "approved" } : input.action === "revoke" ? { status: "revoked" } : input.action === "rename" ? { name: str(input.name, 40) || s.name } : {};
    if (input.action === "revoke") for (const t of await ctx.db.list<TaskRow>("prep_tasks", (x) => x.seatId === s.id && x.status === "working")) await ctx.db.patch<TaskRow>("prep_tasks", t.id, { status: "queued", seatId: null });
    await ctx.db.patch<SeatRow>("agent_seats", s.id, patch);
    ctx.changed("agent_seats", "prep_tasks");
    return { ok: true };
  })
  .get("agents/read", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const links = await ctx.db.list<LinkRow>("agent_links", (l) => l.hostId === me.id);
    const l = links.find((x) => x.id === input.link) ?? links.find((x) => x.scope === "space") ?? links[0] ?? (await linkFor(ctx, me.id, "workspace", null))!;
    const seat = (await ctx.db.list<SeatRow>("agent_seats", (s) => s.linkId === l.id && s.status === "approved"))[0] ?? null;
    const view = await nextView(ctx, l, seat);
    return { markdown: nextMarkdown(view), json: { capabilities: "v1", ...view }, label: await linkLabel(ctx, l) };
  })
  .get("spaces/:id/prep", async (ctx, p) => {
    const me = await requireHostSpace(ctx, p.id!);
    const tasks = await ctx.db.list<TaskRow>("prep_tasks", (t) => t.spaceId === p.id);
    const views = await Promise.all(tasks.sort((a, b) => (a.readyBy ?? "9").localeCompare(b.readyBy ?? "9")).map((t) => taskView(ctx, t)));
    const t = ctx.now().toISOString();
    const next = (await ctx.db.list<SessionRow>("sessions", (s) => s.spaceId === p.id && s.startsAt > t && s.status !== "cancelled")).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    const forNext = next ? views.filter((v) => v.session?.id === next.id) : [];
    const link = (await linkFor(ctx, me.id, "space", p.id!, false)) ?? (await linkFor(ctx, me.id, "workspace", null, false));
    const seats = (await seatViews(ctx, me.id)).filter((s) => link && s.linkLabel.startsWith(link.scope === "workspace" ? "Workspace" : ""));
    const sessions = (await ctx.db.list<SessionRow>("sessions", (s) => s.spaceId === p.id && s.startsAt > t && s.status !== "cancelled")).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 8);
    return {
      next: next ? { id: next.id, title: next.title, startsAt: next.startsAt, done: forNext.filter((v) => ["ready", "accepted"].includes(v.status)).length, total: forNext.length } : null,
      ready: views.filter((v) => v.status === "ready" && v.pending > 0),
      working: views.filter((v) => v.status === "working"),
      needsYou: views.filter((v) => v.status === "needs_you"),
      queued: views.filter((v) => v.status === "queued" || v.status === "changes"),
      done: views.filter((v) => v.status === "accepted" || v.status === "rejected" || (v.status === "ready" && v.pending === 0)).slice(-5),
      templates: PREP_TEMPLATES,
      link: link ? { id: link.id, scope: link.scope, token: link.token, liveEdits: link.liveEdits, paused: link.paused } : null,
      seats,
      sessions: sessions.map((s) => ({ id: s.id, title: s.title, startsAt: s.startsAt }))
    };
  })
  .post("spaces/:id/prep", async (ctx, p, input) => {
    const me = await requireHostSpace(ctx, p.id!);
    const template = PREP_TEMPLATES.find((x) => x.id === input.template)?.id ?? "agenda";
    const sessionId = str(input.sessionId, 80) || null;
    const s = sessionId ? await ctx.db.get<SessionRow>("sessions", sessionId) : undefined;
    const label = PREP_TEMPLATES.find((x) => x.id === template)!;
    const title = str(input.title, 120) || (template === "board_brief" ? "Board from the brief" : template === "check" ? `${Number(/(\d+)/.exec(str(input.brief, 500))?.[1] ?? 5)}-question check` : `${label.label.split(" from ")[0]!.replace(" for a session", "")}${s ? ` for ${s.title}` : ""}`);
    const t: TaskRow = { id: newId("pt"), hostId: me.id, spaceId: p.id!, sessionId, roomId: null, template, title, brief: str(input.brief, 2000), attachments: (Array.isArray(input.attachments) ? input.attachments : []).filter((a): a is string => typeof a === "string").slice(0, 8), readyBy: str(input.readyBy, 40) ? new Date(str(input.readyBy, 40)).toISOString() : s ? new Date(Date.parse(s.startsAt) - 2 * 3600_000).toISOString() : null, who: str(input.who, 80) || null, post: input.post === true, status: "queued", seatId: null, claimedAt: null, doneAt: null, minutes: 0, report: "", question: null, feedback: null, createdAt: nowIso(ctx) };
    await ctx.db.put("prep_tasks", t);
    ctx.changed("prep_tasks");
    return taskView(ctx, t);
  })
  .post("prep/:id/answer", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const t = await ctx.db.get<TaskRow>("prep_tasks", p.id!);
    if (!t || t.hostId !== me.id || !t.question) throw new NotFoundError("Nothing to answer");
    const answer = str(input.answer, 1000);
    if (!answer) throw new Error("Write an answer");
    await ctx.db.patch<TaskRow>("prep_tasks", t.id, { status: "queued", question: { ...t.question, answer }, feedback: `${t.question.text} → ${answer}`, seatId: t.seatId });
    await event(ctx, { hostId: me.id, taskId: t.id, seatId: t.seatId, linkId: null, kind: "answer", text: `host answered: ${answer}`, minutes: 0 });
    ctx.changed("prep_tasks");
    return { ok: true };
  })
  .get("prep/:id/review", async (ctx, p) => {
    const me = await requireMe(ctx);
    const t = await ctx.db.get<TaskRow>("prep_tasks", p.id!);
    if (!t || t.hostId !== me.id) throw new NotFoundError("Task not found");
    const drafts = (await ctx.db.list<DraftRow>("agent_drafts", (d) => d.taskId === t.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { task: await taskView(ctx, t), drafts: drafts.map((d) => ({ id: d.id, kind: d.kind, title: d.title, sub: d.sub, status: d.status, reason: d.reason, payload: d.payload })) };
  })
  .post("prep/:id/review", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const t = await ctx.db.get<TaskRow>("prep_tasks", p.id!);
    if (!t || t.hostId !== me.id) throw new NotFoundError("Task not found");
    const drafts = await ctx.db.list<DraftRow>("agent_drafts", (d) => d.taskId === t.id && d.status === "pending");
    const accept = new Set((Array.isArray(input.accept) ? input.accept : []).filter((x): x is string => typeof x === "string"));
    const reject = new Set((Array.isArray(input.reject) ? input.reject : []).filter((x): x is string => typeof x === "string"));
    const reason = str(input.reason, 500) || "Not needed";
    let accepted = 0;
    for (const d of drafts) {
      if (accept.has(d.id)) {
        await applyDraft(ctx, me, t, d);
        await ctx.db.patch<DraftRow>("agent_drafts", d.id, { status: "accepted" });
        accepted++;
      } else if (reject.has(d.id)) {
        await ctx.db.patch<DraftRow>("agent_drafts", d.id, { status: "rejected", reason });
        await event(ctx, { hostId: me.id, taskId: t.id, seatId: d.seatId, linkId: null, kind: "reject", text: `host rejected ${d.title}: ${reason}`, minutes: 0 });
      }
    }
    const changes = str(input.changes, 1000);
    const left = (await ctx.db.list<DraftRow>("agent_drafts", (d) => d.taskId === t.id && d.status === "pending")).length;
    if (changes) {
      await ctx.db.patch<TaskRow>("prep_tasks", t.id, { status: "changes", feedback: changes });
      await event(ctx, { hostId: me.id, taskId: t.id, seatId: t.seatId, linkId: null, kind: "changes", text: `host asked for changes: ${changes}`, minutes: 0 });
    } else if (!left) {
      const anyAccepted = accepted > 0 || (await ctx.db.list<DraftRow>("agent_drafts", (d) => d.taskId === t.id && d.status === "accepted")).length > 0;
      await ctx.db.patch<TaskRow>("prep_tasks", t.id, { status: anyAccepted ? "accepted" : "rejected" });
    }
    if (accepted) await event(ctx, { hostId: me.id, taskId: t.id, seatId: t.seatId, linkId: null, kind: "accept", text: `host accepted ${accepted} draft${accepted === 1 ? "" : "s"}`, minutes: 0 });
    ctx.changed("agent_drafts", "prep_tasks");
    return { accepted, left };
  })
  // The room's draft layer (A4): pending board drafts and agent activity, for hosts only.
  .get("rooms/:id/agent", async (ctx, p) => {
    const me = await requireMe(ctx);
    const room = await ctx.db.get<Row & { createdBy: string; spaceId: string | null }>("rooms", p.id!);
    if (!room) throw new NotFoundError("Room not found");
    if (room.createdBy !== me.id) return { drafts: [], activity: [], working: null, pending: 0, taskId: null, paused: false };
    const tasks = await ctx.db.list<TaskRow>("prep_tasks", (t) => t.roomId === room.id);
    const ids = new Set(tasks.map((t) => t.id));
    const drafts = await ctx.db.list<DraftRow>("agent_drafts", (d) => ids.has(d.taskId) && d.status === "pending" && d.kind === "board_ops");
    const evs = (await ctx.db.list<EventRow>("agent_events", (e) => !!e.taskId && ids.has(e.taskId))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
    const working = tasks.find((t) => t.status === "working");
    const seat = working?.seatId ? await ctx.db.get<SeatRow>("agent_seats", working.seatId) : undefined;
    const reviewTask = tasks.find((t) => drafts.some((d) => d.taskId === t.id));
    const links = await ctx.db.list<LinkRow>("agent_links", (l) => l.hostId === me.id);
    return {
      ops: drafts.flatMap((d) => d.payload.ops as unknown[]),
      pending: (await ctx.db.list<DraftRow>("agent_drafts", (d) => ids.has(d.taskId) && d.status === "pending")).length,
      activity: evs.map((e) => ({ at: e.at, text: e.text })),
      working: working ? { title: working.title, seat: seat?.name ?? "agent" } : null,
      taskId: reviewTask?.id ?? null,
      paused: links.length > 0 && links.every((l) => l.paused)
    };
  });
