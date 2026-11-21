/**
 * Scheduling (Figma 06 · row C): sessions are stored in UTC and shown in the viewer's zone (Intl).
 * Series are materialised as rows; free slots = availability − sessions − busy blocks − buffers.
 */
import type { BusyBlock } from "./ics";

export type SessionStatus = "scheduled" | "cancelled" | "moved" | "requested";

export interface SessionLike {
  id: string;
  startsAt: string;
  minutes: number;
  status?: SessionStatus;
}

export interface SeriesRule {
  /** 0 = Sunday … 6 = Saturday, in the host's zone. */
  days: number[];
  /** "HH:MM" wall time in `tz`. */
  time: string;
  minutes: number;
  tz: string;
  /** First date (YYYY-MM-DD) to consider. */
  from: string;
  until?: string;
  count?: number;
}

export interface Availability {
  tz: string;
  /** day (0–6) → ranges "HH:MM"–"HH:MM" in `tz`. */
  weekly: Record<number, { start: string; end: string }[]>;
  rules: { bufferMin: number; noticeHours: number; maxPerDay: number; horizonDays: number };
}

const MIN = 60_000;

/** Offset (ms) of `tz` from UTC at instant `t`. */
export function tzOffset(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/** Wall time (YYYY-MM-DD + HH:MM) in `tz` → UTC epoch ms. Handles DST by re-checking the offset. */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  let t = naive - tzOffset(naive, tz);
  t = naive - tzOffset(t, tz);
  return t;
}

/** YYYY-MM-DD of an instant in `tz`. */
export function dateIn(t: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

export function weekdayIn(t: number, tz: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(t));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const dow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Materialise a weekly series into UTC start times (max 200). */
export function expandSeries(rule: SeriesRule): string[] {
  const out: string[] = [];
  const max = Math.min(rule.count ?? 200, 200);
  for (let i = 0, date = rule.from; i < 800 && out.length < max; i++, date = addDays(date, 1)) {
    if (rule.until && date > rule.until) break;
    if (!rule.days.includes(dow(date))) continue;
    out.push(new Date(zonedToUtc(date, rule.time, rule.tz)).toISOString());
  }
  return out;
}

export interface Interval {
  start: number;
  end: number;
}

export const toInterval = (s: { startsAt: string; minutes: number }): Interval => ({ start: Date.parse(s.startsAt), end: Date.parse(s.startsAt) + s.minutes * MIN });
export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Which proposed starts clash with existing sessions (not cancelled) or busy blocks. */
export function findClashes(starts: string[], minutes: number, existing: (SessionLike & { title?: string })[], busy: BusyBlock[] = []): { startsAt: string; with: string }[] {
  const out: { startsAt: string; with: string }[] = [];
  for (const s of starts) {
    const iv = { start: Date.parse(s), end: Date.parse(s) + minutes * MIN };
    const hit = existing.find((e) => e.status !== "cancelled" && overlaps(iv, toInterval(e)));
    if (hit) out.push({ startsAt: s, with: hit.title ?? "another session" });
    else if (busy.some((b) => overlaps(iv, b))) out.push({ startsAt: s, with: "busy in your calendar" });
  }
  return out;
}

/** Free slots for a booking type, over the horizon, in UTC ISO. */
export function freeSlots(av: Availability, minutes: number, taken: Interval[], now: number, opts: { stepMin?: number; days?: number } = {}): string[] {
  const step = (opts.stepMin ?? 30) * MIN;
  const days = Math.min(opts.days ?? 30, av.rules.horizonDays);
  const earliest = now + av.rules.noticeHours * 3600_000;
  const buffer = av.rules.bufferMin * MIN;
  const blocked = taken.map((t) => ({ start: t.start - buffer, end: t.end + buffer }));
  const out: string[] = [];
  const today = dateIn(now, av.tz);
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    const ranges = av.weekly[dow(date)] ?? [];
    // The per-day cap counts what's already booked that day; offering more slots is fine.
    const perDay = taken.filter((t) => dateIn(t.start, av.tz) === date).length;
    for (const r of ranges) {
      const rs = zonedToUtc(date, r.start, av.tz);
      const re = zonedToUtc(date, r.end, av.tz);
      for (let t = rs; t + minutes * MIN <= re; t += step) {
        if (perDay >= av.rules.maxPerDay) break;
        if (t < earliest) continue;
        const iv = { start: t, end: t + minutes * MIN };
        if (blocked.some((b) => overlaps(iv, b))) continue;
        out.push(new Date(t).toISOString());
      }
    }
  }
  return out;
}

/** Late cancel: fewer hours before start than the space's window (I1). */
export function isLateChange(startsAt: string, now: number, windowHours: number): boolean {
  return Date.parse(startsAt) - now < windowHours * 3600_000;
}

/** Next N free slots after a time (for "decline → suggest the next 3 free times"). */
export function nextFree(slots: string[], after: number, n = 3): string[] {
  return slots.filter((s) => Date.parse(s) > after).slice(0, n);
}

export const DEFAULT_AVAILABILITY = (tz: string): Availability => ({
  tz,
  weekly: { 1: [{ start: "10:00", end: "13:00" }], 2: [{ start: "10:00", end: "13:00" }], 3: [{ start: "14:00", end: "17:00" }], 4: [{ start: "10:00", end: "13:00" }], 5: [{ start: "10:00", end: "14:00" }] },
  rules: { bufferMin: 15, noticeHours: 12, maxPerDay: 4, horizonDays: 30 }
});
