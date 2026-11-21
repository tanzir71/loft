// Org admin · Calls & budget (Figma 04 · "Org admin (self-serve) · Calls & budget"). Every provider is
// optional and uses the org's own keys; P2P audio is free and always there; the own Meet/Zoom link is
// the fallback. Keys are shown as their last 4 characters only. Mirrors api/src/routes/live.php.
import { budgetStep, dailyPool, monthKey } from "@loft/core";
import type { Row } from "./db";
import { requireMe, routes, str, type LocalCtx } from "./routes";

interface Provider { on: boolean; keyLast4?: string | null; tokenLast4?: string | null; appIdLast4?: string | null; appTokenLast4?: string | null; privateKeyLast4?: string | null }
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

/** The secrets each provider takes (see api/src/routes/live.php PROVIDER_FIELDS). The preview keeps only their last 4 characters. */
const PROVIDER_FIELDS = { cloudflare: ["key", "token", "appId", "appToken"], daily: ["key"], jitsi: ["appId", "key", "privateKey"] } as const;

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
      // Video needs the real keys, which only the server keeps (encrypted); the preview never has them.
      video: null,
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
    const prov = (input.providers ?? {}) as Record<string, Record<string, unknown>>;
    for (const [name, fields] of Object.entries(PROVIDER_FIELDS) as [keyof typeof PROVIDER_FIELDS, readonly string[]][]) {
      const p = prov[name];
      if (!p) continue;
      const next: Provider & Record<string, unknown> = { ...s[name] };
      if (typeof p.on === "boolean") next.on = p.on;
      for (const f of fields) {
        const v = last4(p[f]);
        if (!v) continue;
        if (f === "privateKey" && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(String(p[f]))) throw new Error("That private key could not be read. Paste the whole PEM, including the BEGIN and END lines.");
        next[`${f}Last4`] = f === "privateKey" ? "PEM" : v;
      }
      s[name] = next;
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
    return { iceServers: [{ urls: `stun:${s.stun || DEFAULT_STUN}` }], ownLink: s.ownLink || null, video: null };
  })
  // Video (Cloudflare Realtime, Daily, Jitsi as a Service) runs on the server, which holds the org's keys.
  .post("rooms/:id/video/join", async () => {
    throw new Error("Video runs on your own server with your provider keys. This preview has P2P audio and stage mode.");
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
