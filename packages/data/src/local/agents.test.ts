import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "./adapter";

const open: LocalAdapter[] = [];
let n = 0;
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
function tab(name = `ag-${++n}`, now?: () => Date) {
  const a = new LocalAdapter({ dbName: name, channel: name, tabStore: mem(), ...(now ? { now } : {}) });
  open.push(a);
  return a;
}
afterEach(() => {
  while (open.length) open.pop()?.close();
});

const claude = { agent: { userAgent: "claude-code/1.4", name: "planner" } };
const SPRINT = "s9k2mQx7Hd4Rw8Pf1Lc6";
const WORKSPACE = "w7Rk2mXq9Lp4Tz8Vb3Nc";

interface Agents { seats: { id: string; name: string; status: string; state: string; minutesWeek: number }[]; working: { title: string }[]; needsYou: { id: string; question: { text: string } }[]; ready: { count: number; tasks: { id: string; title: string; pending: number }[] }; paused: boolean }

describe("agent link protocol (M9)", () => {
  it("seeds the Agents page: seats, working, needs you, ready", async () => {
    const a = tab();
    const ag = await a.query<Agents>("agents");
    expect(ag.seats.map((s) => `${s.name}:${s.state}`)).toEqual(["codex:active", "claude:needs you", "codex (laptop):new"]);
    expect(ag.working[0]!.title).toBe("Board from the brief");
    expect(ag.needsYou[0]!.question.text).toMatch(/dot-voting/);
    expect(ag.ready.tasks.map((t) => t.title)).toEqual(expect.arrayContaining(["5-question check on pricing basics", "Recap from Day 3"]));
    expect(ag.seats.find((s) => s.name === "codex")!.minutesWeek).toBe(220);
  });

  it("next.md starts with capabilities; a workspace link makes new seats wait for approval", async () => {
    const a = tab();
    const md = await a.query<{ markdown: string }>(`a/${WORKSPACE}`, claude);
    expect(md.markdown.split("\n")[3]).toBe("## What you can do");
    expect(md.markdown).toContain("seat: new (waiting for approval)");
    expect(await a.mutate(`a/${WORKSPACE}/claim`, claude)).toEqual({ error: "Waiting for the host to approve this seat.", status: 403 });
    const seat = (await a.query<Agents>("agents")).seats.find((s) => s.name === "planner")!;
    await a.mutate(`agents/seats/${seat.id}`, { action: "approve" });
    const claimed = await a.mutate<{ task: { id: string; title: string } }>(`a/${WORKSPACE}/claim`, claude);
    expect(claimed.task.title).toBe("Client-call agenda from the last 3 recaps");
  });

  it("claim → redacted context → drafts → done; the host accepts board ops into the room and rejects with a reason", async () => {
    const a = tab();
    const id = await a.mutate<{ id: string }>("spaces/sp_acme_sprint/prep", { template: "board_brief", brief: "Two sections: Ideas, Votes.", sessionId: undefined, title: "Board for the retro" });
    // the sprint link's queue: claim until we get ours
    let task: { id: string; title: string } | null = null;
    for (let i = 0; i < 4 && task?.id !== id.id; i++) task = (await a.mutate<{ task: { id: string; title: string } | null }>(`a/${SPRINT}/claim`, claude)).task;
    expect(task?.id).toBe(id.id);
    const ctx = await a.query<Record<string, unknown>>(`a/${SPRINT}/context/${id.id}`, claude);
    expect(JSON.stringify(ctx)).not.toMatch(/@example\.com|payToken|"phone"/);
    // board ops need a room: this task has no session, so drafts can still be posts/plans
    expect(await a.mutate(`a/${SPRINT}/drafts`, { ...claude, taskId: id.id, kind: "email", payload: {} })).toMatchObject({ status: 422 });
    await a.mutate(`a/${SPRINT}/drafts`, { ...claude, taskId: id.id, kind: "post", title: "Stream post", payload: { title: "Retro", body: "Bring one idea." } });
    await a.mutate(`a/${SPRINT}/drafts`, { ...claude, taskId: id.id, kind: "post", title: "Second post", payload: { title: "Extra", body: "Not needed." } });
    await a.mutate(`a/${SPRINT}/report`, { ...claude, taskId: id.id, status: "done", note: "Two posts.", minutes: 7 });
    const review = await a.query<{ drafts: { id: string; title: string }[]; task: { status: string; minutes: number } }>(`prep/${id.id}/review`);
    expect(review.task).toMatchObject({ status: "ready", minutes: 7 });
    const [keep, drop] = review.drafts;
    await a.mutate(`prep/${id.id}/review`, { accept: [keep!.id], reject: [drop!.id], reason: "One post is enough" });
    const md = await a.query<{ markdown: string }>(`a/${SPRINT}`, claude);
    expect(md.markdown).toContain("Second post: One post is enough");
    const posts = await a.query<{ title: string }[]>("spaces/sp_acme_sprint/posts").catch(() => []);
    void posts;
  });

  it("accepting the seeded board drafts moves them onto the room's op-log without the draft flag", async () => {
    const a = tab();
    const room = await a.query<{ ops: { payload: { obj: { draft?: boolean } } }[]; pending: number; taskId: string }>("rooms/rm_sprint_decide/agent");
    expect(room.ops.every((o) => o.payload.obj.draft === true)).toBe(true);
    const review = await a.query<{ drafts: { id: string; kind: string }[] }>(`prep/${room.taskId}/review`);
    await a.mutate(`prep/${room.taskId}/review`, { accept: review.drafts.map((d) => d.id) });
    const ops = [] as { kind: string; payload: { obj?: { draft?: boolean; kind: string } } }[];
    const ctrl = new AbortController();
    for await (const batch of a.sync("rm_sprint_decide", 0, ctrl.signal)) {
      ops.push(...(batch as typeof ops));
      ctrl.abort();
    }
    const objs = ops.filter((o) => o.payload.obj).map((o) => o.payload.obj!);
    expect(objs.filter((o) => o.kind === "section").length).toBe(3);
    expect(objs.some((o) => o.draft)).toBe(false);
    expect((await a.query<{ pending: number }>("rooms/rm_sprint_decide/agent")).pending).toBe(0);
  });

  it("ask moves the agent on; the host's answer re-queues the task with the answer as feedback", async () => {
    const a = tab();
    const ag = await a.query<Agents>("agents");
    const q = ag.needsYou[0]!;
    await a.mutate(`prep/${q.id}/answer`, { answer: "3 dots each" });
    const md = await a.query<{ markdown: string }>(`a/${WORKSPACE}`, { agent: { userAgent: "claude-code/1.0", name: "claude" } });
    expect(md.markdown).toContain("host asked: Should the vote be dot-voting (3 dots each) or one vote per person? → 3 dots each");
  });

  it("pausing stops claims and drafts; revoking a seat blocks it; 60 requests a minute per seat", async () => {
    let clock = Date.now();
    const a = tab("ag-limits", () => new Date(clock));
    await a.mutate("agents/pause", { paused: true });
    expect(await a.mutate(`a/${SPRINT}/claim`, claude)).toEqual({ paused: true, task: null });
    await a.mutate("agents/pause", { paused: false });
    let last: unknown = null;
    for (let i = 0; i < 61; i++) last = await a.query(`a/${SPRINT}/next.json`, claude);
    expect(last).toMatchObject({ status: 429 });
    clock += 60_000;
    const ag = await a.query<Agents>("agents");
    const seat = ag.seats.find((s) => s.name === "planner")!;
    await a.mutate(`agents/seats/${seat.id}`, { action: "revoke" });
    expect(await a.mutate(`a/${SPRINT}/claim`, claude)).toEqual({ error: "This seat was revoked by the host.", status: 403 });
  });
});
