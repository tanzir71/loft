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
  const name = `plans-${++n}`;
  const a = new LocalAdapter({ dbName: name, channel: name, tabStore: mem() });
  open.push(a);
  return a;
}
afterEach(() => {
  while (open.length) open.pop()?.close();
});

interface Plan { id: string; status: string; version: number; blocks: { id: string; title: string; type: string; minutes: number; hostNotes: string }[]; sessionId: string | null; sessions?: { id: string; planId: string | null; startsAt: string }[] }

describe("plans", () => {
  it("lists plans by unit and warns about unplanned upcoming sessions", async () => {
    const a = tab();
    const lib = await a.query<{ plans: Plan[]; unplanned: unknown[]; units: { unit: string }[] }>("spaces/sp_physics_a/plans");
    expect(lib.plans.map((p) => p.id)).toContain("pl_lesson6");
    expect(lib.plans.find((p) => p.id === "pl_lesson6")!.status).toBe("ready");
    expect(lib.unplanned.length).toBeGreaterThan(0);
    expect(lib.units[0]!.unit).toBe("Unit 3");
  });

  it("creates from a template, autosaves versions and restores", async () => {
    const a = tab();
    const p = await a.mutate<Plan>("spaces/sp_studio_team/plans", { title: "Sprint retro", from: "template:retro" });
    expect(p.blocks.length).toBe(5);
    const edited = await a.mutate<Plan>(`plans/${p.id}`, { blocks: p.blocks.slice(0, 2) });
    expect(edited.version).toBe(2);
    const restored = await a.mutate<Plan>(`plans/${p.id}/restore`, { version: 1 });
    expect(restored.blocks.length).toBe(5);
  });

  it("attaches idempotently, preparing pages and an agenda", async () => {
    const a = tab();
    const p = await a.query<Plan>("plans/pl_lesson7");
    const target = p.sessions!.find((s) => !s.planId)!;
    const r1 = await a.mutate<{ status: string; prepared: { roomId: string; pages: Record<string, string>; agendaPostId: string } }>(`plans/${p.id}/attach`, { sessionId: target.id });
    expect(Object.keys(r1.prepared.pages).length).toBe(1); // one Board block
    const r2 = await a.mutate<{ prepared: { roomId: string; pages: Record<string, string>; agendaPostId: string } }>(`plans/${p.id}/attach`, { sessionId: target.id });
    expect(r2.prepared.roomId).toBe(r1.prepared.roomId);
    expect(r2.prepared.agendaPostId).toBe(r1.prepared.agendaPostId);
    await expect(a.mutate("plans/pl_lesson7/attach", { sessionId: (await a.query<Plan>("plans/pl_lesson6")).sessionId })).rejects.toThrow(/already has a plan/);
  });

  it("a session room opened again after it ended gets a new room with its own pages", async () => {
    const a = tab();
    const p = await a.query<Plan>("plans/pl_lesson7");
    const target = p.sessions!.find((s) => !s.planId)!;
    const r1 = await a.mutate<{ prepared: { roomId: string } }>(`plans/${p.id}/attach`, { sessionId: target.id });
    await a.mutate(`rooms/${r1.prepared.roomId}/end`, {});
    const room = await a.mutate<{ id: string }>(`sessions/${target.id}/room`, {});
    expect(room.id).not.toBe(r1.prepared.roomId);
    const ac = new AbortController();
    let ops: { kind: string }[] = [];
    for await (const batch of a.sync(room.id, 0, ac.signal)) {
      ops = batch;
      ac.abort();
      break;
    }
    expect(ops.map((o) => o.kind)).toEqual(["add"]); // the board page is added, not "updated" in a room that never had it
  });

  it("keeps host notes away from members in the room", async () => {
    const a = tab();
    const p = await a.query<Plan>("plans/pl_lesson6");
    const host = await a.query<{ blocks: { hostNotes: string }[]; isHost: boolean }>(`sessions/${p.sessionId}/plan`);
    expect(host.isHost).toBe(true);
    expect(host.blocks.some((b) => b.hostNotes.includes("Rafi"))).toBe(true);
    const g = await a.mutate<{ id: string }>("guests", { name: "Visitor" });
    a.setTabIdentity(g.id);
    await expect(a.mutate(`sessions/${p.sessionId}/rail`, { current: 1 })).rejects.toThrow();
  });

  it("wraps up: writes session_log lines, posts a recap and marks the plan taught", async () => {
    const a = tab();
    const review = await a.query<{ kind: string; link: string }[]>("review");
    const pending = review.find((r) => r.kind === "wrapup")!;
    const sessionId = pending.link.split("/").pop()!;
    const w = await a.query<{ attendance: { memberId: string; status: string; minutes: number }[]; plan: Plan; policy: { unitPriceCents: number } }>(`sessions/${sessionId}/wrapup`);
    expect(w.policy.unitPriceCents).toBe(1500);
    expect(w.attendance.find((x) => x.memberId === "u_ayaan")!.status).toBe("attended");
    expect(w.attendance.find((x) => x.memberId === "u_sumaiya")!.status).toBe("absent");
    const outcomes = Object.fromEntries(w.plan.blocks.map((b, i) => [b.id, i === 2 ? "partly" : "done"]));
    const res = await a.mutate<{ billable: number; totalCents: number; carried: number }>(`sessions/${sessionId}/wrapup`, { outcomes, carry: [w.plan.blocks[2]!.id], attendance: w.attendance, homework: { title: "Worksheet 6 p2" } });
    expect(res).toMatchObject({ billable: 1, totalCents: 1500, carried: 1 });
    expect((await a.query<{ kind: string }[]>("review")).some((r) => r.kind === "wrapup" && r.kind === pending.kind && (r as { link?: string }).link === pending.link)).toBe(false);
    const posts = await a.query<{ kind: string; title: string }[]>("spaces/sp_physics_a/posts");
    expect(posts.some((p) => p.kind === "recap" && p.title.includes("Vectors"))).toBe(true);
  });
});
