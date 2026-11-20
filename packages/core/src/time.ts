/** Times are stored in UTC (ISO strings or epoch ms). The time zone is applied in the client with Intl. */

export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function formatTime(iso: string | number, tz = viewerTimeZone(), locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));
}

export function formatDay(iso: string | number, tz = viewerTimeZone(), locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
}

/** YYYY-MM-DD of an instant in a given zone (used for "first request of the day" and calendars). */
export function dayKey(at: Date | number, tz = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: tz }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Daily jobs run on the first request of each day (no cron on shared hosting). */
export function isDailyDue(lastRunDay: string | null | undefined, now: Date | number, tz = "UTC"): boolean {
  return !lastRunDay || lastRunDay < dayKey(now, tz);
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
