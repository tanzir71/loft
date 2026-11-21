import { DEFAULT_REMINDER_SUBJECT, DEFAULT_REMINDER_TEXT, DEFAULT_REMINDERS, demoDrafts, LINK_DAYS, monthKey, newId, prevMonthKey, sortableId, type AttendanceStatus } from "@loft/core";
import type { LocalDb } from "./db";
import type { LocalCtx } from "./routes";
import { buildDrafts, confirmPayment, recordAttendance, sellPackage, sendInvoice, type InvoiceRow, type MoneySettings } from "./routes-money";

/** Bump when demo data changes; the local adapter wipes and re-seeds a browser whose data is older. */
export const SEED_VERSION = 9;

export const DEMO_HOST_ID = "u_nusrat";

// Demo phone numbers are fictional (+880 1700 0000xx) and only used to build wa.me links.
const PEOPLE = [
  { id: "u_leena", name: "Leena Chowdhury", status: "available", title: "Co-host · Acme pricing", phone: "" },
  { id: "u_farhan", name: "Farhan Ahmed", status: "away", title: "Product lead", phone: "" },
  { id: "u_shirin", name: "Shirin Karim", status: "available", title: "Acme finance · parent", phone: "+880 1700 000001" },
  { id: "u_ayaan", name: "Ayaan Karim", status: "busy", title: "In a room", phone: "" },
  { id: "u_mitu", name: "Mitu Das", status: "offline", title: "Designer", phone: "" },
  { id: "u_rafi", name: "Rafi Hasan", status: "available", title: "Analyst", phone: "" },
  { id: "u_sumaiya", name: "Sumaiya Khan", status: "away", title: "Learner", phone: "+880 1700 000002" },
  { id: "u_tania", name: "Tania Roy", status: "offline", title: "Northwind ops", phone: "+880 1700 000003" },
  { id: "u_dipa", name: "Dipa Saha", status: "offline", title: "Learner", phone: "" }
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
  { slug: "physics-a", name: "HSC Physics", sub: "Section A · Course", mode: "course", code: "PHY", colour: "teal", members: [["u_ayaan", "member"], ["u_sumaiya", "member"], ["u_dipa", "member"]] }
];

// Billing per space (Figma 06 · I1). Physics bills each learner; client spaces bill the client once per session.
const BILLING: Record<string, Record<string, unknown>> = {
  "physics-a": { model: "per_session", unitPriceCents: 1500, per: "member", payers: { u_ayaan: "u_shirin", u_sumaiya: "u_sumaiya" } },
  "acme-pricing": { model: "per_hour", unitPriceCents: 15000, per: "session", payers: { "*": "u_shirin" } },
  "acme-sprint": { model: "per_session", unitPriceCents: 30000, per: "session", payers: { "*": "u_shirin" } },
  "northwind-retainer": { model: "monthly", unitPriceCents: 120000, per: "session", payers: { "*": "u_tania" } }
};
const DAY = 86_400_000;

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
  // Last seen / last login (minutes ago) for Insights.
  const SEEN: Record<string, number> = { u_leena: 30, u_farhan: 60 * 24 * 3, u_shirin: 300, u_ayaan: 10, u_mitu: 60 * 24 * 12, u_rafi: 60 * 26, u_sumaiya: 120, u_tania: 60 * 24 * 8, u_dipa: 60 * 24 * 9 };
  for (const p of PEOPLE) await db.put("users", { id: p.id, name: p.name, email: `${p.id.slice(2)}@example.com`, phone: p.phone, tz: "UTC", status: p.status, title: p.title, createdAt: iso, lastSeenAt: ago(now, SEEN[p.id] ?? 60), lastLoginAt: ago(now, (SEEN[p.id] ?? 60) + 45) });

  const spaceIds: Record<string, string> = {};
  for (const [i, s] of SPACES.entries()) {
    const id = `sp_${s.slug.replace(/-/g, "_")}`;
    spaceIds[s.slug] = id;
    // Staggered so the side panel keeps this order.
    await db.put("spaces", { id, orgId: null, mode: s.mode, code: s.code, name: s.name, sub: s.sub, slug: s.slug, colour: s.colour, roomSlug: s.slug, createdAt: ago(now, 60 * 24 * 30 - i), createdBy: DEMO_HOST_ID, ...(BILLING[s.slug] ? { billing: BILLING[s.slug] } : {}) });
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
  const sessionIds: Record<string, string> = {};
  let steeringId: string | undefined;
  for (const [slug, title, d, h, m] of sessions) {
    const id = newId("se");
    sessionIds[title] = id;
    if (title === "Steering review") steeringId = id;
    await db.put("sessions", { id, spaceId: spaceIds[slug], title, startsAt: at(now, d, h, m), minutes: 60, room: "loft", status: "scheduled", sequence: 0 });
  }
  // A weekly series (Mon/Wed 16:00) for the course, materialised as rows from the start of last month.
  const seriesId = newId("sr");
  const physicsSessions: { id: string; startsAt: string }[] = [];
  await db.put("series", { id: seriesId, spaceId: spaceIds["physics-a"], rule: { days: [1, 3], time: "16:00", minutes: 60 }, createdAt: iso });
  const today0 = new Date(now);
  today0.setHours(0, 0, 0, 0);
  const firstPrev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const dStart = -Math.round((today0.getTime() - firstPrev.getTime()) / DAY);
  for (let d = dStart; d <= 28; d++) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    if (day.getDay() !== 1 && day.getDay() !== 3) continue;
    const sid = newId("se");
    physicsSessions.push({ id: sid, startsAt: at(now, d, 16) });
    await db.put("sessions", { id: sid, spaceId: spaceIds["physics-a"], seriesId, title: "Physics · Section A", startsAt: at(now, d, 16), minutes: 60, room: "loft", status: "scheduled", sequence: 0 });
  }

  // Plans (Figma 06 · row A): Lesson 6 attached to the next Physics session, Lesson 7 a draft,
  // last week's lesson taught-but-not-wrapped (shows "Wrap-up pending").
  const blk = (id: string, title: string, type: string, minutes: number, memberText: string, hostNotes = "", visible = true) => ({ id, title, type, minutes, memberText, hostNotes, resources: type === "board" ? [{ kind: "board", label: "Board · blank grid" }] : [], visible });
  const next = physicsSessions.find((x) => Date.parse(x.startsAt) > now.getTime());
  // The lesson waiting for its wrap-up is an extra session that ended 2 h ago, so it is always inside
  // the 24 h window before auto-wrap (the Mon/Wed series alone would make this depend on the weekday).
  const past = { id: newId("se"), startsAt: new Date(now.getTime() - 3 * 3600_000).toISOString() };
  await db.put("sessions", { id: past.id, spaceId: spaceIds["physics-a"], title: "Physics · extra session", startsAt: past.startsAt, minutes: 60, room: "loft", status: "scheduled", sequence: 0 });
  const lesson6 = [
    blk("b1", "Check-in", "talk", 5, "What did you notice about last week's homework?"),
    blk("b2", "Predict", "board", 10, "Which launch angle lands furthest? Write your guess on the board before we test.", "Expect 45°. Ask Rafi first; he guessed 60° last week."),
    blk("b3", "Simulation lab", "activity", 20, "Pairs test 15°–75° in the simulation and log ranges"),
    blk("b4", "Share findings", "board", 10, "Each pair plots their best angle"),
    blk("b5", "Exit ticket", "check", 5, "3 questions · auto-graded"),
    blk("b6", "Set homework", "handout", 5, "Worksheet 7 p2 · due in 2 days")
  ];
  await db.put("plans", { id: "pl_lesson6", spaceId: spaceIds["physics-a"], title: "Lesson 6 · Projectiles lab", minutes: 60, objective: "Predict range from launch angle", tags: ["Predict range from launch angle", "Test a prediction with data"], unit: "Unit 3", order: 1, status: "draft", blocks: lesson6, sessionId: next?.id ?? null, version: 3, createdAt: ago(now, 60 * 30), updatedAt: ago(now, 2) });
  if (next) await db.put("sessions", { ...(await db.get<Record<string, unknown> & { id: string }>("sessions", next.id))!, planId: "pl_lesson6" });
  await db.put("plans", { id: "pl_lesson7", spaceId: spaceIds["physics-a"], title: "Lesson 7 · Energy and work", minutes: 60, objective: "Relate work done to energy change", tags: ["Work–energy theorem"], unit: "Unit 3", order: 2, status: "draft", blocks: [blk("c1", "Warm-up", "talk", 5, "Lift a book: where did the energy go?"), blk("c2", "Derive W = Fd", "board", 15, "Together on the board")], sessionId: null, version: 1, createdAt: ago(now, 60 * 20), updatedAt: ago(now, 60 * 20) });
  {
    await db.put("plans", { id: "pl_lesson5", spaceId: spaceIds["physics-a"], title: "Lesson 5 · Vectors", minutes: 60, objective: "Resolve vectors into components", tags: ["Resolve vectors"], unit: "Unit 3", order: 0, status: "draft", blocks: [blk("a1", "Check-in", "talk", 10, "Quick recap"), blk("a2", "Components", "board", 30, "Resolve forces on a slope"), blk("a3", "Practice", "activity", 15, "Worksheet 6"), blk("a4", "Set homework", "handout", 5, "Worksheet 6 p2")], sessionId: past.id, version: 2, createdAt: ago(now, 60 * 24 * 9), updatedAt: ago(now, 60 * 24 * 8) });
    await db.put("sessions", { ...(await db.get<Record<string, unknown> & { id: string }>("sessions", past.id))!, planId: "pl_lesson5" });
    const roomId = `rm_past_${past.id}`;
    await db.put("rooms", { id: roomId, spaceId: spaceIds["physics-a"], sessionId: past.id, slug: "past", code: "PST-RM2", name: "Physics · Section A", capacity: 12, guestJoin: false, createdBy: DEMO_HOST_ID, createdAt: past.startsAt, endedAt: new Date(Date.parse(past.startsAt) + 3600_000).toISOString() });
    await db.put("attendance_events", { id: `${roomId}:u_ayaan`, roomId, userId: "u_ayaan", joinedAt: past.startsAt, leftAt: new Date(Date.parse(past.startsAt) + 58 * 60_000).toISOString() });
  }
  if (steeringId) {
    const s = await db.get<Record<string, unknown> & { id: string }>("sessions", steeringId);
    await db.put("plans", { id: "pl_steering", spaceId: spaceIds["acme-pricing"], title: "Steering review", minutes: 60, objective: "Agree the price test and owners", tags: ["Price test decision"], unit: "Pricing project", order: 0, status: "draft", blocks: [blk("s1", "Since last time", "talk", 10, "Two-week test status"), blk("s2", "Review the numbers", "board", 20, "Units and revenue by store"), blk("s3", "Options", "activity", 15, "Three price paths"), blk("s4", "Decisions + owners", "talk", 10, "Who does what by Friday"), blk("s5", "Actions", "handout", 5, "Action list")], sessionId: steeringId, version: 1, createdAt: ago(now, 60 * 30), updatedAt: ago(now, 60 * 30) });
    if (s) await db.put("sessions", { ...s, planId: "pl_steering" });
  }

  // Availability + booking types (Figma 06 · S3) and a booking page at /book/nusrat (S4).
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  await db.put("availability", {
    id: DEMO_HOST_ID,
    tz,
    weekly: { 1: [{ start: "10:00", end: "13:00" }], 2: [{ start: "10:00", end: "13:00" }], 3: [{ start: "14:00", end: "17:00" }], 4: [{ start: "10:00", end: "13:00" }], 5: [{ start: "10:00", end: "14:00" }] },
    rules: { bufferMin: 15, noticeHours: 12, maxPerDay: 4, horizonDays: 30 },
    handle: "nusrat",
    bio: "Pricing and product strategy for small teams",
    feedToken: newId(),
    busyIcs: ""
  });
  await db.put("booking_types", { id: "bt_discovery", userId: DEMO_HOST_ID, name: "Discovery call", minutes: 30, priceCents: 0, destSpaceId: null, approval: "manual", blurb: "A short call to see if we're a good fit. You'll get a calendar invite and a room link by email." });
  await db.put("booking_types", { id: "bt_strategy", userId: DEMO_HOST_ID, name: "Strategy session", minutes: 60, priceCents: 15000, destSpaceId: spaceIds["acme-pricing"], approval: "auto", blurb: "A working session on your pricing or launch plan." });
  await db.put("booking_types", { id: "bt_intro", userId: DEMO_HOST_ID, name: "Workshop intro", minutes: 45, priceCents: 0, destSpaceId: spaceIds["acme-sprint"], approval: "auto", blurb: "Plan a design sprint with your team." });

  // A pending move request (S5) and a booking waiting for approval.
  const steering = steeringId;
  if (steering) {
    const proposed = new Date(at(now, 4, 11));
    await db.put("change_requests", { id: "rq_demo", sessionId: steering, memberId: "u_rafi", kind: "move", proposedStartsAt: proposed.toISOString(), note: "I'm travelling Monday morning.", status: "pending", createdAt: ago(now, 90) });
  }
  const bookingSession = newId("se");
  await db.put("sessions", { id: bookingSession, spaceId: spaceIds["acme-pricing"], title: "Discovery call · Rina Saha", startsAt: at(now, 2, 10, 30), minutes: 30, room: "loft", status: "requested", sequence: 0, bookingId: "bk_demo" });
  await db.put("bookings", { id: "bk_demo", typeId: "bt_discovery", hostId: DEMO_HOST_ID, sessionId: bookingSession, guestName: "Rina Saha", guestEmail: "rina@example.com", note: "We're launching a snack range and want to test prices.", status: "requested", manageToken: "demo-manage-token", createdAt: ago(now, 60) });

  // Notifications (Figma 07 · Notifications panel).
  const note = async (kind: string, title: string, sub: string, link: string, minutesAgo: number, read = false) =>
    db.put("notifications", { id: sortableId("nt"), userId: DEMO_HOST_ID, kind, title, sub, link, createdAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(), readAt: read ? iso : null });
  await note("handin", "Sumaiya handed in Worksheet 7 p2", "HSC Physics", "/s/physics-a/work", 180, false);
  await note("handin", "Rafi handed in Price test plan", "Acme pricing", "/s/acme-pricing/work", 120, false);
  await note("message", "Leena: Perfect, cut part 3 in half.", "Direct message", "/dm/u_leena", 30, false);
  await note("ack", "2 of 4 have seen the steering review move", "Acme pricing · must-read", "/s/acme-pricing", 600, true);

  await seedMoney(db, now, spaceIds, physicsSessions, past.id);
  await seedChecks(db, now, phy);
  await seedAgents(db, now, spaceIds, sessionIds);
  await seedOrgs(db, now);
}

/** Owner console demo (Figma 04 · Owner): on Pages the demo host plays the owner. */
async function seedOrgs(db: LocalDb, now: Date) {
  const t = now.getTime();
  const day = (d: number) => new Date(t + d * DAY).toISOString().slice(0, 10);
  await db.setMeta("ownerUserId", DEMO_HOST_ID);
  const all = { app: true, invoices: true, certificates: true, exports: true, templates: true, poweredBy: true };
  const org = (id: string, name: string, slug: string, email: string, theme: string, branded: boolean, until: string | null, active: number, extra: Record<string, unknown> = {}) =>
    db.put("orgs", { id, hostId: `demo_${id}`, hostName: name, hostEmail: email, slug, name, monogram: name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase(), theme, branded, brandedUntil: until, note: "", published: branded, applies: all, requestedAt: null, createdAt: new Date(t - 90 * DAY).toISOString(), activeOverride: active, ...extra });
  await org("org_sunrise", "Sunrise Academy", "sunrise", "office@sunriseacademy.example", "sunrise", true, day(365), 214, { note: "Yearly · bank transfer" });
  await org("org_northwind", "Northwind Consulting", "northwind", "ops@northwind.example", "northwind", true, day(74), 38);
  await org("org_bright", "Bright Minds Academy", "bright-minds", "admin@brightminds.example", "aurelian", true, day(9), 140);
  await org("org_acme", "Acme Foods", "acme-foods", "shirin@acmefoods.example", "loft", false, null, 12, { requestedAt: new Date(t - 2 * DAY).toISOString() });
  await db.put("orgs", { id: "org_nusrat", hostId: DEMO_HOST_ID, slug: "nusrat", name: "Nusrat Rahman", monogram: "NR", theme: "loft", branded: false, brandedUntil: null, note: "", published: false, applies: all, requestedAt: null, createdAt: new Date(t - 30 * DAY).toISOString() });
}

/** Agents demo (Figma 06 · A1–A5): two links, three seats, a prep queue and drafts on the room's draft layer. */
async function seedAgents(db: LocalDb, now: Date, spaceIds: Record<string, string>, sessionIds: Record<string, string>) {
  const t = now.getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  const sprint = spaceIds["acme-sprint"]!;
  const sessionId = sessionIds["Sprint · Decide"]!;
  const session = await db.get<Record<string, unknown> & { id: string; startsAt: string; title: string }>("sessions", sessionId);
  // The session's room, with one page, so board drafts have somewhere to land.
  const roomId = "rm_sprint_decide";
  await db.put("rooms", { id: roomId, spaceId: sprint, sessionId, slug: "spr-dcd", code: "SPR-DCD", name: "Sprint · Decide", capacity: 12, guestJoin: false, createdBy: DEMO_HOST_ID, createdAt: iso(t - DAY), endedAt: null });
  await db.appendOps(roomId, [{ actor: DEMO_HOST_ID, ts: t - DAY, kind: "add", payload: { page: { id: "pg_decide", title: "Decide board", order: 1, x: 0, y: 0, w: 1200, h: 750, bg: null } } }] as never);
  if (session) await db.put("sessions", { ...session, prepared: { roomId } });
  const exp = iso(t + LINK_DAYS * DAY - 2 * DAY);
  await db.put("agent_links", { id: "al_workspace", hostId: DEMO_HOST_ID, scope: "workspace", scopeId: null, token: "w7Rk2mXq9Lp4Tz8Vb3Nc", expiresAt: exp, paused: false, liveEdits: false, createdAt: iso(t - 9 * DAY) });
  await db.put("agent_links", { id: "al_sprint", hostId: DEMO_HOST_ID, scope: "space", scopeId: sprint, token: "s9k2mQx7Hd4Rw8Pf1Lc6", expiresAt: exp, paused: false, liveEdits: false, createdAt: iso(t - 5 * DAY) });
  let order = 0;
  const seat = (id: string, linkId: string, name: string, runtime: string, version: string, seatNo: number, status: string, seenMin: number) =>
    db.put("agent_seats", { id, linkId, hostId: DEMO_HOST_ID, name, runtime, version, seatNo, status, createdAt: iso(t - 5 * DAY + order++ * 60_000), lastSeenAt: iso(t - seenMin * 60_000), bucket: null });
  await seat("seat_codex", "al_sprint", "codex", "codex-cli", "0.9", 1, "approved", 2);
  await seat("seat_claude", "al_workspace", "claude", "claude-code", "1.0", 1, "approved", 12);
  await seat("seat_codex2", "al_sprint", "codex (laptop)", "codex-cli", "0.9", 2, "pending", 1);
  const task = (id: string, template: string, title: string, status: string, seatId: string | null, extra: Record<string, unknown> = {}) =>
    db.put("prep_tasks", { id, hostId: DEMO_HOST_ID, spaceId: sprint, sessionId, roomId: null, template, title, brief: "", attachments: [], readyBy: session ? iso(Date.parse(session.startsAt) - 2 * 3600_000) : null, who: null, post: false, status, seatId, claimedAt: seatId ? iso(t - 3 * 3600_000) : null, doneAt: status === "ready" ? iso(t - 3600_000) : null, minutes: 0, report: "", question: null, feedback: null, createdAt: iso(t - 2 * DAY), ...extra });
  const draft = (taskId: string, seatId: string, d: { kind: string; title: string; sub: string; payload: Record<string, unknown> }, minsAgo: number) =>
    db.put("agent_drafts", { id: newId("dr"), taskId, hostId: DEMO_HOST_ID, seatId, ...d, status: "pending", reason: null, createdAt: iso(t - minsAgo * 60_000) });
  const ev = (taskId: string | null, seatId: string | null, kind: string, text: string, minsAgo: number, minutes = 0) =>
    db.put("agent_events", { id: sortableId("ae"), hostId: DEMO_HOST_ID, taskId, seatId, linkId: null, kind, text, minutes, at: iso(t - minsAgo * 60_000) });

  const brief = "Three sections: Map (customer journey), Decide (price options with dot voting), Storyboard (6 frames). Use the numbers from the Q3 panel.";
  await task("pt_board", "board_brief", "Board from the brief", "working", "seat_codex", { brief, attachments: ["brief.pdf", "q3-panel.csv"], roomId, minutes: 38 });
  const board = demoDrafts("board_brief", { title: session?.title ?? "Sprint · Decide", brief, minutes: 90, anchor: { x: 40, y: 60 } }).filter((d) => d.kind === "board_ops");
  for (const [i, d] of board.entries()) {
    const ops = (d.payload.ops as { kind: string; payload: { obj: Record<string, unknown> } }[]).map((o) => ({ ...o, payload: { obj: { ...o.payload.obj, by: "agent:codex" } } }));
    await draft("pt_board", "seat_codex", { ...d, payload: { ops } }, 3 - i);
  }
  await ev("pt_board", "seat_codex", "claim", "claimed Board from the brief", 40);
  await ev("pt_board", "seat_codex", "draft", "added section 'Map' + 4 stickies", 2);
  await ev("pt_board", "seat_codex", "draft", "added section 'Decide' + 3 options", 1);
  await ev("pt_board", "seat_codex", "progress", "seeded votes from the Q3 panel", 1, 38);
  await ev("pt_board", "seat_codex", "draft", "adding storyboard frames 6/6", 0);

  await task("pt_check", "check", "5-question check on pricing basics", "ready", "seat_codex", { brief: "5 questions, multiple choice", minutes: 12, report: "Five multiple-choice questions on elasticity, test design and stop rules." });
  for (const d of demoDrafts("check", { title: "Pricing basics", brief: "5 questions", minutes: 10, anchor: { x: 0, y: 0 } })) await draft("pt_check", "seat_codex", d, 70);
  await ev("pt_check", "seat_codex", "done", "finished 5-question check on pricing basics", 65, 12);

  await task("pt_recap", "recap", "Recap from Day 3", "ready", "seat_claude", { minutes: 9, report: "Recap from yesterday's board and plan." });
  for (const d of demoDrafts("recap", { title: "Day 3", brief: "", minutes: 60, anchor: { x: 0, y: 0 } })) await draft("pt_recap", "seat_claude", d, 50);
  await ev("pt_recap", "seat_claude", "done", "finished Recap from Day 3", 48, 9);

  await task("pt_agenda", "agenda", `Agenda for ${session?.title ?? "the next session"}`, "needs_you", "seat_claude", { minutes: 14, question: { text: "Should the vote be dot-voting (3 dots each) or one vote per person?", options: ["3 dots each", "one vote each"], answer: null, at: iso(t - 12 * 60_000) } });
  await ev("pt_agenda", "seat_claude", "ask", "asked: dot-voting or one vote per person?", 12, 14);

  await task("pt_client", "client_agenda", "Client-call agenda from the last 3 recaps", "queued", null, { readyBy: iso(t + 4 * DAY), sessionId: null });
  await task("pt_invoices", "invoice_drafts", "Draft this month's invoices for Acme", "queued", null, { brief: "Flag anything odd. Never send.", sessionId: null, readyBy: iso(t + 9 * DAY) });
  // Agent time this week (recorded separately; never billed to clients).
  await ev(null, "seat_codex", "progress", "earlier this week", 60 * 24 * 2, 170);
  await ev(null, "seat_claude", "progress", "earlier this week", 60 * 24 * 3, 107);
}

/** Quick checks and nudges (Figma 04 · Insights + nudges): one closed check with results, one open. */
async function seedChecks(db: LocalDb, now: Date, phy: string) {
  const t = now.getTime();
  const iso = (ms: number) => new Date(ms).toISOString();
  // A worksheet that was due last week: two on time, Dipa missing.
  const ws6 = { id: "po_ws6", spaceId: phy, kind: "task", title: "Worksheet 6 p2", body: "Vectors on a slope, questions 1–6.", mustRead: false, dueAt: iso(t - 5 * DAY), createdBy: DEMO_HOST_ID, createdAt: iso(t - 9 * DAY), attachments: [] };
  await db.put("posts", ws6);
  await db.put("submissions", { id: `${ws6.id}:u_ayaan`, postId: ws6.id, spaceId: phy, userId: "u_ayaan", status: "done", note: "", at: iso(t - 6 * DAY), feedback: "Good work on Q4." });
  await db.put("submissions", { id: `${ws6.id}:u_sumaiya`, postId: ws6.id, spaceId: phy, userId: "u_sumaiya", status: "done", note: "", at: iso(t - 5 * DAY - 3600_000) });
  const q = (id: string, type: string, prompt: string, points: number, options: string[], answer: string[]) => ({ id, type, prompt, points, options: type === "true_false" ? [{ id: "true", text: "True" }, { id: "false", text: "False" }] : options.map((text, i) => ({ id: `${id}_${i}`, text })), answer });
  const exit = {
    id: "ck_exit6", spaceId: phy, title: "Projectiles · exit ticket", instructions: "Four quick questions on today's lab. No notes needed.",
    questions: [
      q("q1", "mcq_single", "Which launch angle gives the longest range on flat ground?", 2, ["30°", "45°", "60°", "75°"], ["q1_1"]),
      q("q2", "true_false", "Horizontal velocity stays the same during the flight (ignoring air resistance).", 1, [], ["true"]),
      q("q3", "mcq_multi", "Which changes make a projectile go further?", 2, ["A faster launch", "A heavier ball", "Launching from higher up", "A steeper angle than 60°"], ["q3_0", "q3_2"]),
      q("q4", "short_answer", "What is the vertical acceleration of a projectile? Include the unit.", 1, [], ["9.8 m/s²", "9.8 m/s^2", "9.8 m/s2", "9.81 m/s²", "9.81 m/s2", "g"])
    ],
    status: "published", openAt: null, closeAt: iso(t - 2 * DAY), timeLimitMin: 10, maxAttempts: 1, shuffle: true, integrity: true, createdAt: iso(t - 3 * DAY), createdBy: DEMO_HOST_ID
  };
  await db.put("checks", exit);
  const start = t - 2 * DAY - 3 * 3600_000;
  await db.put("check_attempts", { id: "at_ayaan_exit6", checkId: exit.id, userId: "u_ayaan", startedAt: iso(start), submittedAt: iso(start + 6 * 60_000), status: "graded", answers: { q1: ["q1_1"], q2: ["true"], q3: ["q3_0"], q4: ["9.8 m/s2"] }, scores: { q1: { isCorrect: true, points: 2 }, q2: { isCorrect: true, points: 1 }, q3: { isCorrect: false, points: 0 }, q4: { isCorrect: true, points: 1 } }, integrity: { integrityScore: 100, violationCounts: {}, awayMs: 0, recent: [] } });
  await db.put("check_attempts", { id: "at_sumaiya_exit6", checkId: exit.id, userId: "u_sumaiya", startedAt: iso(start + 60_000), submittedAt: iso(start + 9 * 60_000), status: "submitted", answers: { q1: ["q1_1"], q2: ["true"], q3: ["q3_0", "q3_2"], q4: ["about 10 metres per second squared, downwards"] }, scores: { q1: { isCorrect: true, points: 2 }, q2: { isCorrect: true, points: 1 }, q3: { isCorrect: true, points: 2 }, q4: { isCorrect: null, points: null } }, integrity: { integrityScore: 84, violationCounts: { tab_hidden: 2 }, awayMs: 40_000, recent: [] } });
  await db.put("checks", {
    id: "ck_energy", spaceId: phy, title: "Energy warm-up", instructions: "Three questions before Lesson 7. You can't pause once you start.",
    questions: [
      q("e1", "mcq_single", "A 2 kg book is lifted 1 m. Roughly how much work is done? (g ≈ 10 m/s²)", 1, ["2 J", "10 J", "20 J", "200 J"], ["e1_2"]),
      q("e2", "true_false", "Work is done when you hold a heavy bag still.", 1, [], ["false"]),
      q("e3", "short_answer", "Name the unit of energy.", 1, [], ["joule", "joules", "J"])
    ],
    status: "published", openAt: null, closeAt: iso(t + 2 * DAY), timeLimitMin: 10, maxAttempts: 1, shuffle: true, integrity: true, createdAt: iso(t - 3600_000), createdBy: DEMO_HOST_ID
  });
  // Two nudges this week (one opened and acted on).
  const n1 = sortableId("nt");
  await db.put("notifications", { id: n1, userId: "u_sumaiya", kind: "nudge", title: "Due tomorrow: Worksheet 6 p2", sub: "Due in 1 day", link: `/s/${phy}/work`, createdAt: iso(t - 6 * DAY), readAt: iso(t - 6 * DAY + 3600_000) });
  await db.put("nudge_log", { id: "nl_1", hostId: DEMO_HOST_ID, nudgeId: null, rule: "deadline", userId: "u_sumaiya", notificationId: n1, at: iso(t - 6 * DAY), taskId: ws6.id });
  const n2 = sortableId("nt");
  await db.put("notifications", { id: n2, userId: "u_dipa", kind: "nudge", title: "Due tomorrow: Worksheet 6 p2", sub: "Due in 1 day", link: `/s/${phy}/work`, createdAt: iso(t - 6 * DAY), readAt: null });
  await db.put("nudge_log", { id: "nl_2", hostId: DEMO_HOST_ID, nudgeId: null, rule: "deadline", userId: "u_dipa", notificationId: n2, at: iso(t - 6 * DAY), taskId: ws6.id });
}

/**
 * Money demo (Figma 06 · row B), written through the same code paths the app uses: a paid package,
 * last month's invoices (one the payer says is paid, one partly paid and overdue), and this month's
 * unbilled log rows ready for "Draft invoices".
 */
async function seedMoney(db: LocalDb, now: Date, spaceIds: Record<string, string>, physics: { id: string; startsAt: string }[], pendingId: string | undefined) {
  const t = now.getTime();
  const ctxAt = (ms: number): LocalCtx => ({ db, meId: DEMO_HOST_ID, now: () => new Date(ms), changed: () => {} });
  const fresh = async (id: string) => (await db.get<InvoiceRow>("invoices", id))!;
  const settings: MoneySettings = {
    id: DEMO_HOST_ID,
    prefix: "LF",
    nextNumber: 410,
    footer: "Thank you! Bank transfer: DBBL · 1234 5678 9012 · reference {ref}",
    brandLine: "Consulting & tutoring · Dhaka",
    paymentLink: { mode: "same", link: "https://pay.example.com/nusrat", template: "", perPayer: {} },
    reminders: { steps: DEFAULT_REMINDERS, subject: DEFAULT_REMINDER_SUBJECT, text: DEFAULT_REMINDER_TEXT },
    packages: { renew: true, renewAt: 2, expire: true, expireDays: 60, warnDays: 7, excusedCredit: true },
    pausedPayers: [],
    lastAutoRun: "",
    lastDaily: ""
  };
  await db.put("money_settings", settings);
  await db.put("settings", { ...((await db.get("settings", DEMO_HOST_ID)) ?? { id: DEMO_HOST_ID }), paymentLink: settings.paymentLink.link });
  const issued: string[] = [];
  const via = { email: true, whatsapp: true, inapp: true };
  const send = async (ms: number, inv: InvoiceRow) => {
    issued.push(await sendInvoice(ctxAt(ms), inv, issued, via));
  };
  const phy = spaceIds["physics-a"]!;
  const prev = prevMonthKey(monthKey(now));
  const prev2 = prevMonthKey(prev);

  // A 16-session package for Sumaiya, paid before last month began.
  const { inv: pkgInv } = await sellPackage(ctxAt(t - 55 * DAY), DEMO_HOST_ID, { spaceId: phy, memberId: "u_sumaiya", size: 16, priceCents: 22000 });
  await send(t - 55 * DAY, pkgInv);
  await confirmPayment(ctxAt(t - 53 * DAY), await fresh(pkgInv.id), 22000, null, "Bank transfer");

  // Northwind's retainer two months ago: sent and paid.
  for (const d of await buildDrafts(ctxAt(t - 45 * DAY), DEMO_HOST_ID, prev2, { auto: true })) {
    await send(t - 45 * DAY, d);
    await confirmPayment(ctxAt(t - 40 * DAY), await fresh(d.id), d.totalCents, null, "Bank transfer");
  }

  // Physics sessions since the start of last month (the latest one is still waiting for its wrap-up).
  const firstThis = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  let dipaN = 0;
  for (const [i, s] of physics.entries()) {
    const start = Date.parse(s.startsAt);
    if (start + 3600_000 > t || s.id === pendingId) continue;
    const rows: { memberId: string; minutes: number; status: AttendanceStatus }[] = [
      { memberId: "u_ayaan", minutes: 55 + ((i * 7) % 8), status: "attended" },
      { memberId: "u_sumaiya", minutes: i === 3 ? 0 : 52 + ((i * 5) % 9), status: i === 3 ? "absent" : "attended" }
    ];
    if (start >= firstThis) {
      const st: AttendanceStatus = dipaN === 1 ? "late_cancel" : dipaN === 2 ? "excused" : "attended";
      rows.push({ memberId: "u_dipa", minutes: st === "attended" ? 50 + dipaN : 0, status: st });
      dipaN++;
    }
    const sess = await db.get<Record<string, unknown> & { id: string }>("sessions", s.id);
    if (sess) await db.put("sessions", { ...sess, wrapped: true });
    await recordAttendance(ctxAt(start + 3600_000), { id: s.id, spaceId: phy, startsAt: s.startsAt, minutes: 60, title: "Physics · Section A" }, rows);
  }

  // Two consulting sessions with Acme (billed per hour, once per session).
  const acme = spaceIds["acme-pricing"]!;
  for (const [title, d, h, minutes] of [["Pricing workshop · day 1", -8, 10, 120], ["Pricing workshop · day 2", -1, 14, 90]] as const) {
    const day = new Date(now);
    day.setDate(day.getDate() + d);
    day.setHours(h, 0, 0, 0);
    const id = newId("se");
    await db.put("sessions", { id, spaceId: acme, title, startsAt: day.toISOString(), minutes, room: "loft", status: "scheduled", sequence: 0, wrapped: true });
    await recordAttendance(ctxAt(day.getTime() + minutes * 60_000), { id, spaceId: acme, startsAt: day.toISOString(), minutes, title }, ["u_farhan", "u_rafi", "u_leena"].map((m) => ({ memberId: m, minutes, status: "attended" as const })));
  }

  // Last month's invoices, sent 13 days ago (due 6 days ago).
  const sentAt = t - 13 * DAY;
  const drafts = await buildDrafts(ctxAt(sentAt - 5 * 60_000), DEMO_HOST_ID, prev, { auto: true });
  for (const d of drafts) await send(sentAt, d);
  for (const d of drafts) {
    const inv = await fresh(d.id);
    if (inv.payerId === "u_shirin") {
      const claimAt = new Date(t - 2 * 3600_000).toISOString();
      inv.viewCount = 2;
      inv.viewedAt = new Date(t - DAY).toISOString();
      inv.claims = [{ id: "cl_demo", at: claimAt, amountCents: inv.totalCents, method: "Card · payment link", reference: "#1093", note: "Paid by card this morning. Receipt #1093.", status: "open" }];
      inv.comments = [
        { id: "cm_1", lineIdx: 0, userId: "u_shirin", name: "Shirin Karim", body: "Does this include the extra Saturday session?", at: new Date(t - 3 * DAY).toISOString(), fromPayer: true },
        { id: "cm_2", lineIdx: 0, userId: DEMO_HOST_ID, name: "Nusrat Rahman", body: "No, that one was free. The recap link has the board from that day.", at: new Date(t - 3 * DAY + 3600_000).toISOString(), fromPayer: false }
      ];
      const due = Date.parse(inv.dueAt!);
      inv.remindersSent = [-3, 0, 3];
      inv.activity = [
        ...inv.activity,
        { kind: "reminder", at: new Date(due - 3 * DAY).toISOString(), text: "Reminder · in-app + email" },
        { kind: "reminder", at: new Date(due).toISOString(), text: "Reminder · in-app" },
        { kind: "reminder", at: new Date(due + 3 * DAY).toISOString(), text: "Reminder · in-app + email · WhatsApp sent by you" },
        { kind: "viewed", at: inv.viewedAt, text: "Viewed twice" },
        { kind: "claimed", at: claimAt, text: "Payer says paid · Card · payment link · #1093" }
      ].sort((a, b) => a.at.localeCompare(b.at));
      await db.put("invoices", inv);
      await db.put("notifications", { id: sortableId("nt"), userId: DEMO_HOST_ID, kind: "payment", title: `Shirin Karim says ${inv.number} is paid`, sub: "Card · payment link · #1093", link: `/money/payments?invoice=${inv.id}`, createdAt: claimAt, readAt: null });
    } else if (inv.payerId === "u_tania") {
      await confirmPayment(ctxAt(t - 5 * DAY), inv, 80000, null, "Bank transfer");
      const next = await fresh(inv.id);
      const due = Date.parse(next.dueAt!);
      next.remindersSent = [-3, 0, 3];
      next.waPending = 3;
      next.viewCount = 1;
      next.viewedAt = new Date(sentAt + DAY).toISOString();
      next.activity = [
        ...next.activity,
        { kind: "reminder", at: new Date(due - 3 * DAY).toISOString(), text: "Reminder · in-app + email" },
        { kind: "reminder", at: new Date(due).toISOString(), text: "Reminder · in-app" },
        { kind: "reminder", at: new Date(due + 3 * DAY).toISOString(), text: "Reminder · in-app + email · WhatsApp to send" }
      ].sort((a, b) => a.at.localeCompare(b.at));
      await db.put("invoices", next);
    }
  }
  await db.put("money_settings", { ...(await db.get<MoneySettings>("money_settings", DEMO_HOST_ID))!, lastAutoRun: prev });
}
