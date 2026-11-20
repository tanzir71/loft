/** Small teams by design (handoff §3.3). Agents never count towards room capacity. */
export const ROOM_CAPACITY = 12;
export const P2P_TALKING_MAX = 6;
export const STAGE_MAX = 12;
export const SCREEN_SHARE_VIEWERS_MAX = 6;
export const AGENTS_PER_ROOM_MAX = 2;
export const PRESENCE_TTL_MS = 30_000;
export const PRESENCE_HEARTBEAT_MS = 5_000;

export type Seat = "in" | "waiting";

/** Decide whether the next human joins the room or the waiting line. */
export function seatFor(humansInRoom: number, capacity = ROOM_CAPACITY): Seat {
  return humansInRoom < capacity ? "in" : "waiting";
}

/** Call ladder rung allowed for a number of people who want to talk. */
export function callModeFor(talking: number): "p2p" | "stage" | "external" {
  if (talking <= P2P_TALKING_MAX) return "p2p";
  if (talking <= STAGE_MAX) return "stage";
  return "external";
}
