/**
 * Money (Figma 06 · row B): USD, no payment gateway. The host's own payment link; payers tap "I've paid";
 * the host confirms. Rules ported from legacy/tutorloft/src/lib/billing.ts + payment-reminders.ts as pure functions.
 */
import { fillPaymentLink, prorate } from "./money";
import type { AttendanceStatus } from "./plans";

export type BillingModel = "per_session" | "per_hour" | "monthly" | "package" | "free";

export interface SpaceBilling {
  model: BillingModel;
  /** Per session, per hour or per month depending on the model (cents). */
  unitPriceCents: number;
  /** Bill each member (tutoring, courses) or the space once per session (clients, workshops). */
  per: "member" | "session";
  billable: AttendanceStatus[];
  lateCancelHours: number;
  /** Excused absence: not billed, optionally with a makeup credit. */
  excused: "makeup" | "none";
  schedule: "monthly" | "after_session" | "package_out";
  dueDays: number;
  /** Optional per-space override of the Money payment link. */
  paymentLink?: string | null;
  combineSiblings: boolean;
  /** member → payer user id ("*" = the payer for per-session spaces). */
  payers: Record<string, string>;
}

export const DEFAULT_BILLING: SpaceBilling = { model: "per_session", unitPriceCents: 0, per: "member", billable: ["attended", "late_cancel", "no_show"], lateCancelHours: 24, excused: "makeup", schedule: "monthly", dueDays: 7, paymentLink: null, combineSiblings: true, payers: {} };

/** Fill missing fields (older rows stored only { mode, unitPriceCents }). */
export function normaliseBilling(raw: (Partial<SpaceBilling> & { mode?: string }) | null | undefined, spaceMode = "course"): SpaceBilling {
  const per = raw?.per ?? (spaceMode === "client" || spaceMode === "workshop" || spaceMode === "team" ? "session" : "member");
  const model = (raw?.model ?? (raw?.mode as BillingModel | undefined) ?? (spaceMode === "team" ? "free" : "per_session")) as BillingModel;
  const { mode: _mode, ...rest } = raw ?? {};
  return { ...DEFAULT_BILLING, ...rest, model, per, payers: { ...(raw?.payers ?? {}) } };
}

export interface LogRow {
  id: string;
  sessionId: string;
  spaceId: string;
  memberId: string;
  payerId: string | null;
  minutes: number;
  status: AttendanceStatus;
  billable: boolean;
  unitPriceCents: number;
  amountCents: number;
  invoiceId: string | null;
  at: string;
  title?: string;
  /** Paid from a package: shows as a credit, never invoiced per session. */
  packageId?: string | null;
}

/** Re-price a row from the space policy (status changes; invoiced rows stay frozen). */
export function priceRow(
  row: Pick<LogRow, "status" | "minutes" | "invoiceId" | "unitPriceCents" | "amountCents" | "billable">,
  b: Pick<SpaceBilling, "model" | "billable" | "unitPriceCents">
): { billable: boolean; unitPriceCents: number; amountCents: number } {
  if (row.invoiceId) return { billable: row.billable, unitPriceCents: row.unitPriceCents, amountCents: row.amountCents };
  const billable = b.model !== "free" && b.billable.includes(row.status);
  if (!billable) return { billable: false, unitPriceCents: b.unitPriceCents, amountCents: 0 };
  if (b.model === "per_hour") return { billable, unitPriceCents: b.unitPriceCents, amountCents: prorate(b.unitPriceCents, row.minutes) };
  if (b.model === "monthly" || b.model === "package") return { billable, unitPriceCents: 0, amountCents: 0 };
  return { billable, unitPriceCents: b.unitPriceCents, amountCents: b.unitPriceCents };
}

export interface InvoiceLine {
  spaceId: string;
  memberId: string | null;
  description: string;
  qty: number;
  unitCents: number;
  amountCents: number;
  logIds: string[];
  sessionIds: string[];
  kind: "sessions" | "hours" | "monthly" | "package" | "credit" | "adjustment";
}

export interface InvoiceDraft {
  payerId: string | null;
  lines: InvoiceLine[];
  totalCents: number;
  needsAttention: string | null;
}

/**
 * Draft one invoice per payer from unbilled billable rows (I3). Grouping: payer → members → space
 * (siblings combine unless a space turns that off). per_session = count × price; per_hour = total
 * minutes / 60 × rate; monthly = one line per member (or per space); makeup credits are negative
 * lines. Package rows are skipped. Rows without a payer produce a draft that needs attention.
 */
export function draftInvoices(
  rows: LogRow[],
  billing: Record<string, SpaceBilling>,
  opts: { names?: Record<string, string>; monthLabel?: string; credits?: Record<string, number>; monthly?: { spaceId: string; memberId: string; payerId: string | null }[] } = {}
): InvoiceDraft[] {
  const names = opts.names ?? {};
  const credits = { ...(opts.credits ?? {}) };
  type Item = { spaceId: string; memberId: string; payerId: string | null; row?: LogRow };
  const items: Item[] = rows
    .filter((r) => r.billable && !r.invoiceId && !r.packageId && (billing[r.spaceId]?.model ?? "per_session") !== "monthly")
    .map((r) => ({ spaceId: r.spaceId, memberId: r.memberId, payerId: r.payerId, row: r }));
  for (const m of opts.monthly ?? []) items.push({ ...m });
  const byPayer = new Map<string, Item[]>();
  for (const it of items) {
    const combine = billing[it.spaceId]?.combineSiblings ?? true;
    const k = it.payerId ? (combine ? it.payerId : `${it.payerId}|${it.memberId}`) : `__none__${it.memberId}`;
    byPayer.set(k, [...(byPayer.get(k) ?? []), it]);
  }
  const out: InvoiceDraft[] = [];
  for (const [key, list] of byPayer) {
    const payerId = key.startsWith("__none__") ? null : (key.split("|")[0] ?? null);
    const lines: InvoiceLine[] = [];
    const groups = new Map<string, Item[]>();
    for (const it of list) groups.set(`${it.memberId}|${it.spaceId}`, [...(groups.get(`${it.memberId}|${it.spaceId}`) ?? []), it]);
    for (const [g, its] of groups) {
      const [memberId, spaceId] = g.split("|") as [string, string];
      const b = billing[spaceId] ?? DEFAULT_BILLING;
      const who = names[memberId] ?? "Member";
      const rs = its.flatMap((i) => (i.row ? [i.row] : []));
      const base = { spaceId, memberId, logIds: rs.map((r) => r.id), sessionIds: rs.map((r) => r.sessionId) };
      if (b.model === "monthly") {
        lines.push({ ...base, kind: "monthly", description: `${who} · ${opts.monthLabel || "monthly"}`, qty: 1, unitCents: b.unitPriceCents, amountCents: b.unitPriceCents });
      } else if (b.model === "per_hour") {
        const minutes = rs.reduce((n, r) => n + r.minutes, 0);
        lines.push({ ...base, kind: "hours", description: `${who} · ${durationLabel(minutes)}`, qty: Math.round((minutes / 60) * 100) / 100, unitCents: b.unitPriceCents, amountCents: rs.reduce((n, r) => n + r.amountCents, 0) });
      } else if (rs.length) {
        const unit = rs[0]?.unitPriceCents ?? b.unitPriceCents;
        lines.push({ ...base, kind: "sessions", description: `${who} · ${rs.length} session${rs.length === 1 ? "" : "s"}`, qty: rs.length, unitCents: unit, amountCents: rs.reduce((n, r) => n + r.amountCents, 0) });
        const c = Math.min(credits[memberId] ?? 0, rs.filter((r) => r.status === "attended").length);
        if (c > 0 && unit > 0) {
          credits[memberId] = (credits[memberId] ?? 0) - c;
          lines.push({ spaceId, memberId, logIds: [], sessionIds: [], kind: "credit", description: `${who} · makeup credit${c === 1 ? "" : "s"}`, qty: c, unitCents: -unit, amountCents: -unit * c });
        }
      }
    }
    if (!lines.length) continue;
    out.push({ payerId, lines, totalCents: lines.reduce((n, l) => n + l.amountCents, 0), needsAttention: payerId ? null : "no payer set" });
  }
  return out.sort((a, b) => (a.needsAttention ? 1 : 0) - (b.needsAttention ? 1 : 0));
}

/** 183 → "3 h 3 min"; 120 → "2 h"; 45 → "45 min". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * Invoice numbers follow Figma I1/I3: "LF-0418". The sequence continues from the highest number
 * issued (revision suffixes like "-B" ignored) or the host's "Next number", whichever is higher.
 */
export function nextInvoiceNumber(existing: string[], prefix: string, floor = 1): string {
  const stem = `${prefix}-`;
  const max = existing.filter((n) => n.startsWith(stem)).reduce((m, n) => Math.max(m, Number(/^\d+/.exec(n.slice(stem.length))?.[0] ?? 0)), 0);
  return `${stem}${String(Math.max(max + 1, floor)).padStart(4, "0")}`;
}

/** Receipt RC-0412 for the first payment on LF-0412, then RC-0412-2, -3 for part payments. */
export function receiptNumber(invoiceNumber: string, paymentIndex: number): string {
  const seq = /-(\d+)(?:-[A-Z])?$/.exec(invoiceNumber)?.[1] ?? "0000";
  return `RC-${seq}${paymentIndex > 0 ? `-${paymentIndex + 1}` : ""}`;
}

/** Revision suffix for an edited, already-sent invoice: LF-0412 → LF-0412-B → LF-0412-C. */
export function revisionNumber(number: string): string {
  const m = /^(.*)-([B-Y])$/.exec(number);
  if (m) return `${m[1]}-${String.fromCharCode(m[2]!.charCodeAt(0) + 1)}`;
  return `${number}-B`;
}

/** wa.me deep link the host taps (Loft never sends WhatsApp messages itself). */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Fill a reminder template: {payer_first} {amount} {invoice} {due} {pay_link} {members}. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, k: string) => vars[k] ?? all);
}

export type InvoiceStatus = "draft" | "sent" | "viewed" | "claimed" | "partial" | "paid" | "overdue" | "void";

export interface InvoiceState {
  status: "draft" | "sent" | "void";
  totalCents: number;
  dueAt: string | null;
  viewedAt?: string | null;
  payments: { amountCents: number }[];
  claims: { status: "open" | "confirmed" | "rejected" }[];
}

export function paidTotal(inv: Pick<InvoiceState, "payments">): number {
  return inv.payments.reduce((n, p) => n + p.amountCents, 0);
}
export function balanceDue(inv: Pick<InvoiceState, "payments" | "totalCents">): number {
  return Math.max(0, inv.totalCents - paidTotal(inv));
}

/** Draft → Sent → Viewed → Payer says paid → Paid (or Partly paid) · Overdue · Void. */
export function invoiceStatus(inv: InvoiceState, now: number): InvoiceStatus {
  if (inv.status === "void") return "void";
  if (inv.status === "draft") return "draft";
  const paid = paidTotal(inv);
  if (paid >= inv.totalCents) return "paid";
  if (inv.claims.some((c) => c.status === "open")) return "claimed";
  if (isOverdue(inv, now)) return "overdue";
  if (paid > 0) return "partial";
  return inv.viewedAt ? "viewed" : "sent";
}

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = { draft: "Draft", sent: "Sent", viewed: "Viewed", claimed: "Payer says paid", partial: "Partly paid", paid: "Paid", overdue: "Overdue", void: "Void" };

/** Overdue = past due, balance > 0, no open claim (Insights uses the same rule). */
export function isOverdue(inv: InvoiceState, now: number): boolean {
  return inv.status === "sent" && !!inv.dueAt && Date.parse(inv.dueAt) < now && balanceDue(inv) > 0 && !inv.claims.some((c) => c.status === "open");
}

export type ReminderChannel = "inapp" | "email" | "whatsapp";
export interface ReminderStep {
  offsetDays: number;
  channels: ReminderChannel[];
  final?: boolean;
}
export const DEFAULT_REMINDERS: ReminderStep[] = [
  { offsetDays: -3, channels: ["inapp", "email"] },
  { offsetDays: 0, channels: ["inapp"] },
  { offsetDays: 3, channels: ["inapp", "email", "whatsapp"] },
  { offsetDays: 10, channels: ["email", "whatsapp"], final: true }
];

/** The reminder step due now (latest passed step not yet sent). Claims and pauses stop it; payment ends it. */
export function reminderDue(inv: InvoiceState, steps: ReminderStep[], sentOffsets: number[], now: number, paused = false): ReminderStep | null {
  if (paused || inv.status !== "sent" || !inv.dueAt || balanceDue(inv) === 0 || inv.claims.some((c) => c.status === "open")) return null;
  const due = Date.parse(inv.dueAt);
  const passed = steps.filter((s) => due + s.offsetDays * 86_400_000 <= now && !sentOffsets.includes(s.offsetDays));
  return passed.at(-1) ?? null;
}

/** When the next reminder goes out (null when none left). */
export function nextReminderAt(inv: InvoiceState, steps: ReminderStep[], sentOffsets: number[]): number | null {
  if (!inv.dueAt) return null;
  const due = Date.parse(inv.dueAt);
  const done = sentOffsets.length ? Math.max(...sentOffsets) : -Infinity;
  const next = steps.filter((s) => s.offsetDays > done && !sentOffsets.includes(s.offsetDays)).sort((a, b) => a.offsetDays - b.offsetDays)[0];
  return next ? due + next.offsetDays * 86_400_000 : null;
}

export const DEFAULT_REMINDER_TEXT = "Hi {payer_first}, a reminder that {invoice} for {amount} is due {due}. Pay here: {pay_link}. Already paid? Tap 'I've paid' so I can confirm it. Thank you!";
export const DEFAULT_REMINDER_SUBJECT = "Invoice {invoice} · {amount} due {due}";

export function reminderMessage(input: { payerName: string; number: string; amountCents: number; dueAt: string; payLink: string; members?: string; template?: string; final?: boolean }): string {
  const due = new Date(input.dueAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const text = fillTemplate(input.template || DEFAULT_REMINDER_TEXT, {
    payer_first: input.payerName.split(" ")[0] ?? input.payerName,
    amount: `$${(input.amountCents / 100).toFixed(2)}`,
    invoice: input.number,
    due,
    pay_link: input.payLink,
    members: input.members ?? ""
  });
  return input.final ? `Final reminder: ${text}` : text;
}

export interface PaymentLinkSettings {
  mode: "same" | "template" | "per_payer";
  link: string;
  template: string;
  perPayer: Record<string, string>;
}

/** Resolve the pay link for one payer: same link, a {amount} template, or a per-payer override. */
export function resolvePaymentLink(s: PaymentLinkSettings | null | undefined, payerId: string | null, amountCents: number, reference: string, spaceOverride?: string | null): string | null {
  if (spaceOverride) return fillPaymentLink(spaceOverride, amountCents, reference);
  if (!s) return null;
  if (s.mode === "per_payer" && payerId && s.perPayer[payerId]) return fillPaymentLink(s.perPayer[payerId]!, amountCents, reference);
  if (s.mode === "template" && s.template) return fillPaymentLink(s.template, amountCents, reference);
  return s.link ? fillPaymentLink(s.link, amountCents, reference) : null;
}

export type LedgerKind = "purchase" | "use" | "credit" | "expiry";
export interface LedgerRow {
  kind: LedgerKind;
  qty: number;
  active: boolean;
  at: string;
}

/** Package credits: purchase (+n, active once paid), use (−1), credit (+1 makeup), expiry (−n). */
export function ledgerBalance(rows: LedgerRow[]): number {
  return rows.filter((r) => r.active).reduce((n, r) => n + (r.kind === "use" || r.kind === "expiry" ? -Math.abs(r.qty) : Math.abs(r.qty)), 0);
}

export function needsRenewal(balance: number, threshold: number, openRenewal: boolean): boolean {
  return !openRenewal && balance <= threshold;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: { key: keyof T; label: string; format?: (v: T[keyof T], row: T) => string }[]): string {
  const head = columns.map((c) => csvCell(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(c.format ? c.format(r[c.key], r) : r[c.key])).join(","));
  return [head, ...body].join("\n") + "\n";
}

/** "2026-11" for a date in local time (month boundaries follow the host's clock). */
export function monthKey(at: Date | number | string): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function prevMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}
export function monthRange(key: string): { start: string; end: string } {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return { start: new Date(y, m - 1, 1).toISOString(), end: new Date(y, m, 1).toISOString() };
}
