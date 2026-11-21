// M7 resources (Figma 06 · row B): billing setup, session log, invoice runs, invoice detail, packages &
// credits, confirming payments, reminders, and the payer's pay page. Money never touches Loft: invoices
// carry the host's own payment link, payers tap "I've paid", the host confirms. Mirrors /api/v1.
import {
  balanceDue,
  DEFAULT_REMINDER_SUBJECT,
  DEFAULT_REMINDER_TEXT,
  DEFAULT_REMINDERS,
  draftInvoices,
  formatUSD,
  INVOICE_STATUS_LABEL,
  invoiceStatus,
  isDailyDue,
  dayKey,
  isOverdue,
  ledgerBalance,
  monthKey,
  monthLabel,
  monthRange,
  newId,
  nextInvoiceNumber,
  nextReminderAt,
  normaliseBilling,
  paidTotal,
  prevMonthKey,
  priceRow,
  receiptNumber,
  reminderDue,
  resolvePaymentLink,
  revisionNumber,
  sortableId,
  type AttendanceStatus,
  type InvoiceLine,
  type LedgerKind,
  type LogRow,
  type PaymentLinkSettings,
  type ReminderStep,
  type SpaceBilling,
  type User
} from "@loft/core";
import { ForbiddenError, NotFoundError } from "../types";
import type { Row } from "./db";
import { requireMe, routes, str, type LocalCtx } from "./routes";

interface SpaceRow extends Row { name: string; slug: string; code: string; mode: string; colour: string; sub?: string; createdBy: string; billing?: Partial<SpaceBilling> & { mode?: string } }
interface MemberRow extends Row { spaceId: string; userId: string; role: string }
interface UserRow extends User, Row { phone?: string; title?: string }
type LogRowDb = LogRow & Row;
export interface Claim { id: string; at: string; amountCents: number; method: string; reference: string; note: string; status: "open" | "confirmed" | "rejected"; reason?: string }
interface Payment { id: string; amountCents: number; at: string; receipt: string; method: string; claimId: string | null }
interface Comment { id: string; lineIdx: number | null; userId: string | null; name: string; body: string; at: string; fromPayer: boolean }
interface Activity { kind: string; at: string; text: string }
export interface InvoiceRow extends Row {
  hostId: string;
  number: string | null;
  payerId: string | null;
  memberIds: string[];
  period: string;
  kind: "monthly" | "session" | "package";
  lines: InvoiceLine[];
  totalCents: number;
  status: "draft" | "sent" | "void";
  needsAttention: string | null;
  edited?: boolean;
  createdAt: string;
  sentAt: string | null;
  dueAt: string | null;
  viewedAt: string | null;
  viewCount: number;
  payments: Payment[];
  claims: Claim[];
  comments: Comment[];
  remindersSent: number[];
  waPending: number | null;
  activity: Activity[];
  payToken: string;
  revisionOf?: string | null;
  replacedBy?: string | null;
  packageId?: string | null;
  sessionId?: string | null;
  via?: { email: boolean; whatsapp: boolean; inapp: boolean };
}
interface PackageRow extends Row { hostId: string; spaceId: string; memberId: string; payerId: string | null; size: number; priceCents: number; invoiceId: string | null; renewalOf: string | null; renewalId: string | null; createdAt: string }
interface CreditRow extends Row { hostId: string; spaceId: string; memberId: string; payerId: string | null; packageId: string | null; kind: LedgerKind; qty: number; active: boolean; at: string; note: string; expiresAt?: string | null; logId?: string | null; usedBy?: string | null; expired?: boolean }
export interface MoneySettings extends Row {
  prefix: string;
  nextNumber: number;
  footer: string;
  brandLine: string;
  paymentLink: PaymentLinkSettings;
  reminders: { steps: ReminderStep[]; subject: string; text: string };
  packages: { renew: boolean; renewAt: number; expire: boolean; expireDays: number; warnDays: number; excusedCredit: boolean };
  pausedPayers: string[];
  lastAutoRun: string;
  lastDaily: string;
}

const DAY = 86_400_000;
const nowIso = (ctx: LocalCtx) => ctx.now().toISOString();
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const cents = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const firstName = (n: string) => n.split(" ")[0] ?? n;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export async function moneySettings(ctx: LocalCtx, hostId: string): Promise<MoneySettings> {
  const s = await ctx.db.get<MoneySettings>("money_settings", hostId);
  if (s) return s;
  const legacy = await ctx.db.get<Row & { paymentLink?: string | null }>("settings", hostId);
  return {
    id: hostId,
    prefix: "LF",
    nextNumber: 1,
    footer: "",
    brandLine: "",
    paymentLink: { mode: "same", link: legacy?.paymentLink ?? "", template: "", perPayer: {} },
    reminders: { steps: DEFAULT_REMINDERS, subject: DEFAULT_REMINDER_SUBJECT, text: DEFAULT_REMINDER_TEXT },
    packages: { renew: true, renewAt: 2, expire: true, expireDays: 60, warnDays: 7, excusedCredit: true },
    pausedPayers: [],
    lastAutoRun: "",
    lastDaily: ""
  };
}

async function hostedSpaces(ctx: LocalCtx, hostId: string): Promise<SpaceRow[]> {
  const ids = (await ctx.db.list<MemberRow>("memberships", (m) => m.userId === hostId && m.role === "host")).map((m) => m.spaceId);
  const out: SpaceRow[] = [];
  for (const id of ids) {
    const s = await ctx.db.get<SpaceRow>("spaces", id);
    if (s) out.push(s);
  }
  return out;
}

export const billingFor = (s: SpaceRow | undefined): SpaceBilling => normaliseBilling(s?.billing, s?.mode);

async function userMap(ctx: LocalCtx) {
  return new Map((await ctx.db.list<UserRow>("users")).map((u) => [u.id, u]));
}

/** Display names for log members, including the "space:<id>" member used by per-session spaces. */
async function nameMap(ctx: LocalCtx, spaces: SpaceRow[]) {
  const names: Record<string, string> = {};
  for (const u of (await userMap(ctx)).values()) names[u.id] = u.name;
  for (const s of spaces) names[`space:${s.id}`] = s.name;
  return names;
}

async function requireHostOf(ctx: LocalCtx, spaceId: string) {
  const me = await requireMe(ctx);
  const m = await ctx.db.get<MemberRow>("memberships", `${spaceId}:${me.id}`);
  if (!m || m.role !== "host") throw new ForbiddenError("Only the host sees billing");
  return me;
}

async function invoiceOr404(ctx: LocalCtx, id: string, hostId: string) {
  const inv = await ctx.db.get<InvoiceRow>("invoices", id);
  if (!inv || inv.hostId !== hostId) throw new NotFoundError("Invoice not found");
  return inv;
}

// ---- packages & makeup credits ----

async function packageLedger(ctx: LocalCtx, packageId: string) {
  return (await ctx.db.list<CreditRow>("credits", (c) => c.packageId === packageId)).sort((a, b) => a.at.localeCompare(b.at));
}

async function activePackage(ctx: LocalCtx, spaceId: string, memberId: string): Promise<PackageRow | null> {
  const pkgs = (await ctx.db.list<PackageRow>("packages", (p) => p.spaceId === spaceId && p.memberId === memberId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const p of pkgs) {
    const ledger = await packageLedger(ctx, p.id);
    if (ledger.some((r) => r.kind === "purchase" && r.active) && ledgerBalance(ledger) > 0) return p;
  }
  return null;
}

async function makeupCredits(ctx: LocalCtx, hostId: string) {
  return ctx.db.list<CreditRow>("credits", (c) => c.hostId === hostId && c.kind === "credit" && !c.packageId && !c.usedBy && !c.expired);
}

// ---- session log ----

export interface AttendanceInput { memberId: string; minutes: number; status: AttendanceStatus }
interface SessionLike { id: string; spaceId: string; startsAt: string; minutes: number; title: string }

/** Write (or re-price) one log row from the space policy. Invoiced rows are frozen. */
async function applyLog(ctx: LocalCtx, s: SessionLike, space: SpaceRow, a: AttendanceInput): Promise<LogRowDb> {
  const b = billingFor(space);
  const settings = await moneySettings(ctx, space.createdBy);
  const id = `${s.id}:${a.memberId}`;
  const cur = await ctx.db.get<LogRowDb>("session_log", id);
  if (cur?.invoiceId) return cur;
  await ctx.db.del("credits", `use:${id}`);
  const oldCredit = await ctx.db.get<CreditRow>("credits", `credit:${id}`);
  if (oldCredit && !oldCredit.usedBy) await ctx.db.del("credits", `credit:${id}`);
  const payerId = b.per === "session" ? (b.payers["*"] ?? null) : (b.payers[a.memberId] ?? null);
  let priced = priceRow({ status: a.status, minutes: a.minutes, invoiceId: null, unitPriceCents: 0, amountCents: 0, billable: false }, b);
  let packageId: string | null = null;
  if (priced.billable && b.per === "member") {
    const pkg = await activePackage(ctx, space.id, a.memberId);
    if (pkg) {
      packageId = pkg.id;
      priced = { ...priced, amountCents: 0 };
      await ctx.db.put("credits", { id: `use:${id}`, hostId: space.createdBy, spaceId: space.id, memberId: a.memberId, payerId: pkg.payerId, packageId: pkg.id, kind: "use", qty: 1, active: true, at: s.startsAt, note: a.status === "attended" ? "Attended" : a.status === "late_cancel" ? "Late cancel (billable)" : "No-show (billable)", logId: id } satisfies CreditRow);
    }
  }
  if (a.status === "excused" && b.excused === "makeup" && settings.packages.excusedCredit && !oldCredit?.usedBy) {
    await ctx.db.put("credits", { id: `credit:${id}`, hostId: space.createdBy, spaceId: space.id, memberId: a.memberId, payerId, packageId: null, kind: "credit", qty: 1, active: true, at: s.startsAt, note: `Makeup credit · excused ${shortDate(s.startsAt)}`, expiresAt: settings.packages.expire ? new Date(Date.parse(s.startsAt) + settings.packages.expireDays * DAY).toISOString() : null, logId: id, usedBy: null, expired: false } satisfies CreditRow);
  }
  const row: LogRowDb = { id, sessionId: s.id, spaceId: space.id, memberId: a.memberId, payerId, minutes: Math.round(a.minutes), status: a.status, billable: priced.billable, unitPriceCents: priced.unitPriceCents, amountCents: priced.amountCents, invoiceId: null, at: s.startsAt, title: s.title, packageId };
  await ctx.db.put("session_log", row);
  return row;
}

/** Wrap-up (P6) and auto-wrap call this: one row per member, or one per session for client spaces. */
export async function recordAttendance(ctx: LocalCtx, s: SessionLike, rows: AttendanceInput[]): Promise<LogRowDb[]> {
  const space = await ctx.db.get<SpaceRow>("spaces", s.spaceId);
  if (!space) return [];
  const b = billingFor(space);
  const out: LogRowDb[] = [];
  if (b.per === "session") {
    const attended = rows.filter((r) => r.status === "attended");
    const status: AttendanceStatus = attended.length ? "attended" : rows.some((r) => r.status === "late_cancel") ? "late_cancel" : rows.some((r) => r.status === "no_show") ? "no_show" : "absent";
    const minutes = attended.length ? Math.max(...attended.map((r) => r.minutes), 0) || s.minutes : 0;
    out.push(await applyLog(ctx, s, space, { memberId: `space:${space.id}`, minutes, status }));
  } else {
    for (const r of rows) out.push(await applyLog(ctx, s, space, r));
  }
  if (b.schedule === "after_session") await buildDrafts(ctx, space.createdBy, monthKey(s.startsAt), { sessionId: s.id });
  return out;
}

// ---- invoice runs ----

function blankInvoice(ctx: LocalCtx, hostId: string, extra: Partial<InvoiceRow>): InvoiceRow {
  return { id: newId("inv"), hostId, number: null, payerId: null, memberIds: [], period: monthKey(ctx.now()), kind: "monthly", lines: [], totalCents: 0, status: "draft", needsAttention: null, createdAt: nowIso(ctx), sentAt: null, dueAt: null, viewedAt: null, viewCount: 0, payments: [], claims: [], comments: [], remindersSent: [], waPending: null, activity: [], payToken: newId("pay"), ...extra };
}

/**
 * Build drafts from unbilled rows up to the end of `month` (I3): one per payer. Untouched auto drafts
 * for the same scope are rebuilt; edited drafts keep their rows. Nothing is sent.
 */
export async function buildDrafts(ctx: LocalCtx, hostId: string, month: string, opts: { sessionId?: string; auto?: boolean } = {}): Promise<InvoiceRow[]> {
  const spaces = await hostedSpaces(ctx, hostId);
  const ids = new Set(spaces.map((s) => s.id));
  const billing = Object.fromEntries(spaces.map((s) => [s.id, billingFor(s)]));
  const kind = opts.sessionId ? "session" : "monthly";
  for (const inv of await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === hostId && i.status === "draft" && !i.edited && i.kind === kind)) {
    if (opts.sessionId ? inv.sessionId === opts.sessionId : inv.period === month) await ctx.db.del("invoices", inv.id);
  }
  const rest = await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === hostId && i.status !== "void");
  const held = new Set(rest.filter((i) => i.status === "draft").flatMap((i) => i.lines.flatMap((l) => l.logIds)));
  const { end } = monthRange(month);
  const rows = (await ctx.db.list<LogRowDb>("session_log", (r) => ids.has(r.spaceId) && !r.invoiceId && r.at < end && (!opts.sessionId || r.sessionId === opts.sessionId))).filter((r) => !held.has(r.id) && billing[r.spaceId]?.schedule !== "package_out");
  const monthly: { spaceId: string; memberId: string; payerId: string | null }[] = [];
  if (!opts.sessionId && month <= monthKey(ctx.now())) {
    const billed = new Set(rest.filter((i) => i.period === month).flatMap((i) => i.lines.filter((l) => l.kind === "monthly").map((l) => `${l.spaceId}|${l.memberId}`)));
    for (const s of spaces) {
      const b = billing[s.id]!;
      if (b.model !== "monthly") continue;
      const who = b.per === "session" ? [{ memberId: `space:${s.id}`, payerId: b.payers["*"] ?? null }] : (await ctx.db.list<MemberRow>("memberships", (m) => m.spaceId === s.id && m.role !== "host" && m.role !== "cohost")).map((m) => ({ memberId: m.userId, payerId: b.payers[m.userId] ?? null }));
      for (const w of who) if (!billed.has(`${s.id}|${w.memberId}`)) monthly.push({ spaceId: s.id, ...w });
    }
  }
  const credits: Record<string, number> = {};
  for (const c of await makeupCredits(ctx, hostId)) credits[c.memberId] = (credits[c.memberId] ?? 0) + 1;
  const names = await nameMap(ctx, spaces);
  const drafts = draftInvoices(rows, billing, { names, monthLabel: monthLabel(month).split(" ")[0], credits, monthly });
  const out: InvoiceRow[] = [];
  for (const d of drafts) {
    const inv = blankInvoice(ctx, hostId, {
      payerId: d.payerId,
      memberIds: [...new Set(d.lines.map((l) => l.memberId).filter((x): x is string => !!x))],
      period: month,
      kind,
      sessionId: opts.sessionId ?? null,
      lines: d.lines,
      totalCents: d.totalCents,
      needsAttention: d.needsAttention,
      activity: [{ kind: "drafted", at: nowIso(ctx), text: opts.auto ? "Drafted automatically" : "Drafted" }]
    });
    await ctx.db.put("invoices", inv);
    out.push(inv);
  }
  ctx.changed("invoices");
  return out;
}

// ---- views ----

interface ViewCtx { users: Map<string, UserRow>; spaces: Map<string, SpaceRow>; settings: MoneySettings; host: UserRow | undefined; now: number }

async function viewCtx(ctx: LocalCtx, hostId: string): Promise<ViewCtx> {
  const users = await userMap(ctx);
  const spaces = new Map((await ctx.db.list<SpaceRow>("spaces")).map((s) => [s.id, s]));
  return { users, spaces, settings: await moneySettings(ctx, hostId), host: users.get(hostId), now: ctx.now().getTime() };
}

function memberName(v: ViewCtx, id: string | null | undefined) {
  if (!id) return "—";
  if (id.startsWith("space:")) return v.spaces.get(id.slice(6))?.name ?? "Space";
  return v.users.get(id)?.name ?? "Member";
}

/** "Ayaan + Nabila · combined · 15 sessions" (I3 rows). */
function summary(v: ViewCtx, inv: InvoiceRow) {
  const members = inv.memberIds.map((m) => (m === inv.payerId ? "self" : firstName(memberName(v, m))));
  const sessions = inv.lines.filter((l) => l.kind === "sessions").reduce((n, l) => n + l.qty, 0);
  const minutes = inv.lines.filter((l) => l.kind === "hours").reduce((n, l) => n + l.qty * 60, 0);
  const credits = inv.lines.filter((l) => l.kind === "credit").reduce((n, l) => n + l.qty, 0);
  const parts = [members.join(" + ") || "—"];
  if (members.length > 1) parts.push("combined");
  if (inv.kind === "package") parts.push(inv.lines[0]?.description.split(" · ").slice(1).join(" · ") || "package");
  if (sessions) parts.push(`${sessions} session${sessions === 1 ? "" : "s"}`);
  if (minutes) parts.push(`${Math.round((minutes / 60) * 10) / 10} h`);
  if (inv.lines.some((l) => l.kind === "monthly")) parts.push("monthly");
  if (credits) parts.push(`${credits} credit${credits === 1 ? "" : "s"} used`);
  return parts.join(" · ");
}

function payLinkFor(v: ViewCtx, inv: InvoiceRow) {
  const space = v.spaces.get(inv.lines[0]?.spaceId ?? "");
  return resolvePaymentLink(v.settings.paymentLink, inv.payerId, balanceDue(inv) || inv.totalCents, inv.number ?? "", space ? billingFor(space).paymentLink : null);
}

function listView(v: ViewCtx, inv: InvoiceRow) {
  const status = invoiceStatus(inv, v.now);
  const next = inv.status === "sent" && balanceDue(inv) > 0 ? nextReminderAt(inv, v.settings.reminders.steps, inv.remindersSent) : null;
  const payer = inv.payerId ? v.users.get(inv.payerId) : undefined;
  const credit = inv.lines.filter((l) => l.kind === "credit").reduce((n, l) => n + l.amountCents, 0);
  return {
    id: inv.id,
    number: inv.number,
    kind: inv.kind,
    period: inv.period,
    payerId: inv.payerId,
    payerName: payer?.name ?? (inv.payerId ? "Payer" : memberName(v, inv.memberIds[0])),
    payerPhone: payer?.phone ?? null,
    payerEmail: payer?.email ?? null,
    summary: summary(v, inv),
    tags: [...(inv.kind === "package" ? ["package renewal"] : []), ...(credit ? [`credit −${formatUSD(-credit, { dropZeroCents: true })}`] : [])],
    totalCents: inv.totalCents,
    paidCents: paidTotal(inv),
    balanceCents: balanceDue(inv),
    status,
    statusLabel: INVOICE_STATUS_LABEL[status],
    needsAttention: inv.needsAttention,
    sentAt: inv.sentAt,
    dueAt: inv.dueAt,
    overdueDays: isOverdue(inv, v.now) && inv.dueAt ? Math.floor((v.now - Date.parse(inv.dueAt)) / DAY) : 0,
    nextReminderAt: next,
    nextReminderDays: next === null ? null : Math.max(0, Math.ceil((next - v.now) / DAY)),
    finalSent: v.settings.reminders.steps.some((s) => s.final && inv.remindersSent.includes(s.offsetDays)),
    paused: !!inv.payerId && v.settings.pausedPayers.includes(inv.payerId),
    openClaims: inv.claims.filter((c) => c.status === "open").length,
    payPath: `/pay/${inv.payToken}`,
    members: inv.memberIds.map((m) => memberName(v, m)).join(", ")
  };
}

async function detailView(ctx: LocalCtx, v: ViewCtx, inv: InvoiceRow) {
  const logIds = inv.lines.flatMap((l) => l.logIds);
  const rows = new Map<string, LogRowDb>();
  for (const id of logIds) {
    const r = await ctx.db.get<LogRowDb>("session_log", id);
    if (r) rows.set(id, r);
  }
  const lines = inv.lines.map((l, idx) => {
    const space = v.spaces.get(l.spaceId);
    return {
      ...l,
      idx,
      spaceCode: space?.code ?? "",
      spaceSlug: space?.slug ?? "",
      who: memberName(v, l.memberId),
      items: l.logIds
        .map((id) => rows.get(id))
        .filter((r): r is LogRowDb => !!r)
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((r) => ({ id: r.id, at: r.at, title: r.title ?? "Session", minutes: r.minutes, status: r.status, amountCents: r.amountCents, who: firstName(memberName(v, r.memberId)), recap: space ? `/s/${space.slug}` : null }))
    };
  });
  const payer = inv.payerId ? v.users.get(inv.payerId) : undefined;
  const others = inv.payerId ? await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === inv.hostId && i.payerId === inv.payerId && i.status === "sent") : [];
  const latePaid = others.some((i) => i.payments.length && i.dueAt && Date.parse(i.payments[0]!.at) > Date.parse(i.dueAt));
  const revision = inv.revisionOf ? await ctx.db.get<InvoiceRow>("invoices", inv.revisionOf) : undefined;
  const replaced = inv.replacedBy ? await ctx.db.get<InvoiceRow>("invoices", inv.replacedBy) : undefined;
  return {
    ...listView(v, inv),
    lines,
    payments: inv.payments,
    claims: inv.claims,
    comments: inv.comments,
    activity: inv.activity,
    viewCount: inv.viewCount,
    viewedAt: inv.viewedAt,
    remindersSent: inv.remindersSent,
    payLink: payLinkFor(v, inv),
    footer: v.settings.footer.replaceAll("{ref}", inv.number ?? "draft"),
    host: { name: v.host?.name ?? "Host", brandLine: v.settings.brandLine },
    payer: payer ? { id: payer.id, name: payer.name, email: payer.email, phone: payer.phone ?? null, pays: inv.memberIds.filter((m) => m !== payer.id).map((m) => firstName(memberName(v, m))), invoices: others.length, record: others.length ? (latePaid ? "sometimes late" : "always paid") : "first invoice" } : null,
    revisionOf: revision ? { id: revision.id, number: revision.number } : null,
    replacedBy: replaced ? { id: replaced.id, number: replaced.number } : null,
    template: v.settings.reminders.text
  };
}

/** What the payer sees: no host notes, no other payers, nothing from other invoices. */
async function payView(ctx: LocalCtx, inv: InvoiceRow) {
  const v = await viewCtx(ctx, inv.hostId);
  const d = await detailView(ctx, v, inv);
  return {
    number: d.number,
    status: d.status,
    statusLabel: d.statusLabel,
    period: inv.period,
    periodLabel: monthLabel(inv.period),
    dueAt: d.dueAt,
    sentAt: d.sentAt,
    host: d.host,
    payerName: d.payerName,
    lines: d.lines.map((l) => ({ idx: l.idx, description: l.description, qty: l.qty, unitCents: l.unitCents, amountCents: l.amountCents, kind: l.kind, items: l.items.map((i) => ({ at: i.at, title: i.title, minutes: i.minutes, amountCents: i.amountCents, who: i.who, status: i.status })) })),
    totalCents: d.totalCents,
    paidCents: d.paidCents,
    balanceCents: d.balanceCents,
    payLink: d.payLink,
    footer: d.footer,
    comments: inv.comments,
    claims: inv.claims.map((c) => ({ id: c.id, at: c.at, amountCents: c.amountCents, method: c.method, status: c.status, reason: c.reason ?? null })),
    receipts: inv.payments.map((p) => ({ receipt: p.receipt, amountCents: p.amountCents, at: p.at }))
  };
}

// ---- notifications, sending, payments ----

async function notify(ctx: LocalCtx, userId: string | null, kind: string, title: string, sub: string, link: string) {
  if (!userId || userId.startsWith("space:") || !(await ctx.db.get("users", userId))) return;
  await ctx.db.put("notifications", { id: sortableId("nt"), userId, kind, title, sub, link, createdAt: nowIso(ctx), readAt: null });
  ctx.changed("notifications");
}

function log(inv: InvoiceRow, ctx: LocalCtx, kind: string, text: string) {
  inv.activity = [...inv.activity, { kind, at: nowIso(ctx), text }];
}

export async function sendInvoice(ctx: LocalCtx, inv: InvoiceRow, issued: string[], via: { email: boolean; whatsapp: boolean; inapp: boolean }) {
  const settings = await moneySettings(ctx, inv.hostId);
  const host = await ctx.db.get<UserRow>("users", inv.hostId);
  const space = await ctx.db.get<SpaceRow>("spaces", inv.lines[0]?.spaceId ?? "");
  const number = inv.number ?? nextInvoiceNumber(issued, settings.prefix, settings.nextNumber);
  const t = ctx.now().getTime();
  inv.number = number;
  inv.status = "sent";
  inv.sentAt = new Date(t).toISOString();
  inv.dueAt = new Date(t + billingFor(space).dueDays * DAY).toISOString();
  inv.via = via;
  for (const l of inv.lines) {
    for (const id of l.logIds) await ctx.db.patch("session_log", id, { invoiceId: inv.id });
    if (l.kind === "credit" && l.memberId) {
      const avail = (await makeupCredits(ctx, inv.hostId)).filter((c) => c.memberId === l.memberId).sort((a, b) => a.at.localeCompare(b.at));
      for (const c of avail.slice(0, l.qty)) await ctx.db.patch("credits", c.id, { usedBy: inv.id });
    }
  }
  if (inv.revisionOf) {
    const orig = await ctx.db.get<InvoiceRow>("invoices", inv.revisionOf);
    if (orig) {
      inv.payments = [...orig.payments];
      inv.claims = [...orig.claims];
      inv.comments = [...orig.comments];
      log(orig, ctx, "void", `Replaced by ${number}`);
      await ctx.db.put("invoices", { ...orig, status: "void", replacedBy: inv.id });
    }
  }
  const channels = [via.email && "email", via.whatsapp && "WhatsApp link", via.inapp && "in-app"].filter(Boolean).join(" + ");
  log(inv, ctx, "sent", `Sent · ${channels || "marked as sent"}`);
  await ctx.db.put("invoices", inv);
  if (via.inapp) await notify(ctx, inv.payerId, "invoice", `Invoice ${number} from ${host?.name ?? "your host"} · ${formatUSD(inv.totalCents)}`, `Due ${shortDate(inv.dueAt)}`, `/pay/${inv.payToken}`);
  return number;
}

export async function confirmPayment(ctx: LocalCtx, inv: InvoiceRow, amount: number, claim: Claim | null, method: string) {
  const amt = Math.min(Math.max(0, amount), balanceDue(inv));
  if (amt <= 0) throw new Error("Nothing left to pay on this invoice");
  const receipt = receiptNumber(inv.number ?? "LF-0000", inv.payments.length);
  inv.payments = [...inv.payments, { id: newId("pm"), amountCents: amt, at: nowIso(ctx), receipt, method, claimId: claim?.id ?? null }];
  if (claim) inv.claims = inv.claims.map((c) => (c.id === claim.id ? { ...c, status: "confirmed" } : c));
  const full = balanceDue(inv) === 0;
  log(inv, ctx, "paid", `${full ? "Payment confirmed" : "Part payment confirmed"} · ${formatUSD(amt)} · receipt ${receipt}`);
  inv.waPending = null;
  await ctx.db.put("invoices", inv);
  if (full && inv.packageId) {
    await ctx.db.patch("credits", `purchase:${inv.packageId}`, { active: true, note: `Bought · ${inv.number} paid` });
  }
  await notify(ctx, inv.payerId, "receipt", `Receipt ${receipt} · ${formatUSD(amt)} received`, `${inv.number}${full ? " · paid in full" : ` · ${formatUSD(balanceDue(inv))} left`}`, `/pay/${inv.payToken}`);
  ctx.changed("invoices", "credits");
  return { receipt, balanceCents: balanceDue(inv) };
}

/** Sell a package (I5): a package row, an inactive purchase in the ledger, and an invoice draft. */
export async function sellPackage(ctx: LocalCtx, hostId: string, input: { spaceId: string; memberId: string; size: number; priceCents: number; renewalOf?: string | null }) {
  const space = await ctx.db.get<SpaceRow>("spaces", input.spaceId);
  if (!space) throw new NotFoundError("Space not found");
  const b = billingFor(space);
  const payerId = b.payers[input.memberId] ?? null;
  const users = await userMap(ctx);
  const pkg: PackageRow = { id: newId("pk"), hostId, spaceId: space.id, memberId: input.memberId, payerId, size: input.size, priceCents: input.priceCents, invoiceId: null, renewalOf: input.renewalOf ?? null, renewalId: null, createdAt: nowIso(ctx) };
  const who = users.get(input.memberId)?.name ?? "Member";
  const inv = blankInvoice(ctx, hostId, {
    payerId,
    memberIds: [input.memberId],
    kind: "package",
    edited: true,
    packageId: pkg.id,
    lines: [{ spaceId: space.id, memberId: input.memberId, description: `${firstName(who)} · ${input.size}-session package · ${space.code}`, qty: 1, unitCents: input.priceCents, amountCents: input.priceCents, logIds: [], sessionIds: [], kind: "package" }],
    totalCents: input.priceCents,
    needsAttention: payerId ? null : "no payer set",
    activity: [{ kind: "drafted", at: nowIso(ctx), text: input.renewalOf ? "Renewal drafted automatically" : "Package sold · draft created" }]
  });
  pkg.invoiceId = inv.id;
  await ctx.db.put("packages", pkg);
  await ctx.db.put("invoices", inv);
  await ctx.db.put("credits", { id: `purchase:${pkg.id}`, hostId, spaceId: space.id, memberId: input.memberId, payerId, packageId: pkg.id, kind: "purchase", qty: input.size, active: false, at: nowIso(ctx), note: `Bought ${input.size} sessions · awaiting payment` } satisfies CreditRow);
  if (input.renewalOf) await ctx.db.patch("packages", input.renewalOf, { renewalId: pkg.id });
  ctx.changed("packages", "invoices", "credits");
  return { pkg, inv };
}

// ---- the daily task (first request of the day; no cron) ----

export async function moneyDaily(ctx: LocalCtx, hostId: string): Promise<void> {
  const settings = await moneySettings(ctx, hostId);
  const now = ctx.now();
  if (!isDailyDue(settings.lastDaily, now)) return;
  // 1. Auto-draft last month's invoices on the first request on/after the 1st.
  const prev = prevMonthKey(monthKey(now));
  if (!settings.lastAutoRun || settings.lastAutoRun < prev) {
    await buildDrafts(ctx, hostId, prev, { auto: true });
    settings.lastAutoRun = prev;
  }
  // 2. Reminders: in-app + email go out; WhatsApp is queued for the host to tap.
  for (const inv of await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === hostId && i.status === "sent")) {
    const step = reminderDue(inv, settings.reminders.steps, inv.remindersSent, now.getTime(), !!inv.payerId && settings.pausedPayers.includes(inv.payerId));
    if (!step) continue;
    const skipped = settings.reminders.steps.filter((s) => s.offsetDays < step.offsetDays && !inv.remindersSent.includes(s.offsetDays)).map((s) => s.offsetDays);
    inv.remindersSent = [...inv.remindersSent, ...skipped, step.offsetDays];
    const auto = step.channels.filter((c) => c !== "whatsapp").map((c) => (c === "inapp" ? "in-app" : c));
    log(inv, ctx, "reminder", `${step.final ? "Final reminder" : "Reminder"} · ${auto.join(" + ") || "queued"}${step.channels.includes("whatsapp") ? " · WhatsApp to send" : ""}`);
    if (step.channels.includes("whatsapp")) inv.waPending = step.offsetDays;
    await ctx.db.put("invoices", inv);
    if (step.channels.includes("inapp")) await notify(ctx, inv.payerId, "reminder", `${step.final ? "Final reminder" : "Reminder"}: ${inv.number} · ${formatUSD(balanceDue(inv))}`, inv.dueAt ? `Due ${shortDate(inv.dueAt)}` : "", `/pay/${inv.payToken}`);
  }
  // 3. Makeup credits expire.
  for (const c of await makeupCredits(ctx, hostId)) {
    if (c.expiresAt && c.expiresAt < now.toISOString()) await ctx.db.patch("credits", c.id, { expired: true, note: `${c.note} · expired` });
  }
  // 4. Package renewals at the threshold.
  if (settings.packages.renew) {
    for (const p of await ctx.db.list<PackageRow>("packages", (x) => x.hostId === hostId && !x.renewalId)) {
      const ledger = await packageLedger(ctx, p.id);
      if (!ledger.some((r) => r.kind === "purchase" && r.active)) continue;
      if (ledgerBalance(ledger) <= settings.packages.renewAt) await sellPackage(ctx, hostId, { spaceId: p.spaceId, memberId: p.memberId, size: p.size, priceCents: p.priceCents, renewalOf: p.id });
    }
  }
  settings.lastDaily = dayKey(now);
  await ctx.db.put("money_settings", settings);
  ctx.changed("invoices", "money_settings");
}

/** To review items for Money: claims to check, drafts ready, WhatsApp reminders to send. */
export async function moneyReviewItems(ctx: LocalCtx, hostId: string) {
  const items: { id: string; kind: string; title: string; sub: string; action: string; link: string }[] = [];
  const invoices = await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === hostId);
  const users = await userMap(ctx);
  for (const inv of invoices.filter((i) => i.status === "sent")) {
    const payer = inv.payerId ? users.get(inv.payerId)?.name ?? "A payer" : "A payer";
    for (const c of inv.claims.filter((x) => x.status === "open")) items.push({ id: `claim:${inv.id}:${c.id}`, kind: "payment", title: `${payer} says ${inv.number} is paid`, sub: `${formatUSD(c.amountCents)} · ${c.method}${c.reference ? ` · ${c.reference}` : ""}`, action: "Check", link: `/money/payments?invoice=${inv.id}` });
    if (inv.waPending !== null) items.push({ id: `wa:${inv.id}`, kind: "reminder", title: `WhatsApp reminder to send · ${payer}`, sub: `${inv.number} · ${formatUSD(balanceDue(inv))} left`, action: "Send", link: "/money/reminders" });
  }
  const drafts = invoices.filter((i) => i.status === "draft");
  if (drafts.length) {
    const ready = drafts.filter((d) => !d.needsAttention);
    const attention = drafts.length - ready.length;
    items.push({ id: "drafts", kind: "invoices", title: `${ready.length} invoice draft${ready.length === 1 ? "" : "s"} ready to send`, sub: `${formatUSD(ready.reduce((n, d) => n + d.totalCents, 0))}${attention ? ` · ${attention} need${attention === 1 ? "s" : ""} attention` : ""}`, action: "Review", link: "/money/invoices" });
  }
  return items;
}

// ---- routes ----

routes
  .get("money/overview", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    await moneyDaily(ctx, me.id);
    const month = str(input.month, 7) || monthKey(ctx.now());
    const v = await viewCtx(ctx, me.id);
    const spaces = await hostedSpaces(ctx, me.id);
    const ids = new Set(spaces.map((s) => s.id));
    const { start, end } = monthRange(month);
    const logRows = await ctx.db.list<LogRowDb>("session_log", (r) => ids.has(r.spaceId));
    const invoices = await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === me.id);
    const sent = invoices.filter((i) => i.status === "sent");
    const inMonth = (iso: string) => iso >= start && iso < end;
    const payments = sent.flatMap((i) => i.payments).filter((p) => inMonth(p.at));
    const months = [...new Set([monthKey(ctx.now()), ...logRows.map((r) => monthKey(r.at)), ...invoices.map((i) => i.period)])].sort().reverse().slice(0, 12);
    return {
      month,
      label: monthLabel(month),
      months: months.map((m) => ({ key: m, label: monthLabel(m) })),
      kpis: {
        notInvoicedCents: logRows.filter((r) => !r.invoiceId && r.billable && inMonth(r.at)).reduce((n, r) => n + r.amountCents, 0),
        billableSessions: logRows.filter((r) => r.billable && inMonth(r.at)).length,
        lateCancels: logRows.filter((r) => r.status === "late_cancel" && r.billable && inMonth(r.at)).length,
        makeupCredits: (await makeupCredits(ctx, me.id)).length,
        outstandingCents: sent.reduce((n, i) => n + balanceDue(i), 0),
        overdue: sent.filter((i) => isOverdue(i, v.now)).length,
        overdueCents: sent.filter((i) => isOverdue(i, v.now)).reduce((n, i) => n + balanceDue(i), 0),
        claims: sent.reduce((n, i) => n + i.claims.filter((c) => c.status === "open").length, 0),
        drafts: invoices.filter((i) => i.status === "draft").length,
        paidCents: payments.reduce((n, p) => n + p.amountCents, 0)
      },
      recent: sent.sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? "")).slice(0, 6).map((i) => listView(v, i)),
      review: await moneyReviewItems(ctx, me.id),
      unconfigured: spaces.filter((s) => s.mode !== "team" && !s.billing).map((s) => ({ id: s.id, name: s.name, slug: s.slug }))
    };
  })
  .get("money/log", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const month = str(input.month, 7) || monthKey(ctx.now());
    const v = await viewCtx(ctx, me.id);
    const spaces = await hostedSpaces(ctx, me.id);
    const ids = new Set(spaces.map((s) => s.id));
    const { start, end } = monthRange(month);
    const invoices = new Map((await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === me.id)).map((i) => [i.id, i]));
    const pkgs = new Map((await ctx.db.list<PackageRow>("packages", (p) => p.hostId === me.id)).map((p) => [p.id, p]));
    const uses = await ctx.db.list<CreditRow>("credits", (c) => c.hostId === me.id && c.kind === "use");
    const rows = (await ctx.db.list<LogRowDb>("session_log", (r) => ids.has(r.spaceId) && r.at >= start && r.at < end)).sort((a, b) => b.at.localeCompare(a.at) || a.memberId.localeCompare(b.memberId));
    const credits = await ctx.db.list<CreditRow>("credits", (c) => c.hostId === me.id && c.kind === "credit");
    return {
      month,
      label: monthLabel(month),
      spaces: spaces.filter((s) => rows.some((r) => r.spaceId === s.id)).map((s) => ({ id: s.id, code: s.code, name: s.name })),
      kpis: {
        notInvoicedCents: rows.filter((r) => !r.invoiceId && r.billable).reduce((n, r) => n + r.amountCents, 0),
        billableSessions: rows.filter((r) => r.billable).length,
        lateCancels: rows.filter((r) => r.status === "late_cancel" && r.billable).length,
        makeupCredits: credits.filter((c) => !c.usedBy && !c.expired).length
      },
      rows: rows.map((r) => {
        const pkg = r.packageId ? pkgs.get(r.packageId) : undefined;
        const used = pkg ? uses.filter((u) => u.packageId === pkg.id && u.at <= r.at).length : 0;
        const space = v.spaces.get(r.spaceId);
        return {
          ...r,
          spaceCode: space?.code ?? "",
          spaceName: space?.name ?? "",
          memberName: memberName(v, r.memberId),
          payerName: r.payerId ? memberName(v, r.payerId) : null,
          invoiceNumber: r.invoiceId ? invoices.get(r.invoiceId)?.number ?? "draft" : null,
          package: pkg ? { used, size: pkg.size } : null,
          credit: credits.some((c) => c.logId === r.id)
        };
      })
    };
  })
  .post("money/log/:id", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const row = await ctx.db.get<LogRowDb>("session_log", p.id!);
    if (!row) throw new NotFoundError("Log row not found");
    const space = await ctx.db.get<SpaceRow>("spaces", row.spaceId);
    if (!space) throw new NotFoundError("Space not found");
    await requireHostOf(ctx, space.id);
    if (row.invoiceId) throw new ForbiddenError("This row is on an invoice. Edit the invoice instead.");
    const status = (["attended", "absent", "excused", "late_cancel", "no_show"] as const).find((s) => s === input.status) ?? row.status;
    const minutes = typeof input.minutes === "number" ? Math.max(0, Math.round(input.minutes)) : row.minutes;
    const next = await applyLog(ctx, { id: row.sessionId, spaceId: row.spaceId, startsAt: row.at, minutes, title: row.title ?? "Session" }, space, { memberId: row.memberId, minutes, status });
    await rebuildOpenDrafts(ctx, me.id);
    ctx.changed("session_log", "credits");
    return next;
  })
  .get("spaces/:id/billing", async (ctx, p) => {
    const me = await requireHostOf(ctx, p.id!);
    const space = await ctx.db.get<SpaceRow>("spaces", p.id!);
    if (!space) throw new NotFoundError("Space not found");
    const b = billingFor(space);
    const users = await userMap(ctx);
    const members = (await ctx.db.list<MemberRow>("memberships", (m) => m.spaceId === space.id && m.role !== "host")).map((m) => m.userId);
    const settings = await moneySettings(ctx, me.id);
    const people = [...users.values()].filter((u) => u.id !== me.id && !("guest" in u && (u as { guest?: boolean }).guest)).map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone ?? null }));
    const payer = (id: string | undefined) => (id ? users.get(id) : undefined);
    return {
      space: { id: space.id, name: space.name, slug: space.slug, code: space.code, mode: space.mode },
      billing: b,
      configured: !!space.billing,
      members: (b.per === "session" ? [`*`] : members).map((m) => {
        const pid = b.payers[m];
        const pu = payer(pid);
        return { memberId: m, name: m === "*" ? `${space.name} · whole space` : users.get(m)?.name ?? "Member", payerId: pid ?? null, payerName: pu?.name ?? null, payerContact: pu ? pu.email || pu.phone || "" : null, self: pid === m };
      }),
      people,
      defaultLink: settings.paymentLink.link,
      settings: { prefix: settings.prefix, nextNumber: nextInvoiceNumber((await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === me.id)).map((i) => i.number ?? ""), settings.prefix, settings.nextNumber), footer: settings.footer, reminders: settings.reminders.steps }
    };
  })
  .post("spaces/:id/billing", async (ctx, p, input) => {
    const me = await requireHostOf(ctx, p.id!);
    const space = await ctx.db.get<SpaceRow>("spaces", p.id!);
    if (!space) throw new NotFoundError("Space not found");
    const cur = billingFor(space);
    const raw = (input.billing ?? {}) as Partial<SpaceBilling>;
    const models = ["per_session", "per_hour", "monthly", "package", "free"] as const;
    const next: SpaceBilling = {
      ...cur,
      model: models.find((m) => m === raw.model) ?? cur.model,
      unitPriceCents: cents(raw.unitPriceCents) ?? cur.unitPriceCents,
      per: raw.per === "session" || raw.per === "member" ? raw.per : cur.per,
      billable: Array.isArray(raw.billable) ? (raw.billable.filter((s) => ["attended", "late_cancel", "no_show"].includes(s)) as AttendanceStatus[]) : cur.billable,
      excused: raw.excused === "none" ? "none" : raw.excused === "makeup" ? "makeup" : cur.excused,
      schedule: (["monthly", "after_session", "package_out"] as const).find((s) => s === raw.schedule) ?? cur.schedule,
      dueDays: typeof raw.dueDays === "number" ? Math.max(0, Math.min(60, Math.round(raw.dueDays))) : cur.dueDays,
      paymentLink: raw.paymentLink === null ? null : typeof raw.paymentLink === "string" ? str(raw.paymentLink, 300) || null : cur.paymentLink,
      combineSiblings: typeof raw.combineSiblings === "boolean" ? raw.combineSiblings : cur.combineSiblings,
      payers: raw.payers && typeof raw.payers === "object" ? Object.fromEntries(Object.entries(raw.payers).filter(([, v]) => typeof v === "string" && v)) : cur.payers
    };
    await ctx.db.put("spaces", { ...space, billing: next });
    if (input.settings && typeof input.settings === "object") {
      const s = input.settings as Partial<MoneySettings>;
      const settings = await moneySettings(ctx, me.id);
      if (typeof s.footer === "string") settings.footer = str(s.footer, 300);
      if (typeof s.nextNumber === "number" && s.nextNumber > 0) settings.nextNumber = Math.round(s.nextNumber);
      await ctx.db.put("money_settings", settings);
    }
    ctx.changed("spaces", "money_settings");
    return next;
  })
  // "Add payer" (I1 / I3 needs attention): map a member to a payer and fix their unbilled rows.
  .post("spaces/:id/billing/payer", async (ctx, p, input) => {
    const me = await requireHostOf(ctx, p.id!);
    const space = await ctx.db.get<SpaceRow>("spaces", p.id!);
    if (!space) throw new NotFoundError("Space not found");
    const memberId = str(input.memberId, 80);
    const payerId = str(input.payerId, 80);
    if (!memberId || !payerId || !(await ctx.db.get("users", payerId))) throw new Error("Pick a payer");
    const b = billingFor(space);
    await ctx.db.put("spaces", { ...space, billing: { ...b, payers: { ...b.payers, [memberId]: payerId } } });
    const key = b.per === "session" ? `space:${space.id}` : memberId;
    for (const r of await ctx.db.list<LogRowDb>("session_log", (x) => x.spaceId === space.id && x.memberId === key && !x.invoiceId)) await ctx.db.patch("session_log", r.id, { payerId });
    await rebuildOpenDrafts(ctx, me.id);
    ctx.changed("spaces", "session_log", "invoices");
    return { ok: true };
  })
  .post("money/run", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const month = str(input.month, 7) || monthKey(ctx.now());
    const made = await buildDrafts(ctx, me.id, month);
    return { month, drafts: made.length, ready: made.filter((d) => !d.needsAttention).length };
  })
  .get("money/invoices", async (ctx) => {
    const me = await requireMe(ctx);
    await moneyDaily(ctx, me.id);
    const v = await viewCtx(ctx, me.id);
    const all = await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === me.id);
    const drafts = all.filter((i) => i.status === "draft").sort((a, b) => b.totalCents - a.totalCents).map((i) => listView(v, i));
    const periods = [...new Set(all.filter((i) => i.status === "draft").map((i) => i.period))].sort();
    return {
      draftPeriod: periods.at(-1) ?? null,
      draftLabel: periods.length ? monthLabel(periods.at(-1)!) : null,
      ready: drafts.filter((d) => !d.needsAttention),
      attention: drafts.filter((d) => d.needsAttention),
      sent: all.filter((i) => i.status !== "draft").sort((a, b) => (b.number ?? "").localeCompare(a.number ?? "")).map((i) => listView(v, i)),
      footer: v.settings.footer
    };
  })
  .get("invoices/:id", async (ctx, p) => {
    const me = await requireMe(ctx);
    const inv = await invoiceOr404(ctx, p.id!, me.id);
    return detailView(ctx, await viewCtx(ctx, me.id), inv);
  })
  .post("invoices/send", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const ids = arr(input.ids);
    const via = { email: input.email !== false, whatsapp: input.whatsapp !== false, inapp: input.inapp !== false };
    const all = await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === me.id);
    const issued = all.map((i) => i.number).filter((n): n is string => !!n);
    const v = await viewCtx(ctx, me.id);
    const sent = [];
    for (const id of ids) {
      const inv = all.find((i) => i.id === id);
      if (!inv || inv.status !== "draft" || !inv.payerId || !inv.lines.length) continue;
      const number = await sendInvoice(ctx, inv, issued, via);
      issued.push(number);
      sent.push(listView(v, inv));
    }
    ctx.changed("invoices", "session_log", "credits");
    return { sent };
  })
  .post("invoices/:id/lines", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const inv = await invoiceOr404(ctx, p.id!, me.id);
    if (inv.status !== "draft") throw new ForbiddenError("Sent invoices are frozen. Edit lines to create a revision.");
    const lines = (Array.isArray(input.lines) ? input.lines : []) as InvoiceLine[];
    inv.lines = lines.map((l) => ({ ...l, description: str(l.description, 160) || "Line", qty: Number(l.qty) || 1, amountCents: cents(l.amountCents) ?? 0, unitCents: cents(l.unitCents) ?? 0, logIds: arr(l.logIds), sessionIds: arr(l.sessionIds) }));
    inv.totalCents = inv.lines.reduce((n, l) => n + l.amountCents, 0);
    inv.edited = true;
    log(inv, ctx, "edited", "Lines edited");
    await ctx.db.put("invoices", inv);
    ctx.changed("invoices");
    return { ok: true, totalCents: inv.totalCents };
  })
  .post("invoices/:id/revise", async (ctx, p) => {
    const me = await requireMe(ctx);
    const inv = await invoiceOr404(ctx, p.id!, me.id);
    if (inv.status === "draft") return { id: inv.id };
    if (inv.status === "void") throw new ForbiddenError("This invoice is void");
    const existing = (await ctx.db.list<InvoiceRow>("invoices", (i) => i.revisionOf === inv.id && i.status === "draft"))[0];
    if (existing) return { id: existing.id };
    const rev = blankInvoice(ctx, me.id, { ...inv, id: newId("inv"), number: revisionNumber(inv.number ?? "LF-0000"), status: "draft", edited: true, revisionOf: inv.id, sentAt: null, dueAt: null, viewedAt: null, viewCount: 0, payments: [], claims: [], remindersSent: [], waPending: null, payToken: inv.payToken, activity: [{ kind: "drafted", at: nowIso(ctx), text: `Revision of ${inv.number}` }] });
    await ctx.db.put("invoices", rev);
    ctx.changed("invoices");
    return { id: rev.id };
  })
  .post("invoices/:id/void", async (ctx, p) => {
    const me = await requireMe(ctx);
    const inv = await invoiceOr404(ctx, p.id!, me.id);
    if (inv.status === "draft") {
      await ctx.db.del("invoices", inv.id);
      ctx.changed("invoices");
      return { ok: true, deleted: true };
    }
    for (const id of inv.lines.flatMap((l) => l.logIds)) await ctx.db.patch("session_log", id, { invoiceId: null });
    for (const c of await ctx.db.list<CreditRow>("credits", (x) => x.usedBy === inv.id)) await ctx.db.patch("credits", c.id, { usedBy: null });
    inv.status = "void";
    inv.waPending = null;
    log(inv, ctx, "void", "Voided · rows are back in the log");
    await ctx.db.put("invoices", inv);
    await notify(ctx, inv.payerId, "invoice", `${inv.number} was cancelled`, "No payment needed for this invoice", `/pay/${inv.payToken}`);
    ctx.changed("invoices", "session_log", "credits");
    return { ok: true };
  })
  .post("invoices/:id/resend", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const inv = await invoiceOr404(ctx, p.id!, me.id);
    if (inv.status !== "sent") throw new ForbiddenError("Only sent invoices can be resent");
    const nudge = input.nudge === true;
    log(inv, ctx, nudge ? "reminder" : "sent", nudge ? "Nudge sent · in-app" : "Resent · in-app");
    if (nudge) inv.waPending = null;
    await ctx.db.put("invoices", inv);
    await notify(ctx, inv.payerId, nudge ? "reminder" : "invoice", `${nudge ? "Reminder" : "Invoice"}: ${inv.number} · ${formatUSD(balanceDue(inv))}`, inv.dueAt ? `Due ${shortDate(inv.dueAt)}` : "", `/pay/${inv.payToken}`);
    ctx.changed("invoices");
    return { ok: true };
  })
  .post("invoices/:id/comments", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const inv = await invoiceOr404(ctx, p.id!, me.id);
    const body = str(input.body, 1000);
    if (!body) throw new Error("Write a reply");
    inv.comments = [...inv.comments, { id: newId("cm"), lineIdx: typeof input.lineIdx === "number" ? input.lineIdx : null, userId: me.id, name: me.name, body, at: nowIso(ctx), fromPayer: false }];
    await ctx.db.put("invoices", inv);
    await notify(ctx, inv.payerId, "message", `${firstName(me.name)} replied on ${inv.number}`, body.slice(0, 80), `/pay/${inv.payToken}`);
    ctx.changed("invoices");
    return { ok: true };
  })
  .get("money/claims", async (ctx) => {
    const me = await requireMe(ctx);
    const v = await viewCtx(ctx, me.id);
    const sent = await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === me.id && i.status === "sent");
    const { start, end } = monthRange(monthKey(ctx.now()));
    const confirmed = sent.flatMap((i) => i.payments).filter((pm) => pm.at >= start && pm.at < end);
    return {
      open: sent.flatMap((i) => i.claims.filter((c) => c.status === "open").map((c) => ({ ...c, invoice: listView(v, i) }))).sort((a, b) => b.at.localeCompare(a.at)),
      unpaid: sent.filter((i) => balanceDue(i) > 0 && !i.claims.some((c) => c.status === "open")).map((i) => listView(v, i)),
      confirmedThisMonth: { count: confirmed.length, cents: confirmed.reduce((n, pm) => n + pm.amountCents, 0) }
    };
  })
  .post("invoices/:id/confirm", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const inv = await invoiceOr404(ctx, p.id!, me.id);
    if (inv.status !== "sent") throw new ForbiddenError("Only sent invoices take payments");
    const claim = inv.claims.find((c) => c.id === input.claimId && c.status === "open") ?? null;
    const amount = cents(input.amountCents) ?? claim?.amountCents ?? balanceDue(inv);
    return confirmPayment(ctx, inv, amount, claim, claim?.method ?? (str(input.method, 40) || "Marked paid"));
  })
  .post("invoices/:id/reject", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const inv = await invoiceOr404(ctx, p.id!, me.id);
    const claim = inv.claims.find((c) => c.id === input.claimId && c.status === "open");
    if (!claim) throw new NotFoundError("No open claim");
    const reason = str(input.reason, 300) || "I couldn't find this payment yet.";
    inv.claims = inv.claims.map((c) => (c.id === claim.id ? { ...c, status: "rejected", reason } : c));
    log(inv, ctx, "rejected", `Claim not confirmed · ${reason} · reminders resume`);
    await ctx.db.put("invoices", inv);
    await notify(ctx, inv.payerId, "invoice", `${inv.number}: payment not found yet`, reason, `/pay/${inv.payToken}`);
    ctx.changed("invoices");
    return { ok: true };
  })
  // "Can't find it · ask <payer>": a DM from the host, in their words.
  .post("invoices/:id/ask", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const inv = await invoiceOr404(ctx, p.id!, me.id);
    if (!inv.payerId) throw new Error("No payer on this invoice");
    const payer = await ctx.db.get<UserRow>("users", inv.payerId);
    const body = str(input.body, 1000) || `Hi ${firstName(payer?.name ?? "")}, I can't find the payment for ${inv.number} (${formatUSD(balanceDue(inv))}) yet. Could you send the receipt or reference?`;
    const channelId = [me.id, inv.payerId].sort().join("~");
    await ctx.db.put("messages", { id: sortableId("msg"), channelType: "dm", channelId, userId: me.id, name: me.name, body, createdAt: nowIso(ctx) });
    log(inv, ctx, "asked", `Asked ${firstName(payer?.name ?? "the payer")} by DM`);
    await ctx.db.put("invoices", inv);
    await notify(ctx, inv.payerId, "message", `${me.name}: ${body.slice(0, 60)}`, "Direct message", `/dm/${me.id}`);
    ctx.changed("messages", "invoices");
    return { ok: true, dm: `/dm/${inv.payerId}` };
  })
  .get("money/packages", async (ctx) => {
    const me = await requireMe(ctx);
    const v = await viewCtx(ctx, me.id);
    const pkgs = await ctx.db.list<PackageRow>("packages", (p) => p.hostId === me.id);
    const invoices = new Map((await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === me.id)).map((i) => [i.id, i]));
    const rows = [];
    for (const p of pkgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const ledger = await packageLedger(ctx, p.id);
      const active = ledger.some((r) => r.kind === "purchase" && r.active);
      const used = ledger.filter((r) => r.kind === "use").length;
      const renewal = p.renewalId ? pkgs.find((x) => x.id === p.renewalId) : undefined;
      const renewalInv = renewal?.invoiceId ? invoices.get(renewal.invoiceId) : undefined;
      const inv = p.invoiceId ? invoices.get(p.invoiceId) : undefined;
      if (!active && p.renewalOf) continue; // shown as "Renewal drafted" on the package it renews
      rows.push({
        id: p.id,
        memberName: memberName(v, p.memberId),
        spaceCode: v.spaces.get(p.spaceId)?.code ?? "",
        plan: `${p.size}-session package`,
        size: p.size,
        used,
        left: ledgerBalance(ledger),
        status: !active ? "awaiting" : renewal ? "renewal" : ledgerBalance(ledger) <= 0 ? "used" : "active",
        priceCents: p.priceCents,
        ledger: ledger.map((r) => ({ id: r.id, kind: r.kind, qty: r.qty, active: r.active, at: r.at, note: r.note })),
        invoice: inv ? { id: inv.id, number: inv.number, status: invoiceStatus(inv, v.now) } : null,
        renewal: renewalInv ? { id: renewalInv.id, number: renewalInv.number, priceCents: renewal!.priceCents, at: renewalInv.createdAt } : null
      });
    }
    const credits = await ctx.db.list<CreditRow>("credits", (c) => c.hostId === me.id && c.kind === "credit" && !c.packageId);
    const byMember = new Map<string, CreditRow[]>();
    for (const c of credits.filter((x) => !x.usedBy && !x.expired)) byMember.set(c.memberId, [...(byMember.get(c.memberId) ?? []), c]);
    const settings = await moneySettings(ctx, me.id);
    const spaces = await hostedSpaces(ctx, me.id);
    const members = [];
    for (const s of spaces.filter((x) => billingFor(x).per === "member" && billingFor(x).model !== "free")) {
      for (const m of await ctx.db.list<MemberRow>("memberships", (x) => x.spaceId === s.id && x.role !== "host" && x.role !== "cohost")) members.push({ spaceId: s.id, memberId: m.userId, label: `${memberName(v, m.userId)} · ${s.code}`, priceCents: billingFor(s).unitPriceCents });
    }
    return {
      packages: rows,
      credits: [...byMember.entries()].map(([memberId, list]) => ({ memberId, memberName: memberName(v, memberId), spaceCode: v.spaces.get(list[0]!.spaceId)?.code ?? "", count: list.length, expiresAt: list.map((c) => c.expiresAt).filter(Boolean).sort()[0] ?? null })),
      hourly: spaces.filter((s) => billingFor(s).model === "per_hour" || billingFor(s).model === "monthly").map((s) => ({ name: s.name, code: s.code, plan: billingFor(s).model === "per_hour" ? "Per hour" : "Monthly" })),
      rules: settings.packages,
      members
    };
  })
  .post("money/packages", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const spaceId = str(input.spaceId, 80);
    await requireHostOf(ctx, spaceId);
    const size = Math.max(1, Math.min(100, Math.round(Number(input.size) || 0)));
    const priceCents = cents(input.priceCents) ?? 0;
    if (!size || priceCents <= 0) throw new Error("Set the sessions and a price");
    const { inv } = await sellPackage(ctx, me.id, { spaceId, memberId: str(input.memberId, 80), size, priceCents });
    return { invoiceId: inv.id };
  })
  .get("money/settings", async (ctx) => {
    const me = await requireMe(ctx);
    return moneySettings(ctx, me.id);
  })
  .post("money/settings", async (ctx, _p, input) => {
    const me = await requireMe(ctx);
    const s = await moneySettings(ctx, me.id);
    if (input.packages && typeof input.packages === "object") s.packages = { ...s.packages, ...(input.packages as Partial<MoneySettings["packages"]>) };
    if (input.reminders && typeof input.reminders === "object") {
      const r = input.reminders as Partial<MoneySettings["reminders"]>;
      s.reminders = { steps: Array.isArray(r.steps) ? r.steps : s.reminders.steps, subject: typeof r.subject === "string" ? str(r.subject, 200) : s.reminders.subject, text: typeof r.text === "string" ? str(r.text, 1000) : s.reminders.text };
    }
    if (input.paymentLink && typeof input.paymentLink === "object") {
      const pl = input.paymentLink as Partial<PaymentLinkSettings>;
      s.paymentLink = { mode: pl.mode === "template" || pl.mode === "per_payer" ? pl.mode : "same", link: str(pl.link ?? s.paymentLink.link, 300), template: str(pl.template ?? s.paymentLink.template, 300), perPayer: pl.perPayer ?? s.paymentLink.perPayer };
      await ctx.db.put("settings", { ...((await ctx.db.get("settings", me.id)) ?? { id: me.id }), paymentLink: s.paymentLink.link || null });
    }
    if (typeof input.prefix === "string") s.prefix = str(input.prefix, 6).toUpperCase().replace(/[^A-Z0-9]/g, "") || "LF";
    if (typeof input.footer === "string") s.footer = str(input.footer, 300);
    if (typeof input.brandLine === "string") s.brandLine = str(input.brandLine, 80);
    if (typeof input.nextNumber === "number" && input.nextNumber > 0) s.nextNumber = Math.round(input.nextNumber);
    await ctx.db.put("money_settings", s);
    ctx.changed("money_settings", "settings");
    return s;
  })
  .get("money/reminders", async (ctx) => {
    const me = await requireMe(ctx);
    await moneyDaily(ctx, me.id);
    const v = await viewCtx(ctx, me.id);
    const sent = await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === me.id && i.status === "sent");
    return {
      steps: v.settings.reminders.steps,
      subject: v.settings.reminders.subject,
      text: v.settings.reminders.text,
      overdue: sent.filter((i) => isOverdue(i, v.now)).sort((a, b) => (a.dueAt ?? "").localeCompare(b.dueAt ?? "")).map((i) => listView(v, i)),
      queued: sent.filter((i) => i.waPending !== null).map((i) => listView(v, i)),
      pausedPayers: v.settings.pausedPayers.map((id) => ({ id, name: memberName(v, id) }))
    };
  })
  .post("money/payers/:id/pause", async (ctx, p, input) => {
    const me = await requireMe(ctx);
    const s = await moneySettings(ctx, me.id);
    const id = p.id!;
    s.pausedPayers = input.paused === false ? s.pausedPayers.filter((x) => x !== id) : [...new Set([...s.pausedPayers, id])];
    await ctx.db.put("money_settings", s);
    ctx.changed("money_settings", "invoices");
    return { paused: s.pausedPayers.includes(id) };
  })
  // ---- the payer's pay page (no sign-in; the token in the link is the key) ----
  .get("pay/:token", async (ctx, p) => {
    const inv = (await ctx.db.list<InvoiceRow>("invoices", (i) => i.payToken === p.token && i.status !== "draft" && !i.replacedBy))[0] ?? (await ctx.db.list<InvoiceRow>("invoices", (i) => i.payToken === p.token && i.status !== "draft"))[0];
    if (!inv) throw new NotFoundError("This invoice link isn't valid");
    const isHost = ctx.meId === inv.hostId;
    // A view counts once per 30 minutes (the page re-reads whenever data changes).
    if (!isHost && inv.status === "sent" && (!inv.viewedAt || Date.parse(inv.viewedAt) < ctx.now().getTime() - 30 * 60_000)) {
      inv.viewCount += 1;
      inv.viewedAt = nowIso(ctx);
      log(inv, ctx, "viewed", inv.viewCount > 1 ? `Viewed ${inv.viewCount === 2 ? "twice" : `${inv.viewCount} times`}` : "Viewed");
      await ctx.db.put("invoices", inv);
    }
    return payView(ctx, inv);
  })
  .post("pay/:token/claim", async (ctx, p, input) => {
    const inv = (await ctx.db.list<InvoiceRow>("invoices", (i) => i.payToken === p.token && i.status === "sent"))[0];
    if (!inv) throw new NotFoundError("This invoice can't take payments");
    if (balanceDue(inv) === 0) throw new Error("This invoice is already paid");
    const amount = Math.min(cents(input.amountCents) ?? balanceDue(inv), balanceDue(inv));
    if (amount <= 0) throw new Error("Enter the amount you paid");
    const claim: Claim = { id: newId("cl"), at: nowIso(ctx), amountCents: amount, method: str(input.method, 40) || "Payment link", reference: str(input.reference, 80), note: str(input.note, 500), status: "open" };
    inv.claims = [...inv.claims, claim];
    inv.waPending = null;
    log(inv, ctx, "claimed", `Payer says paid · ${claim.method}${claim.reference ? ` · ${claim.reference}` : ""}`);
    await ctx.db.put("invoices", inv);
    const payer = inv.payerId ? await ctx.db.get<UserRow>("users", inv.payerId) : undefined;
    await notify(ctx, inv.hostId, "payment", `${payer?.name ?? "A payer"} says ${inv.number} is paid`, `${formatUSD(amount)} · ${claim.method}`, `/money/payments?invoice=${inv.id}`);
    ctx.changed("invoices");
    return payView(ctx, inv);
  })
  .post("pay/:token/comments", async (ctx, p, input) => {
    const inv = (await ctx.db.list<InvoiceRow>("invoices", (i) => i.payToken === p.token && i.status !== "draft"))[0];
    if (!inv) throw new NotFoundError("This invoice link isn't valid");
    const body = str(input.body, 1000);
    if (!body) throw new Error("Write your question");
    const payer = inv.payerId ? await ctx.db.get<UserRow>("users", inv.payerId) : undefined;
    const lineIdx = typeof input.lineIdx === "number" ? input.lineIdx : null;
    inv.comments = [...inv.comments, { id: newId("cm"), lineIdx, userId: inv.payerId, name: payer?.name ?? "Payer", body, at: nowIso(ctx), fromPayer: true }];
    await ctx.db.put("invoices", inv);
    await notify(ctx, inv.hostId, "message", `${payer?.name ?? "A payer"} asked about ${inv.number}`, body.slice(0, 80), `/money/invoices/${inv.id}`);
    ctx.changed("invoices");
    return payView(ctx, inv);
  });

/** After a payer or status change, rebuild untouched drafts so they never go stale. */
async function rebuildOpenDrafts(ctx: LocalCtx, hostId: string) {
  const periods = new Set((await ctx.db.list<InvoiceRow>("invoices", (i) => i.hostId === hostId && i.status === "draft" && !i.edited && i.kind === "monthly")).map((i) => i.period));
  for (const m of periods) await buildDrafts(ctx, hostId, m);
}
