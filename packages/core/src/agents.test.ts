import { describe, expect, it } from "vitest";
import { CAPABILITIES, demoDrafts, MAX_BOARD_OPS, nextMarkdown, PREP_TEMPLATES, redact, seatFromRequest, takeToken, validateDraft } from "./agents";

describe("agent link (capabilities v1)", () => {
  it("creates seats from the User-Agent and an optional name", () => {
    expect(seatFromRequest("codex-cli/0.9.1 (darwin)", null)).toEqual({ name: "codex", runtime: "codex-cli", version: "0.9.1" });
    expect(seatFromRequest("claude-code/1.2", "planner")).toEqual({ name: "planner", runtime: "claude-code", version: "1.2" });
    expect(seatFromRequest("", "")).toEqual({ name: "agent", runtime: "agent", version: "" });
  });

  it("rate-limits each seat to 60 requests a minute", () => {
    let b = null as { tokens: number; at: number } | null;
    const t = 1_000_000;
    for (let i = 0; i < 60; i++) {
      const r = takeToken(b, t);
      expect(r.ok).toBe(true);
      b = r.bucket;
    }
    const blocked = takeToken(b, t);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBe(1000);
    expect(takeToken(b, t + 1000).ok).toBe(true);
  });

  it("redacts payer contacts, tokens and DMs from context", () => {
    expect(redact({ name: "Shirin", email: "s@x", phone: "1", payToken: "p", nested: [{ payerContact: "x", ok: 1 }] })).toEqual({ name: "Shirin", nested: [{ ok: 1 }] });
    expect(redact([{ channelType: "dm", body: "secret" }, { channelType: "space", body: "hi" }])).toEqual([{}, { channelType: "space", body: "hi" }]);
  });

  it("validates draft kinds and the 500-op batch cap", () => {
    expect(validateDraft("email", {})).toMatch(/Unknown draft kind/);
    expect(validateDraft("board_ops", { ops: Array.from({ length: MAX_BOARD_OPS + 1 }, () => ({})) })).toMatch(/At most 500/);
    expect(validateDraft("plan", { blocks: [] })).toBeNull();
    expect(validateDraft("post", { body: 1 })).toMatch(/body/);
  });

  it("next.md starts with the capabilities list", () => {
    const md = nextMarkdown({ title: "Design sprint", seat: { name: "codex", runtime: "codex-cli", version: "0.9" }, seatNo: 1, expiresAt: "2026-12-21T00:00:00Z", paused: false, next: { title: "Agenda for Thu 26 Nov 15:00", when: "", readyBy: "Thu 13:00", inputs: ["brief.pdf"], doneWhen: "a plan is drafted" }, queue: [{ title: "Board from the brief", note: "queued" }], rejected: [] });
    const lines = md.split("\n");
    expect(lines[0]).toBe("# Loft · Design sprint · agent link");
    expect(lines[1]).toMatch(/^capabilities: v1 · seat: codex-cli 0\.9 \(seat 1\) · expires 21 Dec 2026$/);
    expect(lines[3]).toBe("## What you can do");
    expect(lines.slice(4, 4 + CAPABILITIES.length).every((l) => l.startsWith("- "))).toBe(true);
    expect(md).toContain("drafts only · never send, invite, charge or confirm payments · 60 requests/min");
    expect(md).toContain("## Queue (1)");
  });

  it("the demo agent drafts valid board ops, plans and checks for every template", () => {
    for (const t of PREP_TEMPLATES) {
      const drafts = demoDrafts(t.id, { title: "Day 4 · Decide", brief: "Three sections: Map (customer journey), Decide (price options), Storyboard (6 frames). 5 questions.", minutes: 90, anchor: { x: 0, y: 0 } });
      expect(drafts.length).toBeGreaterThan(0);
      for (const d of drafts) expect(validateDraft(d.kind, d.payload)).toBeNull();
    }
    const board = demoDrafts("board_brief", { title: "x", brief: "Three sections: Map (journey), Decide, Storyboard.", minutes: 60, anchor: { x: 0, y: 0 } });
    expect(board.map((d) => d.title)).toEqual(["Section · Map", "Section · Decide", "Section · Storyboard", "Stream post · 'What to expect'"]);
    const plan = demoDrafts("agenda", { title: "x", brief: "", minutes: 90, anchor: { x: 0, y: 0 } })[0]!;
    expect((plan.payload.blocks as { minutes: number }[]).reduce((n, b) => n + b.minutes, 0)).toBe(90);
  });
});
