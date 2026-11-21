import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, Download, Eye, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Badge, Button } from "@loft/ui";
import { cellText, toCsv, validateQuestion, type CheckQuestion, type QuestionType } from "@loft/core";
import { useAdapter, useQuery } from "../../lib/data";
import { appUrl, IS_PREVIEW } from "../../lib/env";
import { ErrorState, Loading } from "../../components/bits";

interface CheckItem { id: string; title: string; status: "draft" | "published" | "closed"; closeAt: string | null; timeLimitMin: number | null; integrity: boolean; questions: number; points: number; submitted?: number; members?: number; average?: number | null; toReview?: number; flagged?: number; mine?: { status: string; score: { percent: number | null; pending: number } | null } | null; open?: boolean }
interface Grades { isHost: boolean; columns: { id: string; kind: "task" | "check"; title: string; points: number | null; dueAt: string | null }[]; rows: { userId: string; name: string; average: number | null; cells: { columnId: string; earned: number | null; possible: number | null; status: "graded" | "pending" | "missing" | "not_due" }[] }[] }

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "");
const STATUS: Record<CheckItem["status"], ["neutral" | "success" | "info", string]> = { draft: ["neutral", "Draft"], published: ["success", "Open"], closed: ["info", "Closed"] };

/** The space's Grades tab: quick checks + the gradebook (hosts see everyone, members see themselves). */
export function GradesTab({ spaceId }: { spaceId: string }) {
  const adapter = useAdapter();
  const nav = useNavigate();
  const { data, error, reload } = useQuery<{ isHost: boolean; checks: CheckItem[] }>(`spaces/${spaceId}/checks`);
  if (error) return <ErrorState what="checks" onRetry={reload} />;
  if (!data) return <Loading label="Loading checks" />;
  return (
    <div className="money-col">
      <div className="sec-head">
        <h2>Quick checks</h2>
        <span className="sec-head__spacer" />
        {data.isHost && <Button size="sm" icon={<Plus aria-hidden="true" />} onClick={async () => { const c = await adapter.mutate<{ id: string }>(`spaces/${spaceId}/checks`, { title: "Quick check" }); nav(`/checks/${c.id}`); }}>New check</Button>}
      </div>
      {data.checks.length === 0 ? <p className="muted-note">{data.isHost ? "A few questions to see who got it. Auto-graded, with integrity signals you can review." : "No checks yet."}</p> : (
        <div className="inv-list">
          {data.checks.map((c) => data.isHost ? (
            <Link key={c.id} to={`/checks/${c.id}`} className="inv-row">
              <span className="inv-row__main"><b>{c.title}</b><small>{c.questions} question{c.questions === 1 ? "" : "s"} · {c.points} pts{c.timeLimitMin ? ` · ${c.timeLimitMin} min` : ""}{c.closeAt ? ` · closes ${day(c.closeAt)}` : ""}</small></span>
              <span className="ck-badge-row">
                {c.status !== "draft" && <span className="tag">{c.submitted}/{c.members} done{c.average !== null && c.average !== undefined ? ` · avg ${c.average}%` : ""}</span>}
                {!!c.toReview && <span className="tag tag--warn">{c.toReview} to mark</span>}
                {!!c.flagged && <span className="tag tag--warn">{c.flagged} flagged</span>}
                <Badge status={STATUS[c.status][0]}>{STATUS[c.status][1]}</Badge>
              </span>
            </Link>
          ) : (
            <div key={c.id} className="inv-row">
              <span className="inv-row__main"><b>{c.title}</b><small>{c.questions} questions{c.timeLimitMin ? ` · ${c.timeLimitMin} min` : ""}{c.closeAt ? ` · closes ${day(c.closeAt)}` : ""}</small></span>
              {c.mine && c.mine.status !== "in_progress" ? <span className="tag tag--ok">{c.mine.score?.pending ? "Waiting for a mark" : `${c.mine.score?.percent ?? 0}%`}</span> : c.open ? <Link className="lf-btn lf-btn--primary lf-btn--sm" to={`/checks/${c.id}/take`}>{c.mine ? "Continue" : "Start"}</Link> : <Badge status="neutral">Closed</Badge>}
            </div>
          ))}
        </div>
      )}
      <Gradebook spaceId={spaceId} />
    </div>
  );
}

function Gradebook({ spaceId }: { spaceId: string }) {
  const { data } = useQuery<Grades>(`spaces/${spaceId}/grades`);
  if (!data || !data.columns.length) return null;
  const exportCsv = () => {
    const rows = data.rows.map((r) => ({ name: r.name, average: r.average, ...Object.fromEntries(r.cells.map((c) => [c.columnId, cellText(c)])) }));
    const csv = toCsv(rows as Record<string, unknown>[], [{ key: "name", label: "Member" }, ...data.columns.map((c) => ({ key: c.id, label: `${c.kind === "task" ? "Task" : "Check"}: ${c.title}${c.points ? ` (${c.points})` : ""}` })), { key: "average", label: "Average %" }]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "loft-gradebook.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <>
      <div className="sec-head"><h2>Gradebook</h2><span className="sec-head__spacer" />{data.isHost && <Button size="sm" variant="secondary" icon={<Download aria-hidden="true" />} onClick={exportCsv}>Export CSV</Button>}</div>
      <div className="mtable-wrap">
        <table className="mtable grades">
          <thead><tr><th>Member</th>{data.columns.map((c) => <th key={c.id} title={c.title}>{c.title.length > 18 ? `${c.title.slice(0, 17)}…` : c.title}</th>)}<th>Average</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.userId}>
                <td><b>{r.name}</b></td>
                {r.cells.map((c) => <td key={c.columnId} className={`mono cell-${c.status}`}>{c.status === "graded" && c.possible === null ? "Done" : cellText(c) || "–"}</td>)}
                <td className="num">{r.average === null ? "—" : `${r.average}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="money-foot">Tasks count as done or missing; checks count their points. Missing work counts as zero once it's due.</p>
    </>
  );
}

// ---------- host: builder + results ----------

interface CheckFull { id: string; spaceId: string; title: string; instructions: string; questions: CheckQuestion[]; status: "draft" | "published" | "closed"; openAt: string | null; closeAt: string | null; timeLimitMin: number | null; maxAttempts: number; shuffle: boolean; integrity: boolean; isHost: boolean; space: { id: string; name: string; slug: string; code: string } }

export function CheckPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { data, error, reload } = useQuery<CheckFull>(`checks/${id}`);
  const [tab, setTab] = useState<"results" | "questions">("results");
  if (error) return <ErrorState what="this check" onRetry={reload} />;
  if (!data) return <Loading label="Loading check" />;
  if (!data.isHost) return <Navigate to={`/checks/${id}/take`} replace />;
  const showBuilder = data.status === "draft" || tab === "questions";
  return (
    <div className="money-page">
      <header className="money-top">
        <button type="button" className="lf-icon-btn" onClick={() => nav(`/s/${data.space.slug}/grades`)} aria-label="Back to the space"><ChevronLeft aria-hidden="true" /></button>
        <h1><span className="money-top__eyebrow">{data.space.code} · quick check</span>{data.title}</h1>
        <Badge status={STATUS[data.status][0]}>{STATUS[data.status][1]}</Badge>
        <span className="money-top__spacer" />
        <StatusButtons check={data} />
      </header>
      {data.status !== "draft" && (
        <nav className="money-tabs" aria-label="Check sections">
          <button type="button" className={`money-tab${tab === "results" ? " is-on" : ""}`} onClick={() => setTab("results")}>Results</button>
          <button type="button" className={`money-tab${tab === "questions" ? " is-on" : ""}`} onClick={() => setTab("questions")}>Questions</button>
        </nav>
      )}
      <div className="money-body">{showBuilder ? <Builder key={data.id + data.status} check={data} locked={data.status !== "draft"} /> : <Results check={data} />}</div>
    </div>
  );
}

function StatusButtons({ check }: { check: CheckFull }) {
  const adapter = useAdapter();
  const [err, setErr] = useState<string | null>(null);
  const set = async (status: string) => {
    setErr(null);
    try {
      await adapter.mutate(`checks/${check.id}/status`, { status });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <>
      {err && <span className="risk-text" role="alert">{err}</span>}
      {check.status === "draft" && <Button onClick={() => void set("published")}>Publish</Button>}
      {check.status === "published" && <Button variant="secondary" onClick={() => void set("closed")}>Close now</Button>}
      {check.status === "closed" && <Button variant="secondary" onClick={() => void set("published")}>Reopen</Button>}
    </>
  );
}

const TYPES: { v: QuestionType; label: string }[] = [
  { v: "mcq_single", label: "One answer" },
  { v: "mcq_multi", label: "Several answers" },
  { v: "true_false", label: "True / false" },
  { v: "short_answer", label: "Short answer" }
];
let seq = 0;
const tmpId = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

function Builder({ check, locked }: { check: CheckFull; locked: boolean }) {
  const adapter = useAdapter();
  const [title, setTitle] = useState(check.title);
  const [instructions, setInstructions] = useState(check.instructions);
  const [qs, setQs] = useState<CheckQuestion[]>(check.questions);
  const [limit, setLimit] = useState(check.timeLimitMin ? String(check.timeLimitMin) : "");
  const [closeAt, setCloseAt] = useState(check.closeAt ? check.closeAt.slice(0, 16) : "");
  const [shuffle, setShuffle] = useState(check.shuffle);
  const [integrity, setIntegrity] = useState(check.integrity);
  const [saved, setSaved] = useState(false);
  const setQ = (i: number, patch: Partial<CheckQuestion>) => setQs(qs.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  const save = async () => {
    await adapter.mutate(`checks/${check.id}`, { title, instructions, questions: qs, timeLimitMin: limit ? Number(limit) : null, closeAt: closeAt ? new Date(closeAt).toISOString() : null, shuffle, integrity });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <div className="money-grid money-grid--wide">
      <section className="money-col">
        {locked && <p className="banner-box banner-box--warn">This check is live. Edits change it for anyone who hasn't started; attempts already submitted keep their marks until re-marked.</p>}
        <label className="form-col">Title<input className="field" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="form-col">Instructions<textarea className="textarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="What members should know before they start" /></label>
        {qs.map((q, i) => {
          const err = validateQuestion(q);
          return (
            <div key={q.id} className="ck-q">
              <div className="ck-q__head">
                <span className="ck-q__num">Q{i + 1}</span>
                <select className="field" value={q.type} aria-label={`Question ${i + 1} type`} onChange={(e) => { const type = e.target.value as QuestionType; setQ(i, { type, answer: [], options: type === "true_false" ? [{ id: "true", text: "True" }, { id: "false", text: "False" }] : type === "short_answer" ? [] : q.options.length >= 2 && q.type !== "true_false" ? q.options : [{ id: tmpId("o"), text: "" }, { id: tmpId("o"), text: "" }] }); }}>
                  {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select>
                <label className="form-col" style={{ flexDirection: "row", alignItems: "center" }}><input className="field" style={{ width: 64 }} inputMode="numeric" value={q.points} onChange={(e) => setQ(i, { points: Number(e.target.value.replace(/\D/g, "")) || 0 })} aria-label={`Question ${i + 1} points`} /> pts</label>
                <span className="sec-head__spacer" />
                <button type="button" className="lf-icon-btn" aria-label={`Remove question ${i + 1}`} onClick={() => setQs(qs.filter((_, k) => k !== i))}><Trash2 aria-hidden="true" /></button>
              </div>
              <textarea className="textarea" value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} aria-label={`Question ${i + 1}`} placeholder="Question" />
              {(q.type === "mcq_single" || q.type === "mcq_multi") && (
                <>
                  {q.options.map((o, k) => (
                    <div key={o.id} className="ck-opt">
                      <input type={q.type === "mcq_single" ? "radio" : "checkbox"} name={`correct-${q.id}`} checked={q.answer.includes(o.id)} aria-label={`Option ${k + 1} is correct`} onChange={(e) => setQ(i, { answer: q.type === "mcq_single" ? [o.id] : e.target.checked ? [...q.answer, o.id] : q.answer.filter((x) => x !== o.id) })} />
                      <input className="field" value={o.text} onChange={(e) => setQ(i, { options: q.options.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })} aria-label={`Question ${i + 1} option ${k + 1}`} placeholder={`Option ${k + 1}`} />
                      {q.options.length > 2 && <button type="button" className="lf-icon-btn" aria-label={`Remove option ${k + 1}`} onClick={() => setQ(i, { options: q.options.filter((_, j) => j !== k), answer: q.answer.filter((x) => x !== o.id) })}><Trash2 aria-hidden="true" /></button>}
                    </div>
                  ))}
                  {q.options.length < 8 && <button type="button" className="link" onClick={() => setQ(i, { options: [...q.options, { id: tmpId("o"), text: "" }] })}>Add an option</button>}
                </>
              )}
              {q.type === "true_false" && (
                <div className="ck-opt">
                  {["true", "false"].map((v) => <label key={v} className="ck-choice"><input type="radio" name={`tf-${q.id}`} checked={q.answer[0] === v} onChange={() => setQ(i, { answer: [v] })} />{v === "true" ? "True" : "False"}</label>)}
                </div>
              )}
              {q.type === "short_answer" && <label className="form-col">Accepted answers (comma-separated; anything else goes to you to mark)<input className="field" value={q.answer.join(", ")} onChange={(e) => setQ(i, { answer: e.target.value.split(",").map((x) => x.trim()) })} /></label>}
              {err && q.prompt && <small className="risk-text">{err}</small>}
            </div>
          );
        })}
        <Button variant="secondary" icon={<Plus aria-hidden="true" />} onClick={() => setQs([...qs, { id: tmpId("q"), type: "mcq_single", prompt: "", points: 1, options: [{ id: tmpId("o"), text: "" }, { id: tmpId("o"), text: "" }], answer: [] }])}>Add a question</Button>
      </section>
      <aside className="money-col">
        <section className="card-box">
          <h2>Settings</h2>
          <div className="form-pair">
            <label className="form-col">Time limit (min)<input className="field" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} placeholder="none" /></label>
            <label className="form-col">Closes<input className="field" type="datetime-local" value={closeAt} onChange={(e) => setCloseAt(e.target.value)} /></label>
          </div>
          <label className="switch-row">Shuffle questions and options<span className="sw"><input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} aria-label="Shuffle" /><i /></span></label>
          <label className="switch-row">Integrity signals<span className="sw"><input type="checkbox" checked={integrity} onChange={(e) => setIntegrity(e.target.checked)} aria-label="Integrity signals" /><i /></span></label>
          <p className="muted-note" style={{ padding: 0 }}><ShieldCheck aria-hidden="true" style={{ width: 14, height: 14, verticalAlign: "-2px" }} /> Notes leaving the tab, switching windows, pasting and similar, with tinyproctor.js. No camera, microphone or screen. Signals help you review; they never fail anyone.</p>
          <Button onClick={() => void save()}>{saved ? "Saved" : "Save"}</Button>
        </section>
      </aside>
    </div>
  );
}

interface ResultsData {
  attempts: { id: string; userId: string; name: string; status: string; score: { earned: number; possible: number; pending: number; percent: number | null } | null; minutes: number | null; submittedAt: string | null; integrity: { level: "none" | "clean" | "review" | "flagged"; reasons: string[]; score: number | null } }[];
  notStarted: { userId: string; name: string }[];
  questions: { id: string; prompt: string; type: string; correctRate: number | null }[];
  review: { attemptId: string; name: string; questionId: string; prompt: string; points: number; response: string; accepted: string[] }[];
}
const INTEG: Record<string, ["success" | "warning" | "danger" | "neutral", string]> = { clean: ["success", "Clean"], review: ["warning", "Review"], flagged: ["danger", "Flagged"], none: ["neutral", "Off"] };

function Results({ check }: { check: CheckFull }) {
  const adapter = useAdapter();
  const { data } = useQuery<ResultsData>(`checks/${check.id}/results`);
  const [marks, setMarks] = useState<Record<string, string>>({});
  if (!data) return <Loading label="Loading results" />;
  const firstMember = data.notStarted[0] ?? null;
  return (
    <div className="money-grid money-grid--wide">
      <section className="money-col">
        <div className="mtable-wrap">
          <table className="mtable">
            <thead><tr><th>Member</th><th>Score</th><th>Time</th><th>Integrity</th><th>Status</th></tr></thead>
            <tbody>
              {data.attempts.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.name}</b></td>
                  <td className="num">{a.score ? (a.score.pending ? `${a.score.earned}/${a.score.possible} + ${a.score.pending} to mark` : `${a.score.earned}/${a.score.possible} · ${a.score.percent}%`) : "—"}</td>
                  <td className="mono">{a.minutes ? `${a.minutes} min` : "—"}</td>
                  <td><span className="integ"><Badge status={INTEG[a.integrity.level]![0]}>{INTEG[a.integrity.level]![1]}</Badge>{a.integrity.reasons.length > 0 && <small>{a.integrity.reasons.join(", ")}</small>}</span></td>
                  <td>{a.status === "in_progress" ? "In progress" : a.status === "submitted" ? "To mark" : "Marked"}</td>
                </tr>
              ))}
              {data.notStarted.map((m) => <tr key={m.userId}><td><b>{m.name}</b></td><td colSpan={4} className="risk-text">Not started</td></tr>)}
            </tbody>
          </table>
        </div>
        {data.review.length > 0 && (
          <section className="card-box">
            <h2>To mark · {data.review.length}</h2>
            {data.review.map((r) => (
              <div key={r.attemptId + r.questionId} className="mark-row">
                <span><small>{r.name} · {r.prompt}</small>"{r.response || "(blank)"}"<small>Accepted: {r.accepted.join(", ")}</small></span>
                <span className="money-input"><input inputMode="numeric" value={marks[r.attemptId + r.questionId] ?? ""} onChange={(e) => setMarks({ ...marks, [r.attemptId + r.questionId]: e.target.value.replace(/\D/g, "") })} placeholder={`0–${r.points}`} aria-label={`Points for ${r.name}`} /><span>/{r.points}</span></span>
                <Button size="sm" onClick={() => void adapter.mutate(`attempts/${r.attemptId}/grade`, { questionId: r.questionId, points: Number(marks[r.attemptId + r.questionId] ?? 0) })}>Save mark</Button>
              </div>
            ))}
          </section>
        )}
      </section>
      <aside className="money-col">
        <section className="card-box">
          <h2>By question</h2>
          <ul className="q-bars" role="list">
            {data.questions.map((q, i) => <li key={q.id}><span>Q{i + 1} · {q.prompt.slice(0, 48)}{q.prompt.length > 48 ? "…" : ""}</span><span className={`bar${(q.correctRate ?? 100) < 50 ? " bar--bad" : " bar--ok"}`} aria-hidden="true"><i style={{ width: `${q.correctRate ?? 0}%` }} /></span><span className="mono">{q.correctRate === null ? "—" : `${q.correctRate}%`}</span></li>)}
          </ul>
        </section>
        {IS_PREVIEW && firstMember && check.status === "published" && (
          <section className="card-box">
            <h3>Try it as a member</h3>
            <p className="muted-note" style={{ padding: 0 }}>Opens a new tab signed in as {firstMember.name} (preview only), with integrity signals on.</p>
            <a className="lf-btn lf-btn--secondary" href={appUrl(`/checks/${check.id}/take?as=${firstMember.userId}`)} target="_blank" rel="noopener noreferrer"><Eye aria-hidden="true" />Take it as {firstMember.name.split(" ")[0]}</a>
          </section>
        )}
      </aside>
    </div>
  );
}
