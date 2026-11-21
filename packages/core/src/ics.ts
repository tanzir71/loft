/**
 * iCalendar output, ported from legacy/tutorloft/src/lib/ics.ts and extended for invites:
 * METHOD:REQUEST/CANCEL, a stable UID per session, SEQUENCE+1 on updates, LOCATION/URL, and 75-octet line folding.
 */
export type IcsEvent = {
  id: string;
  startsAt: number;
  endsAt: number;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  sequence?: number;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
};

export type BuildIcsCalendarInput = {
  events: IcsEvent[];
  name: string;
  now?: number;
  method?: "PUBLISH" | "REQUEST" | "CANCEL";
  organizer?: { name: string; email: string };
};

const pad = (v: number) => String(v).padStart(2, "0");

export function formatIcsDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

/** Fold lines longer than 75 octets (RFC 5545 §3.1). */
export function foldIcsLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    const limit = out.length === 0 ? 75 : 74;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function buildIcsCalendar(input: BuildIcsCalendarInput): string {
  const now = input.now ?? Date.now();
  const method = input.method ?? "PUBLISH";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Loft//Sessions//EN", "CALSCALE:GREGORIAN", `METHOD:${method}`, `X-WR-CALNAME:${escapeIcsText(input.name)}`];
  for (const e of input.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(e.id)}@loft`,
      `SEQUENCE:${e.sequence ?? 0}`,
      `DTSTAMP:${formatIcsDate(now)}`,
      `DTSTART:${formatIcsDate(e.startsAt)}`,
      `DTEND:${formatIcsDate(e.endsAt)}`,
      `SUMMARY:${escapeIcsText(e.summary)}`
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeIcsText(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (input.organizer) lines.push(`ORGANIZER;CN=${escapeIcsText(input.organizer.name)}:mailto:${input.organizer.email}`);
    lines.push(`STATUS:${method === "CANCEL" ? "CANCELLED" : (e.status ?? "CONFIRMED")}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

export interface BusyBlock {
  start: number;
  end: number;
}

const DAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseIcsDate(v: string): number | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

/**
 * Busy times from someone's private iCal feed (read-only): VEVENT DTSTART/DTEND, plus simple weekly RRULEs.
 * Floating and TZID times are treated as UTC (good enough for "busy", never written back).
 */
export function parseIcsBusy(text: string, from: number, to: number): BusyBlock[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const out: BusyBlock[] = [];
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0] ?? "";
    const get = (k: string) => body.match(new RegExp(`^${k}(?:;[^:\\r\\n]*)?:(.+)$`, "m"))?.[1]?.trim();
    if (/^STATUS:CANCELLED/m.test(body) || /^TRANSP:TRANSPARENT/m.test(body)) continue;
    const start = parseIcsDate(get("DTSTART") ?? "");
    const end = parseIcsDate(get("DTEND") ?? "") ?? (start !== null ? start + 3600_000 : null);
    if (start === null || end === null) continue;
    const rrule = get("RRULE");
    if (rrule && /FREQ=WEEKLY/.test(rrule)) {
      const parts = Object.fromEntries(rrule.split(";").map((p) => p.split("=") as [string, string]));
      const until = parts.UNTIL ? parseIcsDate(parts.UNTIL) : null;
      const count = parts.COUNT ? Number(parts.COUNT) : null;
      const interval = Number(parts.INTERVAL ?? 1) || 1;
      const byday = parts.BYDAY ? parts.BYDAY.split(",").map((d) => DAYS[d.slice(-2)]).filter((d): d is number => d !== undefined) : [new Date(start).getUTCDay()];
      const dur = end - start;
      const weekStart = start - new Date(start).getUTCDay() * 86_400_000;
      let n = 0;
      for (let w = 0; w < 520; w++) {
        if (w % interval) continue;
        for (const d of byday.sort()) {
          const s = weekStart + (w * 7 + d) * 86_400_000 + (start % 86_400_000 + 86_400_000) % 86_400_000 - (weekStart % 86_400_000 + 86_400_000) % 86_400_000;
          if (s < start) continue;
          if ((until !== null && s > until) || (count !== null && n >= count) || s > to) {
            w = 1e9;
            break;
          }
          n++;
          if (s + dur > from) out.push({ start: s, end: s + dur });
        }
      }
    } else if (end > from && start < to) out.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}
