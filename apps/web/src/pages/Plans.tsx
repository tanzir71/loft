import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowUp, CalendarPlus, ChevronDown, ChevronRight, CircleCheck, Copy, DoorOpen, Eye, Flag, History, Plus, Sparkles, TriangleAlert, Upload, X } from "lucide-react";
import { Badge, Button, Sheet } from "@loft/ui";
import { BLOCK_LABEL, BLOCK_TYPES, blocksFromPages, memberAgenda, mmss, moveBlock, newId, TEMPLATES, timeline, type BlockType, type PlanBlock, type PlanStatus } from "@loft/core";
import { useAdapter, useQuery } from "../lib/data";
import { IS_PREVIEW } from "../lib/env";
import { ErrorState, Loading, relTime, whenLabel } from "../components/bits";

interface PlanRow { id: string; title: string; minutes: number; planned: number; unit: string; status: PlanStatus; aiDraft?: boolean; tags: string[]; session: { id: string; title: string; startsAt: string } | null }
interface Library { plans: PlanRow[]; unplanned: { id: string; title: string; startsAt: string }[]; units: { unit: string; objectives: number; covered: number }[] }

const STATUS_BADGE: Record<PlanStatus, ["neutral" | "info" | "success", string]> = { draft: ["neutral", "Draft"], ready: ["info", "Ready"], taught: ["success", "Taught"] };

/** Figma 06 · P1 "Plans library": the Plans tab, hosts only. */
export function PlansTab({ spaceId }: { spaceId: string }) {
  const adapter = useAdapter();
  const nav = useNavigate();
  const { data, error, reload } = useQuery<Library>(`spaces/${spaceId}/plans`);
  const [creating, setCreating] = useState<{ sessionId?: string; template?: string } | null>(null);
  if (error) return <ErrorState what="plans" onRetry={reload} />;
  if (!data) return <p className="muted-note">Loading plans…</p>;
  const units = [...new Set(data.plans.map((p) => p.unit))];
  const reorder = async (unit: string, from: number, to: number) => {
    const ids = data.plans.filter((p) => p.unit === unit).map((p) => p.id);
    const [x] = ids.splice(from, 1);
    if (!x) return;
    ids.splice(to, 0, x);
    await adapter.mutate(`plans/${ids[0]}/reorder`, { ids });
  };
  return (
    <div className="stream">
      <div className="tab-head">
        <h2 className="tab-title">Plans</h2>
        <Button size="sm" icon={<Plus aria-hidden="true" />} onClick={() => setCreating({})}>New plan</Button>
      </div>
      {data.unplanned.map((s) => (
        <div key={s.id} className="warn-row">
          <TriangleAlert aria-hidden="true" />
          <span><b>{s.title}</b> · {whenLabel(s.startsAt)} has no plan yet</span>
          <Button size="sm" variant="soft" onClick={() => setCreating({ sessionId: s.id, template: "lesson" })}>Plan it from a template</Button>
        </div>
      ))}
      {units.map((unit) => {
        const u = data.units.find((x) => x.unit === unit);
        const list = data.plans.filter((p) => p.unit === unit);
        return (
          <section key={unit} className="unit">
            <header className="unit__head">
              <h3>{unit}</h3>
              {u && <span className="unit__bar" aria-label={`${u.covered} of ${u.objectives} objectives covered`}><i style={{ width: `${(u.covered / Math.max(1, u.objectives)) * 100}%` }} /></span>}
              {u && <small>{u.covered}/{u.objectives} covered</small>}
            </header>
            <ul className="plan-list" role="list">
              {list.map((p, i) => (
                <li key={p.id} className="plan-row">
                  <span className="plan-row__move">
                    <button type="button" className="lf-icon-btn" aria-label={`Move ${p.title} up`} disabled={i === 0} onClick={() => void reorder(unit, i, i - 1)}><ArrowUp aria-hidden="true" /></button>
                    <button type="button" className="lf-icon-btn" aria-label={`Move ${p.title} down`} disabled={i === list.length - 1} onClick={() => void reorder(unit, i, i + 1)}><ArrowDown aria-hidden="true" /></button>
                  </span>
                  <Link to={`/plans/${p.id}`} className="plan-row__main">
                    <b>{p.title}</b>
                    <small>{p.planned} of {p.minutes} min{p.session ? ` · ${p.session.title} · ${whenLabel(p.session.startsAt)}` : " · not attached"}</small>
                  </Link>
                  {p.aiDraft ? <Badge status="warning">AI draft</Badge> : <Badge status={STATUS_BADGE[p.status][0]}>{STATUS_BADGE[p.status][1]}</Badge>}
                  <ChevronRight aria-hidden="true" className="plan-row__chev" />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {data.plans.length === 0 && <p className="muted-note">No plans yet. Start from a template: lesson, workshop, sprint day, client session or retro.</p>}
      {creating && <NewPlanSheet spaceId={spaceId} preset={creating} onClose={() => setCreating(null)} onCreated={async (id, sessionId) => { if (sessionId) await adapter.mutate(`plans/${id}/attach`, { sessionId }); nav(`/plans/${id}`); }} />}
    </div>
  );
}

/** Figma 06 · P2 "New plan": one modal for every starting point. */
function NewPlanSheet({ spaceId, preset, onClose, onCreated }: { spaceId: string; preset: { sessionId?: string; template?: string }; onClose: () => void; onCreated: (id: string, sessionId?: string) => void }) {
  const adapter = useAdapter();
  const [from, setFrom] = useState<"blank" | "template" | "file">(preset.template ? "template" : "blank");
  const [template, setTemplate] = useState(preset.template ?? "lesson");
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [unit, setUnit] = useState("Unit 1");
  const [objective, setObjective] = useState("");
  const [tags, setTags] = useState("");
  const [pages, setPages] = useState<{ title?: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (from === "template") setMinutes(TEMPLATES[template]?.minutes ?? 60);
  }, [from, template]);
  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { title, minutes, unit, objective, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) };
      if (from === "template") body.from = `template:${template}`;
      if (from === "file" && pages) body.blocks = blocksFromPages(pages);
      const p = await adapter.mutate<{ id: string }>(`spaces/${spaceId}/plans`, body);
      onCreated(p.id, preset.sessionId);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose} title="New plan" actions={<div className="sheet-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void submit()} disabled={!title.trim() || busy || (from === "file" && !pages)}>Create plan</Button></div>}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2 className="sheet-title">New plan</h2>
        <div className="start-opts" role="radiogroup" aria-label="Start from">
          <button type="button" role="radio" aria-checked={from === "blank"} className={from === "blank" ? "is-on" : ""} onClick={() => setFrom("blank")}><Plus aria-hidden="true" /> Blank</button>
          <button type="button" role="radio" aria-checked={from === "template"} className={from === "template" ? "is-on" : ""} onClick={() => setFrom("template")}><CircleCheck aria-hidden="true" /> Template</button>
          <button type="button" role="radio" aria-checked={from === "file"} className={from === "file" ? "is-on" : ""} onClick={() => setFrom("file")}><Upload aria-hidden="true" /> From a file</button>
        </div>
        {IS_PREVIEW ? <p className="field-help"><Sparkles aria-hidden="true" className="inline-ic" /> Draft with AI appears when your organisation adds its own AI key (Admin → Integrations, M10).</p> : null}
        <div className="form-grid">
          {from === "template" && (
            <label className="form-wide">Template<select className="field" value={template} onChange={(e) => setTemplate(e.target.value)}>{Object.entries(TEMPLATES).map(([k, t]) => <option key={k} value={k}>{t.label} · {t.minutes} min</option>)}</select></label>
          )}
          {from === "file" && (
            <div className="form-wide">
              <Button variant="secondary" icon={<Upload aria-hidden="true" />} onClick={() => fileRef.current?.click()}>{pages ? `${pages.length} pages read` : "Choose a PDF"}</Button>
              <input ref={fileRef} type="file" accept="application/pdf" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const { renderPdf } = await import("../room/board/pdfImport");
                try {
                  const rendered = await renderPdf(f, undefined, 400);
                  setPages(rendered.map((_, i) => ({ title: `Page ${i + 1}` })));
                  if (!title) setTitle(f.name.replace(/\.pdf$/i, ""));
                } catch (x) {
                  alert(x instanceof Error ? x.message : "Couldn't read that PDF");
                }
              }} />
              <p className="field-help">Each page becomes a board page and a block.</p>
            </div>
          )}
          <label className="form-wide">Title<input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lesson 6 · Projectiles lab" maxLength={120} autoFocus /></label>
          <label>Length<select className="field" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>{[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
          <label>Unit<input className="field" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={60} /></label>
          <label className="form-wide">Objective<input className="field" value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Predict range from launch angle" maxLength={300} /></label>
          <label className="form-wide">Tags (comma separated)<input className="field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="projectiles, prediction" /></label>
        </div>
      </form>
    </Sheet>
  );
}

interface PlanFull {
  id: string; title: string; minutes: number; objective: string; tags: string[]; unit: string; status: PlanStatus; aiDraft?: boolean; version: number; updatedAt: string;
  blocks: PlanBlock[]; sessionId: string | null;
  space: { id: string; name: string; slug: string };
  sessions: { id: string; title: string; startsAt: string; minutes: number; planId: string | null }[];
  versions: { version: number; at: string }[];
}

const TYPE_CLASS: Record<BlockType, string> = { talk: "bt-talk", board: "bt-board", activity: "bt-activity", check: "bt-check", break: "bt-break", handout: "bt-handout" };

/** Figma 06 · P3 "Edit blocks": the timeline is the plan. Autosaves (800 ms). */
export function PlanEditor() {
  const { id = "" } = useParams();
  const adapter = useAdapter();
  const navTo = useNavigate();
  const { data, error, reload } = useQuery<PlanFull>(`plans/${id}`);
  const [blocks, setBlocks] = useState<PlanBlock[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [attach, setAttach] = useState(false);
  const [preview, setPreview] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (data && (!blocks || data.id !== id)) setBlocks(data.blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.id]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  if (error) return <ErrorState what="this plan" onRetry={reload} />;
  if (!data || !blocks) return <Loading label="Loading plan" />;

  const save = (next: PlanBlock[]) => {
    setBlocks(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await adapter.mutate(`plans/${id}`, { blocks: next });
      setSaved(Date.now());
    }, 800);
  };
  const patch = (bid: string, p: Partial<PlanBlock>) => save(blocks.map((b) => (b.id === bid ? { ...b, ...p } : b)));
  const tl = timeline(blocks, data.minutes);
  const starts = tl.segments.filter((x) => x.type !== "free" && x.type !== "over").map((x) => x.start);

  return (
    <div className="page plan-page">
      <header className="plan-top">
        <div className="plan-top__title">
          <span className="eyebrow-mono">{data.space.slug} · plans</span>
          <h1>{data.title} {data.aiDraft ? <Badge status="warning">AI draft</Badge> : <Badge status={STATUS_BADGE[data.status][0]}>{STATUS_BADGE[data.status][1]}</Badge>}</h1>
        </div>
        <span className="muted-note">{saved ? `Saved · ${relTime(new Date(saved).toISOString())}` : `Saved · ${relTime(data.updatedAt)}`}</span>
        <Button variant="secondary" icon={<Eye aria-hidden="true" />} onClick={() => setPreview(true)}>Preview as member</Button>
        {data.sessionId && <Button variant="secondary" icon={<DoorOpen aria-hidden="true" />} onClick={async () => { const r = await adapter.mutate<{ code: string }>(`sessions/${data.sessionId}/room`); navTo(`/r/${r.code}`); }}>Open room</Button>}
        <Button icon={<CalendarPlus aria-hidden="true" />} onClick={() => setAttach(true)}>{data.sessionId ? "Attached" : "Attach to session"}</Button>
      </header>
      <div className="plan-grid">
        <div className="plan-main">
          <div className="chips">
            <span className="chip-pill">{data.minutes} min</span>
            <span className="chip-pill">{data.unit}</span>
            {data.objective && <span className="chip-pill">Objective: {data.objective}</span>}
          </div>
          <div className="tl" aria-label={`${tl.planned} of ${data.minutes} minutes planned`}>
            {tl.segments.map((s) => (
              <span key={s.id} className={`tl__seg ${s.type === "free" ? "tl__seg--free" : s.type === "over" ? "tl__seg--over" : TYPE_CLASS[s.type as BlockType]}`} style={{ flexGrow: s.minutes }} title={`${s.type} · ${s.minutes} min`} />
            ))}
          </div>
          <div className="tl-meta">
            <span>{tl.planned} of {data.minutes} min planned</span>
            {tl.free > 0 && <span className="warn">{tl.free} min free at the end</span>}
            {tl.over > 0 && <span className="danger">{tl.over} min over</span>}
            <span className="tl-legend">{BLOCK_TYPES.map((t) => <span key={t}><i className={TYPE_CLASS[t]} />{BLOCK_LABEL[t]}</span>)}</span>
          </div>
          <ol className="blocks" role="list">
            {blocks.map((b, i) => {
              const at = starts[i] ?? 0;
              const isOpen = open === b.id;
              return (
                <li key={b.id} className={`block${isOpen ? " is-open" : ""}`}>
                  <div className="block__row" onClick={() => setOpen(isOpen ? null : b.id)} onKeyDown={(e) => {
                    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                      e.preventDefault();
                      save(moveBlock(blocks, i, i + (e.key === "ArrowUp" ? -1 : 1)));
                    }
                  }} tabIndex={0} role="button" aria-expanded={isOpen} aria-label={`${b.title}, ${b.minutes} minutes. Alt and arrow keys reorder.`}>
                    <span className="block__time mono">{mmss(at)}</span>
                    <i className={`block__dot ${TYPE_CLASS[b.type]}`} aria-hidden="true" />
                    <b>{b.title || "Untitled block"}</b>
                    <span className="block__text">{b.memberText}</span>
                    <span className="mono block__min">{b.minutes}′</span>
                    {isOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                  </div>
                  {isOpen && (
                    <div className="block__edit">
                      <div className="block__fields">
                        <label>Title<input className="field" value={b.title} onChange={(e) => patch(b.id, { title: e.target.value })} maxLength={120} /></label>
                        <div className="block__type">
                          <span className="field-label">Type</span>
                          <div className="seg" role="radiogroup" aria-label="Block type">
                            {BLOCK_TYPES.map((t) => <button key={t} type="button" role="radio" aria-checked={b.type === t} className={b.type === t ? "is-on" : ""} onClick={() => patch(b.id, { type: t })}>{BLOCK_LABEL[t]}</button>)}
                          </div>
                        </div>
                        <div>
                          <span className="field-label">Minutes</span>
                          <div className="stepper">
                            <button type="button" aria-label="Fewer minutes" onClick={() => patch(b.id, { minutes: Math.max(1, b.minutes - 5) })}>−</button>
                            <span className="mono">{b.minutes}</span>
                            <button type="button" aria-label="More minutes" onClick={() => patch(b.id, { minutes: Math.min(240, b.minutes + 5) })}>+</button>
                          </div>
                        </div>
                      </div>
                      <div className="block__texts">
                        <label>What members see<textarea className="field field--area" rows={2} value={b.memberText} onChange={(e) => patch(b.id, { memberText: e.target.value })} /></label>
                        <label>Host notes · only you<textarea className="field field--area" rows={2} value={b.hostNotes} onChange={(e) => patch(b.id, { hostNotes: e.target.value })} /></label>
                      </div>
                      <div className="block__res">
                        <span className="field-label">Resources</span>
                        {b.resources.map((r, k) => <span key={k} className="res-chip">{r.label}<button type="button" aria-label={`Remove ${r.label}`} onClick={() => patch(b.id, { resources: b.resources.filter((_, j) => j !== k) })}><X aria-hidden="true" /></button></span>)}
                        {(["file", "poll", "link", "timer"] as const).map((k) => (
                          <button key={k} type="button" className="res-add" onClick={() => { const label = prompt(`${k[0]!.toUpperCase()}${k.slice(1)} name`); if (label) patch(b.id, { resources: [...b.resources, { kind: k, label }] }); }}>+ {k[0]!.toUpperCase()}{k.slice(1)}</button>
                        ))}
                        <label className="mini-toggle block__vis">
                          <input type="checkbox" role="switch" checked={b.visible} onChange={(e) => patch(b.id, { visible: e.target.checked })} />
                          <span className="switch" aria-hidden="true" />
                          <span className="mini-toggle__text"><b>Members see this block</b></span>
                        </label>
                      </div>
                      <div className="block__tools">
                        <button type="button" className="lf-icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => save(moveBlock(blocks, i, i - 1))}><ArrowUp aria-hidden="true" /></button>
                        <button type="button" className="lf-icon-btn" aria-label="Move down" disabled={i === blocks.length - 1} onClick={() => save(moveBlock(blocks, i, i + 1))}><ArrowDown aria-hidden="true" /></button>
                        <button type="button" className="lf-icon-btn" aria-label="Duplicate block" onClick={() => save([...blocks.slice(0, i + 1), { ...b, id: newId("b") }, ...blocks.slice(i + 1)])}><Copy aria-hidden="true" /></button>
                        <button type="button" className="lf-icon-btn" aria-label="Delete block" onClick={() => save(blocks.filter((x) => x.id !== b.id))}><X aria-hidden="true" /></button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          <button type="button" className="add-block" onClick={() => { const nb: PlanBlock = { id: newId("b"), title: "New block", type: "talk", minutes: 5, memberText: "", hostNotes: "", resources: [], visible: true }; save([...blocks, nb]); setOpen(nb.id); }}>
            <Plus aria-hidden="true" /> Add block <small>Alt + ↑/↓ reorders · times recalculate</small>
          </button>
        </div>
        <aside className="plan-rail">
          <section className="rail-card">
            <h2>Objectives</h2>
            <ul className="obj-list" role="list">{data.tags.map((t) => <li key={t}><Flag aria-hidden="true" /> {t}</li>)}</ul>
            {data.tags.length === 0 && <p className="muted-note">Add tags on the plan to track coverage.</p>}
          </section>
          <section className="rail-card">
            <h2>Materials</h2>
            <ul className="obj-list" role="list">{blocks.flatMap((b) => b.resources.map((r, k) => <li key={`${b.id}${k}`}><CircleCheck aria-hidden="true" /> {r.label}</li>))}</ul>
            {blocks.every((b) => !b.resources.length) && <p className="muted-note">Resources you add to blocks show here.</p>}
          </section>
          <section className="rail-card">
            <h2><History aria-hidden="true" className="inline-ic" /> History</h2>
            <p className="muted-note">v{data.version} · {data.versions.length} saved versions</p>
            <ul className="obj-list" role="list">
              {data.versions.slice(1, 5).map((v) => (
                <li key={v.version}>v{v.version} · {relTime(v.at)} <button type="button" className="link-action" onClick={async () => { await adapter.mutate(`plans/${id}/restore`, { version: v.version }); setBlocks(null); reload(); }}>Restore</button></li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
      {preview && (
        <Sheet open onClose={() => setPreview(false)} title="Preview as member">
          <h2 className="sheet-title">Agenda · what members see</h2>
          <ol className="agenda-preview" role="list">{memberAgenda(blocks).map((a, i) => <li key={i}><span className="mono">{a.time}</span><span><b>{a.title}</b>{a.text && <small>{a.text}</small>}</span></li>)}</ol>
          <p className="field-help">Host notes and hidden blocks never appear here.</p>
        </Sheet>
      )}
      {attach && <AttachSheet plan={data} onClose={() => setAttach(false)} onDone={() => { setAttach(false); reload(); }} />}
    </div>
  );
}

/** Figma 06 · P4 "Attach & prepare". */
function AttachSheet({ plan, onClose, onDone }: { plan: PlanFull; onClose: () => void; onDone: () => void }) {
  const adapter = useAdapter();
  const [sessionId, setSessionId] = useState(plan.sessionId ?? plan.sessions.find((s) => !s.planId)?.id ?? "");
  const [result, setResult] = useState<{ prepared: { pages?: Record<string, string>; agendaPostId?: string } } | null>(null);
  const boards = plan.blocks.filter((b) => b.type === "board" || b.type === "handout").length;
  return (
    <Sheet open onClose={onClose} title="Attach to a session" actions={<div className="sheet-actions">{plan.sessionId && <Button variant="ghost" onClick={async () => { await adapter.mutate(`plans/${plan.id}/detach`); onDone(); }}>Detach</Button>}<Button variant="ghost" onClick={onClose}>Close</Button>{!result && <Button disabled={!sessionId} onClick={async () => setResult(await adapter.mutate(`plans/${plan.id}/attach`, { sessionId }))}>Attach & prepare</Button>}</div>}>
      <h2 className="sheet-title">Attach to a session</h2>
      {result ? (
        <div className="prepared">
          <p className="ok-note">Ready. Everything below was created from the blocks:</p>
          <ul role="list">
            <li><CircleCheck aria-hidden="true" /> {Object.keys(result.prepared.pages ?? {}).length} board page{Object.keys(result.prepared.pages ?? {}).length === 1 ? "" : "s"} in the session's room</li>
            <li><CircleCheck aria-hidden="true" /> Agenda posted to the stream 1 hour before</li>
            <li><CircleCheck aria-hidden="true" /> Reminder 24 hours before (in-app; email with the server)</li>
          </ul>
        </div>
      ) : (
        <>
          <p className="muted-note">Attaching creates {boards} board page{boards === 1 ? "" : "s"}, the posted agenda and reminders. Re-attaching updates them instead of duplicating.</p>
          <ul className="attach-list" role="list">
            {plan.sessions.map((s) => {
              const taken = !!s.planId && s.planId !== plan.id;
              return (
                <li key={s.id}>
                  <label className={taken ? "is-disabled" : ""}>
                    <input type="radio" name="attach" disabled={taken} checked={sessionId === s.id} onChange={() => setSessionId(s.id)} />
                    <span><b>{s.title}</b><small>{whenLabel(s.startsAt)} · {s.minutes} min{taken ? " · already has a plan" : ""}</small></span>
                  </label>
                </li>
              );
            })}
          </ul>
          {plan.sessions.length === 0 && <p className="muted-note">No upcoming sessions in this space. Add one in the calendar.</p>}
        </>
      )}
    </Sheet>
  );
}
