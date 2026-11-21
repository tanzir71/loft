/**
 * Insights (Figma 04 · "Host · Insights + nudges"): last seen, attendance, homework on time, fees and an
 * at-risk rule, as pure functions over what the data layer already records.
 */
import type { AttendanceStatus } from "./plans";

export type FeeState = "paid" | "overdue" | "claimed" | "sent" | "none";

export interface MemberActivity {
  lastSeenAt: string | null;
  lastLoginAt: string | null;
  inRoom: boolean;
  /** Log rows for the member in the window, any order. */
  sessions: { at: string; status: AttendanceStatus; minutes: number }[];
  /** Tasks and checks due in the window. */
  work: { dueAt: string; doneAt: string | null }[];
  fee: FeeState;
}

export interface MemberInsight {
  attendance: number | null;
  attended: number;
  expected: number;
  homeworkDone: number;
  homeworkDue: number;
  onTime: number;
  notSeenDays: number | null;
  missedInARow: number;
  atRisk: boolean;
  reasons: string[];
}

const DAY = 86_400_000;
const COUNTED: AttendanceStatus[] = ["attended", "absent", "no_show", "late_cancel"];

export function memberInsight(a: MemberActivity, now: number): MemberInsight {
  const counted = a.sessions.filter((s) => COUNTED.includes(s.status) && Date.parse(s.at) <= now).sort((x, y) => y.at.localeCompare(x.at));
  const attended = counted.filter((s) => s.status === "attended").length;
  const attendance = counted.length ? Math.round((attended / counted.length) * 100) : null;
  let missedInARow = 0;
  for (const s of counted) {
    if (s.status === "attended") break;
    if (s.status === "absent" || s.status === "no_show") missedInARow++;
  }
  const due = a.work.filter((w) => Date.parse(w.dueAt) <= now);
  const onTime = due.filter((w) => w.doneAt && w.doneAt <= w.dueAt).length;
  const done = due.filter((w) => w.doneAt).length;
  const notSeenDays = a.inRoom ? 0 : a.lastSeenAt ? Math.floor((now - Date.parse(a.lastSeenAt)) / DAY) : null;
  const reasons: string[] = [];
  if (notSeenDays === null) reasons.push("never seen");
  else if (notSeenDays >= 7) reasons.push(`not seen for ${notSeenDays} days`);
  if (missedInARow >= 2) reasons.push(`missed ${missedInARow} sessions in a row`);
  else if (attendance !== null && counted.length >= 3 && attendance < 75) reasons.push(`attendance ${attendance}%`);
  if (due.length >= 2 && onTime / due.length < 0.5) reasons.push(`${onTime}/${due.length} on time`);
  if (a.fee === "overdue") reasons.push("fee overdue");
  return { attendance, attended, expected: counted.length, homeworkDone: done, homeworkDue: due.length, onTime, notSeenDays, missedInARow, atRisk: reasons.length > 0, reasons };
}

/** "in a room", "2 h ago", "yesterday", "3 days ago", "never". */
export function seenLabel(a: Pick<MemberActivity, "lastSeenAt" | "inRoom">, now: number): string {
  if (a.inRoom) return "in a room";
  if (!a.lastSeenAt) return "never";
  const mins = Math.max(0, Math.round((now - Date.parse(a.lastSeenAt)) / 60_000));
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  const days = Math.floor(mins / (60 * 24));
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export interface InsightTotals { active: number; members: number; attendance: number | null; onTime: number | null; avgMinutes: number | null }

export function totals(list: { insight: MemberInsight; activity: MemberActivity }[], windowStart: number): InsightTotals {
  const active = list.filter((m) => m.activity.inRoom || (m.activity.lastSeenAt && Date.parse(m.activity.lastSeenAt) >= windowStart)).length;
  const expected = list.reduce((n, m) => n + m.insight.expected, 0);
  const attended = list.reduce((n, m) => n + m.insight.attended, 0);
  const due = list.reduce((n, m) => n + m.insight.homeworkDue, 0);
  const onTime = list.reduce((n, m) => n + m.insight.onTime, 0);
  const mins = list.flatMap((m) => m.activity.sessions.filter((s) => s.status === "attended" && s.minutes > 0).map((s) => s.minutes));
  return {
    active,
    members: list.length,
    attendance: expected ? Math.round((attended / expected) * 100) : null,
    onTime: due ? Math.round((onTime / due) * 100) : null,
    avgMinutes: mins.length ? Math.round(mins.reduce((n, x) => n + x, 0) / mins.length) : null
  };
}

/** "+3", "−2%", "steady". */
export function delta(now: number | null, before: number | null, unit = ""): string {
  if (now === null || before === null) return "";
  const d = now - before;
  if (d === 0) return "steady";
  return `${d > 0 ? "+" : "−"}${Math.abs(d)}${unit}`;
}

export type NudgeRule = "deadline" | "missed2" | "fee3" | "files3";
export const NUDGE_RULES: { id: NudgeRule; title: string; sub: string; on: boolean }[] = [
  { id: "deadline", title: "Deadline reminder", sub: "24 h before homework or a check is due", on: true },
  { id: "missed2", title: "Missed 2 sessions in a row", sub: "message the payer (a parent or the client)", on: true },
  { id: "fee3", title: "Fee overdue + 3 days", sub: "payer, with the pay link", on: true },
  { id: "files3", title: "Hasn't opened shared files", sub: "after 3 days", on: false }
];

export const DEFAULT_NUDGE_TEXT = "Hi {first_name}, {task} is due {due}. Stuck on a question? Reply here and we'll go through it.";
