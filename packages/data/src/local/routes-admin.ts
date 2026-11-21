// Org admin · Calls & budget (Figma 04 · "Org admin (self-serve) · Calls & budget"). Every provider is
// optional and uses the org's own keys; P2P audio is free and always there; the own Meet/Zoom link is
// the fallback. Keys are shown as their last 4 characters only. Mirrors api/src/routes/live.php.
import { budgetStep, dailyPool, monthKey } from "@loft/core";
import type { Row } from "./db";
import { requireMe, routes, str, type LocalCtx } from "./routes";

interface Provider { on: boolean; keyLast4?: string | null; tokenLast4?: string | null }
export interface CallSettings extends Row {
  ownLink: string;
  stun: string;
  p2p: boolean;
  cloudflare: Provider;
  daily: Provider;
  jitsi: Provider;
  budgetCents: number;
  /** Free participant-minutes a month the org's providers include (from their plan), if any. */
  freeMinutes: number;
  neverCut: boolean;
  usage: Record<string, { minutes: number; videoMinutes: number }>;
  savedAt: string | null;
}

export const DEFAULT_STUN = "stun.l.google.com:19302";
// Rough public list prices (participant-minute), for the budget estimate only.
const UNIT_CENTS_PER_MIN = 0.4;

export async function callSettings(ctx: LocalCtx, hostId: string): Promise<CallSettings> {
  return (await ctx.db.get<CallSettings>("call_settings", hostId)) ?? { id: hostId, ownLink: "", stun: DEFAULT_STUN, p2p: true, cloudflare: { on: false }, daily: { on: false }, jitsi: { on: false }, budgetCents: 0, freeMinutes: 0, neverCut: true, usage: {}, savedAt: null };
}

const last4 = (v: unknown) => (typeof v === "string" && v.trim().length >= 4 ? v.trim().slice(-4) : null);

routes
  .get("admin/calls", async (ctx) => {
    const me = await requireMe(ctx);
    const s = await callSettings(ctx, me.id);
    const now = ctx.now();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const pool = dailyPool({ freeMinutes: s.freeMinutes ?? 0, budgetCents: s.budgetCents, unitPriceCentsPerMinute: UNIT_CENTS_PER_MIN, daysInMonth: days });
    const today = now.toISOString().slice(0, 10);
    const hosted = new Set((await ctx.db.list<Row & { userId: string; spaceId: string; role: string }>("memberships", (m) => m.userId === me.id && m.role === "host")).map((m) => m.spaceId));
    const members = new Set((await ctx.db.list<Row & { userId: string; spaceId: string }>("memberships", (m) => hosted.has(m.spaceId) && m.userId !== me.id)).map((m) => m.userId));
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const active = (await ctx.db.list<Row & { lastSeenAt?: string }>("users", (u) => members.has(u.id) && (u.lastSeenAt ?? "") > since)).length;
    const last14 = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now.getTime() - (13 - i) * 86_400_000).toISOString().slice(0, 10);
      return { day: d, minutes: s.usage[d]?.minutes ?? 0, videoMinutes: s.usage[d]?.videoMinutes ?? 0 };
    });
    const sfu = s.cloudflare.on || s.daily.on || s.jitsi.on;
    return {
      settings: s,
      pool: sfu ? pool : null,
      activeMembers: active,
      perMember: sfu && active ? Math.round(pool / active) : null,
      today: s.usage[today] ?? { minutes: 0, videoMinutes: 0 },
      step: sfu ? budgetStep(s.usage[today]?.videoMinutes ?? 0, pool) : "full",
      last14,
      month: monthKey(now),
      spentCents: Math.round(Object.entries(s.usage).filter(([d]) => d.startsWith(monthKey(now))).reduce((n, [, u]) => n + u.videoMinutes, 0) * UNIT_CENTS_PER_MIN)
    };
  })
  .post("admin/calls", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const s = await callSettings(ctx, me.id);
    if (typeof input.ownLink === "string") {
      const l = str(input.ownLink, 300);
      if (l && !/^https:\/\//i.test(l)) throw new Error("Your own link must start with https://");
      s.ownLink = l;
    }
    if (typeof input.stun === "string") s.stun = str(input.stun, 200).replace(/^stun:/, "") || DEFAULT_STUN;
    if (typeof input.budgetCents === "number") s.budgetCents = Math.max(0, Math.min(1_000_000, Math.round(input.budgetCents)));
    if (typeof input.neverCut === "boolean") s.neverCut = input.neverCut;
    if (typeof input.freeMinutes === "number") s.freeMinutes = Math.max(0, Math.min(10_000_000, Math.round(input.freeMinutes)));
    const prov = (input.providers ?? {}) as Record<string, { on?: boolean; key?: string; token?: string }>;
    for (const name of ["cloudflare", "daily", "jitsi"] as const) {
      const p = prov[name];
      if (!p) continue;
      const cur = s[name];
      s[name] = { on: typeof p.on === "boolean" ? p.on : cur.on, keyLast4: last4(p.key) ?? cur.keyLast4 ?? null, tokenLast4: last4(p.token) ?? cur.tokenLast4 ?? null };
    }
    s.savedAt = ctx.now().toISOString();
    await ctx.db.put("call_settings", s);
    ctx.changed("call_settings");
    return s;
  })
  // What a room's call uses: STUN servers and the host's own link.
  .get("rooms/:id/call-config", async (ctx, p) => {
    const room = await ctx.db.get<Row & { createdBy: string }>("rooms", p.id!);
    const s = await callSettings(ctx, room?.createdBy ?? "");
    return { iceServers: [{ urls: `stun:${s.stun || DEFAULT_STUN}` }], ownLink: s.ownLink || null };
  })
  // Call minutes, reported by each tab once a minute while it's in a call (feeds the budget and "Last 14 days").
  .post("rooms/:id/usage", async (ctx, p, input) => {
    await requireMe(ctx);
    const room = await ctx.db.get<Row & { createdBy: string }>("rooms", p.id!);
    if (!room) return { ok: false };
    const s = await callSettings(ctx, room.createdBy);
    const day = ctx.now().toISOString().slice(0, 10);
    const u = s.usage[day] ?? { minutes: 0, videoMinutes: 0 };
    const m = Math.max(0, Math.min(5, Number(input.minutes) || 0));
    s.usage = { ...s.usage, [day]: { minutes: u.minutes + m, videoMinutes: u.videoMinutes + (input.video === true ? m : 0) } };
    await ctx.db.put("call_settings", s);
    return { ok: true };
  });
