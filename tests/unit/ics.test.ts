import { describe, expect, it } from "vitest";

import { buildIcsCalendar } from "@/lib/ics";

describe("ICS calendar output", () => {
  it("escapes text and renders UTC timestamps", () => {
    const calendar = buildIcsCalendar({
      name: "TutorLoft, Schedule",
      now: Date.UTC(2026, 0, 1, 0, 0),
      events: [
        {
          description: "Line one\nLine two; bring x,y",
          endsAt: Date.UTC(2026, 0, 5, 10, 30),
          id: "session_1",
          startsAt: Date.UTC(2026, 0, 5, 9, 0),
          summary: "Algebra \\ Linear",
        },
      ],
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
});
