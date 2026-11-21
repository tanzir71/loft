/**
 * Calls (handoff §7.3). Ladder: the host's own Meet/Zoom link → P2P audio (≤6 talking) → stage
 * mode (host as hub, raise hand, 60 s turns, up to 12) → optional SFU/video with the org's own keys.
 * Daily budget cap: pool/day = (free + budget ÷ unit price) ÷ days; step down at 80% → 100% → own link,
 * with a 10-minute grace, and never cut a live session.
 */
import { P2P_TALKING_MAX, SCREEN_SHARE_VIEWERS_MAX, STAGE_MAX } from "./limits";

export type CallMode = "p2p" | "stage" | "sfu" | "own-link";
export const TURN_SECONDS = 60;
export const GRACE_MINUTES = 10;

/** Which mode a call should use for N people in it, given what the org has set up. */
export function ladderMode(people: number, opts: { sfu?: boolean; stage?: boolean; ownLink?: string | null } = {}): CallMode {
  if (opts.sfu) return "sfu";
  if (people <= P2P_TALKING_MAX && !opts.stage) return "p2p";
  if (people <= STAGE_MAX) return "stage";
  return opts.ownLink ? "own-link" : "stage";
}

/** In P2P mode, everyone talks (up to 6); in stage mode, the host plus whoever has the turn. */
export function canTalk(mode: CallMode, opts: { isHost: boolean; hasTurn: boolean; talkingNow: number; amTalking: boolean }): boolean {
  if (mode === "sfu" || mode === "own-link") return true;
  if (mode === "stage") return opts.isHost || opts.hasTurn;
  return opts.amTalking || opts.talkingNow < P2P_TALKING_MAX;
}

export function canViewShare(viewersNow: number): boolean {
  return viewersNow < SCREEN_SHARE_VIEWERS_MAX;
}

/** Minutes per day the org's SFU budget allows (free minutes + paid minutes, spread over the month). */
export function dailyPool(o: { freeMinutes: number; budgetCents: number; unitPriceCentsPerMinute: number; daysInMonth: number }): number {
  const paid = o.unitPriceCentsPerMinute > 0 ? o.budgetCents / o.unitPriceCentsPerMinute : 0;
  return Math.floor((o.freeMinutes + paid) / Math.max(1, o.daysInMonth));
}

export type BudgetStep = "full" | "warn" | "audio-only" | "own-link";

/**
 * Where today's usage sits: under 80% full service; at 80% a warning (video off for new joins);
 * at 100% audio only; past 100% + 10 minutes' grace, new calls use the own link.
 * A session that's already live is never cut: it keeps its current step.
 */
export function budgetStep(usedMinutes: number, pool: number, opts: { live?: boolean; current?: BudgetStep } = {}): BudgetStep {
  if (opts.live && opts.current) return opts.current;
  if (pool <= 0) return "own-link";
  if (usedMinutes < pool * 0.8) return "full";
  if (usedMinutes < pool) return "warn";
  if (usedMinutes < pool + GRACE_MINUTES) return "audio-only";
  return "own-link";
}

/** Stage mode queue: raised hands in order; the host gives 60 s turns. */
export interface StageState { hands: string[]; turn: { id: string; endsAt: number } | null }

export function raiseHand(s: StageState, id: string): StageState {
  return s.hands.includes(id) || s.turn?.id === id ? s : { ...s, hands: [...s.hands, id] };
}
export function lowerHand(s: StageState, id: string): StageState {
  return { hands: s.hands.filter((h) => h !== id), turn: s.turn?.id === id ? null : s.turn };
}
/** Give the next raised hand a turn (or a specific person). */
export function nextTurn(s: StageState, now: number, id?: string): StageState {
  const who = id ?? s.hands[0];
  if (!who) return { ...s, turn: null };
  return { hands: s.hands.filter((h) => h !== who), turn: { id: who, endsAt: now + TURN_SECONDS * 1000 } };
}
/** Turns end on their own after 60 s. */
export function tickStage(s: StageState, now: number): StageState {
  return s.turn && s.turn.endsAt <= now ? { ...s, turn: null } : s;
}

/** Deterministic offer direction in a mesh: the lower tab id makes the offer (no glare). */
export function shouldOffer(myTab: string, theirTab: string): boolean {
  return myTab < theirTab;
}
