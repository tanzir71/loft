import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { monthKey } from "@loft/core";
import { LocalAdapter } from "./adapter";

const open: LocalAdapter[] = [];
let n = 0;
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
function tab(name = `money-${++n}`, now?: () => Date) {
  const a = new LocalAdapter({ dbName: name, channel: name, tabStore: mem(), ...(now ? { now } : {}) });
  open.push(a);
  return a;
}
afterEach(() => {
  while (open.length) open.pop()?.close();
});

interface ListInv { id: string; number: string | null; payerId: string | null; payerName: string; status: string; totalCents: number; balanceCents: number; needsAttention: string | null; summary: string; payPath: string; overdueDays: number; openClaims: number; nextReminderAt: number | null }
interface Invoices { ready: ListInv[]; attention: ListInv[]; sent: ListInv[]; draftLabel: string | null }

describe("money (M7)", () => {
  it("seeds last month's invoices: a payer claim, a part payment that is overdue, and a paid package", async () => {
    const a = tab();
    const inv = await a.query<Invoices>("money/invoices");
    const byNumber = Object.fromEntries(inv.sent.map((i) => [i.number, i]));
    expect(byNumber["LF-0410"]).toMatchObject({ status: "paid", payerId: "u_sumaiya" });
    expect(byNumber["LF-0411"]).toMatchObject({ status: "paid", payerId: "u_tania" });
    expect(byNumber["LF-0412"]).toMatchObject({ status: "claimed", payerId: "u_shirin", openClaims: 1 });
    expect(byNumber["LF-0413"]).toMatchObject({ status: "overdue", overdueDays: 6, balanceCents: 40000 });
    const review = await a.query<{ id: string; title: string }[]>("review");
    expect(review.map((r) => r.title)).toEqual(expect.arrayContaining([expect.stringMatching(/^Shirin Karim says LF-0412 is paid$/), expect.stringMatching(/^WhatsApp reminder to send · Tania Roy$/)]));
  });

  it("drafts this month per payer, flags a member with no payer, then sends with numbers", async () => {
    const a = tab();
    const month = monthKey(new Date());
    const log = await a.query<{ rows: { id: string; memberId: string; status: string; amountCents: number; invoiceNumber: string | null; package: unknown }[]; kpis: { notInvoicedCents: number } }>("money/log", { month });
    expect(log.rows.length).toBeGreaterThan(0);
    expect(log.rows.some((r) => r.memberId === "u_sumaiya" && r.package)).toBe(true);
    await a.mutate("money/run", { month });
    let inv = await a.query<Invoices>("money/invoices");
    const shirin = inv.ready.find((d) => d.payerId === "u_shirin");
    expect(shirin).toBeTruthy();
    expect(inv.ready.find((d) => d.payerId === "u_tania")?.totalCents).toBe(120000);
    const dipa = inv.attention.find((d) => d.payerName === "Dipa Saha");
    expect(dipa?.needsAttention).toBe("no payer set");
    // Dipa pays for herself → the draft moves to Ready.
    await a.mutate("spaces/sp_physics_a/billing/payer", { memberId: "u_dipa", payerId: "u_dipa" });
    inv = await a.query<Invoices>("money/invoices");
    expect(inv.attention.length).toBe(0);
    const ready = inv.ready.map((d) => d.id);
    const { sent } = await a.mutate<{ sent: ListInv[] }>("invoices/send", { ids: ready });
    expect(sent.map((s) => s.number)).toEqual(sent.map((_, i) => `LF-${String(414 + i).padStart(4, "0")}`));
    // Frozen: invoiced rows can't change status any more.
    const after = await a.query<{ rows: { id: string; invoiceNumber: string | null }[] }>("money/log", { month });
    const frozen = after.rows.find((r) => r.invoiceNumber && r.invoiceNumber !== "draft")!;
    await expect(a.mutate(`money/log/${encodeURIComponent(frozen.id)}`, { status: "excused" })).rejects.toThrow(/on an invoice/);
  });

  it("re-prices a log row: excused is $0 with a makeup credit that the next invoice uses", async () => {
    const a = tab();
    const month = monthKey(new Date());
    const log = await a.query<{ rows: { id: string; memberId: string; status: string; amountCents: number; invoiceId: string | null }[]; kpis: { makeupCredits: number } }>("money/log", { month });
    const row = log.rows.find((r) => r.memberId === "u_ayaan" && !r.invoiceId && r.status === "attended")!;
    const before = log.kpis.makeupCredits;
    const next = await a.mutate<{ amountCents: number; billable: boolean }>(`money/log/${encodeURIComponent(row.id)}`, { status: "excused" });
    expect(next).toMatchObject({ amountCents: 0, billable: false });
    const again = await a.query<{ kpis: { makeupCredits: number } }>("money/log", { month });
    expect(again.kpis.makeupCredits).toBe(before + 1);
    await a.mutate("money/run", { month });
    const detail = await a.query<{ lines: { kind: string; amountCents: number }[] }>(`invoices/${(await a.query<Invoices>("money/invoices")).ready.find((d) => d.payerId === "u_shirin")!.id}`);
    expect(detail.lines.find((l) => l.kind === "credit")?.amountCents).toBe(-1500);
  });

  it("payer says paid on the pay page; the host confirms with a receipt (or part payment / reject)", async () => {
    const host = tab("money-pay");
    const payer = tab("money-pay");
    payer.setTabIdentity("u_shirin");
    const inv = await host.query<Invoices>("money/invoices");
    const tania = inv.sent.find((i) => i.number === "LF-0413")!;
    const token = tania.payPath.split("/").pop()!;
    const view = await payer.query<{ number: string; balanceCents: number; payLink: string; lines: unknown[] }>(`pay/${token}`);
    expect(view).toMatchObject({ number: "LF-0413", balanceCents: 40000 });
    expect(view.payLink).toBe("https://pay.example.com/nusrat");
    await payer.mutate(`pay/${token}/claim`, { amountCents: 40000, method: "Bank transfer", reference: "LF-0413" });
    const claims = await host.query<{ open: { id: string; invoice: ListInv }[] }>("money/claims");
    const claim = claims.open.find((c) => c.invoice.number === "LF-0413")!;
    expect(claim.invoice.status).toBe("claimed");
    // Part payment first, then the rest.
    const part = await host.mutate<{ receipt: string; balanceCents: number }>(`invoices/${tania.id}/confirm`, { claimId: claim.id, amountCents: 10000 });
    expect(part).toEqual({ receipt: "RC-0413-2", balanceCents: 30000 });
    const rest = await host.mutate<{ receipt: string; balanceCents: number }>(`invoices/${tania.id}/confirm`, {});
    expect(rest.balanceCents).toBe(0);
    const detail = await host.query<{ status: string; activity: { text: string }[] }>(`invoices/${tania.id}`);
    expect(detail.status).toBe("paid");
    // Reject Shirin's claim → reminders resume (status back to overdue once due has passed).
    const shirin = inv.sent.find((i) => i.number === "LF-0412")!;
    await host.mutate(`invoices/${shirin.id}/reject`, { claimId: "cl_demo", reason: "Not in my account yet" });
    expect((await host.query<{ status: string }>(`invoices/${shirin.id}`)).status).toBe("overdue");
  });

  it("revises a sent invoice as -B and voids the original when the revision is sent", async () => {
    const a = tab();
    const inv = await a.query<Invoices>("money/invoices");
    const orig = inv.sent.find((i) => i.number === "LF-0413")!;
    const { id } = await a.mutate<{ id: string }>(`invoices/${orig.id}/revise`);
    const rev = await a.query<{ number: string; lines: { description: string; amountCents: number; qty: number; unitCents: number; kind: string; spaceId: string; memberId: string | null; logIds: string[]; sessionIds: string[] }[] }>(`invoices/${id}`);
    expect(rev.number).toBe("LF-0413-B");
    await a.mutate(`invoices/${id}/lines`, { lines: [...rev.lines, { ...rev.lines[0]!, description: "Discount", kind: "adjustment", qty: 1, unitCents: -10000, amountCents: -10000, logIds: [], sessionIds: [] }] });
    await a.mutate("invoices/send", { ids: [id] });
    const after = await a.query<Invoices>("money/invoices");
    expect(after.sent.find((i) => i.number === "LF-0413")?.status).toBe("void");
    expect(after.sent.find((i) => i.number === "LF-0413-B")).toMatchObject({ totalCents: 110000, balanceCents: 30000 });
  });

  it("sells a package: credits start when its invoice is paid", async () => {
    const a = tab();
    const { invoiceId } = await a.mutate<{ invoiceId: string }>("money/packages", { spaceId: "sp_physics_a", memberId: "u_ayaan", size: 8, priceCents: 11000 });
    let pk = await a.query<{ packages: { memberName: string; status: string; left: number }[] }>("money/packages");
    expect(pk.packages.find((p) => p.memberName === "Ayaan Karim")).toMatchObject({ status: "awaiting", left: 0 });
    await a.mutate("invoices/send", { ids: [invoiceId] });
    await a.mutate(`invoices/${invoiceId}/confirm`, {});
    pk = await a.query("money/packages");
    expect(pk.packages.find((p) => p.memberName === "Ayaan Karim")).toMatchObject({ status: "active", left: 8 });
  });

  it("runs the daily task once a day: reminders go out and WhatsApp is queued, never sent", async () => {
    let clock = Date.now();
    const a = tab("money-daily", () => new Date(clock));
    await a.query("nav");
    const inv = await a.query<Invoices>("money/invoices");
    const tania = inv.sent.find((i) => i.number === "LF-0413")!;
    expect(tania.nextReminderAt).toBeGreaterThan(clock);
    clock = tania.nextReminderAt! + 3600_000;
    await a.query("nav");
    const d = await a.query<{ activity: { text: string }[]; remindersSent: number[] }>(`invoices/${tania.id}`);
    expect(d.remindersSent).toContain(10);
    expect(d.activity.at(-1)?.text).toMatch(/^Final reminder · email · WhatsApp to send$/);
    // Pausing a payer stops the next run.
    await a.mutate("money/payers/u_tania/pause", { paused: true });
    const r = await a.query<{ overdue: { paused: boolean }[] }>("money/reminders");
    expect(r.overdue[0]?.paused).toBe(true);
  });

  it("first request on/after the 1st drafts last month automatically", async () => {
    const d = new Date();
    let clock = d.getTime();
    const a = tab("money-auto", () => new Date(clock));
    await a.query("nav");
    const next1 = new Date(d.getFullYear(), d.getMonth() + 1, 1, 9).getTime();
    clock = next1;
    await a.query("nav");
    const inv = await a.query<Invoices>("money/invoices");
    expect(inv.draftLabel).toBe(new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }));
    expect(inv.ready.length + inv.attention.length).toBeGreaterThan(0);
  });
});
