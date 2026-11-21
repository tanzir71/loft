import type { SpaceMode } from "./types";

export type SpaceTab = "stream" | "chat" | "work" | "files" | "people" | "billing" | "agenda" | "votes" | "grades" | "sessions" | "notes";

export interface ModeConfig {
  label: string;
  blurb: string;
  /** Tabs in order (Figma 07 · New space · step 1). */
  tabs: SpaceTab[];
  /** What the "work" tab is called in this mode. */
  workLabel: string;
  composer: string;
  icon: "users" | "wallet" | "layout-dashboard" | "graduation-cap" | "book-open";
}

/** A mode only changes labels, tabs and templates. You can switch later. */
export const SPACE_MODES: Record<SpaceMode, ModeConfig> = {
  team: { label: "Team", blurb: "Weekly meetings, retros, a shared board", tabs: ["stream", "chat", "work", "files", "people"], workLabel: "Tasks", composer: "Post an update to the team", icon: "users" },
  client: { label: "Client / consulting", blurb: "Calls, decisions, retainers and invoices", tabs: ["stream", "chat", "work", "files", "people", "billing"], workLabel: "Actions", composer: "Post an update to the client team", icon: "wallet" },
  workshop: { label: "Workshop / sprint", blurb: "A few intense days with a set agenda", tabs: ["agenda", "stream", "chat", "votes", "files", "people"], workLabel: "Actions", composer: "Post an update to the group", icon: "layout-dashboard" },
  course: { label: "Course / class", blurb: "Lessons, assignments, quick checks", tabs: ["stream", "chat", "work", "files", "people", "grades"], workLabel: "Classwork", composer: "Announce something to your class", icon: "graduation-cap" },
  tutoring: { label: "1:1 tutoring or coaching", blurb: "One person, regular sessions, packages", tabs: ["stream", "chat", "sessions", "notes", "files", "billing"], workLabel: "Homework", composer: "Share something with your learner", icon: "book-open" }
};

export const MODE_ORDER: SpaceMode[] = ["team", "client", "workshop", "course", "tutoring"];

export function tabLabel(mode: SpaceMode, tab: SpaceTab): string {
  if (tab === "work") return SPACE_MODES[mode].workLabel;
  return { stream: "Stream", chat: "Chat", files: "Files", people: "People", billing: "Billing", agenda: "Agenda", votes: "Votes", grades: "Grades", sessions: "Sessions", notes: "Notes", work: "Work" }[tab];
}

/** Three-letter space code shown on cards ("Acme pricing" → "ACM", "Product team" → "PRO"). */
export function spaceCode(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  return (letters.slice(0, 3) || "LFT").padEnd(3, "X");
}

export const SPACE_COLOURS = ["blue", "green", "amber", "red", "slate", "teal"] as const;
export type SpaceColour = (typeof SPACE_COLOURS)[number];

/** Must-read posts: who in the space hasn't acknowledged yet (the author never needs to). */
export function unacknowledged(memberIds: string[], ackedIds: string[], authorId: string): string[] {
  const acked = new Set(ackedIds);
  return memberIds.filter((id) => id !== authorId && !acked.has(id));
}
