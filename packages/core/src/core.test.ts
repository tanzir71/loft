import { describe, expect, it } from "vitest";
import { callModeFor, seatFor, ROOM_CAPACITY } from "./limits";
import { fillPaymentLink, formatUSD, parseUSD, prorate } from "./money";
import { isRoomCode, newId, normaliseCode, roomCode, slugify, sortableId } from "./ids";
import { dayKey, isDailyDue } from "./time";
import { MODE_ORDER, SPACE_MODES, spaceCode, tabLabel, unacknowledged } from "./spaces";

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
    expect(normaliseCode(c.toLowerCase().replace("-", " "))).toBe(c);
    expect(normaliseCode("https://tanziro.com/spaces/r/k7p-42q")).toBe("K7P-42Q");
    expect(isRoomCode("K7P-42Q")).toBe(true);
    expect(isRoomCode("K7P-42O")).toBe(false);
  });
  it("makes unique ids", () => {
    const s = new Set(Array.from({ length: 200 }, () => newId()));
    expect(s.size).toBe(200);
    expect(newId("sp")).toMatch(/^sp_[a-z0-9]{16}$/);
  });
  it("makes time-sortable ids, even within one millisecond", () => {
    const ids = Array.from({ length: 50 }, () => sortableId("m"));
    expect([...ids].sort()).toEqual(ids);
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

describe("space modes", () => {
  it("has five modes with Figma's tab sets", () => {
    expect(MODE_ORDER).toEqual(["team", "client", "workshop", "course", "tutoring"]);
    expect(SPACE_MODES.client.tabs).toContain("billing");
    expect(tabLabel("course", "work")).toBe("Classwork");
    expect(tabLabel("client", "work")).toBe("Actions");
    expect(tabLabel("team", "work")).toBe("Tasks");
  });
  it("makes three-letter codes", () => {
    expect(spaceCode("Acme pricing")).toBe("ACM");
    expect(spaceCode("HSC Physics")).toBe("HSC");
    expect(spaceCode("Q3")).toBe("QXX");
    expect(spaceCode("123")).toBe("LFT");
  });
  it("lists who hasn't acknowledged a must-read post", () => {
    expect(unacknowledged(["a", "b", "c", "host"], ["b"], "host")).toEqual(["a", "c"]);
  });
});
