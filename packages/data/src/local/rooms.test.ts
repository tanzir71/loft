import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAdapter } from "./adapter";

const open: LocalAdapter[] = [];
let n = 0;
const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
function tabs() {
  const name = `rooms-${++n}`;
  const host = new LocalAdapter({ dbName: name, channel: name, tabStore: mem() });
  const guest = new LocalAdapter({ dbName: name, channel: name, tabStore: mem() });
  open.push(host, guest);
  return { host, guest };
}
afterEach(() => {
  while (open.length) open.pop()?.close();
});

interface RoomRes { id: string; code: string; name: string; guestJoin: boolean; capacity: number; endedAt: string | null; hostName?: string }

async function asGuest(guest: LocalAdapter, name: string) {
  const g = await guest.mutate<{ id: string }>("guests", { name });
  guest.setTabIdentity(g.id);
  return g;
}

describe("rooms", () => {
  it("creates a room with a readable code and capacity 12", async () => {
    const { host } = tabs();
    const room = await host.mutate<RoomRes>("rooms", { name: "Acme kickoff" });
    expect(room.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(room.capacity).toBe(12);
    expect(room.guestJoin).toBe(true);
    const found = await host.query<RoomRes>(`rooms/by-code/${room.code.toLowerCase().replace("-", "")}`);
    expect(found.id).toBe(room.id);
    expect(found.hostName).toBe("Nusrat Rahman");
  });

  it("lets guests walk in when guest join is on", async () => {
    const { host, guest } = tabs();
    const room = await host.mutate<RoomRes>("rooms", {});
    await asGuest(guest, "Rahim Uddin");
    const adm = await guest.mutate<{ status: string }>(`rooms/${room.id}/knock`);
    expect(adm.status).toBe("admitted");
  });

  it("makes guests wait for the host when guest join is off", async () => {
    const { host, guest } = tabs();
    const room = await host.mutate<RoomRes>("rooms", { guestJoin: false });
    await asGuest(guest, "Rahim Uddin");
    const adm = await guest.mutate<{ id: string; status: string }>(`rooms/${room.id}/knock`);
    expect(adm.status).toBe("pending");
    const pending = await host.query<{ id: string; name: string }[]>(`rooms/${room.id}/admissions`);
    expect(pending.map((p) => p.name)).toEqual(["Rahim Uddin"]);
    await host.mutate(`rooms/${room.id}/admissions/${adm.id}`, { decision: "admit" });
    const mine = await guest.query<{ status: string }>(`rooms/${room.id}/admission`);
    expect(mine.status).toBe("admitted");
    expect(await host.query<unknown[]>(`rooms/${room.id}/admissions`)).toEqual([]);
  });

  it("only lets the host change settings or end the session", async () => {
    const { host, guest } = tabs();
    const room = await host.mutate<RoomRes>("rooms", {});
    await asGuest(guest, "Rafi");
    await expect(guest.mutate(`rooms/${room.id}/end`)).rejects.toThrow(/host/);
    await expect(guest.mutate(`rooms/${room.id}/settings`, { guestJoin: false })).rejects.toThrow(/host/);
    const off = await host.mutate<RoomRes>(`rooms/${room.id}/settings`, { guestJoin: false });
    expect(off.guestJoin).toBe(false);
    const ended = await host.mutate<RoomRes>(`rooms/${room.id}/end`);
    expect(ended.endedAt).not.toBeNull();
    await expect(guest.mutate(`rooms/${room.id}/knock`)).rejects.toThrow(/ended/);
  });

  it("keeps room chat in order across tabs", async () => {
    const { host, guest } = tabs();
    const room = await host.mutate<RoomRes>("rooms", {});
    await asGuest(guest, "Ayaan");
    await host.mutate(`rooms/${room.id}/messages`, { body: "Welcome" });
    await guest.mutate(`rooms/${room.id}/messages`, { body: "sir page 2 also?" });
    const msgs = await host.query<{ name: string; body: string }[]>(`rooms/${room.id}/messages`);
    expect(msgs.map((m) => `${m.name}: ${m.body}`)).toEqual(["Nusrat Rahman: Welcome", "Ayaan: sir page 2 also?"]);
    await expect(guest.mutate(`rooms/${room.id}/messages`, { body: "   " })).rejects.toThrow();
  });
});
