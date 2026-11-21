// M5 resources: calendar, sessions + series (clash check), .ics, availability, booking types,
// the public booking page, manage links, and change/booking requests. Mirrors /api/v1 (docs/api.md).
import {
  buildIcsCalendar,
  dateIn,
  DEFAULT_AVAILABILITY,
  expandSeries,
  findClashes,
  freeSlots,
  isLateChange,
  newId,
  nextFree,
  parseIcsBusy,
  roomCode,
  sortableId,
  toInterval,
  type Availability,
  type SeriesRule,
  type User
} from "@loft/core";
import { ForbiddenError, NotFoundError } from "../types";
import type { Row } from "./db";
import { requireMe, routes, str, type LocalCtx } from "./routes";

interface SessionRow extends Row { spaceId: string; seriesId?: string | null; title: string; startsAt: string; minutes: number; room: "loft" | "external"; externalUrl?: string | null; status: "scheduled" | "cancelled" | "moved" | "requested"; sequence?: number; forUserId?: string | null; bookingId?: string | null }
interface SpaceRow extends Row { name: string; slug: string; code: string; colour: string; mode: string }
interface MemberRow extends Row { spaceId: string; userId: string; role: string }
interface AvailRow extends Row, Availability { handle: string; bio: string; busyIcs?: string; busyUrl?: string; feedToken: string }
interface TypeRow extends Row { userId: string; name: string; minutes: number; priceCents: number; destSpaceId: string | null; approval: "auto" | "manual"; blurb: string }
interface BookingRow extends Row { typeId: string; hostId: string; sessionId: string; guestName: string; guestEmail: string; note: string; status: "requested" | "scheduled" | "declined" | "cancelled"; manageToken: string; createdAt: string }
interface RequestRow extends Row { sessionId: string; memberId: string; kind: "move" | "cancel"; proposedStartsAt: string | null; note: string; status: "pending" | "approved" | "declined" | "expired"; createdAt: string }

const LATE_WINDOW_H = 24;

async function hostedSpaces(ctx: LocalCtx, meId: string) {
  const mine = await ctx.db.list<MemberRow>("memberships", (m) => m.userId === meId);
  const ids = new Set(mine.map((m) => m.spaceId));
  const hostOf = new Set(mine.filter((m) => m.role === "host" || m.role === "cohost").map((m) => m.spaceId));
  const spaces = await ctx.db.list<SpaceRow>("spaces", (s) => ids.has(s.id));
  return { spaces, ids, hostOf };
}

async function availabilityFor(ctx: LocalCtx, userId: string): Promise<AvailRow> {
  const a = await ctx.db.get<AvailRow>("availability", userId);
  if (a) return a;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const user = await ctx.db.get<User & Row>("users", userId);
  return { id: userId, ...DEFAULT_AVAILABILITY(tz), handle: (user?.name.split(" ")[0] ?? "host").toLowerCase(), bio: "", feedToken: newId() };
}

async function hostSessions(ctx: LocalCtx, hostId: string): Promise<SessionRow[]> {
  const { ids } = await hostedSpaces(ctx, hostId);
  return ctx.db.list<SessionRow>("sessions", (s) => ids.has(s.spaceId) && s.status !== "cancelled");
}

function busyFrom(av: AvailRow, from: number, to: number) {
  return av.busyIcs ? parseIcsBusy(av.busyIcs, from, to) : [];
}

async function notifyMembers(ctx: LocalCtx, spaceId: string, exceptId: string, kind: string, title: string, sub: string, link: string) {
  for (const m of await ctx.db.list<MemberRow>("memberships", (x) => x.spaceId === spaceId && x.userId !== exceptId)) {
    await ctx.db.put("notifications", { id: sortableId("nt"), userId: m.userId, kind, title, sub, link, createdAt: ctx.now().toISOString(), readAt: null });
  }
}

async function requireHostOf(ctx: LocalCtx, s: SessionRow) {
  const me = await requireMe(ctx);
  const m = await ctx.db.get<MemberRow>("memberships", `${s.spaceId}:${me.id}`);
  if (!m || (m.role !== "host" && m.role !== "cohost")) throw new ForbiddenError("Only the host can change sessions");
  return me;
}

function seriesTargets(all: SessionRow[], s: SessionRow, scope: string): SessionRow[] {
  if (!s.seriesId || scope === "this") return [s];
  const same = all.filter((x) => x.seriesId === s.seriesId && x.status !== "cancelled");
  return scope === "following" ? same.filter((x) => x.startsAt >= s.startsAt) : same;
}

async function slotsFor(ctx: LocalCtx, hostId: string, minutes: number) {
  const av = await availabilityFor(ctx, hostId);
  const now = ctx.now().getTime();
  const sessions = await hostSessions(ctx, hostId);
  const taken = [...sessions.map(toInterval), ...busyFrom(av, now, now + av.rules.horizonDays * 86_400_000)];
  return { av, slots: freeSlots(av, minutes, taken, now) };
}

routes
  .get("calendar", async (ctx, _p, q) => {
    const me = await requireMe(ctx);
    const { spaces, ids, hostOf } = await hostedSpaces(ctx, me.id);
    const from = str(q.from, 40) || new Date(ctx.now().getTime() - 7 * 86_400_000).toISOString();
    const to = str(q.to, 40) || new Date(ctx.now().getTime() + 35 * 86_400_000).toISOString();
    const sp = new Map(spaces.map((s) => [s.id, s]));
    const sessions = (await ctx.db.list<SessionRow>("sessions", (s) => ids.has(s.spaceId) && s.startsAt >= from && s.startsAt <= to && (!s.forUserId || s.forUserId === me.id || hostOf.has(s.spaceId))))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .map((s) => ({ ...s, spaceName: sp.get(s.spaceId)?.name ?? "", code: sp.get(s.spaceId)?.code ?? "", colour: sp.get(s.spaceId)?.colour ?? "blue", slug: sp.get(s.spaceId)?.slug ?? "", isHost: hostOf.has(s.spaceId) }));
    const av = await availabilityFor(ctx, me.id);
    const requests = await pendingRequests(ctx, me.id);
    return { tz: av.tz, sessions, requests, availability: { tz: av.tz, weekly: av.weekly }, spaces: spaces.map((s) => ({ id: s.id, name: s.name, code: s.code, colour: s.colour, isHost: hostOf.has(s.id) })), feedToken: av.feedToken, handle: av.handle };
  })
  .post("sessions", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const spaceId = str(input.spaceId, 60);
    const m = await ctx.db.get<MemberRow>("memberships", `${spaceId}:${me.id}`);
    if (!m || (m.role !== "host" && m.role !== "cohost")) throw new ForbiddenError("Pick a space you host");
    const title = str(input.title, 120) || "Session";
    const minutes = Math.max(15, Math.min(480, Number(input.minutes) || 60));
    const av = await availabilityFor(ctx, me.id);
    const rule = input.series as SeriesRule | undefined;
    const starts = rule ? expandSeries({ ...rule, minutes, tz: rule.tz || av.tz }) : [str(input.startsAt, 40)];
    if (!starts[0] || Number.isNaN(Date.parse(starts[0]))) throw new Error("Pick a date and time");
    const skip = new Set(Array.isArray(input.skip) ? (input.skip as string[]) : []);
    const existing = await hostSessions(ctx, me.id);
    const now = ctx.now().getTime();
    const clashes = findClashes(starts, minutes, existing, busyFrom(av, now - 86_400_000, now + 400 * 86_400_000));
    if (input.dryRun) return { starts, clashes };
    const seriesId = rule ? newId("sr") : null;
    if (seriesId) await ctx.db.put("series", { id: seriesId, spaceId, rule: { ...rule, minutes }, createdAt: ctx.now().toISOString() });
    const created: SessionRow[] = [];
    for (const s of starts) {
      if (skip.has(s)) continue;
      const row: SessionRow = { id: newId("se"), spaceId, seriesId, title, startsAt: s, minutes, room: input.room === "external" ? "external" : "loft", externalUrl: str(input.externalUrl, 300) || null, status: "scheduled", sequence: 0 };
      await ctx.db.put("sessions", row);
      created.push(row);
    }
    const space = await ctx.db.get<SpaceRow>("spaces", spaceId);
    if (created[0]) await notifyMembers(ctx, spaceId, me.id, "invite", `${title}${created.length > 1 ? ` · ${created.length} sessions` : ""}`, `${space?.name ?? ""} · calendar invite`, "/calendar");
    ctx.changed("sessions", "notifications");
    return { created: created.length, sessions: created, clashes };
  })
  .post("sessions/:id/move", async (ctx, p, input) => {
    const s = await ctx.db.get<SessionRow>("sessions", p.id!);
    if (!s) throw new NotFoundError("Session not found");
    const me = await requireHostOf(ctx, s);
    const to = str(input.startsAt, 40);
    if (!to || Number.isNaN(Date.parse(to))) throw new Error("Pick a new time");
    const delta = Date.parse(to) - Date.parse(s.startsAt);
    const all = await ctx.db.list<SessionRow>("sessions", (x) => x.spaceId === s.spaceId);
    for (const t of seriesTargets(all, s, str(input.scope, 12) || "this")) {
      await ctx.db.patch<SessionRow>("sessions", t.id, { startsAt: new Date(Date.parse(t.startsAt) + delta).toISOString(), minutes: Number(input.minutes) || t.minutes, sequence: (t.sequence ?? 0) + 1 });
    }
    await notifyMembers(ctx, s.spaceId, me.id, "move", `${s.title} moved`, "Updated calendar invite sent", "/calendar");
    ctx.changed("sessions", "notifications");
    return { ok: true };
  })
  .post("sessions/:id/cancel", async (ctx, p, input) => {
    const s = await ctx.db.get<SessionRow>("sessions", p.id!);
    if (!s) throw new NotFoundError("Session not found");
    const me = await requireHostOf(ctx, s);
    const all = await ctx.db.list<SessionRow>("sessions", (x) => x.spaceId === s.spaceId);
    for (const t of seriesTargets(all, s, str(input.scope, 12) || "this")) await ctx.db.patch<SessionRow>("sessions", t.id, { status: "cancelled", sequence: (t.sequence ?? 0) + 1 });
    await notifyMembers(ctx, s.spaceId, me.id, "move", `${s.title} cancelled`, "Calendar updated", "/calendar");
    ctx.changed("sessions", "notifications");
    return { ok: true };
  })
  .get("sessions/:id/ics", async (ctx, p) => {
    const s = await ctx.db.get<SessionRow>("sessions", p.id!);
    if (!s) throw new NotFoundError("Session not found");
    const space = await ctx.db.get<SpaceRow>("spaces", s.spaceId);
    return {
      filename: `${s.title.replace(/[^\w-]+/g, "-")}.ics`,
      text: buildIcsCalendar({
        name: space?.name ?? "Loft",
        method: s.status === "cancelled" ? "CANCEL" : "REQUEST",
        events: [{ id: s.id, startsAt: Date.parse(s.startsAt), endsAt: Date.parse(s.startsAt) + s.minutes * 60_000, summary: `${s.title} · ${space?.name ?? ""}`, location: s.room === "external" && s.externalUrl ? s.externalUrl : `https://tanziro.com/spaces/r/${space?.slug ?? ""}`, sequence: s.sequence ?? 0 }]
      })
    };
  })
  // Private calendar feed (production: GET /ics/<token>.ics, text/calendar).
  .get("feed", async (ctx) => {
    const me = await requireMe(ctx);
    const { ids, spaces } = await hostedSpaces(ctx, me.id);
    const sp = new Map(spaces.map((s) => [s.id, s]));
    const list = await ctx.db.list<SessionRow>("sessions", (s) => ids.has(s.spaceId) && s.status !== "cancelled" && (!s.forUserId || s.forUserId === me.id));
    return { filename: "loft.ics", text: buildIcsCalendar({ name: "Loft", events: list.map((s) => ({ id: s.id, startsAt: Date.parse(s.startsAt), endsAt: Date.parse(s.startsAt) + s.minutes * 60_000, summary: `${s.title} · ${sp.get(s.spaceId)?.name ?? ""}`, sequence: s.sequence ?? 0 })) }) };
  })
  .get("availability", async (ctx) => {
    const me = await requireMe(ctx);
    const av = await availabilityFor(ctx, me.id);
    const types = await ctx.db.list<TypeRow>("booking_types", (t) => t.userId === me.id);
    const { spaces, hostOf } = await hostedSpaces(ctx, me.id);
    return { ...av, busyCount: av.busyIcs ? parseIcsBusy(av.busyIcs, ctx.now().getTime(), ctx.now().getTime() + 30 * 86_400_000).length : 0, types, spaces: spaces.filter((s) => hostOf.has(s.id)).map((s) => ({ id: s.id, name: s.name })) };
  })
  .post("availability", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const cur = await availabilityFor(ctx, me.id);
    const rules = (input.rules ?? {}) as Partial<Availability["rules"]>;
    const next: AvailRow = {
      ...cur,
      tz: str(input.tz, 60) || cur.tz,
      weekly: (input.weekly as Availability["weekly"]) ?? cur.weekly,
      rules: { bufferMin: Number(rules.bufferMin ?? cur.rules.bufferMin), noticeHours: Number(rules.noticeHours ?? cur.rules.noticeHours), maxPerDay: Number(rules.maxPerDay ?? cur.rules.maxPerDay), horizonDays: Number(rules.horizonDays ?? cur.rules.horizonDays) },
      handle: (str(input.handle, 40) || cur.handle).toLowerCase().replace(/[^a-z0-9-]/g, ""),
      bio: input.bio !== undefined ? str(input.bio, 160) : cur.bio,
      busyUrl: input.busyUrl !== undefined ? str(input.busyUrl, 500) : cur.busyUrl,
      busyIcs: input.busyIcs !== undefined ? String(input.busyIcs).slice(0, 200_000) : cur.busyIcs
    };
    await ctx.db.put("availability", next);
    ctx.changed("availability");
    return next;
  })
  .post("booking-types", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const id = str(input.id, 60) || newId("bt");
    const row: TypeRow = { id, userId: me.id, name: str(input.name, 60) || "Call", minutes: Math.max(15, Math.min(240, Number(input.minutes) || 30)), priceCents: Math.max(0, Math.round(Number(input.priceCents) || 0)), destSpaceId: str(input.destSpaceId, 60) || null, approval: input.approval === "manual" ? "manual" : "auto", blurb: str(input.blurb, 200) };
    await ctx.db.put("booking_types", row);
    ctx.changed("booking_types");
    return row;
  })
  .post("booking-types/:id/delete", async (ctx, p) => {
    const me = await requireMe(ctx);
    const t = await ctx.db.get<TypeRow>("booking_types", p.id!);
    if (!t || t.userId !== me.id) throw new NotFoundError("Booking type not found");
    await ctx.db.del("booking_types", t.id);
    ctx.changed("booking_types");
    return { ok: true };
  })
  // ---- public booking page (no account) ----
  .get("book/:handle", async (ctx, p) => {
    const host = (await ctx.db.list<AvailRow>("availability", (a) => a.handle === p.handle))[0];
    if (!host) throw new NotFoundError("No booking page here");
    const user = await ctx.db.get<User & Row>("users", host.id);
    const types = await ctx.db.list<TypeRow>("booking_types", (t) => t.userId === host.id);
    return { name: user?.name ?? "", bio: host.bio, tz: host.tz, types: types.map((t) => ({ id: t.id, name: t.name, minutes: t.minutes, priceCents: t.priceCents, approval: t.approval, blurb: t.blurb })) };
  })
  .get("book/:handle/slots", async (ctx, p, q) => {
    const host = (await ctx.db.list<AvailRow>("availability", (a) => a.handle === p.handle))[0];
    if (!host) throw new NotFoundError("No booking page here");
    const type = await ctx.db.get<TypeRow>("booking_types", str(q.type, 60));
    if (!type || type.userId !== host.id) throw new NotFoundError("Pick a booking type");
    return (await slotsFor(ctx, host.id, type.minutes)).slots;
  })
  .post("book/:handle", async (ctx, p, input) => {
    if (str(input.website, 200)) return { ok: true, manageToken: "" }; // honeypot: pretend success
    const host = (await ctx.db.list<AvailRow>("availability", (a) => a.handle === p.handle))[0];
    if (!host) throw new NotFoundError("No booking page here");
    const type = await ctx.db.get<TypeRow>("booking_types", str(input.typeId, 60));
    if (!type || type.userId !== host.id) throw new NotFoundError("Pick a booking type");
    const name = str(input.name, 80), email = str(input.email, 200);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Add your name and a valid email");
    const startsAt = str(input.startsAt, 40);
    const { slots } = await slotsFor(ctx, host.id, type.minutes);
    if (!slots.includes(startsAt)) throw new Error("That time was just taken. Pick another.");
    let spaceId = type.destSpaceId;
    if (!spaceId) {
      const { spaces, hostOf } = await hostedSpaces(ctx, host.id);
      spaceId = spaces.find((s) => hostOf.has(s.id))?.id ?? null;
    }
    if (!spaceId) throw new Error("This host isn't taking bookings yet");
    const status = type.approval === "manual" ? "requested" : "scheduled";
    const session: SessionRow = { id: newId("se"), spaceId, title: `${type.name} · ${name}`, startsAt, minutes: type.minutes, room: "loft", status, sequence: 0 };
    const booking: BookingRow = { id: newId("bk"), typeId: type.id, hostId: host.id, sessionId: session.id, guestName: name, guestEmail: email, note: str(input.note, 500), status, manageToken: newId(), createdAt: ctx.now().toISOString() };
    session.bookingId = booking.id;
    await ctx.db.put("sessions", session);
    await ctx.db.put("bookings", booking);
    await ctx.db.put("notifications", { id: sortableId("nt"), userId: host.id, kind: "booking", title: `New booking · ${type.name}`, sub: `${name} · ${status === "requested" ? "needs your approval" : "confirmed"}`, link: "/calendar", createdAt: ctx.now().toISOString(), readAt: null });
    ctx.changed("sessions", "bookings", "notifications");
    return { ok: true, status, manageToken: booking.manageToken, startsAt, minutes: type.minutes, typeName: type.name };
  })
  .get("manage/:token", async (ctx, p) => {
    const b = (await ctx.db.list<BookingRow>("bookings", (x) => x.manageToken === p.token))[0];
    if (!b) throw new NotFoundError("This link isn't valid any more");
    const s = await ctx.db.get<SessionRow>("sessions", b.sessionId);
    const type = await ctx.db.get<TypeRow>("booking_types", b.typeId);
    const host = await availabilityFor(ctx, b.hostId);
    return { booking: b, session: s, typeName: type?.name ?? "", handle: host.handle, minutes: type?.minutes ?? s?.minutes ?? 30 };
  })
  .post("manage/:token/cancel", async (ctx, p) => {
    const b = (await ctx.db.list<BookingRow>("bookings", (x) => x.manageToken === p.token))[0];
    if (!b) throw new NotFoundError("This link isn't valid any more");
    await ctx.db.patch<BookingRow>("bookings", b.id, { status: "cancelled" });
    const s = await ctx.db.get<SessionRow>("sessions", b.sessionId);
    if (s) await ctx.db.patch<SessionRow>("sessions", s.id, { status: "cancelled", sequence: (s.sequence ?? 0) + 1 });
    await ctx.db.put("notifications", { id: sortableId("nt"), userId: b.hostId, kind: "move", title: `${b.guestName} cancelled`, sub: s?.title ?? "", link: "/calendar", createdAt: ctx.now().toISOString(), readAt: null });
    ctx.changed("sessions", "bookings", "notifications");
    return { ok: true };
  })
  .post("manage/:token/move", async (ctx, p, input) => {
    const b = (await ctx.db.list<BookingRow>("bookings", (x) => x.manageToken === p.token))[0];
    if (!b) throw new NotFoundError("This link isn't valid any more");
    const s = await ctx.db.get<SessionRow>("sessions", b.sessionId);
    if (!s) throw new NotFoundError("Session not found");
    const to = str(input.startsAt, 40);
    const { slots } = await slotsFor(ctx, b.hostId, s.minutes);
    if (!slots.includes(to)) throw new Error("That time isn't free. Pick another.");
    await ctx.db.patch<SessionRow>("sessions", s.id, { startsAt: to, sequence: (s.sequence ?? 0) + 1 });
    await ctx.db.put("notifications", { id: sortableId("nt"), userId: b.hostId, kind: "move", title: `${b.guestName} moved their booking`, sub: s.title, link: "/calendar", createdAt: ctx.now().toISOString(), readAt: null });
    ctx.changed("sessions", "notifications");
    return { ok: true };
  })
  // ---- change requests (members propose; the host answers in one tap) ----
  .post("sessions/:id/requests", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const s = await ctx.db.get<SessionRow>("sessions", p.id!);
    if (!s) throw new NotFoundError("Session not found");
    if (!(await ctx.db.get("memberships", `${s.spaceId}:${me.id}`))) throw new ForbiddenError("You're not in this space");
    const kind = input.kind === "cancel" ? "cancel" : "move";
    const proposed = kind === "move" ? str(input.proposedStartsAt, 40) : null;
    if (kind === "move") {
      const host = (await ctx.db.list<MemberRow>("memberships", (m) => m.spaceId === s.spaceId && m.role === "host"))[0];
      const { slots } = await slotsFor(ctx, host?.userId ?? me.id, s.minutes);
      if (!proposed || !slots.includes(proposed)) throw new Error("Pick one of the host's free times");
    }
    const r: RequestRow = { id: newId("rq"), sessionId: s.id, memberId: me.id, kind, proposedStartsAt: proposed, note: str(input.note, 300), status: "pending", createdAt: ctx.now().toISOString() };
    await ctx.db.put("change_requests", r);
    ctx.changed("change_requests");
    return r;
  })
  .get("requests", async (ctx) => {
    const me = await requireMe(ctx);
    return pendingRequests(ctx, me.id);
  })
  .post("requests/:id", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const approve = input.decision === "approve";
    const booking = await ctx.db.get<BookingRow>("bookings", p.id!);
    if (booking) {
      if (booking.hostId !== me.id) throw new ForbiddenError("Not your booking");
      await ctx.db.patch<BookingRow>("bookings", booking.id, { status: approve ? "scheduled" : "declined" });
      await ctx.db.patch<SessionRow>("sessions", booking.sessionId, { status: approve ? "scheduled" : "cancelled" });
      ctx.changed("bookings", "sessions");
      return { ok: true, suggest: approve ? [] : nextFree((await slotsFor(ctx, me.id, 30)).slots, ctx.now().getTime()) };
    }
    const r = await ctx.db.get<RequestRow>("change_requests", p.id!);
    if (!r || r.status !== "pending") throw new NotFoundError("Request not found");
    const s = await ctx.db.get<SessionRow>("sessions", r.sessionId);
    if (!s) throw new NotFoundError("Session not found");
    await requireHostOf(ctx, s);
    await ctx.db.patch<RequestRow>("change_requests", r.id, { status: approve ? "approved" : "declined" });
    const member = await ctx.db.get<User & Row>("users", r.memberId);
    if (approve && r.kind === "move" && r.proposedStartsAt) {
      const others = (await ctx.db.list<MemberRow>("memberships", (m) => m.spaceId === s.spaceId && m.role !== "host" && m.role !== "cohost")).length;
      if (others <= 1) await ctx.db.patch<SessionRow>("sessions", s.id, { startsAt: r.proposedStartsAt, sequence: (s.sequence ?? 0) + 1 });
      else await ctx.db.put("sessions", { ...s, id: newId("se"), startsAt: r.proposedStartsAt, title: `${s.title} · ${member?.name.split(" ")[0] ?? ""}`, forUserId: r.memberId, seriesId: null, sequence: 0 });
    } else if (approve && r.kind === "cancel") {
      // A member cancelling a group session only drops their own attendance (recorded for billing in M7).
      await ctx.db.put("attendance_exceptions", { id: `${s.id}:${r.memberId}`, sessionId: s.id, userId: r.memberId, kind: "cancelled" });
    }
    await ctx.db.put("notifications", { id: sortableId("nt"), userId: r.memberId, kind: "move", title: approve ? `Approved: ${s.title}` : `Not this time: ${s.title}`, sub: approve ? "Updated calendar invite sent" : "Here are the next free times", link: "/calendar", createdAt: ctx.now().toISOString(), readAt: null });
    ctx.changed("sessions", "change_requests", "notifications");
    return { ok: true, suggest: approve ? [] : nextFree((await slotsFor(ctx, me.id, s.minutes)).slots, ctx.now().getTime()) };
  });

export async function pendingRequests(ctx: LocalCtx, hostId: string) {
  const now = ctx.now().getTime();
  const { hostOf } = await hostedSpaces(ctx, hostId);
  const sessions = await hostSessions(ctx, hostId);
  const out: { id: string; kind: "move" | "cancel" | "booking"; who: string; title: string; from: string; to: string | null; free: boolean; clash: string | null; late: boolean; note: string }[] = [];
  for (const r of await ctx.db.list<RequestRow>("change_requests", (x) => x.status === "pending")) {
    const s = await ctx.db.get<SessionRow>("sessions", r.sessionId);
    if (!s || !hostOf.has(s.spaceId)) continue;
    if (Date.parse(s.startsAt) < now) {
      await ctx.db.patch<RequestRow>("change_requests", r.id, { status: "expired" }); // unanswered requests expire at the original start
      continue;
    }
    const who = (await ctx.db.get<User & Row>("users", r.memberId))?.name ?? "Someone";
    const clash = r.proposedStartsAt ? findClashes([r.proposedStartsAt], s.minutes, sessions.filter((x) => x.id !== s.id))[0]?.with ?? null : null;
    out.push({ id: r.id, kind: r.kind, who, title: s.title, from: s.startsAt, to: r.proposedStartsAt, free: !clash, clash, late: isLateChange(s.startsAt, now, LATE_WINDOW_H), note: r.note });
  }
  for (const b of await ctx.db.list<BookingRow>("bookings", (x) => x.hostId === hostId && x.status === "requested")) {
    const s = await ctx.db.get<SessionRow>("sessions", b.sessionId);
    if (!s) continue;
    const clash = findClashes([s.startsAt], s.minutes, sessions.filter((x) => x.id !== s.id && x.status !== "requested"))[0]?.with ?? null;
    out.push({ id: b.id, kind: "booking", who: b.guestName, title: s.title, from: s.startsAt, to: null, free: !clash, clash, late: false, note: b.note });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

export { roomCode, dateIn };
