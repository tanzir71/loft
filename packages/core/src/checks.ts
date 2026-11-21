/**
 * Quick checks (M8): four question types, auto-grading, timing and a gradebook. Ported from
 * legacy/tutorloft/src/lib/quizzes.ts and gradebook.ts as pure functions. Integrity signals come from
 * the vendored tinyproctorjs client (MIT); `integrityReview` turns its counts into something a host can act on.
 */

export type QuestionType = "mcq_single" | "mcq_multi" | "true_false" | "short_answer";

export interface CheckOption { id: string; text: string }
export interface CheckQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  options: CheckOption[];
  /** mcq_single: [id]; mcq_multi: ids; true_false: ["true"|"false"]; short_answer: accepted answers. */
  answer: string[];
}

export type StudentAnswer = string[];

export interface CheckWindow {
  status: "draft" | "published" | "closed";
  openAt: string | null;
  closeAt: string | null;
  timeLimitMin: number | null;
  maxAttempts: number;
}

/** Validate a question the way the legacy zod schemas did; returns an error message or null. */
export function validateQuestion(q: CheckQuestion): string | null {
  if (!q.prompt.trim()) return "Write the question";
  if (!Number.isInteger(q.points) || q.points < 1) return "Points must be a whole number of at least 1";
  if (q.type === "mcq_single" || q.type === "mcq_multi") {
    if (q.options.length < 2) return "Add at least two options";
    if (q.options.some((o) => !o.text.trim())) return "Every option needs text";
    const ids = new Set(q.options.map((o) => o.id));
    if (!q.answer.length || q.answer.some((a) => !ids.has(a))) return "Mark the correct option";
    if (q.type === "mcq_single" && q.answer.length !== 1) return "Pick exactly one correct option";
  }
  if (q.type === "true_false" && !(q.answer.length === 1 && (q.answer[0] === "true" || q.answer[0] === "false"))) return "Pick true or false";
  if (q.type === "short_answer" && !q.answer.some((a) => a.trim())) return "Add at least one accepted answer";
  return null;
}

const normalise = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase();
const sameSet = (a: string[], b: string[]) => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

/** Objective answers are graded now; an unmatched short answer is null (it goes to the host's review). */
export function scoreAnswer(q: CheckQuestion, a: StudentAnswer | undefined): { isCorrect: boolean | null; points: number | null } {
  if (!a || !a.length) return q.type === "short_answer" ? { isCorrect: false, points: 0 } : { isCorrect: false, points: 0 };
  if (q.type === "mcq_single" || q.type === "true_false") {
    const ok = a[0] === q.answer[0];
    return { isCorrect: ok, points: ok ? q.points : 0 };
  }
  if (q.type === "mcq_multi") {
    const ok = sameSet(a, q.answer);
    return { isCorrect: ok, points: ok ? q.points : 0 };
  }
  const accepted = new Set(q.answer.map(normalise));
  return accepted.has(normalise(a[0] ?? "")) ? { isCorrect: true, points: q.points } : { isCorrect: null, points: null };
}

export interface AttemptScore { earned: number; possible: number; pending: number; percent: number | null }

export function attemptScore(questions: CheckQuestion[], scores: Record<string, { points: number | null }>): AttemptScore {
  let earned = 0;
  let pending = 0;
  const possible = questions.reduce((n, q) => n + q.points, 0);
  for (const q of questions) {
    const s = scores[q.id];
    if (!s || s.points === null) pending++;
    else earned += s.points;
  }
  return { earned, possible, pending, percent: pending || !possible ? null : Math.round((earned / possible) * 100) };
}

export function windowError(c: CheckWindow, now: number): string | null {
  if (c.status !== "published") return "This check isn't open";
  if (c.openAt && Date.parse(c.openAt) > now) return "This check isn't open yet";
  if (c.closeAt && Date.parse(c.closeAt) < now) return "This check is closed";
  return null;
}

export function attemptDeadline(c: CheckWindow, startedAt: string): number | null {
  const d: number[] = [];
  if (c.closeAt) d.push(Date.parse(c.closeAt));
  if (c.timeLimitMin) d.push(Date.parse(startedAt) + c.timeLimitMin * 60_000);
  return d.length ? Math.min(...d) : null;
}

export function remainingSeconds(c: CheckWindow, startedAt: string, now: number): number | null {
  const d = attemptDeadline(c, startedAt);
  return d === null ? null : Math.max(0, Math.floor((d - now) / 1000));
}

/** Stable per-member shuffle (same order on reload). */
export function shuffled<T extends { id: string }>(items: T[], seed: string): T[] {
  const h = (s: string) => {
    let x = 2166136261;
    for (const ch of s) x = Math.imul(x ^ ch.charCodeAt(0), 16777619) >>> 0;
    return x;
  };
  return [...items].sort((a, b) => h(seed + a.id) - h(seed + b.id));
}

// ---- integrity (tinyproctorjs signals) ----

export interface IntegritySnapshot {
  integrityScore: number;
  violationCounts: Record<string, number>;
  awayMs: number;
}

const SIGNAL_LABEL: Record<string, string> = {
  tab_hidden: "left the tab",
  window_blur: "switched windows",
  fullscreen_exit: "left full screen",
  devtools_key: "opened developer tools",
  devtools_resize: "developer tools suspected",
  copy_attempt: "copied text",
  cut_attempt: "cut text",
  paste_attempt: "pasted text",
  context_menu: "opened the context menu",
  print_attempt: "tried to print",
  page_idle: "went idle",
  multi_screen: "has a second screen",
  automation_flag: "browser automation detected",
  drop_attempt: "dropped content in",
  insert_burst: "inserted a block of text at once"
};

/**
 * Signals, not verdicts: "clean" (nothing worth a look), "review" (look at the answers), "flagged"
 * (strong signals such as pasting or automation). The host decides; Loft never fails anyone.
 */
export function integrityReview(s: IntegritySnapshot | null | undefined): { level: "none" | "clean" | "review" | "flagged"; reasons: string[] } {
  if (!s) return { level: "none", reasons: [] };
  const reasons = Object.entries(s.violationCounts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${SIGNAL_LABEL[k] ?? k.replace(/_/g, " ")}${n > 1 ? ` ×${n}` : ""}`);
  if (s.awayMs >= 60_000) reasons.push(`away ${Math.round(s.awayMs / 60_000)} min`);
  const strong = ["paste_attempt", "automation_flag", "insert_burst", "devtools_key", "drop_attempt"].some((k) => (s.violationCounts[k] ?? 0) > 0);
  const level = strong || s.integrityScore < 60 ? "flagged" : s.integrityScore < 90 || s.awayMs >= 60_000 ? "review" : "clean";
  return { level, reasons };
}

// ---- gradebook (ported) ----

export type CellStatus = "graded" | "pending" | "missing" | "not_due";
export interface GradeCell { earned: number | null; possible: number | null; status: CellStatus }

/** Average over graded cells; missing work counts as zero once due (legacy rule). */
export function cellAverage(cells: GradeCell[]): number | null {
  let earned = 0;
  let possible = 0;
  for (const c of cells) {
    if (!c.possible || c.possible <= 0) continue;
    if (c.status === "graded" && c.earned !== null) {
      earned += c.earned;
      possible += c.possible;
    }
    if (c.status === "missing") possible += c.possible;
  }
  return possible === 0 ? null : Math.round((earned / possible) * 100);
}

export function cellText(c: GradeCell): string {
  if (c.status === "missing") return "Missing";
  if (c.status === "pending") return "Pending";
  if (c.status === "not_due") return "";
  return c.possible === null ? String(c.earned ?? "") : `${c.earned}/${c.possible}`;
}
