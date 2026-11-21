import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "./adapter";

const open: LocalAdapter[] = [];
let n = 0;
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
function tab() {
  const name = `sched-${++n}`;
  const a = new LocalAdapter({ dbName: name, channel: name, tabStore: mem() });
  open.push(a);
  return a;
}
afterEach(() => {
  while (open.length) open.pop()?.close();
});

describe("scheduling routes", () => {
  it("creates a weekly series as rows and reports clashes on a dry run", async () => {
    const a = tab();
    const series = { days: [2], time: "09:00", tz: "UTC", from: new Date().toISOString().slice(0, 10), count: 3 };
    const dry = await a.mutate<{ starts: string[]; clashes: unknown[] }>("sessions", { spaceId: "sp_studio_team", title: "Standup", minutes: 30, series, dryRun: true });
    expect(dry.starts.length).toBe(3);
    const made = await a.mutate<{ created: number; sessions: { id: string; seriesId: string; startsAt: string }[] }>("sessions", { spaceId: "sp_studio_team", title: "Standup", minutes: 30, series, skip: [dry.starts[1]] });
    expect(made.created).toBe(2);
    expect(made.sessions[0]!.seriesId).toBe(made.sessions[1]!.seriesId);
    const again = await a.mutate<{ clashes: unknown[] }>("sessions", { spaceId: "sp_studio_team", title: "Clash", minutes: 30, startsAt: made.sessions[0]!.startsAt, dryRun: true });
    expect(again.clashes.length).toBe(1);
  });

  it("moves 'this and following' in a series and bumps the .ics sequence", async () => {
    const a = tab();
    const series = { days: [4], time: "15:00", tz: "UTC", from: new Date().toISOString().slice(0, 10), count: 3 };
    const made = await a.mutate<{ sessions: { id: string; startsAt: string }[] }>("sessions", { spaceId: "sp_studio_team", title: "Retro", minutes: 60, series });
    const second = made.sessions[1]!;
    await a.mutate(`sessions/${second.id}/move`, { startsAt: new Date(Date.parse(second.startsAt) + 3600_000).toISOString(), scope: "following" });
    const cal = await a.query<{ sessions: { id: string; startsAt: string; sequence: number }[] }>("calendar", { from: "2000-01-01", to: "2100-01-01" });
    const mine = made.sessions.map((s) => cal.sessions.find((c) => c.id === s.id)!);
    expect(mine[0]!.startsAt).toBe(made.sessions[0]!.startsAt);
    expect(Date.parse(mine[2]!.startsAt) - Date.parse(made.sessions[2]!.startsAt)).toBe(3600_000);
    const ics = await a.query<{ text: string }>(`sessions/${second.id}/ics`);
    expect(ics.text).toContain(`UID:${second.id}@loft`);
    expect(ics.text).toContain("SEQUENCE:1");
  });

  it("books through the public page, with approval, and manages without login", async () => {
    const a = tab();
    const page = await a.query<{ name: string; types: { id: string; approval: string }[] }>("book/nusrat");
    expect(page.name).toBe("Nusrat Rahman");
    const slots = await a.query<string[]>("book/nusrat/slots", { type: "bt_discovery" });
    expect(slots.length).toBeGreaterThan(0);
    const res = await a.mutate<{ status: string; manageToken: string }>("book/nusrat", { typeId: "bt_discovery", startsAt: slots[0], name: "Rina Saha", email: "rina@example.com" });
    expect(res.status).toBe("requested");
    await expect(a.mutate("book/nusrat", { typeId: "bt_discovery", startsAt: "2000-01-01T00:00:00.000Z", name: "X", email: "x@example.com" })).rejects.toThrow(/taken/);
    await expect(a.mutate("book/nusrat", { typeId: "bt_discovery", startsAt: slots[1], name: "X", email: "nope" })).rejects.toThrow(/email/);
    const honeypot = await a.mutate<{ manageToken: string }>("book/nusrat", { website: "spam", typeId: "bt_discovery" });
    expect(honeypot.manageToken).toBe("");
    const manage = await a.query<{ booking: { status: string } }>(`manage/${res.manageToken}`);
    expect(manage.booking.status).toBe("requested");
    await a.mutate(`manage/${res.manageToken}/cancel`);
    expect((await a.query<{ booking: { status: string } }>(`manage/${res.manageToken}`)).booking.status).toBe("cancelled");
  });

  it("lists requests with checks and approves a move", async () => {
    const a = tab();
    const reqs = await a.query<{ id: string; kind: string; who: string; free: boolean; late: boolean }[]>("requests");
    const move = reqs.find((r) => r.kind === "move")!;
    expect(move.who).toBe("Rafi Hasan");
    expect(reqs.some((r) => r.kind === "booking")).toBe(true);
    const review = await a.query<{ kind: string; title: string }[]>("review");
    expect(review.some((r) => r.title.startsWith("Rafi asks to move"))).toBe(true);
    await a.mutate(`requests/${move.id}`, { decision: "approve" });
    expect((await a.query<{ id: string }[]>("requests")).some((r) => r.id === move.id)).toBe(false);
  });

  it("saves availability and booking types", async () => {
    const a = tab();
    await a.mutate("availability", { weekly: { 1: [{ start: "09:00", end: "11:00" }] }, rules: { bufferMin: 10, noticeHours: 2, maxPerDay: 2, horizonDays: 14 }, busyIcs: "BEGIN:VEVENT\nDTSTART:20991124T090000Z\nDTEND:20991124T100000Z\nEND:VEVENT" });
    const t = await a.mutate<{ id: string }>("booking-types", { name: "Office hours", minutes: 20, priceCents: 0, approval: "auto" });
    const av = await a.query<{ rules: { bufferMin: number }; types: { id: string }[] }>("availability");
    expect(av.rules.bufferMin).toBe(10);
    expect(av.types.some((x) => x.id === t.id)).toBe(true);
    await a.mutate(`booking-types/${t.id}/delete`);
    expect((await a.query<{ types: { id: string }[] }>("availability")).types.some((x) => x.id === t.id)).toBe(false);
  });
});
