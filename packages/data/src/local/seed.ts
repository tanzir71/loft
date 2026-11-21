import { newId, sortableId } from "@loft/core";
import type { LocalDb } from "./db";

/** Bump when demo data changes; the local adapter wipes and re-seeds a browser whose data is older. */
export const SEED_VERSION = 3;

export const DEMO_HOST_ID = "u_nusrat";

const PEOPLE = [
  { id: "u_leena", name: "Leena Chowdhury", status: "available", title: "Co-host · Acme pricing" },
  { id: "u_farhan", name: "Farhan Ahmed", status: "away", title: "Product lead" },
  { id: "u_shirin", name: "Shirin Karim", status: "available", title: "Acme finance" },
  { id: "u_ayaan", name: "Ayaan Karim", status: "busy", title: "In a room" },
  { id: "u_mitu", name: "Mitu Das", status: "offline", title: "Designer" },
  { id: "u_rafi", name: "Rafi Hasan", status: "available", title: "Analyst" },
  { id: "u_sumaiya", name: "Sumaiya Khan", status: "away", title: "Learner" },
  { id: "u_tania", name: "Tania Roy", status: "offline", title: "Northwind ops" }
] as const;

interface SeedSpace {
  slug: string;
  name: string;
  sub: string;
  mode: "team" | "client" | "workshop" | "course" | "tutoring";
  code: string;
  colour: string;
  members: [string, "cohost" | "member" | "payer"][];
}

// Consulting and team examples first, tutoring second (handoff §6).
const SPACES: SeedSpace[] = [
  { slug: "acme-pricing", name: "Acme pricing", sub: "Acme Foods · Consulting", mode: "client", code: "PRC", colour: "blue", members: [["u_leena", "cohost"], ["u_shirin", "payer"], ["u_farhan", "member"], ["u_rafi", "member"]] },
  { slug: "northwind-retainer", name: "Northwind", sub: "Northwind · Retainer", mode: "client", code: "NWD", colour: "green", members: [["u_tania", "payer"], ["u_mitu", "member"]] },
  { slug: "product-weekly", name: "Product team", sub: "Internal · Team", mode: "team", code: "PRD", colour: "amber", members: [["u_farhan", "member"], ["u_mitu", "member"], ["u_leena", "member"]] },
  { slug: "acme-sprint", name: "Design sprint", sub: "Acme Foods · Workshop", mode: "workshop", code: "ACM", colour: "red", members: [["u_shirin", "member"], ["u_rafi", "member"], ["u_farhan", "member"]] },
  { slug: "studio-team", name: "Studio team", sub: "Internal · Team", mode: "team", code: "TEA", colour: "slate", members: [["u_mitu", "member"], ["u_leena", "member"]] },
  { slug: "physics-a", name: "HSC Physics", sub: "Section A · Course", mode: "course", code: "PHY", colour: "teal", members: [["u_ayaan", "member"], ["u_sumaiya", "member"]] }
];

const ago = (base: Date, minutes: number) => new Date(base.getTime() - minutes * 60_000).toISOString();

const at = (base: Date, dayOffset: number, h: number, m = 0) => {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

/** Host only (the "Home · first run" state). */
export async function seedHost(db: LocalDb, now: Date): Promise<void> {
  const iso = now.toISOString();
  await db.put("users", { id: DEMO_HOST_ID, name: "Nusrat Rahman", email: "nusrat@example.com", tz: "UTC", status: "available", createdAt: iso });
  await db.put("settings", { id: DEMO_HOST_ID, roomLink: "tanziro.com/spaces/r/nusrat", bookingPage: null, paymentLink: null, guestJoin: true });
  await db.setMeta("currentUserId", DEMO_HOST_ID);
  await db.setMeta("seedVersion", SEED_VERSION);
}

/**
 * Preview demo workspace. Everything lives in this browser's IndexedDB.
 * `empty: true` seeds only the host so Home shows the first-run state.
 */
export async function seed(db: LocalDb, now = new Date(), opts: { empty?: boolean } = {}): Promise<void> {
  await seedHost(db, now);
  if (opts.empty) return;
  const iso = now.toISOString();
  for (const p of PEOPLE) await db.put("users", { id: p.id, name: p.name, email: `${p.id.slice(2)}@example.com`, tz: "UTC", status: p.status, title: p.title, createdAt: iso });

  const spaceIds: Record<string, string> = {};
  for (const [i, s] of SPACES.entries()) {
    const id = `sp_${s.slug.replace(/-/g, "_")}`;
    spaceIds[s.slug] = id;
    // Staggered so the side panel keeps this order.
    await db.put("spaces", { id, orgId: null, mode: s.mode, code: s.code, name: s.name, sub: s.sub, slug: s.slug, colour: s.colour, roomSlug: s.slug, createdAt: ago(now, 60 * 24 * 30 - i), createdBy: DEMO_HOST_ID });
    await db.put("memberships", { id: `${id}:${DEMO_HOST_ID}`, spaceId: id, userId: DEMO_HOST_ID, role: "host", lastReadAt: ago(now, 60 * 24) });
    for (const [uid, role] of s.members) await db.put("memberships", { id: `${id}:${uid}`, spaceId: id, userId: uid, role, lastReadAt: iso });
  }

  // Acme pricing stream (Figma 04 · Space — Stream).
  const acme = spaceIds["acme-pricing"]!;
  const recap = { id: sortableId("po"), spaceId: acme, kind: "recap", title: "Recap: Pricing workshop, day 2", body: "We agreed to test two price points in two stores for two weeks. Board notes and the test plan are attached.", mustRead: false, createdBy: DEMO_HOST_ID, createdAt: at(now, -1, 17, 30), attachments: [{ name: "Board notes.pdf", meta: "4 annotated pages", kind: "file" }, { name: "Price test plan", meta: "Due Sat 17:00", kind: "task" }] };
  const notice = { id: sortableId("po"), spaceId: acme, kind: "notice", title: "Steering review moved to Monday 24 Nov, 10:00", body: "Same room link. Please confirm you've seen this.", mustRead: true, createdBy: DEMO_HOST_ID, createdAt: at(now, -3, 9, 15), attachments: [] };
  const task = { id: sortableId("po"), spaceId: acme, kind: "task", title: "Price test plan", body: "One page: stores, price points, what we measure, and the stop rule.", mustRead: false, dueAt: at(now, 2, 17), createdBy: DEMO_HOST_ID, createdAt: at(now, -1, 18), attachments: [] };
  for (const p of [notice, recap, task]) await db.put("posts", p);
  await db.put("post_acks", { id: `${notice.id}:u_leena`, postId: notice.id, userId: "u_leena", at: at(now, -3, 10) });
  await db.put("post_acks", { id: `${notice.id}:u_farhan`, postId: notice.id, userId: "u_farhan", at: at(now, -2, 8) });
  await db.put("submissions", { id: `${task.id}:u_rafi`, postId: task.id, spaceId: acme, userId: "u_rafi", status: "handed-in", note: "Draft attached; stop rule is a 5% drop in units.", at: at(now, 0, 9, 40) });

  const prd = spaceIds["product-weekly"]!;
  await db.put("posts", { id: sortableId("po"), spaceId: prd, kind: "post", title: "", body: "Retro board from Tuesday is in Files. Two actions carried over: onboarding copy and the pricing page.", mustRead: false, createdBy: "u_farhan", createdAt: at(now, -2, 15), attachments: [] });
  const phy = spaceIds["physics-a"]!;
  const ws = { id: sortableId("po"), spaceId: phy, kind: "task", title: "Worksheet 7 p2", body: "Projectile motion, questions 5–8.", mustRead: false, dueAt: at(now, 2, 22), createdBy: DEMO_HOST_ID, createdAt: at(now, -1, 16), attachments: [] };
  await db.put("posts", ws);
  await db.put("submissions", { id: `${ws.id}:u_sumaiya`, postId: ws.id, spaceId: phy, userId: "u_sumaiya", status: "handed-in", note: "", at: at(now, 0, 11, 5) });

  // Space chat + DMs (Figma 04 · Hallway — DM + start a room).
  const chat = async (channelType: string, channelId: string, userId: string, name: string, body: string, when: string, extra: Record<string, unknown> = {}) =>
    db.put("messages", { id: sortableId("msg"), channelType, channelId, userId, name, body, createdAt: when, ...extra });
  await chat("space", acme, "u_shirin", "Shirin Karim", "Thanks for the recap. Finance is fine with a two-week test.", ago(now, 60 * 20));
  await chat("space", acme, "u_leena", "Leena Chowdhury", "Slides for the steering review are up in Files.", ago(now, 95));
  await chat("space", prd, "u_farhan", "Farhan Ahmed", "storyboard v2 is on page 4", ago(now, 50));
  const dm = (a: string, b: string) => [a, b].sort().join("~");
  await chat("dm", dm(DEMO_HOST_ID, "u_leena"), "u_leena", "Leena Chowdhury", "Can you look at the pricing exercise before tonight's call? I think part 3 is too long.", ago(now, 34));
  await chat("dm", dm(DEMO_HOST_ID, "u_leena"), DEMO_HOST_ID, "Nusrat Rahman", "Sure. Easier on a board, give me 2 minutes.", ago(now, 31));
  await chat("dm", dm(DEMO_HOST_ID, "u_leena"), "u_leena", "Leena Chowdhury", "Perfect, cut part 3 in half.", ago(now, 5));
  await chat("dm", dm(DEMO_HOST_ID, "u_shirin"), "u_shirin", "Shirin Karim", "Invoice received, paying Friday.", ago(now, 60 * 26));
  await chat("dm", dm(DEMO_HOST_ID, "u_farhan"), "u_farhan", "Farhan Ahmed", "Back at 18:00", ago(now, 120));
  await db.put("dm_reads", { id: `${DEMO_HOST_ID}:${dm(DEMO_HOST_ID, "u_farhan")}`, at: ago(now, 100) });

  // Today's sessions (full scheduling arrives in M5).
  const sessions: [string, string, number, number, number][] = [
    ["acme-pricing", "Pricing workshop", 0, 16, 0],
    ["acme-sprint", "Sprint · Decide", 0, 18, 30],
    ["northwind-retainer", "Northwind review", 0, 20, 0],
    ["product-weekly", "Product weekly", 0, 21, 0],
    ["acme-pricing", "Steering review", 3, 10, 0],
    ["physics-a", "Kinematics II", 1, 16, 0]
  ];
  for (const [slug, title, d, h, m] of sessions) {
    await db.put("sessions", { id: newId("se"), spaceId: spaceIds[slug], title, startsAt: at(now, d, h, m), minutes: 60, room: "loft", status: "scheduled" });
  }

  // Notifications (Figma 07 · Notifications panel).
  const note = async (kind: string, title: string, sub: string, link: string, minutesAgo: number, read = false) =>
    db.put("notifications", { id: sortableId("nt"), userId: DEMO_HOST_ID, kind, title, sub, link, createdAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(), readAt: read ? iso : null });
  await note("handin", "Sumaiya handed in Worksheet 7 p2", "HSC Physics", "/s/physics-a/work", 180, false);
  await note("handin", "Rafi handed in Price test plan", "Acme pricing", "/s/acme-pricing/work", 120, false);
  await note("message", "Leena: Perfect, cut part 3 in half.", "Direct message", "/dm/u_leena", 30, false);
  await note("ack", "2 of 4 have seen the steering review move", "Acme pricing · must-read", "/s/acme-pricing", 600, true);
}
