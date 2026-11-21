import { describe, expect, it } from "vitest";
import {
  balanceDue,
  DEFAULT_BILLING,
  DEFAULT_REMINDERS,
  draftInvoices,
  durationLabel,
  fillTemplate,
  invoiceStatus,
  isOverdue,
  ledgerBalance,
  monthKey,
  monthRange,
  needsRenewal,
  nextInvoiceNumber,
  nextReminderAt,
  normaliseBilling,
  paidTotal,
  prevMonthKey,
  priceRow,
  receiptNumber,
  reminderDue,
  reminderMessage,
  resolvePaymentLink,
  revisionNumber,
  toCsv,
  whatsappLink,
  type InvoiceState,
  type LogRow,
  type SpaceBilling
} from "./billing";

const row = (id: string, memberId: string, payerId: string | null, extra: Partial<LogRow> = {}): LogRow => ({ id, sessionId: `s_${id}`, spaceId: "sp1", memberId, payerId, minutes: 60, status: "attended", billable: true, unitPriceCents: 1500, amountCents: 1500, invoiceId: null, at: "2026-11-10T10:00:00Z", ...extra });
const billing = (extra: Partial<SpaceBilling> = {}): Record<string, SpaceBilling> => ({ sp1: { ...DEFAULT_BILLING, unitPriceCents: 1500, ...extra } });

describe("space billing defaults (I1)", () => {
  it("bills members in courses and the space once per session for clients", () => {
    expect(normaliseBilling({ mode: "per_session", unitPriceCents: 1500 } as never, "course")).toMatchObject({ model: "per_session", per: "member", unitPriceCents: 1500, dueDays: 7 });
    expect(normaliseBilling(null, "client").per).toBe("session");
    expect(normaliseBilling(null, "team").model).toBe("free");
  });
});

describe("pricing log rows from the space policy (I2)", () => {
  const blank = { invoiceId: null, unitPriceCents: 0, amountCents: 0, billable: false };
  it("prices per session, per hour (rounded to the cent) and free", () => {
    const b = billing().sp1!;
    expect(priceRow({ ...blank, status: "attended", minutes: 60 }, b)).toEqual({ billable: true, unitPriceCents: 1500, amountCents: 1500 });
    expect(priceRow({ ...blank, status: "excused", minutes: 60 }, b).amountCents).toBe(0);
    expect(priceRow({ ...blank, status: "late_cancel", minutes: 0 }, b).amountCents).toBe(1500);
    expect(priceRow({ ...blank, status: "attended", minutes: 61 }, { ...b, model: "per_hour", unitPriceCents: 2250 }).amountCents).toBe(2288);
    expect(priceRow({ ...blank, status: "attended", minutes: 20 }, { ...b, model: "per_hour", unitPriceCents: 3333 }).amountCents).toBe(1111);
    expect(priceRow({ ...blank, status: "attended", minutes: 60 }, { ...b, model: "free" }).billable).toBe(false);
  });
  it("keeps invoiced rows frozen", () => {
    expect(priceRow({ status: "excused", minutes: 60, invoiceId: "inv1", unitPriceCents: 1500, amountCents: 1500, billable: true }, billing().sp1!).amountCents).toBe(1500);
  });
});

describe("invoice drafts (I3)", () => {
  it("groups one invoice per payer, combines siblings, and flags rows with no payer", () => {
    const drafts = draftInvoices(
      [row("1", "ayaan", "shirin"), row("2", "ayaan", "shirin"), row("3", "nabila", "shirin"), row("4", "dipa", null), row("5", "rafi", "rafi", { invoiceId: "old" }), row("6", "x", "x", { billable: false, amountCents: 0 }), row("7", "sumaiya", "sumaiya", { packageId: "pk1", amountCents: 0 })],
      billing(),
      { names: { ayaan: "Ayaan", nabila: "Nabila" } }
    );
    expect(drafts.length).toBe(2);
    const shirin = drafts.find((d) => d.payerId === "shirin")!;
    expect(shirin.lines.map((l) => l.description)).toEqual(["Ayaan · 2 sessions", "Nabila · 1 session"]);
    expect(shirin.totalCents).toBe(4500);
    expect(drafts.at(-1)).toMatchObject({ payerId: null, needsAttention: "no payer set" });
  });
  it("splits siblings when a space turns combining off", () => {
    const drafts = draftInvoices([row("1", "ayaan", "shirin"), row("2", "nabila", "shirin")], billing({ combineSiblings: false }));
    expect(drafts.length).toBe(2);
  });
  it("totals hours for per-hour spaces and one line per member for monthly", () => {
    const hourly = draftInvoices([row("1", "a", "p", { minutes: 90, amountCents: 22500 }), row("2", "a", "p", { minutes: 93, amountCents: 23250 })], billing({ model: "per_hour", unitPriceCents: 15000 }), { names: { a: "Ayaan" } });
    expect(hourly[0]!.lines[0]).toMatchObject({ kind: "hours", qty: 3.05, amountCents: 45750, description: "Ayaan · 3 h 3 min" });
    const monthly = draftInvoices([], billing({ model: "monthly", unitPriceCents: 120000 }), { monthLabel: "November", monthly: [{ spaceId: "sp1", memberId: "a", payerId: "p" }] });
    expect(monthly[0]!.lines).toEqual([expect.objectContaining({ kind: "monthly", qty: 1, amountCents: 120000, description: "Member · November" })]);
  });
  it("applies makeup credits as negative lines", () => {
    const d = draftInvoices([row("1", "t", "tania"), row("2", "t", "tania"), row("3", "t", "tania", { status: "late_cancel" })], billing(), { credits: { t: 5 } });
    expect(d[0]!.lines.at(-1)).toMatchObject({ kind: "credit", qty: 2, amountCents: -3000 });
    expect(d[0]!.totalCents).toBe(1500);
  });
});

describe("numbering (Figma: LF-0418 + next number)", () => {
  it("continues the sequence and respects the host's next number", () => {
    expect(nextInvoiceNumber([], "LF")).toBe("LF-0001");
    expect(nextInvoiceNumber(["LF-0410", "LF-0412", "LF-0412-B", "XX-0999"], "LF")).toBe("LF-0413");
    expect(nextInvoiceNumber(["LF-0410"], "LF", 418)).toBe("LF-0418");
    expect(receiptNumber("LF-0412", 0)).toBe("RC-0412");
    expect(receiptNumber("LF-0412-B", 1)).toBe("RC-0412-2");
    expect(revisionNumber("LF-0412")).toBe("LF-0412-B");
    expect(revisionNumber("LF-0412-B")).toBe("LF-0412-C");
  });
});

describe("payment status (ported from 'records payments and derives partial and paid invoice statuses')", () => {
  const inv = (extra: Partial<InvoiceState> = {}): InvoiceState => ({ status: "sent", totalCents: 300000, dueAt: "2026-11-20T00:00:00Z", payments: [], claims: [], ...extra });
  const now = Date.UTC(2026, 10, 15);
  it("derives partial and paid from payments", () => {
    expect(invoiceStatus(inv(), now)).toBe("sent");
    const partial = inv({ payments: [{ amountCents: 100000 }] });
    expect(invoiceStatus(partial, now)).toBe("partial");
    expect(paidTotal(partial)).toBe(100000);
    expect(balanceDue(partial)).toBe(200000);
    const paid = inv({ payments: [{ amountCents: 100000 }, { amountCents: 200000 }] });
    expect(invoiceStatus(paid, now)).toBe("paid");
    expect(balanceDue(paid)).toBe(0);
  });
  it("covers viewed, claimed, overdue, draft and void", () => {
    expect(invoiceStatus(inv({ viewedAt: "2026-11-12" }), now)).toBe("viewed");
    expect(invoiceStatus(inv({ claims: [{ status: "open" }] }), now)).toBe("claimed");
    const late = Date.UTC(2026, 10, 25);
    expect(invoiceStatus(inv(), late)).toBe("overdue");
    expect(isOverdue(inv({ claims: [{ status: "open" }] }), late)).toBe(false);
    expect(invoiceStatus(inv({ status: "draft" }), now)).toBe("draft");
    expect(invoiceStatus(inv({ status: "void" }), now)).toBe("void");
  });
});

describe("reminders (ported from 'sends due+3 and due+10 reminders once per invoice')", () => {
  const inv: InvoiceState = { status: "sent", totalCents: 5000, dueAt: "2026-11-20T00:00:00Z", payments: [], claims: [] };
  it("sends each step once, the latest passed step first", () => {
    expect(reminderDue(inv, DEFAULT_REMINDERS, [], Date.UTC(2026, 10, 16))).toBeNull();
    expect(reminderDue(inv, DEFAULT_REMINDERS, [], Date.UTC(2026, 10, 17))?.offsetDays).toBe(-3);
    expect(reminderDue(inv, DEFAULT_REMINDERS, [-3], Date.UTC(2026, 10, 23))?.offsetDays).toBe(3);
    expect(reminderDue(inv, DEFAULT_REMINDERS, [-3, 0, 3], Date.UTC(2026, 10, 30))?.final).toBe(true);
    expect(reminderDue(inv, DEFAULT_REMINDERS, [-3, 0, 3, 10], Date.UTC(2026, 11, 30))).toBeNull();
    expect(nextReminderAt(inv, DEFAULT_REMINDERS, [-3, 0, 3])).toBe(Date.UTC(2026, 10, 30));
    expect(nextReminderAt(inv, DEFAULT_REMINDERS, [-3, 0, 3, 10])).toBeNull();
  });
  it("pauses for claims and payer pauses, stops when paid", () => {
    const t = Date.UTC(2026, 10, 23);
    expect(reminderDue({ ...inv, claims: [{ status: "open" }] }, DEFAULT_REMINDERS, [], t)).toBeNull();
    expect(reminderDue(inv, DEFAULT_REMINDERS, [], t, true)).toBeNull();
    expect(reminderDue({ ...inv, payments: [{ amountCents: 5000 }] }, DEFAULT_REMINDERS, [], t)).toBeNull();
  });
  it("fills the reminder template and builds a wa.me link", () => {
    const msg = reminderMessage({ payerName: "Tania Jahan", number: "LF-0414", amountCents: 3500, dueAt: "2026-11-27T12:00:00Z", payLink: "buy.stripe.com/nusrat-tutoring" });
    expect(msg).toBe("Hi Tania, a reminder that LF-0414 for $35.00 is due Fri 27 Nov. Pay here: buy.stripe.com/nusrat-tutoring. Already paid? Tap 'I've paid' so I can confirm it. Thank you!");
    expect(fillTemplate("{invoice} {nope}", { invoice: "LF-1" })).toBe("LF-1 {nope}");
    expect(whatsappLink("+880 17 1234 5678", "Hi there")).toBe("https://wa.me/8801712345678?text=Hi%20there");
  });
});

describe("payment links", () => {
  const s = { mode: "template" as const, link: "https://pay.me/nusrat", template: "https://pay.me/nusrat?amount={amount}&ref={ref}", perPayer: { p2: "https://bank.example/p2?a={amount}" } };
  it("resolves same, template, per payer and space overrides", () => {
    expect(resolvePaymentLink({ ...s, mode: "same" }, "p1", 4500, "LF-1")).toBe("https://pay.me/nusrat");
    expect(resolvePaymentLink(s, "p1", 4500, "LF-1")).toBe("https://pay.me/nusrat?amount=45.00&ref=LF-1");
    expect(resolvePaymentLink({ ...s, mode: "per_payer" }, "p2", 4500, "LF-1")).toBe("https://bank.example/p2?a=45.00");
    expect(resolvePaymentLink({ ...s, mode: "per_payer" }, "p1", 4500, "LF-1")).toBe("https://pay.me/nusrat");
    expect(resolvePaymentLink(s, "p1", 4500, "LF-1", "https://club.example/pay")).toBe("https://club.example/pay");
    expect(resolvePaymentLink(null, "p1", 4500, "LF-1")).toBeNull();
  });
});

describe("package credits (I5)", () => {
  it("counts only active rows and asks for renewal at the threshold", () => {
    const rows = [
      { kind: "purchase" as const, qty: 8, active: true, at: "1" },
      { kind: "use" as const, qty: 1, active: true, at: "2" },
      { kind: "use" as const, qty: 1, active: true, at: "3" },
      { kind: "credit" as const, qty: 1, active: true, at: "4" },
      { kind: "purchase" as const, qty: 8, active: false, at: "5" },
      { kind: "expiry" as const, qty: 2, active: true, at: "6" }
    ];
    expect(ledgerBalance(rows)).toBe(5);
    expect(needsRenewal(2, 2, false)).toBe(true);
    expect(needsRenewal(2, 2, true)).toBe(false);
    expect(needsRenewal(3, 2, false)).toBe(false);
  });
});

describe("CSV export and months (ported from 'exports invoice summaries as CSV')", () => {
  it("escapes cells", () => {
    const csv = toCsv([{ n: "LF-1", who: 'Karim, "N"', amt: 4500 }], [{ key: "n", label: "Number" }, { key: "who", label: "Payer" }, { key: "amt", label: "Amount (USD)", format: (v) => (Number(v) / 100).toFixed(2) }]);
    expect(csv).toBe('Number,Payer,Amount (USD)\nLF-1,"Karim, ""N""",45.00\n');
  });
  it("walks months", () => {
    expect(monthKey(new Date(2026, 10, 21))).toBe("2026-11");
    expect(prevMonthKey("2026-01")).toBe("2025-12");
    expect(Date.parse(monthRange("2026-11").end) - Date.parse(monthRange("2026-11").start)).toBeGreaterThan(29 * 86_400_000);
    expect(durationLabel(120)).toBe("2 h");
  });
});
