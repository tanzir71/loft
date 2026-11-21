import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Clock, Play, Plus } from "lucide-react";
import { Button } from "@loft/ui";
import { BLOCK_LABEL, type PlanBlock } from "@loft/core";
import { useAdapter, useQuery } from "../lib/data";

interface RailData { planId: string; title: string; blocks: PlanBlock[]; rail: { current: number; startedAt: string | null; extensions: Record<string, number> }; isHost: boolean; sessionId: string; pages: Record<string, string> }

const ACTION: Record<string, string> = { board: "opens its board page for everyone", handout: "hands out a copy to each person", check: "runs the quick check", break: "pauses the timer", activity: "starts the activity", talk: "moves on" };
const fmt = (s: number) => `${s < 0 ? "+" : ""}${Math.floor(Math.abs(s) / 60)}:${String(Math.floor(Math.abs(s) % 60)).padStart(2, "0")}`;

/** Figma 06 · P5 "Run in the room": a quiet rail only the host sees; members see "Now / next". Nothing auto-advances. */
export function PlanRail({ sessionId, onGoToPage, compact }: { sessionId: string; onGoToPage: (pageId: string) => void; compact: boolean }) {
  const adapter = useAdapter();
  const { data } = useQuery<RailData | null>(`sessions/${sessionId}/plan`);
  const [open, setOpen] = useState(!compact);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!data || !data.blocks.length) return null;
  const i = Math.min(data.rail.current, data.blocks.length - 1);
  const cur = data.blocks[i]!;
  const next = data.blocks[i + 1];
  const started = data.rail.startedAt ? Date.parse(data.rail.startedAt) : null;
  const total = cur.minutes * 60 + (data.rail.extensions[cur.id] ?? 0) * 60;
  const left = started ? total - (now - started) / 1000 : total;

  if (!data.isHost) {
    return (
      <div className="island now-chip" data-board-ui="" role="status" aria-live="polite">
        <span className="now-chip__tag">NOW</span> <b>{cur.title}</b>{next && <span className="now-chip__next"> · next: {next.title}</span>}
      </div>
    );
  }
  const save = (rail: RailData["rail"]) => adapter.mutate(`sessions/${sessionId}/rail`, rail);
  const startBlock = async (k: number) => {
    const b = data.blocks[k];
    if (!b) return;
    await save({ current: k, startedAt: new Date().toISOString(), extensions: data.rail.extensions });
    const page = data.pages[b.id];
    if (page && (b.type === "board" || b.type === "handout")) onGoToPage(page);
  };
  if (!open) {
    return (
      <button type="button" className="island rail-pill" data-board-ui="" onClick={() => setOpen(true)} aria-label="Open the plan rail">
        <Clock aria-hidden="true" /> {cur.title} · <span className={`mono${left < 0 ? " over" : ""}`}>{fmt(left)}</span> <ChevronDown aria-hidden="true" />
      </button>
    );
  }
  return (
    <aside className="island plan-rail-room" data-board-ui="" aria-label="Plan (only you see this)">
      <header>
        <span className="eyebrow-mono">Plan · only you</span>
        <button type="button" className="lf-icon-btn" onClick={() => setOpen(false)} aria-label="Collapse the plan rail"><ChevronUp aria-hidden="true" /></button>
      </header>
      <ol className="rail-blocks" role="list">
        {data.blocks.map((b, k) => (
          <li key={b.id} className={k === i ? "is-now" : k < i ? "is-done" : ""}>
            <span className="mono">{b.minutes}′</span> {b.title}
          </li>
        ))}
      </ol>
      <div className="rail-now">
        <small>{BLOCK_LABEL[cur.type]} · block {i + 1} of {data.blocks.length}</small>
        <b>{cur.title}</b>
        <span className={`rail-timer mono${left < 0 ? " over" : left < 60 ? " soon" : ""}`}>{started ? (left < 0 ? `${fmt(left)} over` : fmt(left)) : fmt(total)}</span>
        {cur.hostNotes && <p className="rail-notes">{cur.hostNotes}</p>}
        {started && left < 60 && next && <p className="rail-prompt" role="status">Time's up soon. Next, <b>{next.title}</b> {ACTION[next.type]}.</p>}
      </div>
      <div className="rail-actions">
        {!started ? (
          <Button size="sm" icon={<Play aria-hidden="true" />} onClick={() => void startBlock(i)}>Start {cur.title}</Button>
        ) : next ? (
          <Button size="sm" icon={<Play aria-hidden="true" />} onClick={() => void startBlock(i + 1)}>Start next block</Button>
        ) : (
          <span className="muted-note">Last block. End the session to wrap up.</span>
        )}
        {started && <Button size="sm" variant="secondary" icon={<Plus aria-hidden="true" />} onClick={() => void save({ ...data.rail, extensions: { ...data.rail.extensions, [cur.id]: (data.rail.extensions[cur.id] ?? 0) + 2 } })}>2 min</Button>}
      </div>
    </aside>
  );
}
