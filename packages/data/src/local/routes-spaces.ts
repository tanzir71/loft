// M3 resources: spaces, stream (posts, must-read acks, tasks), files, space chat, people, DMs,
// knock, notifications and the To review inbox. Mirrors /api/v1 (docs/api.md).
import { newId, roomCode, ROOM_CAPACITY, slugify, sortableId, spaceCode, SPACE_MODES, unacknowledged, type SpaceMode, type User } from "@loft/core";
import { ForbiddenError, NotFoundError } from "../types";
import type { Row } from "./db";
import { requireMe, routes, str, type LocalCtx } from "./routes";

interface SpaceRow extends Row { mode: SpaceMode; code: string; name: string; sub?: string; slug: string; colour: string; createdBy: string; createdAt: string }
interface MemberRow extends Row { spaceId: string; userId: string; role: string; lastReadAt: string }
interface PostRow extends Row { spaceId: string; kind: string; title: string; body: string; mustRead: boolean; dueAt?: string; createdBy: string; createdAt: string; attachments: unknown[] }
interface MsgRow extends Row { channelType: string; channelId: string; userId: string; name: string; body: string; createdAt: string; kind?: string; roomCode?: string; roomName?: string }
interface UserRow extends User, Row { title?: string; guest?: boolean }
interface NoteRow extends Row { userId: string; kind: string; title: string; sub: string; link: string; createdAt: string; readAt: string | null }
interface SubRow extends Row { postId: string; spaceId: string; userId: string; status: "handed-in" | "returned" | "done"; note: string; at: string; feedback?: string }

const dmKey = (a: string, b: string) => [a, b].sort().join("~");

/** Stable, readable join code per space: "prc-7kq". */
function joinCodeFor(s: { id: string; code: string }): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let h = 2166136261;
  for (const ch of s.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let tail = "";
  for (let i = 0; i < 3; i++) {
    tail += alphabet[h % alphabet.length];
    h = Math.floor(h / alphabet.length);
  }
  return `${s.code.toLowerCase()}-${tail}`;
}
const byTime = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);

async function users(ctx: LocalCtx): Promise<Map<string, UserRow>> {
  return new Map((await ctx.db.list<UserRow>("users")).map((u) => [u.id, u]));
}

async function spaceBySlugOrId(ctx: LocalCtx, key: string): Promise<SpaceRow> {
  const s = (await ctx.db.get<SpaceRow>("spaces", key)) ?? (await ctx.db.list<SpaceRow>("spaces", (x) => x.slug === key))[0];
  if (!s) throw new NotFoundError("Space not found");
  return s;
}

async function membership(ctx: LocalCtx, spaceId: string, userId: string) {
  return ctx.db.get<MemberRow>("memberships", `${spaceId}:${userId}`);
}

async function requireMember(ctx: LocalCtx, spaceId: string) {
  const me = await requireMe(ctx);
  const m = await membership(ctx, spaceId, me.id);
  if (!m) throw new ForbiddenError("You're not in this space");
  return { me, m, isHost: m.role === "host" || m.role === "cohost" };
}

async function notify(ctx: LocalCtx, userId: string, kind: string, title: string, sub: string, link: string) {
  await ctx.db.put("notifications", { id: sortableId("nt"), userId, kind, title, sub, link, createdAt: ctx.now().toISOString(), readAt: null });
}

async function spaceUnread(ctx: LocalCtx, s: SpaceRow, meId: string): Promise<number> {
  const m = await membership(ctx, s.id, meId);
  if (!m) return 0;
  const msgs = await ctx.db.list<MsgRow>("messages", (x) => x.channelType === "space" && x.channelId === s.id && x.userId !== meId && x.createdAt > m.lastReadAt);
  const posts = await ctx.db.list<PostRow>("posts", (x) => x.spaceId === s.id && x.createdBy !== meId && x.createdAt > m.lastReadAt);
  return msgs.length + posts.length;
}

async function mySpaces(ctx: LocalCtx, meId: string): Promise<SpaceRow[]> {
  const mine = new Set((await ctx.db.list<MemberRow>("memberships", (m) => m.userId === meId)).map((m) => m.spaceId));
  return (await ctx.db.list<SpaceRow>("spaces", (s) => mine.has(s.id))).sort(byTime);
}

async function dmList(ctx: LocalCtx, meId: string) {
  const all = await ctx.db.list<MsgRow>("messages", (m) => m.channelType === "dm" && m.channelId.split("~").includes(meId));
  const u = await users(ctx);
  const byPeer = new Map<string, MsgRow[]>();
  for (const m of all) {
    const peer = m.channelId.split("~").find((x) => x !== meId) ?? meId;
    byPeer.set(peer, [...(byPeer.get(peer) ?? []), m]);
  }
  // Everyone you share a space with is reachable, even before the first message.
  const spaces = await mySpaces(ctx, meId);
  for (const s of spaces) for (const m of await ctx.db.list<MemberRow>("memberships", (x) => x.spaceId === s.id)) if (m.userId !== meId && !byPeer.has(m.userId)) byPeer.set(m.userId, []);
  const rows = [];
  for (const [peer, msgs] of byPeer) {
    const user = u.get(peer);
    if (!user || user.guest) continue;
    msgs.sort(byTime);
    const read = (await ctx.db.get<Row & { at: string }>("dm_reads", `${meId}:${dmKey(meId, peer)}`))?.at ?? "";
    const unread = msgs.filter((m) => m.userId !== meId && m.createdAt > read).length;
    const last = msgs[msgs.length - 1];
    rows.push({ id: peer, name: user.name, title: user.title ?? "", status: user.status, last: last ? { body: last.kind === "room" ? `Room · ${last.roomName}` : last.body, at: last.createdAt, mine: last.userId === meId } : null, unread });
  }
  return rows.sort((a, b) => (b.last?.at ?? "").localeCompare(a.last?.at ?? "") || a.name.localeCompare(b.name));
}

async function reviewItems(ctx: LocalCtx, meId: string) {
  const items: { id: string; kind: string; title: string; sub: string; action: string; link: string }[] = [];
  const hosted = new Set((await ctx.db.list<MemberRow>("memberships", (m) => m.userId === meId && (m.role === "host" || m.role === "cohost"))).map((m) => m.spaceId));
  const subs = await ctx.db.list<SubRow>("submissions", (s) => s.status === "handed-in" && hosted.has(s.spaceId));
  const byPost = new Map<string, SubRow[]>();
  for (const s of subs) byPost.set(s.postId, [...(byPost.get(s.postId) ?? []), s]);
  for (const [postId, list] of byPost) {
    const post = await ctx.db.get<PostRow>("posts", postId);
    const space = post ? await ctx.db.get<SpaceRow>("spaces", post.spaceId) : undefined;
    if (!post || !space) continue;
    items.push({ id: `handin:${postId}`, kind: "handin", title: `${list.length} hand-in${list.length === 1 ? "" : "s"} to review`, sub: `${post.title} · ${space.name}`, action: "Review", link: `/s/${space.slug}/work` });
  }
  const knocks = await ctx.db.list<NoteRow>("notifications", (n) => n.userId === meId && n.kind === "knock" && !n.readAt);
  for (const k of knocks) items.push({ id: `knock:${k.id}`, kind: "knock", title: k.title, sub: k.sub, action: "Join", link: k.link });
  // Must-read posts you haven't acknowledged yet (as a member).
  const memberOf = await ctx.db.list<MemberRow>("memberships", (m) => m.userId === meId && m.role !== "host" && m.role !== "cohost");
  for (const m of memberOf) {
    for (const p of await ctx.db.list<PostRow>("posts", (x) => x.spaceId === m.spaceId && x.mustRead)) {
      if (!(await ctx.db.get("post_acks", `${p.id}:${meId}`))) items.push({ id: `ack:${p.id}`, kind: "ack", title: `Please confirm: ${p.title}`, sub: "Must-read", action: "Open", link: `/s/${m.spaceId}` });
    }
  }
  return items;
}

async function postView(ctx: LocalCtx, p: PostRow, meId: string, members: MemberRow[], u: Map<string, UserRow>) {
  const acks = await ctx.db.list<Row & { postId: string; userId: string }>("post_acks", (a) => a.postId === p.id);
  const waiting = p.mustRead ? unacknowledged(members.map((m) => m.userId), acks.map((a) => a.userId), p.createdBy) : [];
  const subs = p.kind === "task" ? await ctx.db.list<SubRow>("submissions", (s) => s.postId === p.id) : [];
  return {
    ...p,
    authorName: u.get(p.createdBy)?.name ?? "Someone",
    acked: acks.length,
    audience: Math.max(0, members.length - 1),
    ackedByMe: acks.some((a) => a.userId === meId),
    notSeen: waiting.map((id) => u.get(id)?.name ?? id),
    handIns: subs.filter((s) => s.status === "handed-in").length,
    mySubmission: subs.find((s) => s.userId === meId) ?? null
  };
}

routes
  .get("nav", async (ctx) => {
    const me = await requireMe(ctx);
    const spaces = await mySpaces(ctx, me.id);
    const rooms = await ctx.db.list<Row & { name: string; code: string; endedAt: string | null; createdAt: string }>("rooms", (r) => !r.endedAt && Date.parse(r.createdAt) > ctx.now().getTime() - 12 * 3600_000);
    const dms = await dmList(ctx, me.id);
    const review = await reviewItems(ctx, me.id);
    const notes = await ctx.db.list<NoteRow>("notifications", (n) => n.userId === me.id && !n.readAt);
    const spaceRows = [];
    let chats = 0;
    for (const s of spaces) {
      const unread = await spaceUnread(ctx, s, me.id);
      chats += unread;
      spaceRows.push({ id: s.id, slug: s.slug, to: `/s/${s.slug}`, unread });
    }
    chats += dms.reduce((n, d) => n + d.unread, 0);
    return {
      me,
      brand: { name: "Loft", monogram: "L" },
      rooms: rooms.map((r) => ({ id: r.id, name: r.name, to: `/r/${r.code}`, people: 0 })),
      spaces: spaceRows,
      dms: dms.slice(0, 6).map((d) => ({ id: d.id, name: d.name, to: `/dm/${d.id}`, presence: d.status, note: d.status === "busy" ? "in a room" : undefined, canKnock: d.status === "available" })),
      counts: { review: review.length, chats, inbox: review.length + notes.length }
    };
  })
  .get("home", async (ctx) => {
    const me = await requireMe(ctx);
    const settings = await ctx.db.get("settings", me.id);
    const spaces = await mySpaces(ctx, me.id);
    const now = ctx.now();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);
    const all = await ctx.db.list<Row & { spaceId: string; title: string; startsAt: string; minutes: number }>("sessions");
    const ids = new Set(spaces.map((s) => s.id));
    const mineSessions = all.filter((x) => ids.has(x.spaceId)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const sp = new Map(spaces.map((s) => [s.id, s]));
    const live = await ctx.db.list<Row & { code: string; spaceId: string | null; endedAt: string | null; createdAt: string }>("rooms", (r) => !r.endedAt);
    const today = mineSessions
      .filter((x) => x.startsAt >= start.toISOString() && x.startsAt < end.toISOString())
      .map((x) => {
        const s = sp.get(x.spaceId)!;
        const startMs = Date.parse(x.startsAt);
        const isLive = now.getTime() >= startMs && now.getTime() < startMs + x.minutes * 60_000;
        return { ...x, spaceName: s.name, code: s.code, colour: s.colour, slug: s.slug, live: isLive, roomCode: live.find((r) => r.spaceId === s.id)?.code ?? null };
      });
    const next = (spaceId: string) => mineSessions.find((x) => x.spaceId === spaceId && Date.parse(x.startsAt) + x.minutes * 60_000 > now.getTime());
    return {
      me,
      settings,
      today,
      spaces: spaces.map((s) => ({ ...s, modeLabel: SPACE_MODES[s.mode].label, next: next(s.id)?.startsAt ?? null })),
      review: await reviewItems(ctx, me.id),
      rooms: live
    };
  })
  .get("spaces", async (ctx) => {
    const me = await requireMe(ctx);
    return mySpaces(ctx, me.id);
  })
  .post("spaces", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const name = str(input.name, 60);
    if (!name) throw new Error("Give the space a name");
    const mode = (Object.keys(SPACE_MODES) as SpaceMode[]).includes(input.mode as SpaceMode) ? (input.mode as SpaceMode) : "team";
    let slug = slugify(name) || "space";
    const taken = new Set((await ctx.db.list<SpaceRow>("spaces")).map((s) => s.slug));
    for (let i = 2; taken.has(slug); i++) slug = `${slugify(name)}-${i}`;
    const iso = ctx.now().toISOString();
    const space: SpaceRow = { id: newId("sp"), orgId: null, mode, code: str(input.code, 4).toUpperCase() || spaceCode(name), name, sub: str(input.sub, 80) || SPACE_MODES[mode].label, slug, colour: str(input.colour, 12) || "blue", roomSlug: slug, createdBy: me.id, createdAt: iso };
    await ctx.db.put("spaces", space);
    await ctx.db.put("memberships", { id: `${space.id}:${me.id}`, spaceId: space.id, userId: me.id, role: "host", lastReadAt: iso });
    ctx.changed("spaces");
    return space;
  })
  .get("spaces/:key", async (ctx, p) => {
    const s = await spaceBySlugOrId(ctx, p.key!);
    const { m, isHost } = await requireMember(ctx, s.id);
    const members = await ctx.db.list<MemberRow>("memberships", (x) => x.spaceId === s.id);
    const u = await users(ctx);
    const upcoming = (await ctx.db.list<PostRow>("posts", (x) => x.spaceId === s.id && x.kind === "task" && !!x.dueAt && x.dueAt > ctx.now().toISOString())).sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
    const sessions = (await ctx.db.list<Row & { spaceId: string; title: string; startsAt: string }>("sessions", (x) => x.spaceId === s.id && x.startsAt > ctx.now().toISOString())).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return {
      ...s,
      modeConfig: SPACE_MODES[s.mode],
      myRole: m.role,
      isHost,
      joinCode: joinCodeFor(s),
      members: members.map((x) => ({ userId: x.userId, role: x.role, name: u.get(x.userId)?.name ?? "?", status: u.get(x.userId)?.status ?? "offline", title: u.get(x.userId)?.title ?? "" })).sort((a, b) => (a.role === "host" ? -1 : b.role === "host" ? 1 : a.name.localeCompare(b.name))),
      upcoming: [...upcoming.map((t) => ({ kind: "task", title: t.title, at: t.dueAt! })), ...sessions.map((x) => ({ kind: "session", title: x.title, at: x.startsAt }))].sort((a, b) => a.at.localeCompare(b.at)).slice(0, 4)
    };
  })
  .post("spaces/:id/read", async (ctx, p) => {
    const { m } = await requireMember(ctx, p.id!);
    await ctx.db.patch<MemberRow>("memberships", m.id, { lastReadAt: ctx.now().toISOString() });
    ctx.changed("memberships");
    return { ok: true };
  })
  .get("spaces/:id/posts", async (ctx, p) => {
    const { me } = await requireMember(ctx, p.id!);
    const members = await ctx.db.list<MemberRow>("memberships", (x) => x.spaceId === p.id);
    const u = await users(ctx);
    const posts = (await ctx.db.list<PostRow>("posts", (x) => x.spaceId === p.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Promise.all(posts.map((x) => postView(ctx, x, me.id, members, u)));
  })
  .post("spaces/:id/posts", async (ctx, p, input) => {
    const { me, isHost } = await requireMember(ctx, p.id!);
    const kind = ["post", "notice", "task", "recap", "file"].includes(String(input.kind)) ? String(input.kind) : "post";
    if ((kind === "task" || kind === "notice") && !isHost) throw new ForbiddenError("Only hosts can post tasks and must-read notices");
    const body = str(input.body, 5000);
    const title = str(input.title, 160);
    if (!body && !title) throw new Error("Write something first");
    const post: PostRow = { id: sortableId("po"), spaceId: p.id!, kind, title, body, mustRead: kind === "notice" || input.mustRead === true, dueAt: str(input.dueAt, 40) || undefined, createdBy: me.id, createdAt: ctx.now().toISOString(), attachments: Array.isArray(input.attachments) ? input.attachments.slice(0, 10) : [] };
    await ctx.db.put("posts", post);
    const space = await spaceBySlugOrId(ctx, p.id!);
    if (post.mustRead || kind === "task") {
      for (const m of await ctx.db.list<MemberRow>("memberships", (x) => x.spaceId === p.id && x.userId !== me.id)) {
        await notify(ctx, m.userId, kind === "task" ? "task" : "notice", kind === "task" ? `New task: ${title || body.slice(0, 60)}` : `Please confirm: ${title || body.slice(0, 60)}`, space.name, `/s/${space.slug}`);
      }
    }
    ctx.changed("posts", "notifications");
    return post;
  })
  .post("posts/:id/ack", async (ctx, p) => {
    const me = await requireMe(ctx);
    const post = await ctx.db.get<PostRow>("posts", p.id!);
    if (!post) throw new NotFoundError("Post not found");
    await requireMember(ctx, post.spaceId);
    await ctx.db.put("post_acks", { id: `${post.id}:${me.id}`, postId: post.id, userId: me.id, at: ctx.now().toISOString() });
    ctx.changed("posts");
    return { ok: true };
  })
  .post("posts/:id/remind", async (ctx, p) => {
    const post = await ctx.db.get<PostRow>("posts", p.id!);
    if (!post) throw new NotFoundError("Post not found");
    const { isHost } = await requireMember(ctx, post.spaceId);
    if (!isHost) throw new ForbiddenError("Only hosts can send reminders");
    const members = await ctx.db.list<MemberRow>("memberships", (x) => x.spaceId === post.spaceId);
    const acks = await ctx.db.list<Row & { postId: string; userId: string }>("post_acks", (a) => a.postId === post.id);
    const space = await spaceBySlugOrId(ctx, post.spaceId);
    const waiting = unacknowledged(members.map((m) => m.userId), acks.map((a) => a.userId), post.createdBy);
    for (const uid of waiting) await notify(ctx, uid, "notice", `Reminder: ${post.title || "please confirm"}`, space.name, `/s/${space.slug}`);
    ctx.changed("notifications");
    return { reminded: waiting.length };
  })
  .post("posts/:id/handin", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const post = await ctx.db.get<PostRow>("posts", p.id!);
    if (!post || post.kind !== "task") throw new NotFoundError("Task not found");
    await requireMember(ctx, post.spaceId);
    await ctx.db.put("submissions", { id: `${post.id}:${me.id}`, postId: post.id, spaceId: post.spaceId, userId: me.id, status: "handed-in", note: str(input.note, 2000), at: ctx.now().toISOString() });
    const space = await spaceBySlugOrId(ctx, post.spaceId);
    for (const m of await ctx.db.list<MemberRow>("memberships", (x) => x.spaceId === post.spaceId && (x.role === "host" || x.role === "cohost"))) {
      await notify(ctx, m.userId, "handin", `${me.name.split(" ")[0]} handed in ${post.title}`, space.name, `/s/${space.slug}/work`);
    }
    ctx.changed("submissions", "notifications");
    return { ok: true };
  })
  .get("spaces/:id/work", async (ctx, p) => {
    const { me, isHost } = await requireMember(ctx, p.id!);
    const u = await users(ctx);
    const tasks = (await ctx.db.list<PostRow>("posts", (x) => x.spaceId === p.id && x.kind === "task")).sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? ""));
    const members = await ctx.db.list<MemberRow>("memberships", (x) => x.spaceId === p.id && x.role !== "host" && x.role !== "cohost");
    return Promise.all(
      tasks.map(async (t) => {
        const subs = await ctx.db.list<SubRow>("submissions", (s) => s.postId === t.id);
        return {
          ...t,
          assigned: members.length,
          submissions: isHost ? subs.map((s) => ({ ...s, name: u.get(s.userId)?.name ?? "?" })) : subs.filter((s) => s.userId === me.id)
        };
      })
    );
  })
  .post("submissions/:id/review", async (ctx, p, input) => {
    const sub = await ctx.db.get<SubRow>("submissions", p.id!);
    if (!sub) throw new NotFoundError("Hand-in not found");
    const { isHost } = await requireMember(ctx, sub.spaceId);
    if (!isHost) throw new ForbiddenError("Only hosts review hand-ins");
    const next = await ctx.db.patch<SubRow>("submissions", sub.id, { status: input.status === "returned" ? "returned" : "done", feedback: str(input.feedback, 2000) });
    ctx.changed("submissions");
    return next;
  })
  .get("spaces/:id/files", async (ctx, p) => {
    await requireMember(ctx, p.id!);
    const u = await users(ctx);
    return (await ctx.db.list<Row & { spaceId: string; createdAt: string; ownerId: string }>("files", (f) => f.spaceId === p.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((f) => ({ ...f, ownerName: u.get(f.ownerId)?.name ?? "?" }));
  })
  .post("spaces/:id/files", async (ctx, p, input) => {
    const { me } = await requireMember(ctx, p.id!);
    const ref = input.ref as { id: string; name: string; mime: string; bytes: number; sha256: string } | undefined;
    if (!ref?.id) throw new Error("Upload the file first");
    const row = { id: sortableId("fl"), fileId: ref.id, name: str(ref.name, 200), mime: ref.mime, bytes: ref.bytes, sha256: ref.sha256, spaceId: p.id!, ownerId: me.id, createdAt: ctx.now().toISOString() };
    await ctx.db.put("files", row);
    ctx.changed("files");
    return row;
  })
  .get("spaces/:id/messages", async (ctx, p) => {
    await requireMember(ctx, p.id!);
    return (await ctx.db.list<MsgRow>("messages", (m) => m.channelType === "space" && m.channelId === p.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
  })
  .post("spaces/:id/messages", async (ctx, p, input) => {
    const { me } = await requireMember(ctx, p.id!);
    const body = str(input.body, 2000);
    if (!body) throw new Error("Empty message");
    const m = { id: sortableId("msg"), channelType: "space", channelId: p.id!, userId: me.id, name: me.name, body, createdAt: ctx.now().toISOString() };
    await ctx.db.put("messages", m);
    ctx.changed("messages");
    return m;
  })
  .post("spaces/:id/members", async (ctx, p, input) => {
    const { isHost } = await requireMember(ctx, p.id!);
    if (!isHost) throw new ForbiddenError("Only hosts add people");
    const name = str(input.name, 60);
    if (!name) throw new Error("Name required");
    const role = ["member", "cohost", "payer", "guest"].includes(String(input.role)) ? String(input.role) : "member";
    const user = { id: newId("u"), name, email: str(input.email, 200), tz: "UTC", status: "offline", title: "", createdAt: ctx.now().toISOString() };
    await ctx.db.put("users", user);
    await ctx.db.put("memberships", { id: `${p.id}:${user.id}`, spaceId: p.id!, userId: user.id, role, lastReadAt: ctx.now().toISOString() });
    ctx.changed("memberships");
    return user;
  })
  .get("dms", async (ctx) => {
    const me = await requireMe(ctx);
    return dmList(ctx, me.id);
  })
  .get("dms/:userId", async (ctx, p) => {
    const me = await requireMe(ctx);
    const peer = await ctx.db.get<UserRow>("users", p.userId!);
    if (!peer) throw new NotFoundError("Person not found");
    const msgs = (await ctx.db.list<MsgRow>("messages", (m) => m.channelType === "dm" && m.channelId === dmKey(me.id, peer.id))).sort((a, b) => (a.id < b.id ? -1 : 1));
    return { peer: { id: peer.id, name: peer.name, status: peer.status, title: peer.title ?? "" }, messages: msgs };
  })
  .post("dms/:userId/messages", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const body = str(input.body, 2000);
    if (!body) throw new Error("Empty message");
    const m = { id: sortableId("msg"), channelType: "dm", channelId: dmKey(me.id, p.userId!), userId: me.id, name: me.name, body, createdAt: ctx.now().toISOString() };
    await ctx.db.put("messages", m);
    await ctx.db.put("dm_reads", { id: `${me.id}:${m.channelId}`, at: m.createdAt });
    ctx.changed("messages");
    return m;
  })
  .post("dms/:userId/read", async (ctx, p) => {
    const me = await requireMe(ctx);
    await ctx.db.put("dm_reads", { id: `${me.id}:${dmKey(me.id, p.userId!)}`, at: ctx.now().toISOString() });
    ctx.changed("dm_reads");
    return { ok: true };
  })
  // "Start a room together": a room plus an invite card in the DM. Knock does the same with a nudge.
  .post("dms/:userId/room", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const peer = await ctx.db.get<UserRow>("users", p.userId!);
    if (!peer) throw new NotFoundError("Person not found");
    const code = roomCode();
    const name = str(input.name, 60) || `${me.name.split(" ")[0]} + ${peer.name.split(" ")[0]}`;
    const room = { id: newId("rm"), spaceId: null, slug: code.toLowerCase(), code, name, capacity: ROOM_CAPACITY, guestJoin: false, createdBy: me.id, createdAt: ctx.now().toISOString(), endedAt: null };
    await ctx.db.put("rooms", room);
    const knock = input.knock === true;
    await ctx.db.put("messages", { id: sortableId("msg"), channelType: "dm", channelId: dmKey(me.id, peer.id), userId: me.id, name: me.name, body: knock ? "knocked" : `Room · ${name}`, kind: "room", roomCode: code, roomName: name, createdAt: ctx.now().toISOString() });
    await notify(ctx, peer.id, "knock", knock ? `${me.name.split(" ")[0]} knocked` : `${me.name.split(" ")[0]} started a room`, name, `/r/${code}`);
    ctx.changed("rooms", "messages", "notifications");
    return room;
  })
  .get("notifications", async (ctx) => {
    const me = await requireMe(ctx);
    return (await ctx.db.list<NoteRow>("notifications", (n) => n.userId === me.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  })
  .post("notifications/read-all", async (ctx) => {
    const me = await requireMe(ctx);
    for (const n of await ctx.db.list<NoteRow>("notifications", (x) => x.userId === me.id && !x.readAt)) await ctx.db.patch<NoteRow>("notifications", n.id, { readAt: ctx.now().toISOString() });
    ctx.changed("notifications");
    return { ok: true };
  })
  .post("notifications/:id/read", async (ctx, p) => {
    await requireMe(ctx);
    await ctx.db.patch<NoteRow>("notifications", p.id!, { readAt: ctx.now().toISOString() });
    ctx.changed("notifications");
    return { ok: true };
  })
  .get("review", async (ctx) => {
    const me = await requireMe(ctx);
    return reviewItems(ctx, me.id);
  });
