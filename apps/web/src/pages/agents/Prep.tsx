import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bot, Calendar, CheckSquare, Clock, Eye, FileText, LayoutGrid, Link2, MessageSquare, Plus, Receipt } from "lucide-react";
import { Badge, Button, Sheet } from "@loft/ui";
import type { PrepTemplate } from "@loft/core";
import { useAdapter, useQuery } from "../../lib/data";
import { ErrorState, Loading } from "../../components/bits";
import type { TaskView } from "./Agents";

interface PrepData {
  next: { id: string; title: string; startsAt: string; done: number; total: number } | null;
  ready: TaskView[]; working: TaskView[]; needsYou: TaskView[]; queued: TaskView[]; done: TaskView[];
  templates: { id: PrepTemplate; label: string; chip: string; output: string[]; blurb: string }[];
  link: { id: string; scope: string; token: string; liveEdits: boolean; paused: boolean } | null;
  seats: { id: string; name: string; state: string; seatNo: number }[];
  sessions: { id: string; title: string; startsAt: string }[];
}
const ICON: Record<PrepTemplate, typeof FileText> = { agenda: FileText, board_brief: LayoutGrid, check: CheckSquare, recap: FileText, client_agenda: MessageSquare, invoice_drafts: Receipt };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Figma 06 · A2 "Prep queue in a space" (hosts). */
export function PrepTab({ spaceId, slug }: { spaceId: string; slug: string }) {
  const adapter = useAdapter();
  const nav = useNavigate();
  const { data, error, reload } = useQuery<PrepData>(`spaces/${spaceId}/prep`);
  const [creating, setCreating] = useState<PrepTemplate | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  if (error) return <ErrorState what="the prep queue" onRetry={reload} />;
  if (!data) return <Loading label="Loading prep" />;
  const row = (t: TaskView, right: ReactNode) => {
    const Ic = ICON[t.template as PrepTemplate] ?? Bot;
    return (
      <div key={t.id} className="inv-row">
        <span className={`ag-ic${t.seat?.name.startsWith("claude") ? " ag-ic--warm" : ""}${t.status === "queued" ? " ag-ic--muted" : ""}`} aria-hidden="true">{t.status === "queued" ? <Clock /> : <Ic />}</span>
        <span className="inv-row__main"><b>{t.title}</b><small>{t.sub || t.brief}</small></span>
        {right}
      </div>
    );
  };
  return (
    <div className="money-col">
      <div className="sec-head">
        <h2>Prep</h2>
        <span className="sec-head__spacer" />
        <Link className="lf-btn lf-btn--secondary lf-btn--sm" to={`/agents?scope=space:${spaceId}`}><Link2 aria-hidden="true" />Agent link</Link>
        <Button size="sm" icon={<Bot aria-hidden="true" />} onClick={() => setCreating("board_brief")}>New prep task</Button>
      </div>
      <div className="money-grid money-grid--wide">
        <section className="money-col">
          {data.next && (
            <p className="banner-box banner-box--info ag-next"><Calendar aria-hidden="true" /><span className="ag-next__text">Next session: {data.next.title} · {when(data.next.startsAt)}{data.next.total ? ` · ${data.next.done} of ${data.next.total} prep tasks done` : ""}</span>{data.next.total > 0 && <Badge status={data.next.done === data.next.total ? "success" : "info"}>{data.next.done === data.next.total ? "Ready" : data.next.done >= data.next.total - 1 ? "Almost ready" : "In prep"}</Badge>}</p>
          )}
          {data.ready.length > 0 && <><span className="eyebrow-mono">Ready for you · {data.ready.length}</span><div className="inv-list">{data.ready.map((t) => row(t, <><Badge status="success">Ready</Badge><Link className="lf-btn lf-btn--primary lf-btn--sm" to={`/agents/review/${t.id}`}>Review</Link></>))}</div></>}
          {data.working.length > 0 && <><span className="eyebrow-mono">In progress · {data.working.length}</span><div className="inv-list">{data.working.map((t) => row(t, <><Badge status="info">Working</Badge>{t.roomId && t.session && <Button size="sm" variant="secondary" icon={<Eye aria-hidden="true" />} onClick={async () => { const r = await adapter.mutate<{ code: string }>(`sessions/${t.session!.id}/room`); nav(`/r/${r.code}`); }}>Watch</Button>}</>))}</div></>}
          {data.needsYou.length > 0 && <><span className="eyebrow-mono">Needs you · {data.needsYou.length}</span><div className="inv-list">{data.needsYou.map((t) => (
            <div key={t.id} className="inv-row ag-need">
              <span className="ag-ic ag-ic--warm" aria-hidden="true"><Bot /></span>
              <span className="inv-row__main"><b>{t.title}</b><small>{t.question?.text}</small></span>
              <Badge status="warning">Needs you</Badge>
              <span className="ag-answer">
                {t.question?.options.map((o) => <button key={o} type="button" className="chip-pill" onClick={() => void adapter.mutate(`prep/${t.id}/answer`, { answer: o })}>{o}</button>)}
                <input className="field" placeholder="Answer" value={answers[t.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [t.id]: e.target.value })} aria-label={`Answer ${t.seat?.name ?? "the agent"}`} />
                <Button size="sm" variant="secondary" disabled={!answers[t.id]?.trim()} onClick={() => void adapter.mutate(`prep/${t.id}/answer`, { answer: answers[t.id] })}>Answer</Button>
              </span>
            </div>
          ))}</div></>}
          {data.queued.length > 0 && <><span className="eyebrow-mono">Queued · {data.queued.length}</span><div className="inv-list">{data.queued.map((t) => row(t, <Badge status="neutral">{t.status === "changes" ? "Changes asked" : "Queued"}</Badge>))}</div></>}
          {!data.ready.length && !data.working.length && !data.needsYou.length && !data.queued.length && (
            <section className="empty"><h2 className="empty__title">Nothing in prep</h2><p className="empty__lead">Queue an agenda, a board from a brief, a quick check or a recap. An agent on this space's link picks it up and leaves drafts for you.</p></section>
          )}
        </section>
        <aside className="money-col">
          <section className="card-box">
            <h2>Prep templates</h2>
            <ul className="more-list" role="list">
              {data.templates.map((t) => { const Ic = ICON[t.id]; return <li key={t.id}><button type="button" onClick={() => setCreating(t.id)}><Ic aria-hidden="true" /><span style={{ flex: 1 }}>{t.label}</span><Plus aria-hidden="true" /></button></li>; })}
            </ul>
          </section>
          <section className="card-box">
            <h2>On this space's link</h2>
            {data.seats.length === 0 ? <p className="muted-note" style={{ padding: 0 }}>No agent yet. Give one the <Link className="link" to={`/agents?scope=space:${spaceId}`}>agent link</Link>.</p> : data.seats.map((s) => <div key={s.id} className="ag-onlink"><span className="ag-ic" aria-hidden="true"><Bot /></span><b>{s.name}</b><small>{s.state} · seat {s.seatNo}</small></div>)}
            {data.link && <label className="switch-row">Let agents edit during live sessions<span className="sw"><input type="checkbox" checked={data.link.liveEdits} onChange={(e) => void adapter.mutate(`agents/links/${data.link!.id}`, { liveEdits: e.target.checked })} aria-label="Let agents edit during live sessions" /><i /></span></label>}
          </section>
        </aside>
      </div>
      {creating && <NewPrepSheet spaceId={spaceId} slug={slug} data={data} template={creating} onClose={() => setCreating(null)} />}
    </div>
  );
}

function NewPrepSheet({ spaceId, data, template, onClose }: { spaceId: string; slug: string; data: PrepData; template: PrepTemplate; onClose: () => void }) {
  const adapter = useAdapter();
  const { data: files } = useQuery<{ id: string; name: string }[]>(`spaces/${spaceId}/files`);
  const [tpl, setTpl] = useState<PrepTemplate>(template);
  const [sessionId, setSessionId] = useState(data.next?.id ?? data.sessions[0]?.id ?? "");
  const [brief, setBrief] = useState("");
  const [attach, setAttach] = useState<string[]>([]);
  const [readyBy, setReadyBy] = useState("");
  const [who, setWho] = useState("");
  const [post, setPost] = useState(false);
  const t = data.templates.find((x) => x.id === tpl)!;
  const queue = async () => {
    await adapter.mutate(`spaces/${spaceId}/prep`, { template: tpl, sessionId: sessionId || undefined, brief, attachments: attach, readyBy: readyBy ? new Date(readyBy).toISOString() : undefined, who: who || undefined, post });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title="New prep task" actions={<div className="sheet-actions"><span className="muted-note" style={{ flex: 1 }}>Agents only create drafts. Nothing reaches your group until you accept it.</span><Button variant="ghost" onClick={onClose}>Cancel</Button><Button icon={<Bot aria-hidden="true" />} onClick={() => void queue()}>Queue task</Button></div>}>
      <h2 className="sheet-title">New prep task</h2>
      <p className="muted-note" style={{ padding: 0 }}>An agent on this space's link will pick it up</p>
      <span className="form-col">What should it prepare?</span>
      <div className="chips" role="radiogroup" aria-label="What should it prepare?">
        {data.templates.map((x) => <button key={x.id} type="button" role="radio" aria-checked={tpl === x.id} className={`filter-chip${tpl === x.id ? " is-on" : ""}`} onClick={() => setTpl(x.id)}>{x.chip}</button>)}
      </div>
      <label className="form-col">For
        <select className="field" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
          <option value="">No session</option>
          {data.sessions.map((s) => <option key={s.id} value={s.id}>{s.title} · {when(s.startsAt)}</option>)}
        </select>
      </label>
      <label className="form-col">Brief<textarea className="textarea" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={tpl === "board_brief" ? "Three sections: Map (customer journey), Decide (price options with dot voting), Storyboard (6 frames)." : tpl === "check" ? "5 questions on pricing basics, multiple choice." : "What should it cover?"} /></label>
      {files && files.length > 0 && (
        <div className="form-col">Attach
          <div className="chips">{files.slice(0, 8).map((f) => <button key={f.id} type="button" className={`filter-chip${attach.includes(f.name) ? " is-on" : ""}`} aria-pressed={attach.includes(f.name)} onClick={() => setAttach(attach.includes(f.name) ? attach.filter((x) => x !== f.name) : [...attach, f.name])}>{f.name}</button>)}</div>
        </div>
      )}
      <div className="form-pair">
        <label className="form-col">Ready by<input className="field" type="datetime-local" value={readyBy} onChange={(e) => setReadyBy(e.target.value)} /></label>
        <label className="form-col">Who<select className="field" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Any agent on the link</option>{data.seats.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      <div className="form-col">Output
        <div className="model-opt" aria-readonly="true"><b>{t.output.includes("board_ops") ? "Draft board pages in the room" : t.output.includes("plan") ? "Draft a plan for the session" : t.output.includes("check") ? "Draft a quick check" : t.output.includes("invoice_draft") ? "Draft invoices (never sends)" : "Draft a stream post"}</b><small>{t.output.includes("board_ops") ? "dashed draft layer until you accept" : "a draft until you accept it"}</small></div>
        {!t.output.every((o) => o === "post") && <label className="check-row"><input type="checkbox" checked={post} onChange={(e) => setPost(e.target.checked)} /> Also draft a stream post, so members know what to expect</label>}
      </div>
    </Sheet>
  );
}
