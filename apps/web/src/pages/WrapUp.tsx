import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FileText, Receipt, Send, X } from "lucide-react";
import { Avatar, Button } from "@loft/ui";
import { formatUSD, type AttendanceStatus, type PlanBlock } from "@loft/core";
import { useAdapter, useQuery } from "../lib/data";
import { ErrorState, Loading } from "../components/bits";

interface WrapData {
  session: { id: string; title: string; startsAt: string; minutes: number };
  space: { id: string; name: string; slug: string };
  plan: { id: string; title: string; blocks: PlanBlock[] } | null;
  policy: { unitPriceCents: number; billable: AttendanceStatus[] };
  attendance: { memberId: string; name: string; minutes: number; status: AttendanceStatus }[];
  homework: { title: string } | null;
  nextPlan: { id: string; title: string } | null;
}

const STATUSES: { v: AttendanceStatus; label: string }[] = [
  { v: "attended", label: "Attended" },
  { v: "absent", label: "Absent" },
  { v: "excused", label: "Excused" },
  { v: "late_cancel", label: "Late cancel" },
  { v: "no_show", label: "No-show" }
];
type Outcome = "done" | "partly" | "skipped";

/** Figma 06 · P6 "Wrap-up · the hinge": closes the plan, confirms attendance, sets homework, writes billable lines. */
export function WrapUpPage() {
  const { sessionId = "" } = useParams();
  const adapter = useAdapter();
  const nav = useNavigate();
  const { data, error, reload } = useQuery<WrapData>(`sessions/${sessionId}/wrapup`);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [carry, setCarry] = useState<Set<string>>(new Set());
  const [att, setAtt] = useState<WrapData["attendance"]>([]);
  const [hwOn, setHwOn] = useState(true);
  const [postRecap, setPostRecap] = useState(true);
  const [markTaught, setMarkTaught] = useState(true);
  const [done, setDone] = useState<{ billable: number; totalCents: number; carried: number } | null>(null);
  useEffect(() => {
    if (data) {
      setOutcomes(Object.fromEntries((data.plan?.blocks ?? []).map((b) => [b.id, "done" as Outcome])));
      setAtt(data.attendance);
    }
  }, [data]);
  if (error) return <ErrorState what="the wrap-up" onRetry={reload} />;
  if (!data) return <Loading label="Loading wrap-up" />;
  const billable = att.filter((a) => data.policy.billable.includes(a.status));
  const notDone = (data.plan?.blocks ?? []).filter((b) => outcomes[b.id] && outcomes[b.id] !== "done");
  const ended = new Date(Date.parse(data.session.startsAt) + data.session.minutes * 60_000);

  if (done) {
    return (
      <div className="page">
        <section className="empty">
          <h2 className="empty__title">Wrapped up</h2>
          <p className="empty__lead">{done.billable} billable line{done.billable === 1 ? "" : "s"} ({formatUSD(done.totalCents)}) added to the session log. {done.carried ? `${done.carried} block carried into the next plan. ` : ""}Nothing is invoiced yet.</p>
          <Button onClick={() => nav(`/s/${data.space.slug}`)}>Back to {data.space.name}</Button>
        </section>
      </div>
    );
  }

  return (
    <div className="page wrap-page">
      <div className="wrap-card" role="dialog" aria-labelledby="wrap-title">
        <header className="wrap-head">
          <div>
            <h1 id="wrap-title">Wrap up · {data.plan?.title ?? data.session.title}</h1>
            <p className="muted-note">Ended {ended.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} · {data.session.minutes} min · {data.space.name}</p>
          </div>
          <button type="button" className="lf-icon-btn" onClick={() => nav(-1)} aria-label="Close"><X aria-hidden="true" /></button>
        </header>
        <div className="wrap-grid">
          <section>
            <h2 className="wrap-sub">What we covered</h2>
            <ul className="covered" role="list">
              {(data.plan?.blocks ?? []).map((b) => (
                <li key={b.id}>
                  <span>{b.title}</span>
                  <div className="seg seg--sm" role="radiogroup" aria-label={`${b.title} outcome`}>
                    {(["done", "partly", "skipped"] as Outcome[]).map((o) => (
                      <button key={o} type="button" role="radio" aria-checked={outcomes[b.id] === o} className={`out-${o}${outcomes[b.id] === o ? " is-on" : ""}`} onClick={() => setOutcomes({ ...outcomes, [b.id]: o })}>{o[0]!.toUpperCase() + o.slice(1)}</button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {notDone.map((b) => (
              <label key={b.id} className="check-row wrap-carry">
                <input type="checkbox" checked={carry.has(b.id)} onChange={(e) => setCarry((c) => { const n = new Set(c); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n; })} />
                Carry '{b.title}' ({b.minutes} min) into {data.nextPlan?.title ?? "the carry-over tray"}
              </label>
            ))}
            {!data.plan && <p className="muted-note">This session had no plan. Attendance and billing still apply.</p>}
          </section>
          <section>
            <h2 className="wrap-sub">Attendance · from the room</h2>
            <ul className="att-list" role="list">
              {att.map((a, i) => (
                <li key={a.memberId}>
                  <Avatar name={a.name} />
                  <span className="att-list__who"><b>{a.name}</b><small>{a.minutes ? `${a.minutes} min` : "didn't join"}</small></span>
                  <select className={`field att-status att-${a.status}`} value={a.status} onChange={(e) => setAtt(att.map((x, k) => (k === i ? { ...x, status: e.target.value as AttendanceStatus } : x)))} aria-label={`${a.name} attendance`}>
                    {STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          </section>
        </div>
        {data.homework && (
          <label className="hw-row">
            <FileText aria-hidden="true" />
            <span>Homework · {data.homework.title}</span>
            <span className="muted-note">from the plan</span>
            <span className="mini-toggle"><input type="checkbox" role="switch" checked={hwOn} onChange={(e) => setHwOn(e.target.checked)} aria-label="Set homework" /><span className="switch" aria-hidden="true" /></span>
          </label>
        )}
        <div className="bill-note">
          <Receipt aria-hidden="true" />
          <span>
            <b>Adds {billable.length} billable line{billable.length === 1 ? "" : "s"} to the {new Date(data.session.startsAt).toLocaleDateString("en-GB", { month: "long" })} log</b>
            <small>{att.filter((a) => a.status === "attended").length} attended{att.some((a) => a.status === "late_cancel") ? ` + ${att.filter((a) => a.status === "late_cancel").length} late cancel` : ""} · {data.policy.unitPriceCents ? `${formatUSD(data.policy.unitPriceCents, { dropZeroCents: true })} each` : "no price set (Money → Billing setup, M7)"} · nothing is sent yet</small>
          </span>
        </div>
        <div className="wrap-checks">
          <label className="check-row"><input type="checkbox" checked={postRecap} onChange={(e) => setPostRecap(e.target.checked)} /> Post recap to the stream</label>
          <label className="check-row"><input type="checkbox" checked={markTaught} onChange={(e) => setMarkTaught(e.target.checked)} /> Mark plan as taught</label>
        </div>
        <footer className="wrap-foot">
          <span className="muted-note">Recap = board PDF + homework + what we covered</span>
          <Button variant="ghost" onClick={() => nav(-1)}>Save for later</Button>
          <Button icon={<Send aria-hidden="true" />} onClick={async () => setDone(await adapter.mutate(`sessions/${sessionId}/wrapup`, { outcomes, carry: [...carry], attendance: att, homework: hwOn && data.homework ? { title: data.homework.title } : undefined, postRecap, markTaught }))}>Post recap & close</Button>
        </footer>
      </div>
    </div>
  );
}
