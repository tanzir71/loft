import type { User } from "@loft/core";
import { ResourceRouter } from "../router";
import { NotFoundError } from "../types";
import type { LocalDb, Row } from "./db";

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
  .get("nav", async (ctx) => {
    const me = await requireMe(ctx);
    const spaces = await ctx.db.list<Row & { slug: string }>("spaces");
    const rooms = await ctx.db.list<Row & { name: string; code: string; people?: number }>("rooms", (r) => !r.endedAt);
    return {
      me,
      brand: { name: "Loft", monogram: "L" },
      rooms: rooms.map((r) => ({ id: r.id, name: r.name, to: `/r/${r.code}`, people: r.people ?? 0 })),
      spaces: spaces.map((s) => ({ id: s.id, slug: s.slug, to: `/s/${s.slug}`, unread: 0 })),
      dms: [],
      counts: { review: 0, chats: 0, inbox: 0 }
    };
  })
  .get("home", async (ctx) => {
    const me = await requireMe(ctx);
    const settings = await ctx.db.get("settings", me.id);
    const spaces = await ctx.db.list("spaces");
    const rooms = await ctx.db.list("rooms", (r) => !r.endedAt);
    return {
      me,
      settings,
      spaces,
      rooms,
      dms: [],
      counts: { review: 0, chats: 0, inbox: 0 }
    };
  });
