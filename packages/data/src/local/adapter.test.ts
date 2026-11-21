import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "./adapter";
import type { Op, PresencePeer } from "../types";

const open: LocalAdapter[] = [];
let n = 0;
function pair() {
  const name = `test-${++n}`;
  const memA = new Map<string, string>();
  const memB = new Map<string, string>();
  const store = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
  const a = new LocalAdapter({ dbName: name, channel: name, tabStore: store(memA) });
  const b = new LocalAdapter({ dbName: name, channel: name, tabStore: store(memB) });
  open.push(a, b);
  return { a, b };
}
afterEach(() => {
  while (open.length) open.pop()?.close();
});

describe("LocalAdapter", () => {
  it("seeds the demo workspace (consulting first) and can start empty for the first-run home", async () => {
    const { a } = pair();
    const me = await a.auth.me();
    expect(me?.name).toBe("Nusrat Rahman");
    const home = await a.query<{ spaces: { slug: string; mode: string }[]; settings: { roomLink: string } }>("home");
    expect(home.spaces[0]).toMatchObject({ slug: "acme-pricing", mode: "client" });
    expect(home.settings.roomLink).toContain("/spaces/r/");
    await a.reset({ empty: true });
    const empty = await a.query<{ spaces: unknown[] }>("home");
    expect(empty.spaces).toEqual([]);
  });

  it("rejects unknown resources", async () => {
    const { a } = pair();
    await expect(a.query("nope")).rejects.toThrow(/GET nope/);
  });

  it("tells other tabs what changed", async () => {
    const { a, b } = pair();
    await a.auth.me();
    const seen = new Promise<string[]>((r) => {
      const off = b.subscribe((t) => {
        off();
        r(t);
      });
    });
    await a.mutate("settings", { paymentLink: "https://pay.example/{amount}" });
    expect(await seen).toContain("settings");
    const s = await b.query<{ paymentLink: string }>("settings");
    expect(s.paymentLink).toBe("https://pay.example/{amount}");
  });

  it("assigns increasing seq and streams ops across tabs", async () => {
    const { a, b } = pair();
    const ctrl = new AbortController();
    const got: Op[] = [];
    const done = (async () => {
      for await (const batch of b.sync("room1", 0, ctrl.signal)) {
        got.push(...batch);
        if (got.length >= 3) ctrl.abort();
      }
    })();
    await a.append("room1", [{ actor: "u1", kind: "add", payload: { id: "s1" } }]);
    await a.append("room1", [
      { actor: "u1", kind: "update", payload: { id: "s1", x: 2 } },
      { actor: "u1", kind: "remove", payload: { id: "s1" } }
    ]);
    await done;
    expect(got.map((o) => o.seq)).toEqual([1, 2, 3]);
    expect(got.every((o) => o.roomId === "room1")).toBe(true);
  });

  it("shares presence between tabs", async () => {
    const { a, b } = pair();
    const seen = new Promise<PresencePeer[]>((r) => {
      const h = b.presence("room1", { userId: "guest", name: "Guest" }, (peers) => {
        if (peers.length) {
          h.stop();
          r(peers);
        }
      });
    });
    const ha = a.presence("room1", { userId: "u_nusrat", name: "Nusrat Rahman" });
    const peers = await seen;
    ha.stop();
    expect(peers[0]?.name).toBe("Nusrat Rahman");
  });

  it("dedupes files by sha-256", async () => {
    const { a } = pair();
    const f1 = await a.files.put(new Blob(["hello"], { type: "text/plain" }), { name: "a.txt" });
    const f2 = await a.files.put(new Blob(["hello"], { type: "text/plain" }), { name: "b.txt" });
    expect(f1.id).toBe(f2.id);
    expect(f1.sha256).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("lets a second tab act as a different user", async () => {
    const { a, b } = pair();
    await a.auth.me();
    b.setTabIdentity("someone-else");
    expect(await b.auth.me()).toBeNull();
    expect((await a.auth.me())?.id).toBe("u_nusrat");
  });
});
