// Owner console + Brand studio (Figma 04 · "Owner · Organisations + branding switch", "Org admin ·
// Brand studio" on/off). Branding = one toggle + paid-until date, active until paid-until + 14 days.
// On Pages the demo host plays the owner. Mirrors api/src/routes/system.php.
import { newId, slugify, sortableId, type User } from "@loft/core";
import { ForbiddenError, NotFoundError } from "../types";
import type { Row } from "./db";
import { requireMe, routes, str, type LocalCtx } from "./routes";

export const THEMES = ["loft", "sunrise", "northwind", "aurelian"] as const;
export const APPLIES = ["app", "invoices", "certificates", "exports", "templates", "poweredBy"] as const;
export const OWNER_EMAIL = "hello@tanziro.com";

export interface OrgRow extends Row {
  hostId: string; slug: string; name: string; monogram: string; theme: (typeof THEMES)[number]; branded: boolean; brandedUntil: string | null; note: string;
  published: boolean; applies: Record<string, boolean>; requestedAt: string | null; createdAt: string;
}
interface UserRow extends User, Row { lastSeenAt?: string }
interface MemberRow extends Row { spaceId: string; userId: string; role: string }

const DAY = 86_400_000;

/** Branding is active while today ≤ paid-until + 14 days. */
export function brandingActive(org: OrgRow | undefined | null, now: number): boolean {
  return !!org && org.branded && !!org.brandedUntil && Date.parse(org.brandedUntil) + 14 * DAY >= now;
}

export async function orgForHost(ctx: LocalCtx, host: UserRow): Promise<OrgRow> {
  const found = (await ctx.db.list<OrgRow>("orgs", (o) => o.hostId === host.id))[0];
  if (found) return found;
  const taken = new Set((await ctx.db.list<OrgRow>("orgs")).map((o) => o.slug));
  let slug = slugify(host.name) || "org";
  for (let i = 2; taken.has(slug); i++) slug = `${slugify(host.name)}-${i}`;
  const org: OrgRow = { id: newId("org"), hostId: host.id, slug, name: host.name, monogram: host.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase(), theme: "loft", branded: false, brandedUntil: null, note: "", published: false, applies: Object.fromEntries(APPLIES.map((a) => [a, true])), requestedAt: null, createdAt: ctx.now().toISOString() };
  await ctx.db.put("orgs", org);
  return org;
}

/** The brand the shell shows: the host's published, active brand, else Loft. */
export async function navBrand(ctx: LocalCtx, me: UserRow) {
  const org = (await ctx.db.list<OrgRow>("orgs", (o) => o.hostId === me.id))[0];
  if (org && org.published && brandingActive(org, ctx.now().getTime())) return { name: org.name, monogram: org.monogram, theme: org.theme };
  return { name: "Loft", monogram: "L" };
}

async function requireOwner(ctx: LocalCtx) {
  const me = await requireMe(ctx);
  const owner = (await ctx.db.getMeta<string>("ownerUserId")) ?? (await ctx.db.getMeta<string>("currentUserId"));
  if (me.id !== owner) throw new ForbiddenError("Only the owner can do that");
  return me;
}

routes
  // Your profile (Settings): name, title, time zone.
  .post("profile", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const patch: Record<string, unknown> = {};
    if (typeof input.name === "string" && str(input.name, 80)) patch.name = str(input.name, 80);
    if (typeof input.title === "string") patch.title = str(input.title, 80);
    if (typeof input.tz === "string" && str(input.tz, 64)) patch.tz = str(input.tz, 64);
    const next = await ctx.db.patch<UserRow>("users", me.id, patch);
    ctx.changed("users", "me", "nav");
    return next;
  })
  .get("owner", async (ctx) => {
    await requireOwner(ctx);
    const t = ctx.now().getTime();
    const users = new Map((await ctx.db.list<UserRow>("users")).map((u) => [u.id, u]));
    const hosts = new Map<string, string[]>();
    for (const m of await ctx.db.list<MemberRow>("memberships", (x) => x.role === "host")) hosts.set(m.userId, [...(hosts.get(m.userId) ?? []), m.spaceId]);
    for (const [hid] of hosts) if (users.get(hid)) await orgForHost(ctx, users.get(hid)!);
    const contacts = await ctx.db.list<Row & { email: string; organisation: string; createdAt: string }>("contact_messages");
    const orgs = [];
    for (const o of await ctx.db.list<OrgRow>("orgs")) {
      const host = users.get(o.hostId);
      const spaceIds = hosts.get(o.hostId) ?? [];
      const members = new Set((await ctx.db.list<MemberRow>("memberships", (m) => spaceIds.includes(m.spaceId))).map((m) => m.userId));
      const active = o.activeOverride ?? [...members].filter((id) => (users.get(id)?.lastSeenAt ?? "") > new Date(t - 30 * DAY).toISOString()).length;
      const ends = o.branded && o.brandedUntil ? Math.ceil((Date.parse(o.brandedUntil) - t) / DAY) : null;
      orgs.push({ ...o, hostName: host?.name ?? (o.hostName as string) ?? "", hostEmail: host?.email ?? (o.hostEmail as string) ?? "", spaces: spaceIds.length, members: members.size, activeMembers: active, active: brandingActive(o, t), endsInDays: ends, askedByEmail: !o.branded && (!!o.requestedAt || contacts.some((c) => c.email === host?.email || c.organisation === o.name)) });
    }
    const log = (await ctx.db.list<Row & { at: string; actor: string; action: string; data: Record<string, unknown> }>("audit")).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50).map((l) => ({ ...l, actor: users.get(l.actor)?.name ?? l.actor }));
    return { orgs: orgs.sort((a, b) => a.name.localeCompare(b.name)), log, contacts: contacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20), version: "preview" };
  })
  .post("owner/orgs/:id", async (ctx, p, input) => {
    const me = await requireOwner(ctx);
    const org = await ctx.db.get<OrgRow>("orgs", p.id!);
    if (!org) throw new NotFoundError("Organisation not found");
    const patch: Partial<OrgRow> = {};
    if (typeof input.branded === "boolean") patch.branded = input.branded;
    if ("brandedUntil" in input) patch.brandedUntil = input.brandedUntil ? str(input.brandedUntil, 10) : null;
    if (typeof input.note === "string") patch.note = str(input.note, 500);
    const next = await ctx.db.patch<OrgRow>("orgs", org.id, patch);
    await ctx.db.put("audit", { id: sortableId("au"), at: ctx.now().toISOString(), actor: me.id, action: "branding", data: { org: next.name, branded: next.branded, until: next.brandedUntil, note: next.note } });
    if (input.notify === true && next.branded && next.hostId) {
      await ctx.db.put("notifications", { id: sortableId("nt"), userId: next.hostId, kind: "brand", title: "Branding is on", sub: `Until ${next.brandedUntil ?? "—"} · open Brand studio to publish`, link: "/brand", createdAt: ctx.now().toISOString(), readAt: null });
    }
    ctx.changed("orgs", "notifications", "nav");
    return { ...next, active: brandingActive(next, ctx.now().getTime()) };
  })
  .get("brand", async (ctx) => {
    const me = (await requireMe(ctx)) as UserRow;
    const org = await orgForHost(ctx, me);
    const active = brandingActive(org, ctx.now().getTime());
    const subject = `Branding for ${org.name}`;
    return {
      org,
      active,
      endsInDays: org.brandedUntil ? Math.ceil((Date.parse(org.brandedUntil) - ctx.now().getTime()) / DAY) : null,
      ownerEmail: OWNER_EMAIL,
      link: `tanziro.com/spaces/${org.slug}`,
      request: { to: OWNER_EMAIL, subject, body: `Hi, please switch on branding for ${org.name} (${me.email ?? ""}). Address: tanziro.com/spaces/${org.slug}. Monthly or yearly: yearly.` }
    };
  })
  .post("brand", async (ctx, _p, input) => {
    const me = (await requireMe(ctx)) as UserRow;
    const org = await orgForHost(ctx, me);
    const patch: Partial<OrgRow> = {};
    if (typeof input.name === "string") patch.name = str(input.name, 60) || org.name;
    if (typeof input.monogram === "string") patch.monogram = str(input.monogram, 2).toUpperCase() || org.monogram;
    if (THEMES.includes(input.theme as OrgRow["theme"])) patch.theme = input.theme as OrgRow["theme"];
    if (typeof input.slug === "string") {
      const slug = slugify(str(input.slug, 40));
      if (!slug) throw new Error("Pick an address");
      if ((await ctx.db.list<OrgRow>("orgs", (o) => o.slug === slug && o.id !== org.id)).length) throw new Error("That address is taken");
      patch.slug = slug;
    }
    if (input.applies && typeof input.applies === "object") patch.applies = { ...org.applies, ...Object.fromEntries(Object.entries(input.applies as Record<string, unknown>).filter(([k, v]) => (APPLIES as readonly string[]).includes(k) && typeof v === "boolean")) } as Record<string, boolean>;
    if (input.requested === true) patch.requestedAt = ctx.now().toISOString();
    if (input.publish === true) {
      if (!brandingActive(org, ctx.now().getTime())) throw new ForbiddenError("Branding is off for this organisation. Ask for branding by email first.");
      patch.published = true;
    }
    if (input.publish === false) patch.published = false;
    const next = await ctx.db.patch<OrgRow>("orgs", org.id, patch);
    ctx.changed("orgs", "nav");
    return next;
  });
