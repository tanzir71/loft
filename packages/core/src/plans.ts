/**
 * Plans (Figma 06 · row A): the timeline is the plan. Block times are derived from minutes;
 * attaching prepares the room; wrap-up writes the billable session_log lines (the hinge into billing).
 */
export const BLOCK_TYPES = ["talk", "board", "activity", "check", "break", "handout"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const BLOCK_LABEL: Record<BlockType, string> = { talk: "Talk", board: "Board", activity: "Activity", check: "Check", break: "Break", handout: "Hand-out" };

export interface PlanBlock {
  id: string;
  title: string;
  type: BlockType;
  minutes: number;
  memberText: string;
  hostNotes: string;
  resources: { kind: "board" | "file" | "poll" | "link" | "timer"; label: string; ref?: string }[];
  visible: boolean;
}

export type PlanStatus = "draft" | "ready" | "taught";

export interface PlanLike {
  minutes: number;
  blocks: PlanBlock[];
  status: PlanStatus;
  sessionId?: string | null;
}

export interface Segment {
  id: string;
  type: BlockType | "free" | "over";
  start: number;
  minutes: number;
}

/** Derived timeline: start = sum of previous minutes; under-length → a "free" tail, over-length → an "over" tail. */
export function timeline(blocks: PlanBlock[], available: number): { segments: Segment[]; planned: number; free: number; over: number } {
  let t = 0;
  const segments: Segment[] = blocks.map((b) => {
    const s = { id: b.id, type: b.type, start: t, minutes: b.minutes };
    t += b.minutes;
    return s;
  });
  const free = Math.max(0, available - t);
  const over = Math.max(0, t - available);
  if (free) segments.push({ id: "free", type: "free", start: t, minutes: free });
  if (over) segments.push({ id: "over", type: "over", start: available, minutes: over });
  return { segments, planned: t, free, over };
}

export const mmss = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

/** Draft (under length or unattached) → Ready (attached) → Taught (wrap-up done). */
export function derivePlanStatus(p: PlanLike): PlanStatus {
  if (p.status === "taught") return "taught";
  const planned = p.blocks.reduce((n, b) => n + b.minutes, 0);
  return p.sessionId && planned >= p.minutes * 0.8 ? "ready" : "draft";
}

/** Move a block (Alt+↑/↓ or drag); returns a new array. */
export function moveBlock(blocks: PlanBlock[], from: number, to: number): PlanBlock[] {
  const out = blocks.slice();
  const [b] = out.splice(from, 1);
  if (!b) return blocks;
  out.splice(Math.max(0, Math.min(out.length, to)), 0, b);
  return out;
}

/** What members see in the posted agenda: visible blocks, titles + times, never host notes. */
export function memberAgenda(blocks: PlanBlock[], startsAt?: string): { time: string; title: string; text: string }[] {
  let t = 0;
  const base = startsAt ? Date.parse(startsAt) : null;
  const out: { time: string; title: string; text: string }[] = [];
  for (const b of blocks) {
    if (b.visible) {
      const at = base !== null ? new Date(base + t * 60_000) : null;
      out.push({ time: at ? `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}` : mmss(t), title: b.title, text: b.memberText });
    }
    t += b.minutes;
  }
  return out;
}

let seq = 0;
const bid = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;
const block = (title: string, type: BlockType, minutes: number, memberText = "", hostNotes = ""): PlanBlock => ({ id: bid(), title, type, minutes, memberText, hostNotes, resources: type === "board" ? [{ kind: "board", label: "Board · blank page" }] : [], visible: true });

export const TEMPLATES: Record<string, { label: string; minutes: number; blocks: () => PlanBlock[] }> = {
  lesson: { label: "Lesson", minutes: 60, blocks: () => [block("Check-in", "talk", 5, "What did you notice since last time?"), block("Predict", "board", 10, "Write your guess on the board."), block("Activity", "activity", 25, "Work in pairs."), block("Share findings", "board", 10), block("Exit ticket", "check", 5, "3 quick questions"), block("Set homework", "handout", 5)] },
  workshop: { label: "Workshop", minutes: 90, blocks: () => [block("Welcome + goals", "talk", 10), block("Map the problem", "board", 20), block("Ideas", "activity", 25), block("Break", "break", 10), block("Vote + decide", "check", 15), block("Next steps", "talk", 10)] },
  sprint: { label: "Sprint day", minutes: 120, blocks: () => [block("Recap yesterday", "talk", 10), block("Sketch", "board", 40), block("Break", "break", 10), block("Storyboard", "board", 40), block("Decide", "check", 20)] },
  client: { label: "Client session", minutes: 60, blocks: () => [block("Since last time", "talk", 10), block("Review the numbers", "board", 20), block("Options", "activity", 15), block("Decisions + owners", "talk", 10), block("Actions", "handout", 5)] },
  retro: { label: "Retro", minutes: 45, blocks: () => [block("Check-in", "talk", 5), block("What went well / not", "board", 15), block("Group + vote", "check", 10), block("Actions", "talk", 10), block("Close", "talk", 5)] }
};

/** "From a file": one block per page (title = page heading or "Page n"). */
export function blocksFromPages(pages: { title?: string }[], minutesEach = 5): PlanBlock[] {
  return pages.map((p, i) => block(p.title?.trim() || `Page ${i + 1}`, "board", minutesEach));
}

/** Validate AI JSON blocks (nothing is published until the host edits/accepts). */
export function parseAiBlocks(json: unknown): PlanBlock[] {
  if (!Array.isArray(json)) throw new Error("Expected a list of blocks");
  return json.slice(0, 40).map((raw, i) => {
    const r = raw as Record<string, unknown>;
    const type = BLOCK_TYPES.includes(r.type as BlockType) ? (r.type as BlockType) : "talk";
    const minutes = Math.max(1, Math.min(240, Math.round(Number(r.minutes) || 5)));
    return { id: bid(), title: String(r.title ?? `Block ${i + 1}`).slice(0, 120), type, minutes, memberText: String(r.instructions ?? "").slice(0, 2000), hostNotes: String(r.hostNotes ?? "").slice(0, 2000), resources: [], visible: true };
  });
}

/** Partly/skipped blocks carry over: prepended to the next plan. */
export function carryOver(outcomes: Record<string, "done" | "partly" | "skipped">, blocks: PlanBlock[], keep: Set<string>): PlanBlock[] {
  return blocks.filter((b) => outcomes[b.id] && outcomes[b.id] !== "done" && keep.has(b.id)).map((b) => ({ ...b, id: bid(), title: b.title }));
}

export type AttendanceStatus = "attended" | "absent" | "excused" | "late_cancel" | "no_show";

export interface BillingPolicy {
  /** Price per session per member, in cents. */
  unitPriceCents: number;
  /** Which statuses are billable. */
  billable: AttendanceStatus[];
}

export const DEFAULT_POLICY: BillingPolicy = { unitPriceCents: 0, billable: ["attended", "late_cancel", "no_show"] };

export interface LogLine {
  memberId: string;
  minutes: number;
  status: AttendanceStatus;
  billable: boolean;
  unitPriceCents: number;
  amountCents: number;
}

/** One session_log line per member (I2). Nothing is invoiced yet. */
export function sessionLogLines(attendance: { memberId: string; minutes: number; status: AttendanceStatus }[], policy: BillingPolicy): LogLine[] {
  return attendance.map((a) => {
    const billable = policy.billable.includes(a.status);
    return { ...a, billable, unitPriceCents: policy.unitPriceCents, amountCents: billable ? policy.unitPriceCents : 0 };
  });
}

/** Attendance prefilled from presence: joined at all → attended; nothing → absent. */
export function attendanceFromPresence(memberIds: string[], minutesById: Record<string, number>, lateCancel: Set<string> = new Set()): { memberId: string; minutes: number; status: AttendanceStatus }[] {
  return memberIds.map((id) => ({ memberId: id, minutes: Math.round(minutesById[id] ?? 0), status: lateCancel.has(id) ? "late_cancel" : (minutesById[id] ?? 0) > 0 ? "attended" : "absent" }));
}
