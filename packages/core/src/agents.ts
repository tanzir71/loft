/**
 * Agent link protocol, capabilities v1 (handoff §12; Figma 06 · A1–A6 + "Agents · build rules").
 * One link + one line. Plain HTTP + JSON so it runs on shared hosting. Agents create drafts only.
 */

export type LinkScope = "workspace" | "space" | "room";
export type PrepTemplate = "agenda" | "board_brief" | "check" | "recap" | "client_agenda" | "invoice_drafts";
export type DraftKind = "plan" | "board_ops" | "post" | "check" | "invoice_draft";
export type PrepStatus = "queued" | "working" | "needs_you" | "ready" | "accepted" | "rejected" | "changes";

export const AGENT_LINE = "Get things ready through this link, top to bottom.";
export const LINK_DAYS = 30;
export const RATE_PER_MIN = 60;
export const MAX_BOARD_OPS = 500;
export const MAX_AGENTS_PER_ROOM = 2;
export const FILE_CAP_MB = 20;

export const CAPABILITIES: { what: string; method: string; path: string; note?: string }[] = [
  { what: "claim the next prep task", method: "POST", path: "/claim" },
  { what: "read context", method: "GET", path: "/context/{id}", note: "plans, files, past recaps (no payer contacts, no DMs)" },
  { what: "create drafts", method: "POST", path: "/drafts", note: `plan | board_ops (≤${MAX_BOARD_OPS}) | post | check | invoice_draft` },
  { what: "upload a file", method: "POST", path: "/files", note: `≤ ${FILE_CAP_MB} MB` },
  { what: "ask the host, then move on", method: "POST", path: "/ask" },
  { what: "report", method: "POST", path: "/report", note: "progress | done | blocker, minutes" },
  { what: "re-read changes", method: "GET", path: "/changes?since=" }
];

/** Built-in chips on Agents (A1): what an agent learns from the link itself. */
export const BUILT_IN = ["claim the next prep task", "read plans, files, past recaps", "draft plans + agendas", "draft board pages: shapes, connectors, stickies", "draft quick checks", "draft recap posts", "draft invoices (never sends)", "upload files", "ask you, then move on", "report progress · done · blocker"];

export const PREP_TEMPLATES: { id: PrepTemplate; label: string; chip: string; output: DraftKind[]; blurb: string }[] = [
  { id: "agenda", label: "Agenda for a session", chip: "Agenda for a session", output: ["plan", "post"], blurb: "A plan with timed blocks, attached to the session" },
  { id: "board_brief", label: "Board from a brief or PDF", chip: "Board from a brief", output: ["board_ops", "post"], blurb: "Sections, stickies and shapes on the session's board" },
  { id: "check", label: "N-question check", chip: "N-question check", output: ["check"], blurb: "A quick check, auto-graded" },
  { id: "recap", label: "Recap from today's board", chip: "Recap", output: ["post"], blurb: "A recap post from the board and the plan" },
  { id: "client_agenda", label: "Client-call agenda from past recaps", chip: "Client-call agenda", output: ["plan"], blurb: "An agenda from the last 3 recaps" },
  { id: "invoice_drafts", label: "Invoice drafts, anomalies flagged", chip: "Invoice drafts", output: ["invoice_draft"], blurb: "Drafts only, with anything odd flagged; never sends" }
];

/** Agents may never do these; context endpoints redact the fields server-side. */
export const NEVER = ["send messages, email or WhatsApp", "send or confirm invoices", "invite people", "change branding", "read payer contact details or DMs"];

export interface AgentSeat { name: string; runtime: string; version: string }

/** The first request creates a seat from the User-Agent + X-Agent-Name ("codex-cli/0.9" → codex · codex-cli 0.9). */
export function seatFromRequest(userAgent: string | null | undefined, agentName: string | null | undefined): AgentSeat {
  const ua = (userAgent ?? "").trim();
  const m = /^([a-z][a-z0-9._-]*)\/([0-9][\w.-]*)/i.exec(ua);
  const runtime = m ? m[1]!.toLowerCase() : ua.split(/\s+/)[0]?.toLowerCase() || "agent";
  const version = m ? m[2]! : "";
  const fromRuntime = runtime.replace(/-(cli|code)$/, "");
  const name = (agentName ?? "").trim().slice(0, 40) || fromRuntime || "agent";
  return { name, runtime, version };
}

/** Token bucket: 60 requests a minute per seat, refilled continuously. */
export function takeToken(bucket: { tokens: number; at: number } | null | undefined, now: number, perMin = RATE_PER_MIN): { ok: boolean; bucket: { tokens: number; at: number }; retryAfterMs: number } {
  const b = bucket ?? { tokens: perMin, at: now };
  const tokens = Math.min(perMin, b.tokens + ((now - b.at) / 60_000) * perMin);
  if (tokens < 1) return { ok: false, bucket: { tokens, at: now }, retryAfterMs: Math.ceil(((1 - tokens) / perMin) * 60_000) };
  return { ok: true, bucket: { tokens: tokens - 1, at: now }, retryAfterMs: 0 };
}

const SECRET_KEYS = new Set(["email", "phone", "payerEmail", "payerPhone", "payerContact", "payToken", "manageToken", "feedToken", "token", "password"]);
/** Context for agents: no payer contacts, no tokens, no DMs (handoff §12). */
export function redact<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redact(v)) as T;
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(k)) continue;
    if (k === "channelType" && v === "dm") return {} as T;
    out[k] = redact(v);
  }
  return out as T;
}

export function validateDraft(kind: string, payload: unknown): string | null {
  if (!["plan", "board_ops", "post", "check", "invoice_draft"].includes(kind)) return `Unknown draft kind "${kind}"`;
  if (!payload || typeof payload !== "object") return "payload must be an object";
  const p = payload as Record<string, unknown>;
  if (kind === "board_ops") {
    if (!Array.isArray(p.ops) || !p.ops.length) return "board_ops needs ops";
    if (p.ops.length > MAX_BOARD_OPS) return `At most ${MAX_BOARD_OPS} ops per batch`;
  }
  if (kind === "plan" && !Array.isArray(p.blocks)) return "plan needs blocks";
  if (kind === "post" && typeof p.body !== "string") return "post needs a body";
  if (kind === "check" && !Array.isArray(p.questions)) return "check needs questions";
  if (kind === "invoice_draft" && typeof p.note !== "string") return "invoice_draft needs a note";
  return null;
}

export interface NextView {
  title: string;
  seat: AgentSeat | null;
  seatNo: number | null;
  expiresAt: string;
  paused: boolean;
  next: { title: string; when: string; readyBy: string; inputs: string[]; doneWhen: string } | null;
  queue: { title: string; note: string }[];
  rejected: { title: string; reason: string }[];
}

const dots = (label: string, width = 28) => `${label} ${".".repeat(Math.max(2, width - label.length))}`;

/** next.md: what an agent reads first. It starts with the capabilities list, so nobody explains it in a prompt. */
export function nextMarkdown(v: NextView): string {
  const lines = [
    `# Loft · ${v.title} · agent link`,
    `capabilities: v1 · seat: ${v.seat ? `${v.seat.runtime}${v.seat.version ? ` ${v.seat.version}` : ""} (seat ${v.seatNo ?? 1})` : "new (waiting for approval)"} · expires ${new Date(v.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
    "",
    "## What you can do",
    ...CAPABILITIES.map((c) => `- ${dots(c.what)} ${c.method.padEnd(4)} ${c.path}${c.note ? `   ${c.note}` : ""}`),
    "- stop when paused",
    "",
    "## Rules",
    `drafts only · never send, invite, charge or confirm payments · ${RATE_PER_MIN} requests/min`,
    "in a live room: no audio, named cursor, edits wait on a draft layer",
    ""
  ];
  if (v.paused) lines.push("## Paused", "The host paused this link. Stop and check back later.", "");
  if (v.next) lines.push("## Next task", `${v.next.title} · ready by ${v.next.readyBy}`, `inputs: ${v.next.inputs.join(" · ") || "none"}`, `done when: ${v.next.doneWhen}`, "");
  if (v.queue.length) lines.push(`## Queue (${v.queue.length})`, ...v.queue.map((q, i) => `${i + 1}. ${q.title} · ${q.note}`), "");
  if (v.rejected.length) lines.push("## Sent back by the host", ...v.rejected.map((r) => `- ${r.title}: ${r.reason}`), "");
  return lines.join("\n");
}

export const DONE_WHEN: Record<PrepTemplate, string> = {
  agenda: "a plan with 5–7 timed blocks is drafted and attached to the session",
  board_brief: "the board has one section per part of the brief, drafted on the draft layer",
  check: "a check with the requested number of questions is drafted",
  recap: "a recap post with what was covered and the board notes is drafted",
  client_agenda: "an agenda built from the last 3 recaps is drafted",
  invoice_drafts: "invoice drafts exist for the month with anything unusual flagged"
};

/**
 * The scripted demo agent used on GitHub Pages: deterministic drafts for each template,
 * delivered through the same protocol endpoints a real agent would call.
 */
export function demoDrafts(t: PrepTemplate, ctx: { title: string; brief: string; minutes: number; anchor: { x: number; y: number } }): { kind: DraftKind; title: string; sub: string; payload: Record<string, unknown> }[] {
  if (t === "board_brief") {
    const parts = (/sections?:\s*([^.]+)/i.exec(ctx.brief)?.[1] ?? "Map, Decide, Storyboard")
      .split(/,|\band\b/)
      .map((s) => s.replace(/\(.*?\)/g, "").trim())
      .filter(Boolean)
      .slice(0, 4);
    const out: ReturnType<typeof demoDrafts> = [];
    parts.forEach((name, i) => {
      const sx = ctx.anchor.x + (i % 2) * 480;
      const sy = ctx.anchor.y + Math.floor(i / 2) * 380;
      const sid = `drf_sec_${i}`;
      const stickies = i === 0 ? ["Sees price on shelf", "Compares with rival", "Buys or walks", "Comes back?"] : i === 1 ? ["$2.40 · keep", "$2.60 · test", "$2.80 · stretch"] : ["Frame 1", "Frame 2", "Frame 3", "Frame 4", "Frame 5", "Frame 6"];
      const grid = i === 2 ? { cols: 3, dx: 138, dy: 100, w: 124, h: 86 } : { cols: 2, dx: 210, dy: 140, w: 180, h: 120 };
      const ops = [
        { kind: "add", payload: { obj: { id: sid, kind: "section", z: 1, x: sx, y: sy, w: 440, h: 340, title: name, draft: true } } },
        ...stickies.map((text, k) => {
          const pos = { x: sx + 20 + (k % grid.cols) * grid.dx, y: sy + 50 + Math.floor(k / grid.cols) * grid.dy, w: grid.w, h: grid.h };
          const obj = i === 2 ? { kind: "shape", shape: "process", fill: "card", text } : { kind: "sticky", colour: "yellow", text };
          return { kind: "add", payload: { obj: { id: `${sid}_s${k}`, z: 2 + k, ...obj, ...pos, draft: true } } };
        })
      ];
      out.push({ kind: "board_ops", title: `Section · ${name}`, sub: i === 1 ? `${stickies.length} options · votes seeded` : i === 2 ? `${stickies.length} frames, empty` : `${stickies.length} stickies`, payload: { ops } });
    });
    out.push({ kind: "post", title: `Stream post · 'What to expect'`, sub: "draft post", payload: { title: `What to expect: ${ctx.title}`, body: `We'll work through ${parts.join(", ")}. Bring your numbers.` } });
    return out;
  }
  if (t === "agenda" || t === "client_agenda") {
    const blocks = t === "agenda"
      ? [["Check-in", "talk", 10], ["Since last time", "talk", 15], ["Decide", "board", 30], ["Break", "break", 10], ["Storyboard", "activity", 20], ["Owners + next steps", "talk", 5]]
      : [["Where we are", "talk", 10], ["Numbers since last call", "board", 20], ["Open questions", "talk", 15], ["Decisions + owners", "talk", 15]];
    const scale = ctx.minutes / blocks.reduce((n, b) => n + (b[2] as number), 0);
    return [{ kind: "plan", title: `Agenda · ${ctx.title}`, sub: `${blocks.length} blocks · ${ctx.minutes} min`, payload: { title: `Agenda · ${ctx.title}`, minutes: ctx.minutes, blocks: blocks.map(([title, type, m], i) => ({ id: `ab${i}`, title, type, minutes: Math.max(5, Math.round(((m as number) * scale) / 5) * 5), memberText: "", hostNotes: "", resources: [], visible: true })) } }];
  }
  if (t === "check") {
    const n = Number(/(\d+)/.exec(ctx.brief)?.[1] ?? 5);
    const qs = Array.from({ length: Math.min(10, Math.max(3, n)) }, (_, i) => ({ id: `dq${i}`, type: "mcq_single", prompt: [`What does "price elasticity" describe?`, "A 10% price rise and a 5% drop in units means demand is…", "Which test isolates the effect of price best?", "What is a decoy price for?", "Which metric tells you a price test worked?", "What should a stop rule say?"][i % 6]!, points: 1, options: [{ id: "a", text: "Option A" }, { id: "b", text: "Option B" }, { id: "c", text: "Option C" }], answer: ["a"] }));
    return [{ kind: "check", title: `${qs.length}-question check · ${ctx.title}`, sub: "multiple choice · auto-graded", payload: { title: `${ctx.title} · check`, questions: qs } }];
  }
  if (t === "recap") return [{ kind: "post", title: `Recap · ${ctx.title}`, sub: "draft post", payload: { title: `Recap: ${ctx.title}`, body: "What we covered, decisions and owners. Board notes attached." } }];
  return [{ kind: "invoice_draft", title: "Invoice drafts · flagged", sub: "never sends", payload: { note: "Drafted this month's invoices. Flagged: one member with no payer; one session over 2 h billed per session." } }];
}
