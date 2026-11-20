export type IcsEvent = {
  description?: string | null;
  endsAt: number;
  id: string;
  startsAt: number;
  summary: string;
};

type BuildIcsCalendarInput = {
  events: IcsEvent[];
  name: string;
  now?: number;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatIcsDate(timestamp: number) {
  const date = new Date(timestamp);
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "T",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    "Z",
  ].join("");
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

export function buildIcsCalendar(input: BuildIcsCalendarInput) {
  const now = input.now ?? Date.now();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TutorLoft//Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(input.name)}`,
  ];

  for (const event of input.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(event.id)}@tutorloft`,
      `DTSTAMP:${formatIcsDate(now)}`,
      `DTSTART:${formatIcsDate(event.startsAt)}`,
      `DTEND:${formatIcsDate(event.endsAt)}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
    );

    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}
