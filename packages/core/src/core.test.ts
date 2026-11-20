import { describe, expect, it } from "vitest";
import { callModeFor, seatFor, ROOM_CAPACITY } from "./limits";
import { fillPaymentLink, formatUSD, parseUSD, prorate } from "./money";
import { isRoomCode, newId, normaliseCode, roomCode, slugify } from "./ids";
import { dayKey, isDailyDue } from "./time";

describe("limits", () => {
  it("seats 12 then queues the 13th", () => {
    expect(ROOM_CAPACITY).toBe(12);
    expect(seatFor(11)).toBe("in");
    expect(seatFor(12)).toBe("waiting");
  });
  it("climbs the call ladder", () => {
    expect(callModeFor(2)).toBe("p2p");
    expect(callModeFor(6)).toBe("p2p");
    expect(callModeFor(7)).toBe("stage");
    expect(callModeFor(12)).toBe("stage");
    expect(callModeFor(13)).toBe("external");
  });
});

describe("money (USD, integer cents)", () => {
  it("formats", () => {
    expect(formatUSD(12345)).toBe("$123.45");
    expect(formatUSD(12000, { dropZeroCents: true })).toBe("$120");
    expect(formatUSD(0)).toBe("$0.00");
    expect(() => formatUSD(1.5)).toThrow();
  });
  it("parses", () => {
    expect(parseUSD("120")).toBe(12000);
    expect(parseUSD("$1,250.5")).toBe(125050);
    expect(parseUSD("40.05")).toBe(4005);
    expect(parseUSD("abc")).toBeNull();
    expect(parseUSD("1.234")).toBeNull();
  });
  it("prorates hourly rates", () => {
    expect(prorate(6000, 90)).toBe(9000);
    expect(prorate(5000, 45)).toBe(3750);
    expect(prorate(3333, 20)).toBe(1111);
  });
  it("fills payment link templates", () => {
    expect(fillPaymentLink("https://pay.example/x?amount={amount}&ref={ref}", 12050, "LF-0007")).toBe(
      "https://pay.example/x?amount=120.50&ref=LF-0007"
    );
  });
});

describe("ids", () => {
  it("makes readable room codes", () => {
    const c = roomCode();
    expect(isRoomCode(c)).toBe(true);
    expect(normaliseCode(c.toUpperCase().replaceAll("-", " "))).toBe(c);
  });
  it("makes unique ids", () => {
    const s = new Set(Array.from({ length: 200 }, () => newId()));
    expect(s.size).toBe(200);
    expect(newId("sp")).toMatch(/^sp_[a-z0-9]{16}$/);
  });
  it("slugifies", () => {
    expect(slugify("Acme Sprint · Q3!")).toBe("acme-sprint-q3");
    expect(slugify("  Café Ünïcode  ")).toBe("cafe-unicode");
  });
});

describe("daily jobs", () => {
  it("runs once per day on the first request", () => {
    const now = Date.UTC(2026, 10, 21, 9);
    expect(dayKey(now)).toBe("2026-11-21");
    expect(isDailyDue(null, now)).toBe(true);
    expect(isDailyDue("2026-11-20", now)).toBe(true);
    expect(isDailyDue("2026-11-21", now)).toBe(false);
  });
});
