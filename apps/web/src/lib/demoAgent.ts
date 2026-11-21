import { demoDrafts, type PrepTemplate } from "@loft/core";
import type { DataAdapter } from "@loft/data";

/**
 * The scripted agent for the Pages preview. It talks to the same agent-link endpoints a real agent
 * uses (read next.md → claim → context → drafts → report), with pauses so you can watch it work.
 */
export const DEMO_AGENT = { userAgent: "claude-code/1.0 (demo)", name: "claude (demo)" };

type Claim = { paused?: boolean; task: { id: string; template: PrepTemplate; title: string; brief: string; session: { title: string; minutes: number } | null } | null; error?: string };

export async function runDemoAgent(adapter: DataAdapter, token: string, onStep: (text: string) => void, delay = 700): Promise<{ done: boolean; title?: string; error?: string }> {
  const agent = { agent: DEMO_AGENT };
  const wait = () => new Promise((r) => setTimeout(r, delay));
  onStep("reading the link (next.md)");
  await adapter.query(`a/${token}`, agent);
  await wait();
  const claim = await adapter.mutate<Claim>(`a/${token}/claim`, agent);
  if (claim.error) return { done: false, error: claim.error };
  if (claim.paused) return { done: false, error: "Agents are paused" };
  if (!claim.task) return { done: false, error: "Nothing queued on this link" };
  const t = claim.task;
  onStep(`claimed ${t.title}`);
  await wait();
  const ctx = await adapter.query<{ board?: { anchor: { x: number; y: number } } | null }>(`a/${token}/context/${t.id}`, agent);
  onStep("read plans, files and past recaps");
  await wait();
  const drafts = demoDrafts(t.template, { title: t.session?.title ?? t.title, brief: t.brief, minutes: t.session?.minutes ?? 60, anchor: ctx.board?.anchor ?? { x: 80, y: 80 } });
  for (const d of drafts) {
    await adapter.mutate(`a/${token}/drafts`, { ...agent, taskId: t.id, ...d });
    onStep(`drafted ${d.title}`);
    await wait();
  }
  await adapter.mutate(`a/${token}/report`, { ...agent, taskId: t.id, status: "done", note: `Drafted ${drafts.length} item${drafts.length === 1 ? "" : "s"} for ${t.title}. Demo agent on the Pages preview.`, minutes: 3 + drafts.length });
  onStep(`finished ${t.title}`);
  return { done: true, title: t.title };
}
