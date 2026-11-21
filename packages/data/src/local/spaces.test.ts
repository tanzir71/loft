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
  const name = `spaces-${++n}`;
  const a = new LocalAdapter({ dbName: name, channel: name, tabStore: mem() });
  open.push(a);
  return a;
}
afterEach(() => {
  while (open.length) open.pop()?.close();
});

interface Post { id: string; kind: string; title: string; mustRead: boolean; acked: number; audience: number; notSeen: string[]; handIns: number }

describe("spaces + stream", () => {
  it("creates a space with a unique slug, a code and the host as member", async () => {
    const a = tab();
    const s1 = await a.mutate<{ id: string; slug: string; code: string; mode: string }>("spaces", { name: "Acme pricing", mode: "client" });
    expect(s1.slug).toBe("acme-pricing-2"); // the demo already has acme-pricing
    expect(s1.code).toBe("ACM");
    const view = await a.query<{ isHost: boolean; myRole: string; modeConfig: { tabs: string[] } }>(`spaces/${s1.slug}`);
    expect(view.isHost).toBe(true);
    expect(view.modeConfig.tabs).toContain("billing");
    await expect(a.mutate("spaces", { name: "  " })).rejects.toThrow();
  });

  it("tracks must-read acknowledgements and who hasn't seen a notice", async () => {
    const a = tab();
    const posts = await a.query<Post[]>("spaces/acme-pricing/posts".replace("acme-pricing", "sp_acme_pricing"));
    const notice = posts.find((p) => p.mustRead)!;
    expect(notice.audience).toBe(4);
    expect(notice.acked).toBe(2);
    expect(notice.notSeen.sort()).toEqual(["Rafi Hasan", "Shirin Karim"]);
    const r = await a.mutate<{ reminded: number }>(`posts/${notice.id}/remind`);
    expect(r.reminded).toBe(2);
  });

  it("lets hosts post tasks and see hand-ins in To review", async () => {
    const a = tab();
    const review = await a.query<{ kind: string; title: string }[]>("review");
    expect(review.filter((r) => r.kind === "handin").length).toBe(2);
    const task = await a.mutate<{ id: string }>("spaces/sp_studio_team/posts", { kind: "task", title: "Write the retro notes", dueAt: new Date(Date.now() + 86400000).toISOString() });
    const work = await a.query<{ id: string; assigned: number }[]>("spaces/sp_studio_team/work");
    expect(work.find((w) => w.id === task.id)?.assigned).toBe(2);
  });

  it("keeps DMs, unread counts, knock and room invites", async () => {
    const a = tab();
    const dms = await a.query<{ id: string; unread: number; last: { body: string } | null }[]>("dms");
    const leena = dms.find((d) => d.id === "u_leena")!;
    expect(leena.last?.body).toContain("cut part 3");
    expect(leena.unread).toBe(2);
    await a.mutate("dms/u_leena/read");
    expect((await a.query<{ id: string; unread: number }[]>("dms")).find((d) => d.id === "u_leena")?.unread).toBe(0);
    const room = await a.mutate<{ code: string }>("dms/u_leena/room", { knock: true });
    const thread = await a.query<{ messages: { kind?: string; roomCode?: string }[] }>("dms/u_leena");
    expect(thread.messages.at(-1)).toMatchObject({ kind: "room", roomCode: room.code });
  });

  it("marks notifications read", async () => {
    const a = tab();
    const before = await a.query<{ readAt: string | null }[]>("notifications");
    expect(before.some((x) => !x.readAt)).toBe(true);
    await a.mutate("notifications/read-all");
    const after = await a.query<{ readAt: string | null }[]>("notifications");
    expect(after.every((x) => x.readAt)).toBe(true);
  });

  it("serves the side panel with unread counts", async () => {
    const a = tab();
    const nav = await a.query<{ spaces: { slug: string; unread: number }[]; dms: { name: string; canKnock: boolean }[]; counts: { review: number; chats: number } }>("nav");
    expect(nav.spaces.map((s) => s.slug).slice(0, 2)).toEqual(["acme-pricing", "northwind-retainer"]);
    expect(nav.counts.review).toBeGreaterThanOrEqual(2);
    expect(nav.counts.chats).toBeGreaterThan(0);
    expect(nav.dms.find((d) => d.name === "Leena Chowdhury")?.canKnock).toBe(true);
  });
});
