import { describe, expect, it } from "vitest";
import { attemptDeadline, attemptScore, cellAverage, cellText, integrityReview, remainingSeconds, scoreAnswer, shuffled, validateQuestion, windowError, type CheckQuestion } from "./checks";
import { delta, memberInsight, seenLabel, totals, type MemberActivity } from "./insights";

const q = (type: CheckQuestion["type"], answer: string[], extra: Partial<CheckQuestion> = {}): CheckQuestion => ({ id: `q_${type}`, type, prompt: "Which?", points: 2, options: [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }], answer, ...extra });

describe("quick checks (ported from 'creates and edits quizzes with four question types')", () => {
  it("validates the four question types", () => {
    expect(validateQuestion(q("mcq_single", ["a"]))).toBeNull();
    expect(validateQuestion(q("mcq_single", ["a", "b"]))).toMatch(/exactly one/);
    expect(validateQuestion(q("mcq_multi", ["z"]))).toMatch(/correct option/);
    expect(validateQuestion(q("true_false", ["maybe"], { options: [] }))).toMatch(/true or false/);
    expect(validateQuestion(q("short_answer", [" "], { options: [] }))).toMatch(/accepted answer/);
    expect(validateQuestion(q("mcq_single", ["a"], { prompt: " " }))).toMatch(/Write/);
    expect(validateQuestion(q("mcq_single", ["a"], { points: 0 }))).toMatch(/Points/);
  });

  it("autogrades objective answers and leaves unmatched short answers for review", () => {
    expect(scoreAnswer(q("mcq_single", ["b"]), ["b"])).toEqual({ isCorrect: true, points: 2 });
    expect(scoreAnswer(q("mcq_single", ["b"]), ["a"])).toEqual({ isCorrect: false, points: 0 });
    expect(scoreAnswer(q("mcq_multi", ["a", "c"]), ["c", "a"])).toEqual({ isCorrect: true, points: 2 });
    expect(scoreAnswer(q("mcq_multi", ["a", "c"]), ["a"])).toEqual({ isCorrect: false, points: 0 });
    expect(scoreAnswer(q("true_false", ["false"]), ["false"]).isCorrect).toBe(true);
    expect(scoreAnswer(q("short_answer", ["45 degrees", "45°"]), ["  45   Degrees "])).toEqual({ isCorrect: true, points: 2 });
    expect(scoreAnswer(q("short_answer", ["45 degrees"]), ["about forty-five"])).toEqual({ isCorrect: null, points: null });
    expect(scoreAnswer(q("mcq_single", ["b"]), undefined)).toEqual({ isCorrect: false, points: 0 });
  });

  it("totals an attempt, pending while a short answer waits", () => {
    const qs = [q("mcq_single", ["a"]), q("short_answer", ["x"], { id: "s" })];
    expect(attemptScore(qs, { q_mcq_single: { points: 2 }, s: { points: null } })).toEqual({ earned: 2, possible: 4, pending: 1, percent: null });
    expect(attemptScore(qs, { q_mcq_single: { points: 2 }, s: { points: 1 } })).toEqual({ earned: 3, possible: 4, pending: 0, percent: 75 });
  });

  it("times attempts and enforces the window (ported from 'starts, autosaves, times, submits')", () => {
    const w = { status: "published" as const, openAt: "2026-11-21T10:00:00Z", closeAt: "2026-11-21T12:00:00Z", timeLimitMin: 15, maxAttempts: 1 };
    expect(windowError(w, Date.parse("2026-11-21T09:00:00Z"))).toMatch(/isn't open yet/);
    expect(windowError(w, Date.parse("2026-11-21T11:00:00Z"))).toBeNull();
    expect(windowError(w, Date.parse("2026-11-21T13:00:00Z"))).toMatch(/closed/);
    expect(windowError({ ...w, status: "draft" }, Date.parse("2026-11-21T11:00:00Z"))).toMatch(/isn't open/);
    expect(attemptDeadline(w, "2026-11-21T11:00:00Z")).toBe(Date.parse("2026-11-21T11:15:00Z"));
    expect(attemptDeadline(w, "2026-11-21T11:50:00Z")).toBe(Date.parse("2026-11-21T12:00:00Z"));
    expect(remainingSeconds(w, "2026-11-21T11:00:00Z", Date.parse("2026-11-21T11:14:00Z"))).toBe(60);
    expect(remainingSeconds({ ...w, closeAt: null, timeLimitMin: null }, "2026-11-21T11:00:00Z", 0)).toBeNull();
  });

  it("shuffles stably per member", () => {
    const items = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    expect(shuffled(items, "u1").map((x) => x.id)).toEqual(shuffled(items, "u1").map((x) => x.id));
    expect(shuffled(items, "u1").map((x) => x.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("turns integrity signals into a review level, never a verdict", () => {
    expect(integrityReview(null).level).toBe("none");
    expect(integrityReview({ integrityScore: 100, violationCounts: {}, awayMs: 0 })).toEqual({ level: "clean", reasons: [] });
    expect(integrityReview({ integrityScore: 85, violationCounts: { tab_hidden: 2 }, awayMs: 20_000 })).toEqual({ level: "review", reasons: ["left the tab ×2"] });
    expect(integrityReview({ integrityScore: 95, violationCounts: { paste_attempt: 1 }, awayMs: 90_000 })).toEqual({ level: "flagged", reasons: ["pasted text", "away 2 min"] });
  });
});

describe("gradebook (ported from 'builds course rows ... with averages, pending, missing')", () => {
  it("averages graded work and counts missing as zero", () => {
    expect(cellAverage([{ earned: 8, possible: 10, status: "graded" }, { earned: null, possible: 10, status: "missing" }, { earned: null, possible: 5, status: "pending" }])).toBe(40);
    expect(cellAverage([{ earned: null, possible: 5, status: "pending" }])).toBeNull();
    expect(cellText({ earned: 8, possible: 10, status: "graded" })).toBe("8/10");
    expect(cellText({ earned: null, possible: 10, status: "missing" })).toBe("Missing");
  });
});

describe("insights", () => {
  const now = Date.parse("2026-11-21T12:00:00Z");
  const base: MemberActivity = { lastSeenAt: "2026-11-21T10:00:00Z", lastLoginAt: null, inRoom: false, sessions: [], work: [], fee: "paid" };
  it("computes attendance, on-time homework and an at-risk reason list", () => {
    const m = memberInsight({
      ...base,
      lastSeenAt: "2026-11-18T12:00:00Z",
      sessions: [
        { at: "2026-11-02T16:00:00Z", status: "attended", minutes: 60 },
        { at: "2026-11-04T16:00:00Z", status: "attended", minutes: 55 },
        { at: "2026-11-09T16:00:00Z", status: "excused", minutes: 0 },
        { at: "2026-11-16T16:00:00Z", status: "absent", minutes: 0 },
        { at: "2026-11-18T16:00:00Z", status: "no_show", minutes: 0 }
      ],
      work: [{ dueAt: "2026-11-10T00:00:00Z", doneAt: "2026-11-09T00:00:00Z" }, { dueAt: "2026-11-17T00:00:00Z", doneAt: null }, { dueAt: "2026-11-25T00:00:00Z", doneAt: null }],
      fee: "overdue"
    }, now);
    expect(m).toMatchObject({ attendance: 50, attended: 2, expected: 4, missedInARow: 2, homeworkDue: 2, onTime: 1, notSeenDays: 3, atRisk: true });
    expect(m.reasons).toEqual(["missed 2 sessions in a row", "fee overdue"]);
    expect(memberInsight({ ...base, lastSeenAt: "2026-11-10T00:00:00Z" }, now).reasons).toEqual(["not seen for 11 days"]);
    expect(memberInsight(base, now).atRisk).toBe(false);
  });
  it("labels last seen and totals with deltas", () => {
    expect(seenLabel({ inRoom: true, lastSeenAt: null }, now)).toBe("in a room");
    expect(seenLabel({ inRoom: false, lastSeenAt: "2026-11-21T10:00:00Z" }, now)).toBe("2 h ago");
    expect(seenLabel({ inRoom: false, lastSeenAt: "2026-11-20T08:00:00Z" }, now)).toBe("yesterday");
    expect(seenLabel({ inRoom: false, lastSeenAt: "2026-11-18T08:00:00Z" }, now)).toBe("3 days ago");
    const a = { ...base, sessions: [{ at: "2026-11-02T16:00:00Z", status: "attended" as const, minutes: 60 }] };
    expect(totals([{ activity: a, insight: memberInsight(a, now) }], now - 30 * 86_400_000)).toEqual({ active: 1, members: 1, attendance: 100, onTime: null, avgMinutes: 60 });
    expect(delta(91, 93, "%")).toBe("−2%");
    expect(delta(23, 20)).toBe("+3");
    expect(delta(58, 58)).toBe("steady");
  });
});
