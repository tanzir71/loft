import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Check, ShieldCheck } from "lucide-react";
import { Button } from "@loft/ui";
import type { CheckQuestion } from "@loft/core";
import type { LocalAdapter } from "@loft/data";
import type { TinyProctorInstance } from "../../vendor/tinyproctor/tinyproctor";
import { useAdapter, useQuery } from "../../lib/data";
import { IS_PREVIEW } from "../../lib/env";
import { ErrorState, Loading } from "../../components/bits";

interface MemberCheck { id: string; title: string; instructions: string; questions: CheckQuestion[]; timeLimitMin: number | null; closeAt: string | null; integrity: boolean; status: string; isHost: boolean; space: { slug: string; name: string } }
interface Attempt { id: string; status: string; answers: Record<string, string[]>; remaining: number | null; score: { earned: number; possible: number; pending: number; percent: number | null } | null; results: Record<string, boolean | null> | null }

/** Lazily load the vendored tinyproctor.js (MIT) and start it silently, with no endpoint. */
async function startProctor(onChange: (i: TinyProctorInstance) => void): Promise<TinyProctorInstance | null> {
  try {
    await import("../../vendor/tinyproctor/tinyproctor.js");
    const tp = window.TinyProctor;
    tp.destroy(true);
    const inst = tp.init({ silent: true, persist: false, blurDedupeMs: 800, onViolation: () => onChange(inst), onEvent: (e) => e.eventType === "heartbeat" && onChange(inst) });
    inst.start();
    return inst;
  } catch {
    return null;
  }
}

/** A member taking a quick check: focused page, timer, autosave, integrity signals, instant marks. */
export function TakeCheck() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const adapter = useAdapter();
  // Preview only: "Take it as Ayaan" opens this tab as that member.
  const as = params.get("as");
  const [ready, setReady] = useState(!(IS_PREVIEW && as));
  useEffect(() => {
    if (IS_PREVIEW && as && adapter.kind === "local") {
      (adapter as LocalAdapter).setTabIdentity(as);
      setReady(true);
    }
  }, [adapter, as]);
  const { data, error, reload } = useQuery<MemberCheck>(ready ? `checks/${id}` : null);
  if (error) return <div className="ck-page"><ErrorState what="this check" onRetry={reload} /></div>;
  if (!data) return <Loading label="Loading check" />;
  return <Taker check={data} />;
}

function Taker({ check }: { check: MemberCheck }) {
  const adapter = useAdapter();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const proctor = useRef<TinyProctorInstance | null>(null);
  const lastSent = useRef(0);
  // Saves run one after another; Submit waits for them.
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const queue = (fn: () => Promise<unknown>) => (saving.current = saving.current.then(fn, fn));
  const attemptId = attempt?.id ?? null;
  const live = attempt?.status === "in_progress";

  // Integrity snapshot → the attempt (throttled to one write every 3 s).
  useEffect(() => {
    if (!live || !check.integrity || !attemptId) return;
    let alive = true;
    const send = (i: TinyProctorInstance) => {
      const now = Date.now();
      if (now - lastSent.current < 3000) return;
      lastSent.current = now;
      const s = i.getState();
      void (saving.current = saving.current.then(() => adapter.mutate(`attempts/${attemptId}/integrity`, { integrityScore: s.integrityScore, violationCounts: s.violationCounts, awayMs: s.awayMs, recent: s.recentViolations.map((v) => ({ t: v.t, violationKey: v.violationKey })) })));
    };
    void startProctor(send).then((inst) => {
      if (!alive) inst?.stop();
      else proctor.current = inst;
    });
    return () => {
      alive = false;
      proctor.current?.stop();
    };
  }, [adapter, attemptId, check.integrity, live]);

  // Countdown.
  useEffect(() => {
    if (!live || attempt?.remaining === null || attempt?.remaining === undefined) return;
    const end = Date.now() + attempt.remaining * 1000;
    const tick = () => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [attempt?.remaining, live]);

  const submit = async () => {
    if (!attempt) return;
    const st = proctor.current?.getState();
    if (st) queue(() => adapter.mutate(`attempts/${attempt.id}/integrity`, { integrityScore: st.integrityScore, violationCounts: st.violationCounts, awayMs: st.awayMs }));
    await saving.current;
    const done = await adapter.mutate<Attempt>(`attempts/${attempt.id}/submit`);
    proctor.current?.stop();
    window.TinyProctor?.destroy(true);
    setAttempt(done);
    setConfirm(false);
  };
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  useEffect(() => {
    if (live && left === 0) void submitRef.current();
  }, [left, live]);

  const start = async () => {
    setErr(null);
    try {
      setAttempt(await adapter.mutate<Attempt>(`checks/${check.id}/start`));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const answer = (q: CheckQuestion, value: string[]) => {
    if (!attempt) return;
    setAttempt({ ...attempt, answers: { ...attempt.answers, [q.id]: value } });
    void queue(() => adapter.mutate(`attempts/${attempt.id}/answer`, { questionId: q.id, answer: value }));
  };
  const mm = left === null ? null : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const answered = attempt ? check.questions.filter((q) => (attempt.answers[q.id] ?? []).some((x) => x.trim())).length : 0;

  return (
    <div className="ck-page">
      <header className="ck-take__bar">
        <h1>{check.title}</h1>
        {live && mm && <span className={`ck-timer${(left ?? 999) < 60 ? " is-low" : ""}`} role="timer" aria-label={`${mm} left`}>{mm}</span>}
        {live && <Button onClick={() => setConfirm(true)}>Submit</Button>}
      </header>
      <main className="ck-take">
        {!attempt && (
          <section className="ck-intro">
            <span className="eyebrow-mono">{check.space.name} · quick check</span>
            <h1>{check.title}</h1>
            {check.instructions && <p>{check.instructions}</p>}
            <p className="muted-note" style={{ padding: 0 }}>{check.questions.length} questions{check.timeLimitMin ? ` · ${check.timeLimitMin} minutes once you start` : ""}{check.closeAt ? ` · closes ${new Date(check.closeAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</p>
            {check.integrity && <p className="banner-box banner-box--info"><ShieldCheck aria-hidden="true" />This check notes when you leave the page, switch windows or paste text, so your host can see how it went. It doesn't use your camera, microphone or screen.</p>}
            {err && <p className="state-error" role="alert"><b>{err}</b></p>}
            <Button onClick={() => void start()} disabled={check.status !== "published"}>{check.status === "published" ? "Start" : "This check is closed"}</Button>
          </section>
        )}
        {attempt && live && (
          <>
            {check.questions.map((q, i) => (
              <fieldset key={q.id} className="ck-q">
                <legend className="ck-q__num">Question {i + 1} of {check.questions.length} · {q.points} pt{q.points === 1 ? "" : "s"}</legend>
                <p style={{ font: "var(--text-body-l)" }}>{q.prompt}</p>
                {q.type === "short_answer" ? (
                  <input className="field" value={attempt.answers[q.id]?.[0] ?? ""} onChange={(e) => answer(q, [e.target.value])} aria-label={`Answer to question ${i + 1}`} />
                ) : (
                  q.options.map((o) => {
                    const multi = q.type === "mcq_multi";
                    const cur = attempt.answers[q.id] ?? [];
                    return (
                      <label key={o.id} className="ck-choice">
                        <input type={multi ? "checkbox" : "radio"} name={q.id} checked={cur.includes(o.id)} onChange={(e) => answer(q, multi ? (e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id)) : [o.id])} />
                        {o.text}
                      </label>
                    );
                  })
                )}
              </fieldset>
            ))}
            <p className="money-foot">{answered} of {check.questions.length} answered · saved as you go</p>
            <Button onClick={() => setConfirm(true)}>Submit</Button>
            {confirm && (
              <div className="ck-intro" role="dialog" aria-label="Submit check">
                <b>Submit now?</b>
                <p className="muted-note" style={{ padding: 0 }}>{answered < check.questions.length ? `${check.questions.length - answered} question${check.questions.length - answered === 1 ? " is" : "s are"} still blank. ` : ""}You can't change answers after this.</p>
                <div className="part-row"><Button variant="ghost" onClick={() => setConfirm(false)}>Keep going</Button><Button icon={<Check aria-hidden="true" />} onClick={() => void submit()}>Submit</Button></div>
              </div>
            )}
          </>
        )}
        {attempt && !live && attempt.score && (
          <>
            <section className="ck-score" role="status">
              <span className="eyebrow-mono">Submitted</span>
              <b>{attempt.score.pending ? `${attempt.score.earned}/${attempt.score.possible}` : `${attempt.score.percent}%`}</b>
              <span>{attempt.score.pending ? `${attempt.score.pending} answer${attempt.score.pending === 1 ? "" : "s"} waiting for your host to mark` : `${attempt.score.earned} of ${attempt.score.possible} points`}</span>
            </section>
            {check.questions.map((q, i) => {
              const r = attempt.results?.[q.id];
              return (
                <div key={q.id} className={`ck-choice ${r === true ? "is-right" : r === false ? "is-wrong" : ""}`}>
                  <span className="ck-q__num">Q{i + 1}</span>
                  <span style={{ flex: 1 }}>{q.prompt}</span>
                  <span>{r === true ? "Right" : r === false ? "Not quite" : "To be marked"}</span>
                </div>
              );
            })}
            <Link className="lf-btn lf-btn--secondary" to={`/s/${check.space.slug}`}>Back to {check.space.name}</Link>
          </>
        )}
      </main>
    </div>
  );
}
