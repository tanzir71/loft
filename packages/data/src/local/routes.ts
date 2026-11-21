import type { Room, User } from "@loft/core";
import { newId, normaliseCode, roomCode, ROOM_CAPACITY, sortableId } from "@loft/core";
import { ResourceRouter } from "../router";
import { ForbiddenError, NotFoundError } from "../types";
import type { LocalDb, Row } from "./db";

export { requireMe };
export interface LocalCtx {
  db: LocalDb;
  meId: string | null;
  now: () => Date;
  /** Tell every tab which tables changed. */
  changed: (...tables: string[]) => void;
}

async function requireMe(ctx: LocalCtx): Promise<User & Row> {
  const me = ctx.meId ? await ctx.db.get<User & Row>("users", ctx.meId) : undefined;
  if (!me) throw new NotFoundError("Not signed in");
  return me;
}

type RoomRow = Room & Row;
interface Admission extends Row {
  roomId: string;
  guestId: string;
  name: string;
  status: "pending" | "admitted" | "denied";
  at: string;
}
interface Message extends Row {
  channelType: "room" | "space" | "dm";
  channelId: string;
  userId: string;
  name: string;
  body: string;
  createdAt: string;
}

export const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function roomOr404(ctx: LocalCtx, id: string): Promise<RoomRow> {
  const r = await ctx.db.get<RoomRow>("rooms", id);
  if (!r) throw new NotFoundError("Room not found");
  return r;
}

async function hostOnly(ctx: LocalCtx, room: RoomRow): Promise<void> {
  if (ctx.meId !== room.createdBy) throw new ForbiddenError("Only the host can do that");
}

async function withHost(ctx: LocalCtx, room: RoomRow) {
  const host = await ctx.db.get<User & Row>("users", room.createdBy);
  return { ...room, hostName: host?.name ?? "the host" };
}

export const routes = new ResourceRouter<LocalCtx>()
  .get("me", async (ctx) => (ctx.meId ? ((await ctx.db.get("users", ctx.meId)) ?? null) : null))
  .get("settings", async (ctx) => {
    const me = await requireMe(ctx);
    return (await ctx.db.get("settings", me.id)) ?? { id: me.id, roomLink: "", bookingPage: null, paymentLink: null };
  })
  .post("settings", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const cur = (await ctx.db.get("settings", me.id)) ?? { id: me.id };
    const allowed = ["bookingPage", "paymentLink"] as const;
    const next: Row = { ...cur, id: me.id };
    for (const k of allowed) if (k in input) next[k] = input[k];
    await ctx.db.put("settings", next);
    ctx.changed("settings");
    return next;
  })
  // ---- rooms (M2) ----
  .post("rooms", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    let code = roomCode();
    while ((await ctx.db.list<RoomRow>("rooms", (r) => r.code === code)).length) code = roomCode();
    const first = me.name.split(" ")[0] ?? me.name;
    const room: RoomRow = {
      id: newId("rm"),
      spaceId: str(input.spaceId) || null,
      sessionId: str(input.sessionId) || null,
      slug: code.toLowerCase(),
      code,
      name: str(input.name, 60) || `Quick room · ${first}`,
      capacity: ROOM_CAPACITY,
      guestJoin: input.guestJoin !== false,
      createdBy: me.id,
      createdAt: ctx.now().toISOString(),
      endedAt: null
    };
    await ctx.db.put("rooms", room);
    ctx.changed("rooms");
    return room;
  })
  .get("rooms/by-code/:code", async (ctx, p) => {
    const code = normaliseCode(p.code ?? "");
    const [room] = await ctx.db.list<RoomRow>("rooms", (r) => r.code === code);
    if (!room) throw new NotFoundError("No room with that code");
    return withHost(ctx, room);
  })
  .get("rooms/:id", async (ctx, p) => withHost(ctx, await roomOr404(ctx, p.id!)))
  .post("rooms/:id/settings", async (ctx, p, input) => {
    const room = await roomOr404(ctx, p.id!);
    await hostOnly(ctx, room);
    const patch: Partial<RoomRow> = {};
    if (typeof input.guestJoin === "boolean") patch.guestJoin = input.guestJoin;
    if (str(input.name, 60)) patch.name = str(input.name, 60);
    const next = await ctx.db.patch<RoomRow>("rooms", room.id, patch);
    ctx.changed("rooms");
    return next;
  })
  .post("rooms/:id/end", async (ctx, p) => {
    const room = await roomOr404(ctx, p.id!);
    await hostOnly(ctx, room);
    const next = await ctx.db.patch<RoomRow>("rooms", room.id, { endedAt: ctx.now().toISOString() });
    ctx.changed("rooms");
    return next;
  })
  // A guest asks to join. With guest join on they walk straight in; off, the host admits them.
  .post("rooms/:id/knock", async (ctx, p) => {
    const room = await roomOr404(ctx, p.id!);
    const me = await requireMe(ctx);
    if (room.endedAt) throw new ForbiddenError("This session has ended");
    if (me.id === room.createdBy) return { id: "host", status: "admitted" };
    const existing = (await ctx.db.list<Admission>("admissions", (a) => a.roomId === room.id && a.guestId === me.id))[0];
    if (existing && existing.status !== "denied") return existing;
    const adm: Admission = { id: newId("adm"), roomId: room.id, guestId: me.id, name: me.name, status: room.guestJoin ? "admitted" : "pending", at: ctx.now().toISOString() };
    await ctx.db.put("admissions", adm);
    ctx.changed("admissions");
    return adm;
  })
  .get("rooms/:id/admissions", async (ctx, p) => {
    const room = await roomOr404(ctx, p.id!);
    await hostOnly(ctx, room);
    return (await ctx.db.list<Admission>("admissions", (a) => a.roomId === room.id && a.status === "pending")).sort((a, b) => a.at.localeCompare(b.at));
  })
  .get("rooms/:id/admission", async (ctx, p) => {
    const me = await requireMe(ctx);
    const room = await roomOr404(ctx, p.id!);
    if (me.id === room.createdBy) return { id: "host", status: "admitted" };
    return (await ctx.db.list<Admission>("admissions", (a) => a.roomId === room.id && a.guestId === me.id))[0] ?? null;
  })
  .post("rooms/:id/admissions/:aid", async (ctx, p, input) => {
    const room = await roomOr404(ctx, p.id!);
    await hostOnly(ctx, room);
    const status = input.decision === "admit" ? "admitted" : "denied";
    const next = await ctx.db.patch<Admission>("admissions", p.aid!, { status });
    ctx.changed("admissions");
    return next;
  })
  .get("rooms/:id/messages", async (ctx, p) => {
    await roomOr404(ctx, p.id!);
    return (await ctx.db.list<Message>("messages", (m) => m.channelType === "room" && m.channelId === p.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  })
  .post("rooms/:id/messages", async (ctx, p, input) => {
    const room = await roomOr404(ctx, p.id!);
    const me = await requireMe(ctx);
    const body = str(input.body, 2000);
    if (!body) throw new Error("Empty message");
    const m: Message = { id: sortableId("msg"), channelType: "room", channelId: room.id, userId: me.id, name: me.name, body, createdAt: ctx.now().toISOString() };
    await ctx.db.put("messages", m);
    ctx.changed("messages");
    return m;
  })
  // Guests get a lightweight user for this tab (no account).
  .post("guests", async (ctx, _p, input) => {
    const name = str(input.name, 40);
    if (!name) throw new Error("Name required");
    const g = { id: newId("g"), name, email: "", tz: "UTC", status: "available", guest: true, createdAt: ctx.now().toISOString() };
    await ctx.db.put("users", g);
    return g;
  });
