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
  const name = `owner-${++n}`;
  const a = new LocalAdapter({ dbName: name, channel: name, tabStore: mem() });
  open.push(a);
  return a;
}
afterEach(() => {
  while (open.length) open.pop()?.close();
});

interface Org { id: string; name: string; branded: boolean; active: boolean; endsInDays: number | null; askedByEmail: boolean; activeMembers: number }

describe("owner console + Brand studio (M10)", () => {
  it("lists organisations with branding, paid-until, ending soon and asked-by-email", async () => {
    const a = tab();
    const o = await a.query<{ orgs: Org[] }>("owner");
    const by = Object.fromEntries(o.orgs.map((x) => [x.name, x]));
    expect(by["Sunrise Academy"]).toMatchObject({ branded: true, active: true, activeMembers: 214 });
    expect(by["Bright Minds Academy"]!.endsInDays).toBe(9);
    expect(by["Acme Foods"]).toMatchObject({ branded: false, askedByEmail: true });
    expect(by["Nusrat Rahman"]).toMatchObject({ branded: false, active: false });
  });

  it("a host sets up the brand while off; publishing needs branding; the owner's switch makes it live", async () => {
    const a = tab();
    const draft = await a.mutate<{ id: string; slug: string; published: boolean }>("brand", { theme: "sunrise", slug: "Nusrat Tutors", name: "Nusrat Tutors" });
    expect(draft).toMatchObject({ slug: "nusrat-tutors", published: false });
    await expect(a.mutate("brand", { publish: true })).rejects.toThrow(/Branding is off/);
    expect((await a.query<{ brand: { name: string } }>("nav")).brand.name).toBe("Loft");
    await a.mutate(`owner/orgs/${draft.id}`, { branded: true, brandedUntil: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10), notify: true });
    await a.mutate("brand", { publish: true });
    expect((await a.query<{ brand: { name: string; theme: string } }>("nav")).brand).toEqual({ name: "Nusrat Tutors", monogram: "NR", theme: "sunrise" });
    const notes = await a.query<{ title: string }[]>("notifications");
    expect(notes.map((x) => x.title)).toContain("Branding is on");
    // Paid-until + 14 days of grace, then the standard look returns.
    await a.mutate(`owner/orgs/${draft.id}`, { brandedUntil: new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10) });
    expect((await a.query<{ brand: { name: string } }>("nav")).brand.name).toBe("Loft");
  });
});
