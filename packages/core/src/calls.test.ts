import { describe, expect, it } from "vitest";
import { budgetStep, ladderMode, canTalk, canViewShare, dailyPool, lowerHand, nextTurn, raiseHand, shouldOffer, tickStage } from "./calls";

describe("call ladder (handoff §7.3)", () => {
  it("picks P2P up to 6, stage up to 12, SFU only with the org's own keys", () => {
    expect(ladderMode(4)).toBe("p2p");
    expect(ladderMode(6)).toBe("p2p");
    expect(ladderMode(7)).toBe("stage");
    expect(ladderMode(12)).toBe("stage");
    expect(ladderMode(4, { stage: true })).toBe("stage");
    expect(ladderMode(9, { sfu: true })).toBe("sfu");
    expect(ladderMode(13, { ownLink: "https://meet.example/abc" })).toBe("own-link");
  });
  it("limits talking and screen-share viewers to 6", () => {
    expect(canTalk("p2p", { isHost: false, hasTurn: false, talkingNow: 5, amTalking: false })).toBe(true);
    expect(canTalk("p2p", { isHost: false, hasTurn: false, talkingNow: 6, amTalking: false })).toBe(false);
    expect(canTalk("p2p", { isHost: false, hasTurn: false, talkingNow: 6, amTalking: true })).toBe(true);
    expect(canTalk("stage", { isHost: false, hasTurn: false, talkingNow: 1, amTalking: false })).toBe(false);
    expect(canTalk("stage", { isHost: false, hasTurn: true, talkingNow: 1, amTalking: false })).toBe(true);
    expect(canViewShare(5)).toBe(true);
    expect(canViewShare(6)).toBe(false);
  });
});

describe("daily budget cap", () => {
  it("spreads free + paid minutes over the month and steps down at 80% → 100% → own link with grace", () => {
    const pool = dailyPool({ freeMinutes: 3000, budgetCents: 2000, unitPriceCentsPerMinute: 0.4, daysInMonth: 30 });
    expect(pool).toBe(266);
    expect(budgetStep(100, 266)).toBe("full");
    expect(budgetStep(220, 266)).toBe("warn");
    expect(budgetStep(270, 266)).toBe("audio-only");
    expect(budgetStep(280, 266)).toBe("own-link");
    expect(budgetStep(280, 266, { live: true, current: "full" })).toBe("full");
    expect(budgetStep(0, 0)).toBe("own-link");
  });
});

describe("stage mode", () => {
  it("queues hands and gives 60 s turns that end on their own", () => {
    let s = { hands: [] as string[], turn: null as { id: string; endsAt: number } | null };
    s = raiseHand(raiseHand(raiseHand(s, "a"), "b"), "a");
    expect(s.hands).toEqual(["a", "b"]);
    s = nextTurn(s, 1000);
    expect(s).toEqual({ hands: ["b"], turn: { id: "a", endsAt: 61_000 } });
    expect(tickStage(s, 60_000).turn?.id).toBe("a");
    expect(tickStage(s, 61_000).turn).toBeNull();
    expect(lowerHand(s, "a").turn).toBeNull();
    expect(nextTurn({ hands: [], turn: null }, 0).turn).toBeNull();
  });
  it("makes exactly one side of each pair send the offer", () => {
    expect(shouldOffer("tab_a", "tab_b")).toBe(true);
    expect(shouldOffer("tab_b", "tab_a")).toBe(false);
  });
});
