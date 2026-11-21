import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Bot, Check, ChevronLeft, ChevronRight, CircleCheck, Copy, Eye, Link2, Pause, Play, Send, X } from "lucide-react";
import { Badge, Button } from "@loft/ui";
import { AGENT_LINE, type CheckQuestion, type PlanBlock } from "@loft/core";
import { useAdapter, useQuery } from "../../lib/data";
import { ADAPTER, IS_PREVIEW } from "../../lib/env";
import { useBreakpoint } from "../../lib/media";
import { runDemoAgent } from "../../lib/demoAgent";
import { ErrorState, Loading } from "../../components/bits";

export interface TaskView {
  id: string; template: string; title: string; status: string; brief: string; readyBy: string | null; minutes: number; report: string; feedback: string | null;
  question: { text: string; options: string[]; answer: string | null; at: string } | null;
  seat: { id: string; name: string } | null; session: { id: string; title: string; startsAt: string } | null; space: { id: string; name: string; slug: string; code: string } | null;
  roomId: string | null; pending: number; drafts: number; sub: string;
}
interface AgentsData {
  scopes: { scope: string; scopeId: string | null; label: string }[];
  links: { id: string; scope: string; scopeId: string | null; label: string; token: string; expiresAt: string; paused: boolean; liveEdits: boolean }[];
  seats: { id: string; name: string; runtime: string; version: string; seatNo: number; status: string; linkLabel: string; state: string; lastSeenAt: string; minutesWeek: number }[];
  working: (TaskView & { doneToday: number; totalToday: number })[];
  needsYou: TaskView[];
  ready: { count: number; tasks: TaskView[] };
  queued: number;
  activity: { at: string; text: string }[];
  builtIn: string[];
  paused: boolean;
}

/** Where an agent fetches the link. Production: the PHP server; the Pages preview has no server. */
export function agentUrl(token: string) {
  if (ADAPTER === "http") return `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/a/${token}`;
  return `https://tanziro.com/spaces/a/${token}`;
}
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m} m` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} m` : `${min} m`);

function CopyBtn({ text, label = "Copy", dark = false }: { text: string; label?: string; dark?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <Button size="sm" variant={dark ? "dark" : "secondary"} icon={<Copy aria-hidden="true" />} onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* clipboard blocked */ } }}>{done ? "Copied" : label}</Button>
  );
}

/** Figma 06 · A1 "Agents" (desktop + phone). */
export function AgentsPage() {
  const adapter = useAdapter();
  const nav = useNavigate();
  const phone = useBreakpoint() === "phone";
  const [params] = useSearchParams();
  const { data, error, reload } = useQuery<AgentsData>("agents");
  const [scopeKey, setScopeKey] = useState<string>(params.get("scope") ?? "");
  const [demo, setDemo] = useState<{ steps: string[]; running: boolean } | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  if (error) return <ErrorState what="Agents" onRetry={reload} />;
  if (!data) return <Loading label="Loading Agents" />;
  const scopes = data.scopes;
  const key = scopeKey || (data.links.find((l) => l.scope === "space") ? `space:${data.links.find((l) => l.scope === "space")!.scopeId}` : "workspace:");
  const [scope, scopeId] = key.split(":") as [string, string];
  const link = data.links.find((l) => l.scope === scope && (l.scopeId ?? "") === (scopeId ?? ""));
  const pickScope = async (k: string) => {
    setScopeKey(k);
    const [s, id] = k.split(":");
    if (!data.links.some((l) => l.scope === s && (l.scopeId ?? "") === (id ?? ""))) await adapter.mutate("agents/links", { scope: s, scopeId: id || null });
  };
  const runDemo = async () => {
    const token = (data.links.find((l) => l.scope === "space") ?? link)?.token;
    if (!token) return;
    setDemo({ steps: ["starting the demo agent"], running: true });
    const r = await runDemoAgent(adapter, token, (s) => setDemo((d) => ({ steps: [...(d?.steps ?? []), s], running: true })));
    setDemo((d) => ({ steps: [...(d?.steps ?? []), ...(r.done ? [] : [r.error ?? "stopped"])], running: false }));
  };
  const answer = async (t: TaskView, a: string) => {
    await adapter.mutate(`prep/${t.id}/answer`, { answer: a });
    setReply({ ...reply, [t.id]: "" });
  };
  return (
    <div className="money-page">
      <header className="money-top">
        {phone && <button type="button" className="lf-icon-btn" onClick={() => nav(-1)} aria-label="Back"><ChevronLeft aria-hidden="true" /></button>}
        <h1>Agents</h1>
        <span className="money-top__spacer" />
        <Link className="lf-btn lf-btn--secondary" to={`/agents/read${link ? `?link=${link.id}` : ""}`}><Eye aria-hidden="true" />{phone ? "Reads" : "What agents read"}</Link>
      </header>
      <div className="money-body">
        <div className="money-grid ag-grid">
          <section className="money-col">
            <section className="card-box ag-hand">
              <h2>Hand the prep to an agent</h2>
              <p className="muted-note" style={{ padding: 0 }}>One link for the whole workspace, one space or one room. It works through your prep tasks top to bottom and asks you when it's stuck.</p>
              <div className="ag-step"><span className="eyebrow-mono">1 · Give it this link</span>
                <select className="field month-pick" value={key} onChange={(e) => void pickScope(e.target.value)} aria-label="Link scope">
                  {scopes.map((s) => <option key={`${s.scope}:${s.scopeId ?? ""}`} value={`${s.scope}:${s.scopeId ?? ""}`}>{s.label}</option>)}
                </select>
              </div>
              <div className="ag-box"><Link2 aria-hidden="true" /><code>{link ? agentUrl(link.token).replace(/^https?:\/\//, "").replace(/(a\/.{4}).+(.{2})$/, "$1…$2") : "Creating a link…"}</code>{link && <CopyBtn text={agentUrl(link.token)} label="Copy link" dark />}</div>
              <span className="eyebrow-mono">2 · And this one line</span>
              <div className="ag-box ag-box--line"><code>{AGENT_LINE}</code><CopyBtn text={AGENT_LINE} /></div>
              <div className="ag-meta">
                <span>drafts only · can't send, invite or charge · asks, then moves on{link ? ` · expires ${new Date(link.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span>
                {link && <button type="button" className="link" onClick={() => void adapter.mutate(`agents/links/${link.id}`, { rotate: true })}>New link</button>}
              </div>
              {IS_PREVIEW && <p className="banner-box banner-box--muted">Preview: there's no server here, so real agents can't reach this link yet (the PHP server serves it in M10). "Run the demo agent" uses the same endpoints from this browser.</p>}
            </section>
            {data.working.map((w) => (
              <div key={w.id} className="inv-row ag-row card-like">
                <span className="ag-ic" aria-hidden="true"><Bot /></span>
                <span className="inv-row__main"><b>{w.seat?.name ?? "agent"} · {w.title.toLowerCase().startsWith("board") ? "building the board" : w.title}{w.session ? ` for ${w.session.title}` : ""}</b><small>{w.doneToday} of {Math.max(w.totalToday, w.doneToday + 1)} tasks done today · {w.minutes} min</small></span>
                <Badge status="info">Working</Badge>
                <Button size="sm" variant="secondary" icon={data.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />} onClick={() => void adapter.mutate("agents/pause", { paused: !data.paused })}>{data.paused ? "Resume" : "Pause"}</Button>
              </div>
            ))}
            {data.paused && <p className="banner-box banner-box--warn"><Pause aria-hidden="true" />Agents are paused. They stop at their next request and pick up again when you resume.</p>}
            {data.needsYou.length > 0 && <span className="eyebrow-mono">Needs you · {data.needsYou.length}</span>}
            {data.needsYou.map((t) => (
              <section key={t.id} className="ag-ask">
                <div className="ag-ask__head"><span className="ag-ic ag-ic--warm" aria-hidden="true"><Bot /></span><b>{t.seat?.name ?? "agent"} · {t.title}</b><span className="ag-ask__moved">moved on to the next task</span></div>
                <p>{t.question?.text}</p>
                <div className="ag-ask__opts">
                  {t.question?.options.map((o) => <button key={o} type="button" className="chip-pill" onClick={() => void answer(t, o)}>{o}</button>)}
                  <input className="field" placeholder="reply…" value={reply[t.id] ?? ""} onChange={(e) => setReply({ ...reply, [t.id]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && reply[t.id]?.trim() && void answer(t, reply[t.id]!)} aria-label={`Reply to ${t.seat?.name ?? "the agent"}`} />
                </div>
              </section>
            ))}
            {data.ready.count > 0 && (
              <div className="ag-ready">
                <CircleCheck aria-hidden="true" />
                <span><b>{data.ready.count} draft{data.ready.count === 1 ? "" : "s"} ready for you</b><small>{data.ready.tasks.map((t) => t.title).join(" · ")}</small></span>
                <Link className="lf-btn lf-btn--primary lf-btn--sm" to={`/agents/review/${data.ready.tasks[0]!.id}`}><Eye aria-hidden="true" />Review</Link>
              </div>
            )}
            {IS_PREVIEW && (
              <section className="card-box">
                <div className="card-box__head"><h3>Run the demo agent</h3><Button size="sm" icon={<Play aria-hidden="true" />} onClick={() => void runDemo()} disabled={!!demo?.running}>{demo?.running ? "Running…" : "Run"}</Button></div>
                <p className="muted-note" style={{ padding: 0 }}>A scripted agent claims the next task on the {data.links.find((l) => l.scope === "space")?.label ?? "space"} link, reads the context and leaves drafts for you to review.</p>
                {demo && <ul className="act-list" role="log" aria-live="polite">{demo.steps.map((d, i) => <li key={i}><Bot aria-hidden="true" /><span>{d}</span></li>)}</ul>}
              </section>
            )}
            <section className="card-box">
              <div className="card-box__head"><h3>Built in: agents learn this from the link itself</h3><Link className="link" to="/agents/read">see what agents read <ArrowRight aria-hidden="true" style={{ width: 14, height: 14, verticalAlign: "-2px" }} /></Link></div>
              <div className="chips">{data.builtIn.map((b) => <span key={b} className="chip-pill">{b}</span>)}</div>
            </section>
          </section>
          <aside className="money-col">
            <section className="card-box">
              <h2>Who is on your links</h2>
              <p className="muted-note" style={{ padding: 0 }}>Each agent gets its own seat the first time it connects. Name and runtime are detected; rename or revoke any time.</p>
              {data.seats.length === 0 && <p className="muted-note">No agents yet.</p>}
              {data.seats.map((s) => (
                <div key={s.id} className="ag-seat">
                  <div className="ag-seat__top"><span className="ag-ic" aria-hidden="true"><Bot /></span><span><b>{s.name}</b><small>{s.runtime}{s.version ? ` ${s.version}` : ""} · seat {s.seatNo}</small></span></div>
                  <div className="ag-seat__foot">
                    <span>{s.linkLabel} · {s.state}{s.status === "approved" ? ` · ${ago(s.lastSeenAt)}` : " · approve?"}</span>
                    {s.status === "pending" ? <Button size="sm" onClick={() => void adapter.mutate(`agents/seats/${s.id}`, { action: "approve" })}>Approve</Button> : <button type="button" className="link danger-link" onClick={() => void adapter.mutate(`agents/seats/${s.id}`, { action: "revoke" })}>revoke</button>}
                  </div>
                </div>
              ))}
            </section>
            <section className="card-box">
              <h2>Agent time this week</h2>
              {data.seats.filter((s) => s.minutesWeek > 0).map((s) => {
                const max = Math.max(...data.seats.map((x) => x.minutesWeek), 1);
                return <div key={s.id} className="ag-time"><span>{s.name}</span><span className="bar" aria-hidden="true"><i style={{ width: `${(s.minutesWeek / max) * 100}%` }} /></span><span className="mono">{hm(s.minutesWeek)}</span></div>;
              })}
              <p className="money-foot">Recorded separately from yours; never billed to clients.</p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

// ---------- A6 · What agents read ----------

export function AgentsReadPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [fmt, setFmt] = useState<"md" | "json">("md");
  const { data } = useQuery<{ markdown: string; json: unknown; label: string }>("agents/read", params.get("link") ? { link: params.get("link") } : {});
  return (
    <div className="money-page">
      <header className="money-top">
        <button type="button" className="lf-icon-btn" onClick={() => nav(-1)} aria-label="Back"><ChevronLeft aria-hidden="true" /></button>
        <h1 className="ag-read-title"><Eye aria-hidden="true" /> This is exactly what your agent reads</h1>
        <span className="money-top__spacer" />
        <div className="seg" role="radiogroup" aria-label="Format">
          <button type="button" role="radio" aria-checked={fmt === "md"} className={fmt === "md" ? "is-on" : ""} onClick={() => setFmt("md")}>next.md</button>
          <button type="button" role="radio" aria-checked={fmt === "json"} className={fmt === "json" ? "is-on" : ""} onClick={() => setFmt("json")}>next.json</button>
        </div>
      </header>
      <div className="money-body ag-read">
        {data ? <pre className="ag-pre" tabIndex={0} aria-label={fmt === "md" ? "next.md" : "next.json"}>{fmt === "md" ? data.markdown : JSON.stringify(data.json, null, 2)}</pre> : <div className="skeleton skeleton--hero" />}
        <p className="money-foot" style={{ textAlign: "center" }}>Plain Markdown and JSON over HTTPS. Any agent that can fetch a URL can use it: Claude Code, Codex, or your own script.</p>
      </div>
    </div>
  );
}

// ---------- A5 · Ready for you · review ----------

interface ReviewData { task: TaskView; drafts: { id: string; kind: string; title: string; sub: string; status: string; reason: string | null; payload: Record<string, unknown> }[] }

export function ReviewPage() {
  const { taskId = "" } = useParams();
  const adapter = useAdapter();
  const { data, error, reload } = useQuery<ReviewData>(`prep/${taskId}/review`);
  const [checked, setChecked] = useState<Set<string> | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [changes, setChanges] = useState("");
  const [note, setNote] = useState<string | null>(null);
  if (error) return <ErrorState what="these drafts" onRetry={reload} />;
  if (!data) return <Loading label="Loading drafts" />;
  const pending = data.drafts.filter((d) => d.status === "pending");
  const picked = checked ?? new Set(pending.filter((d) => d.kind !== "post").map((d) => d.id));
  const current = data.drafts.find((d) => d.id === sel) ?? pending[0] ?? data.drafts[0];
  const decide = async (accept: string[], reject: string[], reason?: string) => {
    const r = await adapter.mutate<{ accepted: number; left: number }>(`prep/${taskId}/review`, { accept, reject, reason });
    setNote(`${r.accepted ? `Accepted ${r.accepted}. ` : ""}${reject.length ? `Rejected ${reject.length}; ${data.task.seat?.name ?? "the agent"} sees why in its next read. ` : ""}${r.left ? `${r.left} left to review.` : "All done."}`);
    setChecked(null);
  };
  return (
    <div className="money-page">
      <header className="money-top">
        <h1><span className="money-top__eyebrow"><Link to="/agents">Agents</Link> · ready for you</span>{data.task.title}</h1>
        {data.task.seat && <span className="tag">by {data.task.seat.name} · {data.task.minutes} min</span>}
        <span className="money-top__spacer" />
        {pending.length > 0 && <Button variant="ghost" onClick={() => void decide([], pending.map((d) => d.id), "Not needed")}>Reject all</Button>}
        {pending.length > 0 && <Button icon={<Check aria-hidden="true" />} onClick={() => void decide(pending.map((d) => d.id), [])}>Accept all {pending.length}</Button>}
      </header>
      <div className="money-body">
        {note && <p className="banner-box banner-box--info" role="status"><Check aria-hidden="true" />{note} {data.task.space && <Link className="link" to={`/s/${data.task.space.slug}/prep`}>Back to {data.task.space.name}</Link>}</p>}
        <div className="money-grid ag-review">
          <section className="money-col">
            <div className="inv-list">
              {data.drafts.map((d) => (
                <div key={d.id} className={`inv-row${current?.id === d.id ? " is-on" : ""}`}>
                  {d.status === "pending" ? <input type="checkbox" checked={picked.has(d.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(d.id); else n.delete(d.id); setChecked(n); }} aria-label={`Include ${d.title}`} /> : <Badge status={d.status === "accepted" ? "success" : "neutral"}>{d.status === "accepted" ? "Accepted" : "Rejected"}</Badge>}
                  <button type="button" className="inv-row__main" onClick={() => setSel(d.id)}><b>{d.title}</b><small>{d.reason ? `rejected: ${d.reason}` : d.sub}</small></button>
                  <ChevronRight className="chev" aria-hidden="true" />
                </div>
              ))}
            </div>
            {pending.length > 0 && picked.size > 0 && picked.size < pending.length && <Button variant="secondary" onClick={() => void decide([...picked], [])}>Accept {picked.size} selected</Button>}
            {data.task.report && <section className="card-box"><h3>{data.task.seat?.name ?? "Agent"}'s report</h3><p>{data.task.report}</p></section>}
            <section className="card-box">
              <h3>Ask for changes</h3>
              <input className="field" value={changes} onChange={(e) => setChanges(e.target.value)} placeholder="Fill storyboard frames 1–3 from the Map stickies." aria-label="Changes to ask for" />
              <Button variant="secondary" icon={<Send aria-hidden="true" />} disabled={!changes.trim()} onClick={async () => { await adapter.mutate(`prep/${taskId}/review`, { changes }); setChanges(""); setNote(`Sent back to ${data.task.seat?.name ?? "the agent"}. It's back in the queue with your note.`); }}>Send back to {data.task.seat?.name ?? "the agent"}</Button>
            </section>
          </section>
          {current && (
            <aside className="money-col">
              <div className="preview-head">
                <span className="eyebrow-mono">Preview · {current.kind === "board_ops" ? "section" : current.kind.replace("_", " ")} · {current.title.split(" · ").pop()}</span>
                {current.status === "pending" && <span className="ag-preview-actions"><Button size="sm" icon={<Check aria-hidden="true" />} onClick={() => void decide([current.id], [])}>Accept</Button><Button size="sm" variant="ghost" icon={<X aria-hidden="true" />} onClick={() => void decide([], [current.id], "Not what I need")}>Reject</Button></span>}
              </div>
              <section className="card-box ag-preview"><DraftPreview kind={current.kind} title={current.title} payload={current.payload} /></section>
              <p className="money-foot">Accepting moves these onto the board, plan or stream everyone sees. Rejected drafts are deleted; the agent sees why in its next read.</p>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

function DraftPreview({ kind, title, payload }: { kind: string; title: string; payload: Record<string, unknown> }) {
  if (kind === "board_ops") {
    const objs = (payload.ops as { payload: { obj?: { kind: string; title?: string; text?: string } } }[]).map((o) => o.payload.obj).filter(Boolean) as { kind: string; title?: string; text?: string }[];
    const section = objs.find((o) => o.kind === "section");
    return (
      <>
        <h2>{section?.title ?? title}</h2>
        <ul className="ag-objs" role="list">{objs.filter((o) => o.kind !== "section").map((o, i) => <li key={i} className={o.kind === "sticky" ? "is-sticky" : ""}>{o.text || "(empty)"}</li>)}</ul>
      </>
    );
  }
  if (kind === "plan") {
    const blocks = (payload.blocks ?? []) as PlanBlock[];
    return <><h2>{String(payload.title ?? title)}</h2><ul className="ag-objs ag-objs--list" role="list">{blocks.map((b) => <li key={b.id}><span>{b.title}</span><span className="mono">{b.minutes} min</span></li>)}</ul></>;
  }
  if (kind === "check") {
    const qs = (payload.questions ?? []) as CheckQuestion[];
    return <><h2>{String(payload.title ?? title)}</h2><ol className="ag-qs">{qs.map((q) => <li key={q.id}>{q.prompt}</li>)}</ol></>;
  }
  if (kind === "post") return <><h2>{String(payload.title ?? title)}</h2><p>{String(payload.body ?? "")}</p></>;
  return <><h2>{title}</h2><p>{String(payload.note ?? "")}</p><p className="muted-note">Accepting drafts this month's invoices in Money. Nothing is sent.</p></>;
}
