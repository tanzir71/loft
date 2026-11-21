// M8 resources: Insights (last seen, attendance, homework on time, fees, at risk) and nudges
// (automatic rules run by the first request of the day; custom nudges delivered when due). Mirrors /api/v1.
import {
  balanceDue,
  dayKey,
  DEFAULT_NUDGE_TEXT,
  fillTemplate,
  formatUSD,
  invoiceStatus,
  isDailyDue,
  isOverdue,
  memberInsight,
  newId,
  NUDGE_RULES,
  seenLabel,
  sortableId,
  totals,
  delta,
  type AttendanceStatus,
  type FeeState,
  type MemberActivity,
  type NudgeRule,
  type User
} from "@loft/core";
import { NotFoundError } from "../types";
import type { Row } from "./db";
import { requireMe, routes, str, type LocalCtx } from "./routes";
import { billingFor, type InvoiceRow } from "./routes-money";

interface SpaceRow extends Row { name: string; slug: string; code: string; mode: string; createdBy: string; billing?: Record<string, unknown> }
interface MemberRow extends Row { spaceId: string; userId: string; role: string }
interface UserRow extends User, Row { phone?: string; lastSeenAt?: string | null; lastLoginAt?: string | null; guest?: boolean }
interface LogRow extends Row { spaceId: string; memberId: string; sessionId: string; at: string; status: AttendanceStatus; minutes: number }
interface PostRow extends Row { spaceId: string; kind: string; title: string; dueAt?: string; createdAt: string }
interface SubRow extends Row { postId: string; userId: string; at: string }
interface CheckRow extends Row { spaceId: string; title: string; status: string; closeAt: string | null }
interface AttemptRow extends Row { checkId: string; userId: string; submittedAt: string | null }
interface NudgeSettings extends Row { rules: Record<NudgeRule, boolean>; sent: Record<string, string>; lastDaily: string }
interface NudgeRow extends Row { hostId: string; audience: string; label: string; recipients: string[]; text: string; channels: string[]; sendAt: string; sentAt: string | null; createdAt: string; taskId?: string | null }
interface NudgeLog extends Row { hostId: string; nudgeId: string | null; rule: string | null; userId: string; notificationId: string; at: string; taskId?: string | null; invoiceId?: string | null }

const DAY = 86_400_000;
const first = (n: string) => n.split(" ")[0] ?? n;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

async function nudgeSettings(ctx: LocalCtx, hostId: string): Promise<NudgeSettings> {
  return (await ctx.db.get<NudgeSettings>("nudge_settings", hostId)) ?? { id: hostId, rules: Object.fromEntries(NUDGE_RULES.map((r) => [r.id, r.on])) as Record<NudgeRule, boolean>, sent: {}, lastDaily: "" };
}

/** Count a visit: last seen on every request (throttled), last login when a visit starts after 30 min away. */
export async function touchSeen(ctx: LocalCtx) {
  if (!ctx.meId) return;
  const u = await ctx.db.get<UserRow>("users", ctx.meId);
  if (!u) return;
  const t = ctx.now().getTime();
  const last = u.lastSeenAt ? Date.parse(u.lastSeenAt) : 0;
  if (t - last < 5 * 60_000) return;
  await ctx.db.put("users", { ...u, lastSeenAt: new Date(t).toISOString(), ...(t - last > 30 * 60_000 ? { lastLoginAt: new Date(t).toISOString() } : {}) });
}

async function hostedSpaces(ctx: LocalCtx, hostId: string) {
  const ids = new Set((await ctx.db.list<MemberRow>("memberships", (m) => m.userId === hostId && (m.role === "host" || m.role === "cohost"))).map((m) => m.spaceId));
  return ctx.db.list<SpaceRow>("spaces", (s) => ids.has(s.id));
}

interface PersonData { user: UserRow; spaces: SpaceRow[]; activity: MemberActivity; payerId: string | null; sessionIds: string[] }

/** Everything Insights needs for each member of the host's spaces in a window. */
async function people(ctx: LocalCtx, hostId: string, opts: { spaceId?: string; from: number; to: number }): Promise<PersonData[]> {
  // Insights are about learners and clients: team spaces (colleagues) are left out.
  const spaces = (await hostedSpaces(ctx, hostId)).filter((s) => s.mode !== "team" && (!opts.spaceId || s.id === opts.spaceId));
  const ids = new Set(spaces.map((s) => s.id));
  const members = await ctx.db.list<MemberRow>("memberships", (m) => ids.has(m.spaceId) && (m.role === "member" || m.role === "payer"));
  const users = new Map((await ctx.db.list<UserRow>("users")).map((u) => [u.id, u]));
  const inWin = (iso: string) => Date.parse(iso) >= opts.from && Date.parse(iso) <= opts.to;
  const logs = await ctx.db.list<LogRow>("session_log", (r) => ids.has(r.spaceId) && inWin(r.at));
  const tasks = await ctx.db.list<PostRow>("posts", (p) => ids.has(p.spaceId) && p.kind === "task" && !!p.dueAt && inWin(p.dueAt));
  const checks = await ctx.db.list<CheckRow>("checks", (c) => ids.has(c.spaceId) && c.status !== "draft" && !!c.closeAt && inWin(c.closeAt));
  const subs = await ctx.db.list<SubRow>("submissions");
  const attempts = await ctx.db.list<AttemptRow>("check_attempts", (a) => !!a.submittedAt);
  const open = await ctx.db.list<Row & { userId: string; joinedAt: string; leftAt: string | null }>("attendance_events", (e) => !e.leftAt && Date.parse(e.joinedAt) > opts.to - 12 * 3600_000);
  const invoices = await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === hostId && i.status === "sent");
  const byUser = new Map<string, MemberRow[]>();
  for (const m of members) byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), m]);
  const out: PersonData[] = [];
  for (const [userId, ms] of byUser) {
    const user = users.get(userId);
    if (!user || user.guest) continue;
    const mySpaces = spaces.filter((s) => ms.some((m) => m.spaceId === s.id));
    const sp = new Set(mySpaces.map((s) => s.id));
    const payerId = mySpaces.map((s) => billingFor(s as never).payers[userId]).find(Boolean) ?? null;
    const theirs = invoices.filter((i) => i.payerId && (i.payerId === userId || i.payerId === payerId || i.memberIds.includes(userId))).sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""));
    const latest = theirs[0];
    const status = latest ? invoiceStatus(latest, opts.to) : null;
    const fee: FeeState = theirs.some((i) => isOverdue(i, opts.to)) ? "overdue" : !status ? "none" : status === "claimed" ? "claimed" : status === "paid" ? "paid" : "sent";
    const myLogs = logs.filter((r) => r.memberId === userId);
    out.push({
      user,
      spaces: mySpaces,
      payerId,
      sessionIds: myLogs.sort((a, b) => b.at.localeCompare(a.at)).map((r) => r.sessionId),
      activity: {
        lastSeenAt: user.lastSeenAt ?? null,
        lastLoginAt: user.lastLoginAt ?? null,
        inRoom: user.status === "busy" || open.some((e) => e.userId === userId),
        sessions: myLogs.map((r) => ({ at: r.at, status: r.status, minutes: r.minutes })),
        work: [
          ...tasks.filter((t) => sp.has(t.spaceId)).map((t) => ({ dueAt: t.dueAt!, doneAt: subs.find((s) => s.postId === t.id && s.userId === userId)?.at ?? null })),
          ...checks.filter((c) => sp.has(c.spaceId)).map((c) => ({ dueAt: c.closeAt!, doneAt: attempts.find((a) => a.checkId === c.id && a.userId === userId)?.submittedAt ?? null }))
        ],
        fee
      }
    });
  }
  return out.sort((a, b) => a.user.name.localeCompare(b.user.name));
}

/** Who a custom nudge can go to. */
async function audiences(ctx: LocalCtx, hostId: string, list: PersonData[], now: number) {
  const out: { id: string; label: string; recipients: string[]; taskId?: string }[] = [];
  const insights = list.map((p) => ({ p, i: memberInsight(p.activity, now) }));
  const risk = insights.filter((x) => x.i.atRisk).map((x) => x.p.user.id);
  const unseen = insights.filter((x) => (x.i.notSeenDays ?? 99) >= 7).map((x) => x.p.user.id);
  const spaces = await hostedSpaces(ctx, hostId);
  const ids = new Set(spaces.map((s) => s.id));
  const tasks = (await ctx.db.list<PostRow>("posts", (p) => ids.has(p.spaceId) && p.kind === "task" && !!p.dueAt && Date.parse(p.dueAt) > now - 3 * DAY)).sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
  for (const t of tasks) {
    const members = (await ctx.db.list<MemberRow>("memberships", (m) => m.spaceId === t.spaceId && m.role === "member")).map((m) => m.userId);
    const done = new Set((await ctx.db.list<SubRow>("submissions", (s) => s.postId === t.id)).map((s) => s.userId));
    const missing = members.filter((m) => !done.has(m));
    if (missing.length) out.push({ id: `task:${t.id}`, label: `${missing.length} who haven't handed in ${t.title}`, recipients: missing, taskId: t.id });
  }
  if (risk.length) out.push({ id: "at_risk", label: `${risk.length} at risk`, recipients: risk });
  if (unseen.length) out.push({ id: "not_seen", label: `${unseen.length} not seen for 7 days`, recipients: unseen });
  for (const s of spaces.filter((x) => x.mode !== "team")) {
    const ms = (await ctx.db.list<MemberRow>("memberships", (m) => m.spaceId === s.id && m.role === "member")).map((m) => m.userId);
    if (ms.length) out.push({ id: `space:${s.id}`, label: `Everyone in ${s.name} (${ms.length})`, recipients: ms });
  }
  return out;
}

async function notifyNudge(ctx: LocalCtx, hostId: string, userId: string, title: string, sub: string, link: string, meta: Partial<NudgeLog>) {
  const id = sortableId("nt");
  await ctx.db.put("notifications", { id, userId, kind: "nudge", title, sub, link, createdAt: ctx.now().toISOString(), readAt: null });
  await ctx.db.put("nudge_log", { id: newId("nl"), hostId, nudgeId: null, rule: null, userId, notificationId: id, at: ctx.now().toISOString(), ...meta } satisfies NudgeLog);
}

/** Deliver custom nudges whose time has come (every request; no cron). */
export async function deliverNudges(ctx: LocalCtx, hostId: string) {
  const t = ctx.now().toISOString();
  const host = await ctx.db.get<UserRow>("users", hostId);
  const users = new Map((await ctx.db.list<UserRow>("users")).map((u) => [u.id, u]));
  for (const n of await ctx.db.list<NudgeRow>("nudges", (x) => x.hostId === hostId && !x.sentAt && x.sendAt <= t)) {
    const task = n.taskId ? await ctx.db.get<PostRow>("posts", n.taskId) : undefined;
    for (const uid of n.recipients) {
      const u = users.get(uid);
      if (!u) continue;
      const text = fillTemplate(n.text, { first_name: first(u.name), task: task?.title ?? "your work", due: task?.dueAt ? shortDate(task.dueAt) : "soon", space: "" });
      if (n.channels.includes("inapp")) await notifyNudge(ctx, hostId, uid, `${first(host?.name ?? "Your host")}: ${text.slice(0, 70)}${text.length > 70 ? "…" : ""}`, text, task ? `/s/${task.spaceId}/work` : "/", { nudgeId: n.id, taskId: n.taskId ?? null });
    }
    await ctx.db.patch("nudges", n.id, { sentAt: t });
    ctx.changed("notifications", "nudges");
  }
}

/** Automatic nudges, once a day on the first request. Each fires once per person per thing. */
export async function insightsDaily(ctx: LocalCtx, hostId: string) {
  const s = await nudgeSettings(ctx, hostId);
  const now = ctx.now();
  if (!isDailyDue(s.lastDaily, now)) return;
  const t = now.getTime();
  const once = async (key: string, fn: () => Promise<void>) => {
    if (s.sent[key]) return;
    await fn();
    s.sent[key] = now.toISOString();
  };
  const spaces = await hostedSpaces(ctx, hostId);
  const ids = new Set(spaces.map((x) => x.id));
  if (s.rules.deadline) {
    for (const task of await ctx.db.list<PostRow>("posts", (p) => ids.has(p.spaceId) && p.kind === "task" && !!p.dueAt && Date.parse(p.dueAt) > t && Date.parse(p.dueAt) <= t + DAY)) {
      const done = new Set((await ctx.db.list<SubRow>("submissions", (x) => x.postId === task.id)).map((x) => x.userId));
      for (const m of await ctx.db.list<MemberRow>("memberships", (x) => x.spaceId === task.spaceId && x.role === "member")) {
        if (done.has(m.userId)) continue;
        await once(`deadline:${task.id}:${m.userId}`, () => notifyNudge(ctx, hostId, m.userId, `Due tomorrow: ${task.title}`, `Due ${shortDate(task.dueAt!)}`, `/s/${task.spaceId}/work`, { rule: "deadline", taskId: task.id }));
      }
    }
  }
  const list = await people(ctx, hostId, { from: t - 30 * DAY, to: t });
  if (s.rules.missed2) {
    for (const p of list) {
      const i = memberInsight(p.activity, t);
      if (i.missedInARow < 2 || !p.sessionIds[0]) continue;
      const to = p.payerId ?? p.user.id;
      await once(`missed2:${p.user.id}:${p.sessionIds[0]}`, () => notifyNudge(ctx, hostId, to, `${first(p.user.name)} missed ${i.missedInARow} sessions in a row`, `${p.spaces.map((x) => x.name).join(", ")} · reply if anything's up`, `/dm/${hostId}`, { rule: "missed2" }));
    }
  }
  if (s.rules.fee3) {
    for (const inv of await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === hostId && i.status === "sent")) {
      if (!isOverdue(inv, t) || !inv.dueAt || t - Date.parse(inv.dueAt) < 3 * DAY || inv.remindersSent.includes(3) || !inv.payerId) continue;
      await once(`fee3:${inv.id}`, () => notifyNudge(ctx, hostId, inv.payerId!, `${inv.number} is overdue · ${formatUSD(balanceDue(inv))}`, "Pay with the link on the invoice, then tap I've paid", `/pay/${inv.payToken}`, { rule: "fee3", invoiceId: inv.id }));
    }
  }
  if (s.rules.files3) {
    for (const f of await ctx.db.list<Row & { spaceId: string; name: string; createdAt: string; ownerId: string }>("files", (x) => ids.has(x.spaceId) && Date.parse(x.createdAt) < t - 3 * DAY && Date.parse(x.createdAt) > t - 14 * DAY)) {
      for (const m of await ctx.db.list<MemberRow>("memberships", (x) => x.spaceId === f.spaceId && x.role === "member" && x.userId !== f.ownerId)) {
        if (await ctx.db.get("file_opens", `${f.id}:${m.userId}`)) continue;
        await once(`files3:${f.id}:${m.userId}`, () => notifyNudge(ctx, hostId, m.userId, `Have a look at ${f.name}`, `Shared in ${spaces.find((x) => x.id === f.spaceId)?.name ?? "your space"}`, `/s/${f.spaceId}/files`, { rule: "files3" }));
      }
    }
  }
  s.lastDaily = dayKey(now);
  await ctx.db.put("nudge_settings", s);
  ctx.changed("notifications");
}

async function weekStats(ctx: LocalCtx, hostId: string) {
  const t = ctx.now().getTime();
  const logs = await ctx.db.list<NudgeLog>("nudge_log", (l) => l.hostId === hostId && Date.parse(l.at) > t - 7 * DAY);
  let opened = 0;
  let acted = 0;
  for (const l of logs) {
    const n = await ctx.db.get<Row & { readAt: string | null }>("notifications", l.notificationId);
    if (n?.readAt) opened++;
    if (l.taskId && (await ctx.db.list<SubRow>("submissions", (s) => s.postId === l.taskId && s.userId === l.userId && s.at > l.at)).length) acted++;
    else if (l.invoiceId) {
      const inv = await ctx.db.get<InvoiceRow>("invoices", l.invoiceId);
      if (inv && (inv.payments.some((p) => p.at > l.at) || inv.claims.some((c) => c.at > l.at))) acted++;
    }
  }
  return { sent: logs.length, opened, acted };
}

routes
  .get("insights", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    await insightsDaily(ctx, me.id);
    const days = [7, 30, 90].includes(Number(input.days)) ? Number(input.days) : 30;
    const spaceId = str(input.space, 80) || undefined;
    const t = ctx.now().getTime();
    const cur = await people(ctx, me.id, { spaceId, from: t - days * DAY, to: t });
    const prev = await people(ctx, me.id, { spaceId, from: t - 2 * days * DAY, to: t - days * DAY });
    const rows = cur.map((p) => ({ p, i: memberInsight(p.activity, t) }));
    const a = totals(rows.map((r) => ({ activity: r.p.activity, insight: r.i })), t - days * DAY);
    const b = totals(prev.map((p) => ({ activity: p.activity, insight: memberInsight(p.activity, t - days * DAY) })), t - 2 * days * DAY);
    const s = await nudgeSettings(ctx, me.id);
    const spaces = await hostedSpaces(ctx, me.id);
    return {
      days,
      spaceId: spaceId ?? null,
      spaces: spaces.filter((x) => x.mode !== "team").map((x) => ({ id: x.id, code: x.code, name: x.name })),
      kpis: {
        active: a.active, members: a.members, activeDelta: delta(a.active, b.members ? b.active : null),
        attendance: a.attendance, attendanceDelta: delta(a.attendance, b.attendance, "%"),
        onTime: a.onTime, onTimeDelta: delta(a.onTime, b.onTime, "%"),
        avgMinutes: a.avgMinutes, avgDelta: delta(a.avgMinutes, b.avgMinutes, " min")
      },
      people: rows
        .map(({ p, i }) => ({
          userId: p.user.id,
          name: p.user.name,
          phone: p.user.phone ?? null,
          spaces: p.spaces.map((x) => x.code).join(" · "),
          seen: seenLabel(p.activity, t),
          lastLogin: p.activity.lastLoginAt,
          attendance: i.attendance,
          homework: i.homeworkDue ? `${i.onTime}/${i.homeworkDue}` : "—",
          fee: p.activity.fee,
          atRisk: i.atRisk,
          reasons: i.reasons,
          notSeen7: (i.notSeenDays ?? 99) >= 7
        }))
        .sort((x, y) => Number(y.atRisk) - Number(x.atRisk) || x.name.localeCompare(y.name)),
      rules: NUDGE_RULES.map((r) => ({ ...r, on: s.rules[r.id] ?? r.on })),
      audiences: (await audiences(ctx, me.id, cur, t)).map((x) => ({ id: x.id, label: x.label, count: x.recipients.length })),
      template: DEFAULT_NUDGE_TEXT,
      stats: await weekStats(ctx, me.id),
      scheduled: (await ctx.db.list<NudgeRow>("nudges", (n) => n.hostId === me.id && !n.sentAt)).map((n) => ({ id: n.id, label: n.label, sendAt: n.sendAt }))
    };
  })
  .post("nudges/rules", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const s = await nudgeSettings(ctx, me.id);
    const rule = NUDGE_RULES.find((r) => r.id === input.rule);
    if (!rule) throw new NotFoundError("Unknown rule");
    s.rules = { ...s.rules, [rule.id]: input.on === true };
    await ctx.db.put("nudge_settings", s);
    ctx.changed("nudge_settings");
    return { ok: true };
  })
  .post("nudges", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const t = ctx.now().getTime();
    const list = await people(ctx, me.id, { from: t - 30 * DAY, to: t });
    const aud = (await audiences(ctx, me.id, list, t)).find((a) => a.id === input.audience);
    const single = typeof input.userId === "string" ? (await ctx.db.get<UserRow>("users", input.userId)) : undefined;
    const recipients = single ? [single.id] : aud?.recipients ?? [];
    if (!recipients.length) throw new Error("Nobody to nudge");
    const channels = (Array.isArray(input.channels) ? input.channels : ["inapp"]).filter((c): c is string => typeof c === "string");
    const sendAt = typeof input.sendAt === "string" && Date.parse(input.sendAt) > t ? new Date(input.sendAt).toISOString() : new Date(t).toISOString();
    const n: NudgeRow = { id: newId("nd"), hostId: me.id, audience: single ? `user:${single.id}` : String(input.audience), label: single ? single.name : aud!.label, recipients, text: str(input.text, 1000) || DEFAULT_NUDGE_TEXT, channels, sendAt, sentAt: null, createdAt: new Date(t).toISOString(), taskId: aud?.taskId ?? null };
    await ctx.db.put("nudges", n);
    await deliverNudges(ctx, me.id);
    const users = new Map((await ctx.db.list<UserRow>("users")).map((u) => [u.id, u]));
    const task = n.taskId ? await ctx.db.get<PostRow>("posts", n.taskId) : undefined;
    ctx.changed("nudges", "notifications");
    return {
      scheduled: sendAt > new Date(t).toISOString(),
      sendAt,
      recipients: recipients.length,
      whatsapp: channels.includes("whatsapp")
        ? recipients.map((id) => {
            const u = users.get(id);
            return { name: u?.name ?? "?", phone: u?.phone ?? "", text: fillTemplate(n.text, { first_name: first(u?.name ?? ""), task: task?.title ?? "your work", due: task?.dueAt ? shortDate(task.dueAt) : "soon", space: "" }) };
          })
        : []
    };
  })
  .post("files/:id/open", async (ctx, p) => {
    const me = await requireMe(ctx);
    await ctx.db.put("file_opens", { id: `${p.id}:${me.id}`, at: ctx.now().toISOString() });
    return { ok: true };
  });
