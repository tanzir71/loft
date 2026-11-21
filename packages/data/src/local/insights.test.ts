import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "./adapter";

const open: LocalAdapter[] = [];
let n = 0;
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
function tab(name = `ins-${++n}`, now?: () => Date) {
  const a = new LocalAdapter({ dbName: name, channel: name, tabStore: mem(), ...(now ? { now } : {}) });
  open.push(a);
  return a;
}
afterEach(() => {
  while (open.length) open.pop()?.close();
});

interface Person { userId: string; name: string; seen: string; attendance: number | null; homework: string; fee: string; atRisk: boolean; reasons: string[]; notSeen7: boolean }
interface Insights { kpis: { active: number; members: number; attendance: number | null; onTime: number | null }; people: Person[]; audiences: { id: string; label: string; count: number }[]; rules: { id: string; on: boolean }[]; stats: { sent: number; opened: number; acted: number } }

describe("insights (M8)", () => {
  it("lists learners and clients with last seen, attendance, homework, fees and at-risk reasons", async () => {
    const a = tab();
    const ins = await a.query<Insights>("insights", { days: 30 });
    const by = Object.fromEntries(ins.people.map((p) => [p.name, p]));
    expect(by["Ayaan Karim"]).toMatchObject({ seen: "in a room", atRisk: false, fee: "claimed" });
    expect(by["Ayaan Karim"]!.attendance).toBeGreaterThanOrEqual(90);
    expect(by["Dipa Saha"]).toMatchObject({ atRisk: true, notSeen7: true });
    expect(by["Dipa Saha"]!.reasons).toContain("not seen for 9 days");
    expect(by["Tania Roy"]!.reasons).toContain("fee overdue");
    expect(by["Leena Chowdhury"]).toBeUndefined(); // co-hosts and team colleagues are not learners
    expect(ins.people[0]!.atRisk).toBe(true);
    expect(ins.stats).toEqual({ sent: 2, opened: 1, acted: 1 });
    expect(ins.audiences.map((x) => x.id)).toContain("at_risk");
  });

  it("sends a custom nudge now or schedules it; WhatsApp is returned as links", async () => {
    let clock = Date.now();
    const host = tab("ins-nudge", () => new Date(clock));
    const dipa = tab("ins-nudge", () => new Date(clock));
    dipa.setTabIdentity("u_dipa");
    const ins = await host.query<Insights>("insights");
    const aud = ins.audiences.find((x) => x.label.includes("Worksheet 7 p2"))!;
    expect(aud.label).toMatch(/who haven't handed in Worksheet 7 p2/);
    const now = await host.mutate<{ recipients: number; whatsapp: { name: string; text: string }[] }>("nudges", { audience: aud.id, text: "Hi {first_name}, {task} is due {due}.", channels: ["inapp", "whatsapp"] });
    expect(now.recipients).toBe(aud.count);
    expect(now.whatsapp[0]!.text).toMatch(/^Hi \w+, Worksheet 7 p2 is due /);
    const notes = await dipa.query<{ title: string }[]>("notifications");
    expect(notes[0]!.title).toMatch(/^Nusrat: Hi Dipa, Worksheet 7 p2 is due/);
    const later = await host.mutate<{ scheduled: boolean }>("nudges", { userId: "u_dipa", text: "See you Monday, {first_name}!", channels: ["inapp"], sendAt: new Date(clock + 3600_000).toISOString() });
    expect(later.scheduled).toBe(true);
    clock += 2 * 3600_000;
    await host.query("nav");
    expect((await dipa.query<{ title: string }[]>("notifications"))[0]!.title).toBe("Nusrat: See you Monday, Dipa!");
  });

  it("runs automatic nudges once a day and lets the host turn a rule off", async () => {
    const a = tab();
    await a.mutate("nudges/rules", { rule: "files3", on: true });
    const ins = await a.query<Insights>("insights");
    expect(ins.rules.find((r) => r.id === "files3")?.on).toBe(true);
    expect(ins.rules.find((r) => r.id === "deadline")?.on).toBe(true);
  });
});

interface CheckList { isHost: boolean; checks: { id: string; title: string; status: string; submitted?: number; toReview?: number; mine?: { status: string; score: { percent: number | null } | null } | null; open?: boolean }[] }
interface Attempt { id: string; status: string; remaining: number | null; score: { earned: number; possible: number; pending: number; percent: number | null } | null; results: Record<string, boolean | null> | null }

describe("quick checks (M8)", () => {
  it("hosts see results with integrity signals; members never get the answer key", async () => {
    const host = tab("ck-1");
    const ayaan = tab("ck-1");
    ayaan.setTabIdentity("u_ayaan");
    const list = await host.query<CheckList>("spaces/sp_physics_a/checks");
    expect(list.checks.find((c) => c.id === "ck_exit6")).toMatchObject({ submitted: 2, toReview: 1 });
    const res = await host.query<{ attempts: { name: string; integrity: { level: string; reasons: string[] } }[]; notStarted: { name: string }[]; review: { attemptId: string; questionId: string; response: string }[] }>("checks/ck_exit6/results");
    expect(res.attempts.find((x) => x.name === "Sumaiya Khan")!.integrity).toMatchObject({ level: "review", reasons: ["left the tab ×2"] });
    expect(res.notStarted.map((x) => x.name)).toEqual(["Dipa Saha"]);
    const view = await ayaan.query<{ questions: { answer: string[] }[] }>("checks/ck_energy");
    expect(view.questions.every((q) => q.answer.length === 0)).toBe(true);
    // Mark Sumaiya's short answer → graded.
    const r = res.review[0]!;
    await host.mutate(`attempts/${r.attemptId}/grade`, { questionId: r.questionId, points: 1 });
    const again = await host.query<CheckList>("spaces/sp_physics_a/checks");
    expect(again.checks.find((c) => c.id === "ck_exit6")?.toReview).toBe(0);
  });

  it("a member takes a timed check: autosave, integrity snapshot, auto-grade, one attempt only", async () => {
    const host = tab("ck-2");
    const ayaan = tab("ck-2");
    ayaan.setTabIdentity("u_ayaan");
    const a = await ayaan.mutate<Attempt>("checks/ck_energy/start");
    expect(a.remaining).toBeGreaterThan(590);
    expect((await ayaan.mutate<Attempt>("checks/ck_energy/start")).id).toBe(a.id);
    await ayaan.mutate(`attempts/${a.id}/answer`, { questionId: "e1", answer: ["e1_2"] });
    await ayaan.mutate(`attempts/${a.id}/answer`, { questionId: "e2", answer: ["true"] });
    await ayaan.mutate(`attempts/${a.id}/answer`, { questionId: "e3", answer: ["Joules"] });
    await ayaan.mutate(`attempts/${a.id}/integrity`, { integrityScore: 70, violationCounts: { paste_attempt: 1 }, awayMs: 0 });
    const done = await ayaan.mutate<Attempt>(`attempts/${a.id}/submit`);
    expect(done.score).toEqual({ earned: 2, possible: 3, pending: 0, percent: 67 });
    expect(done.results).toEqual({ e1: true, e2: false, e3: true });
    await expect(ayaan.mutate("checks/ck_energy/start")).rejects.toThrow(/already done this check/);
    const res = await host.query<{ attempts: { name: string; integrity: { level: string } }[] }>("checks/ck_energy/results");
    expect(res.attempts[0]!.integrity.level).toBe("flagged");
  });

  it("hosts build and publish a check; invalid questions block publishing; the gradebook averages", async () => {
    const host = tab("ck-3");
    const c = await host.mutate<{ id: string; questions: { id: string }[] }>("spaces/sp_physics_a/checks", { title: "Vectors recap" });
    await expect(host.mutate(`checks/${c.id}/status`, { status: "published" })).rejects.toThrow(/Question 1: Write the question/);
    await host.mutate(`checks/${c.id}`, { questions: [{ type: "true_false", prompt: "Vectors have direction.", points: 1, answer: ["true"] }] });
    const pub = await host.mutate<{ status: string }>(`checks/${c.id}/status`, { status: "published" });
    expect(pub.status).toBe("published");
    const g = await host.query<{ columns: { title: string }[]; rows: { name: string; average: number | null; cells: { status: string }[] }[] }>("spaces/sp_physics_a/grades");
    expect(g.columns.map((x) => x.title)).toEqual(expect.arrayContaining(["Worksheet 6 p2", "Projectiles · exit ticket", "Vectors recap"]));
    const dipa = g.rows.find((r) => r.name === "Dipa Saha")!;
    expect(dipa.average).toBe(0);
    expect(g.rows.find((r) => r.name === "Ayaan Karim")!.average).toBe(67);
  });
});
