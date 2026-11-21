import { describe, expect, it } from "vitest";
import { buildIcsCalendar, foldIcsLine, parseIcsBusy } from "./ics";
import { addDays, dateIn, DEFAULT_AVAILABILITY, expandSeries, findClashes, freeSlots, isLateChange, nextFree, tzOffset, weekdayIn, zonedToUtc } from "./schedule";

// Ported from legacy/tutorloft/tests/unit/ics.test.ts (PRODID renamed to Loft).
describe("ICS calendar output", () => {
  it("escapes text and renders UTC timestamps", () => {
    const calendar = buildIcsCalendar({
      name: "TutorLoft, Schedule",
      now: Date.UTC(2026, 0, 1, 0, 0),
      events: [{ description: "Line one\nLine two; bring x,y", endsAt: Date.UTC(2026, 0, 5, 10, 30), id: "session_1", startsAt: Date.UTC(2026, 0, 5, 9, 0), summary: "Algebra \\ Linear" }]
    });
    expect(calendar).toContain("BEGIN:VCALENDAR");
    expect(calendar).toContain("X-WR-CALNAME:TutorLoft\\, Schedule");
    expect(calendar).toContain("DTSTAMP:20260101T000000Z");
    expect(calendar).toContain("DTSTART:20260105T090000Z");
    expect(calendar).toContain("DTEND:20260105T103000Z");
    expect(calendar).toContain("SUMMARY:Algebra \\\\ Linear");
    expect(calendar).toContain("DESCRIPTION:Line one\\nLine two\\; bring x\\,y");
    expect(calendar).toContain("END:VCALENDAR");
  });
  it("sends invites with a stable UID and SEQUENCE for updates", () => {
    const ev = { id: "se_1", startsAt: Date.UTC(2026, 10, 24, 10), endsAt: Date.UTC(2026, 10, 24, 11), summary: "Steering review", location: "https://tanziro.com/spaces/r/acme-pricing" };
    const v1 = buildIcsCalendar({ name: "Loft", method: "REQUEST", events: [ev] });
    const v2 = buildIcsCalendar({ name: "Loft", method: "REQUEST", events: [{ ...ev, sequence: 1 }] });
    const cancel = buildIcsCalendar({ name: "Loft", method: "CANCEL", events: [{ ...ev, sequence: 2 }] });
    expect(v1).toContain("UID:se_1@loft");
    expect(v2).toContain("UID:se_1@loft");
    expect(v2).toContain("SEQUENCE:1");
    expect(v1).toContain("METHOD:REQUEST");
    expect(cancel).toContain("STATUS:CANCELLED");
    expect(v1.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
  it("folds long lines at 75 octets", () => {
    const folded = foldIcsLine(`DESCRIPTION:${"x".repeat(200)}`);
    expect(folded.split("\r\n ").every((l) => l.length <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(`DESCRIPTION:${"x".repeat(200)}`);
  });
});

describe("busy times from an iCal feed", () => {
  const feed = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:20261124T090000Z", "DTEND:20261124T100000Z", "SUMMARY:Dentist", "END:VEVENT", "BEGIN:VEVENT", "DTSTART:20261123T150000Z", "DTEND:20261123T160000Z", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4", "END:VEVENT", "BEGIN:VEVENT", "DTSTART:20261125T120000Z", "DTEND:20261125T130000Z", "STATUS:CANCELLED", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  it("reads single events and weekly RRULEs, skipping cancelled ones", () => {
    const busy = parseIcsBusy(feed, Date.UTC(2026, 10, 20), Date.UTC(2026, 11, 31));
    expect(busy.length).toBe(5);
    expect(new Date(busy[0]!.start).toISOString()).toBe("2026-11-23T15:00:00.000Z");
    expect(busy.some((b) => new Date(b.start).toISOString() === "2026-11-24T09:00:00.000Z")).toBe(true);
    expect(busy.some((b) => new Date(b.start).toISOString() === "2026-11-25T15:00:00.000Z")).toBe(true);
    expect(busy.some((b) => new Date(b.start).toISOString() === "2026-11-25T12:00:00.000Z")).toBe(false);
  });
});

describe("time zones", () => {
  it("converts wall time to UTC, including DST changes", () => {
    expect(new Date(zonedToUtc("2026-11-24", "16:00", "Asia/Dhaka")).toISOString()).toBe("2026-11-24T10:00:00.000Z");
    expect(new Date(zonedToUtc("2026-07-01", "09:00", "Europe/London")).toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(new Date(zonedToUtc("2026-12-01", "09:00", "Europe/London")).toISOString()).toBe("2026-12-01T09:00:00.000Z");
    expect(new Date(zonedToUtc("2026-03-09", "09:00", "America/New_York")).toISOString()).toBe("2026-03-09T13:00:00.000Z");
    expect(tzOffset(Date.UTC(2026, 0, 1), "Asia/Dhaka")).toBe(6 * 3600_000);
  });
  it("reads dates and weekdays in a zone", () => {
    const t = Date.UTC(2026, 10, 23, 20, 0); // Mon 20:00 UTC = Tue 02:00 in Dhaka
    expect(dateIn(t, "Asia/Dhaka")).toBe("2026-11-24");
    expect(weekdayIn(t, "Asia/Dhaka")).toBe(2);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("series + clashes", () => {
  it("materialises a weekly series by count or until", () => {
    const byCount = expandSeries({ days: [1, 3], time: "16:00", minutes: 60, tz: "Asia/Dhaka", from: "2026-11-23", count: 4 });
    expect(byCount).toEqual(["2026-11-23T10:00:00.000Z", "2026-11-25T10:00:00.000Z", "2026-11-30T10:00:00.000Z", "2026-12-02T10:00:00.000Z"]);
    const byUntil = expandSeries({ days: [4], time: "09:00", minutes: 30, tz: "UTC", from: "2026-11-01", until: "2026-11-30" });
    expect(byUntil.length).toBe(4);
  });
  it("finds clashes with sessions and busy times, ignoring cancelled ones", () => {
    const existing = [
      { id: "a", startsAt: "2026-11-23T10:30:00.000Z", minutes: 60, title: "Pricing workshop" },
      { id: "b", startsAt: "2026-11-25T10:00:00.000Z", minutes: 60, status: "cancelled" as const }
    ];
    const busy = [{ start: Date.parse("2026-11-30T09:30:00Z"), end: Date.parse("2026-11-30T10:30:00Z") }];
    const clashes = findClashes(["2026-11-23T10:00:00.000Z", "2026-11-25T10:00:00.000Z", "2026-11-30T10:00:00.000Z"], 60, existing, busy);
    expect(clashes).toEqual([{ startsAt: "2026-11-23T10:00:00.000Z", with: "Pricing workshop" }, { startsAt: "2026-11-30T10:00:00.000Z", with: "busy in your calendar" }]);
  });
});

describe("free slots", () => {
  const av = { ...DEFAULT_AVAILABILITY("UTC"), weekly: { 2: [{ start: "10:00", end: "12:00" }] }, rules: { bufferMin: 15, noticeHours: 12, maxPerDay: 4, horizonDays: 14 } };
  const now = Date.UTC(2026, 10, 20, 9); // Fri 20 Nov
  it("offers slots inside availability, after notice, around sessions and buffers", () => {
    const taken = [{ start: Date.UTC(2026, 10, 24, 10, 30), end: Date.UTC(2026, 10, 24, 11, 0) }];
    const slots = freeSlots(av, 30, taken, now);
    const tue = slots.filter((s) => s.startsWith("2026-11-24"));
    // 10:00 clashes with the 10:30 buffer; 10:30 is taken; 11:00 is inside the buffer; 11:30 is free.
    expect(tue).toEqual(["2026-11-24T11:30:00.000Z"]);
    expect(slots.every((s) => new Date(s).getUTCDay() === 2)).toBe(true);
    expect(slots.some((s) => s.startsWith("2026-12-08"))).toBe(false); // 14-day horizon
  });
  it("respects minimum notice", () => {
    const soon = Date.UTC(2026, 10, 24, 0);
    expect(freeSlots(av, 30, [], soon).filter((s) => s.startsWith("2026-11-24"))).toEqual([]);
  });
  it("flags late changes and suggests the next free times", () => {
    expect(isLateChange("2026-11-24T10:00:00Z", Date.UTC(2026, 10, 24, 0), 24)).toBe(true);
    expect(isLateChange("2026-11-26T10:00:00Z", Date.UTC(2026, 10, 24, 0), 24)).toBe(false);
    expect(nextFree(["2026-11-24T10:00:00.000Z", "2026-11-24T10:30:00.000Z", "2026-12-01T10:00:00.000Z", "2026-12-01T10:30:00.000Z"], Date.UTC(2026, 10, 24, 10), 2)).toEqual(["2026-11-24T10:30:00.000Z", "2026-12-01T10:00:00.000Z"]);
  });
});
