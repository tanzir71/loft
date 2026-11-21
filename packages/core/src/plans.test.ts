import { describe, expect, it } from "vitest";
import { attendanceFromPresence, blocksFromPages, carryOver, DEFAULT_POLICY, derivePlanStatus, memberAgenda, moveBlock, parseAiBlocks, sessionLogLines, TEMPLATES, timeline, type PlanBlock } from "./plans";

const b = (id: string, minutes: number, extra: Partial<PlanBlock> = {}): PlanBlock => ({ id, title: id, type: "talk", minutes, memberText: "", hostNotes: "secret", resources: [], visible: true, ...extra });

describe("plan timeline", () => {
  it("derives start times and shows free time at the end", () => {
    const t = timeline([b("a", 5), b("b", 10), b("c", 40)], 60);
    expect(t.segments.map((s) => [s.id, s.start])).toEqual([["a", 0], ["b", 5], ["c", 15], ["free", 55]]);
    expect(t).toMatchObject({ planned: 55, free: 5, over: 0 });
  });
  it("shows an overflow segment when over length", () => {
    const t = timeline([b("a", 50), b("b", 20)], 60);
    expect(t.over).toBe(10);
    expect(t.segments.at(-1)).toMatchObject({ type: "over", start: 60, minutes: 10 });
  });
  it("reorders blocks and recalculates", () => {
    const moved = moveBlock([b("a", 5), b("b", 10), b("c", 15)], 2, 0);
    expect(moved.map((x) => x.id)).toEqual(["c", "a", "b"]);
    expect(timeline(moved, 30).segments[1]!.start).toBe(15);
  });
});

describe("plan status", () => {
  it("goes draft → ready → taught", () => {
    expect(derivePlanStatus({ minutes: 60, blocks: [b("a", 30)], status: "draft", sessionId: "s1" })).toBe("draft");
    expect(derivePlanStatus({ minutes: 60, blocks: [b("a", 55)], status: "draft", sessionId: "s1" })).toBe("ready");
    expect(derivePlanStatus({ minutes: 60, blocks: [b("a", 55)], status: "draft", sessionId: null })).toBe("draft");
    expect(derivePlanStatus({ minutes: 60, blocks: [], status: "taught" })).toBe("taught");
  });
});

describe("member agenda", () => {
  it("lists visible blocks with times and never host notes", () => {
    const agenda = memberAgenda([b("a", 5, { memberText: "Hi" }), b("hidden", 10, { visible: false }), b("c", 5)], "2026-11-26T10:00:00");
    expect(agenda.map((x) => `${x.time} ${x.title}`)).toEqual(["10:00 a", "10:15 c"]);
    expect(JSON.stringify(agenda)).not.toContain("secret");
  });
});

describe("starting points", () => {
  it("has mode-agnostic templates", () => {
    for (const key of ["lesson", "workshop", "sprint", "client", "retro"]) {
      const t = TEMPLATES[key]!;
      expect(t.blocks().reduce((n, x) => n + x.minutes, 0)).toBe(t.minutes);
    }
  });
  it("turns file pages into board blocks", () => {
    expect(blocksFromPages([{ title: "Projectiles" }, {}]).map((x) => [x.title, x.type])).toEqual([["Projectiles", "board"], ["Page 2", "board"]]);
  });
  it("validates AI blocks", () => {
    const blocks = parseAiBlocks([{ title: "Warm-up", minutes: "7", type: "activity", instructions: "Pairs", hostNotes: "watch Rafi" }, { title: "X", minutes: 999, type: "dance" }]);
    expect(blocks[0]).toMatchObject({ title: "Warm-up", minutes: 7, type: "activity", memberText: "Pairs", hostNotes: "watch Rafi" });
    expect(blocks[1]).toMatchObject({ minutes: 240, type: "talk" });
    expect(() => parseAiBlocks({})).toThrow();
  });
});

describe("wrap-up", () => {
  it("carries partly/skipped blocks over", () => {
    const blocks = [b("a", 5), b("b", 10), b("c", 5)];
    const out = carryOver({ a: "done", b: "partly", c: "skipped" }, blocks, new Set(["b"]));
    expect(out.map((x) => x.title)).toEqual(["b"]);
  });
  it("prefills attendance from presence and writes billable lines by policy", () => {
    const att = attendanceFromPresence(["u1", "u2", "u3"], { u1: 58, u2: 0 }, new Set(["u3"]));
    expect(att.map((a) => a.status)).toEqual(["attended", "absent", "late_cancel"]);
    const lines = sessionLogLines(att, { ...DEFAULT_POLICY, unitPriceCents: 1500 });
    expect(lines.map((l) => l.amountCents)).toEqual([1500, 0, 1500]);
    expect(lines.filter((l) => l.billable).length).toBe(2);
  });
});
