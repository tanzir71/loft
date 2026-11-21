import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronLeft, Clock, Download, MoreHorizontal, Send, Sparkles } from "lucide-react";
import { Avatar, Badge, Button, Sheet } from "@loft/ui";
import { toCsv, whatsappLink } from "@loft/core";
import { useAdapter, useQuery } from "../../lib/data";
import { IS_PREVIEW } from "../../lib/env";
import { useBreakpoint } from "../../lib/media";
import { ErrorState, Loading } from "../../components/bits";

interface Person { userId: string; name: string; phone: string | null; spaces: string; seen: string; lastLogin: string | null; attendance: number | null; homework: string; fee: "paid" | "overdue" | "claimed" | "sent" | "none"; atRisk: boolean; reasons: string[]; notSeen7: boolean }
interface InsightsData {
  days: number; spaceId: string | null; spaces: { id: string; code: string; name: string }[];
  kpis: { active: number; members: number; activeDelta: string; attendance: number | null; attendanceDelta: string; onTime: number | null; onTimeDelta: string; avgMinutes: number | null; avgDelta: string };
  people: Person[];
  rules: { id: string; title: string; sub: string; on: boolean }[];
  audiences: { id: string; label: string; count: number }[];
  template: string;
  stats: { sent: number; opened: number; acted: number };
  scheduled: { id: string; label: string; sendAt: string }[];
}

const FEE: Record<Person["fee"], [("success" | "danger" | "info" | "neutral"), string] | null> = { paid: ["success", "Paid"], overdue: ["danger", "Overdue"], claimed: ["info", "Claimed"], sent: ["neutral", "Sent"], none: null };
const deltaTone = (d: string, goodUp = true) => (!d || d === "steady" ? "flat" : (d.startsWith("+") === goodUp ? "up" : "down"));
const loginLabel = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86_400_000);
  const t = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `today ${t}`;
  if (d.toDateString() === y.toDateString()) return "yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
function defaultText(p: Person) {
  const first = p.name.split(" ")[0];
  if (p.reasons.some((r) => r.startsWith("missed"))) return `Hi ${first}, we missed you at the last sessions. Everything OK? Reply here if you need anything.`;
  if (p.reasons.includes("fee overdue")) return `Hi ${first}, a quick reminder that your invoice is overdue. The pay link is on the invoice; tap "I've paid" once it's done. Thank you!`;
  if (p.reasons.some((r) => r.includes("on time"))) return `Hi ${first}, a couple of pieces of work are still open. Want to go through them together? Reply here.`;
  return `Hi ${first}, haven't seen you for a while. Everything OK? The next session is in your calendar.`;
}

/** "seen 8 days ago · fee overdue" without repeating the last-seen reason. */
function phoneLine(p: Person) {
  const other = p.reasons.find((r) => !r.startsWith("not seen") && r !== "never seen");
  if (!p.atRisk) return `${p.seen} · ${p.homework}`;
  return `seen ${p.seen}${other ? ` · ${other}` : p.homework !== "—" ? ` · ${p.homework}` : ""}`;
}

/** Figma 04 · "Host · Insights + nudges" and 05 · "Host · Insights (phone)". */
export function InsightsPage() {
  const nav = useNavigate();
  const phone = useBreakpoint() === "phone";
  const [space, setSpace] = useState("");
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<"all" | "risk" | "unseen">("all");
  const [nudging, setNudging] = useState<Person | null>(null);
  const [custom, setCustom] = useState(false);
  const { data, error, reload } = useQuery<InsightsData>("insights", { days, ...(space ? { space } : {}) });
  if (error) return <ErrorState what="Insights" onRetry={reload} />;
  if (!data) return <Loading label="Loading Insights" />;
  const risk = data.people.filter((p) => p.atRisk);
  const unseen = data.people.filter((p) => p.notSeen7);
  const rows = filter === "risk" ? risk : filter === "unseen" ? unseen : data.people;
  const k = data.kpis;
  const exportCsv = () => {
    const csv = toCsv(data.people as unknown as Record<string, unknown>[], [
      { key: "name", label: "Member" }, { key: "spaces", label: "Spaces" }, { key: "seen", label: "Last seen" },
      { key: "lastLogin", label: "Last login", format: (v) => (v ? String(v) : "") },
      { key: "attendance", label: "Attendance %", format: (v) => (v === null ? "" : String(v)) }, { key: "homework", label: "Homework on time" },
      { key: "fee", label: "Fees" }, { key: "reasons", label: "At risk because", format: (v) => (v as string[]).join("; ") }
    ]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `loft-insights-${days}d.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const chips = (
    <div className="filter-row" role="group" aria-label="Filter people">
      <button type="button" className={`filter-chip${filter === "all" ? " is-on" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
      <button type="button" className={`filter-chip${filter === "risk" ? " is-on" : ""}`} aria-pressed={filter === "risk"} onClick={() => setFilter("risk")}>At risk · {risk.length}</button>
      <button type="button" className={`filter-chip${filter === "unseen" ? " is-on" : ""}`} aria-pressed={filter === "unseen"} onClick={() => setFilter("unseen")}>Not seen 7d · {unseen.length}</button>
    </div>
  );
  const pickers = (
    <>
      <select className="field month-pick" value={space} onChange={(e) => setSpace(e.target.value)} aria-label="Space">
        <option value="">All spaces</option>
        {data.spaces.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
      </select>
      <select className="field month-pick" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
        <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
      </select>
    </>
  );
  return (
    <div className="money-page">
      <header className="money-top">
        {phone && <button type="button" className="lf-icon-btn" onClick={() => nav(-1)} aria-label="Back"><ChevronLeft aria-hidden="true" /></button>}
        <h1>Insights{phone && <span className="money-top__eyebrow ins-sub">{space ? data.spaces.find((s) => s.id === space)?.name : "All spaces"} · last {days} days</span>}</h1>
        {!phone && pickers}
        <span className="money-top__spacer" />
        {!phone && <Button variant="secondary" icon={<Download aria-hidden="true" />} onClick={exportCsv}>Export CSV</Button>}
      </header>
      <div className="money-body">
        {phone && <div className="filter-row">{pickers}</div>}
        {phone && chips}
        <div className={`kpis${phone ? " kpis--3" : ""}`}>
          <div className="kpi"><small>Active members</small><b>{k.active} / {k.members}</b><em className={`kpi__delta is-${deltaTone(k.activeDelta)}`}>{k.activeDelta}{k.activeDelta && k.activeDelta !== "steady" ? " vs before" : ""}</em></div>
          <div className="kpi"><small>Attendance</small><b>{k.attendance ?? "—"}{k.attendance !== null && "%"}</b><em className={`kpi__delta is-${deltaTone(k.attendanceDelta)}`}>{k.attendanceDelta}</em></div>
          <div className="kpi"><small>{phone ? "On time" : "Homework on time"}</small><b>{k.onTime ?? "—"}{k.onTime !== null && "%"}</b><em className={`kpi__delta is-${deltaTone(k.onTimeDelta)}`}>{k.onTimeDelta}</em></div>
          {!phone && <div className="kpi"><small>Avg. session</small><b>{k.avgMinutes ?? "—"}{k.avgMinutes !== null && " min"}</b><em className="kpi__delta is-flat">{k.avgDelta}</em></div>}
        </div>
        {phone ? (
          <div className="ins-cards">
            {rows.map((p) => (
              <div key={p.userId} className="ins-card">
                <Avatar name={p.name} />
                <span className="ins-card__main"><b>{p.name}</b><small className={p.atRisk ? "warn-text" : ""}>{phoneLine(p)}</small></span>
                {p.atRisk && <Button size="sm" variant="secondary" icon={<Send aria-hidden="true" />} onClick={() => setNudging(p)}>Nudge</Button>}
              </div>
            ))}
            {rows.length === 0 && <p className="muted-note">Nobody here.</p>}
          </div>
        ) : (
          <div className="money-grid ins-grid">
            <section className="card-box ins-people">
              <div className="card-box__head"><h2>People</h2>{chips}</div>
              <div className="mtable-wrap ins-table">
                <table className="mtable">
                  <thead><tr><th>Member</th><th>Last seen</th><th>Last login</th><th>Attendance</th><th>Homework</th><th>Fees</th><th><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.userId} className={p.atRisk ? "is-risk" : ""}>
                        <td><span className="ins-who"><Avatar name={p.name} size="sm" /><span><b>{p.name}</b><small>{p.spaces}</small></span></span></td>
                        <td className={p.atRisk && p.reasons.some((r) => r.startsWith("not seen") || r === "never seen") ? "risk-text" : ""}>{p.seen}</td>
                        <td className="mono">{loginLabel(p.lastLogin)}</td>
                        <td>{p.attendance === null ? "—" : <span className="ins-att"><span className={`bar${p.attendance < 75 ? " bar--bad" : " bar--ok"}`} aria-hidden="true"><i style={{ width: `${p.attendance}%` }} /></span><span className="mono">{p.attendance}%</span></span>}</td>
                        <td className="mono">{p.homework}</td>
                        <td>{FEE[p.fee] ? <Badge status={FEE[p.fee]![0]}>{FEE[p.fee]![1]}</Badge> : "—"}</td>
                        <td>{p.atRisk ? <Button size="sm" variant="secondary" icon={<Bell aria-hidden="true" />} onClick={() => setNudging(p)} title={p.reasons.join(", ")}>Nudge</Button> : <button type="button" className="lf-icon-btn" aria-label={`Nudge ${p.name}`} onClick={() => setNudging(p)}><MoreHorizontal aria-hidden="true" /></button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length === 0 && <p className="muted-note">Nobody here. People appear once they join one of your spaces.</p>}
            </section>
            <aside className="money-col">
              <AutoNudges rules={data.rules} />
              <CustomNudge data={data} />
              <p className="money-foot">This week: {data.stats.sent} nudge{data.stats.sent === 1 ? "" : "s"} sent · {data.stats.opened} opened · {data.stats.acted} acted on</p>
            </aside>
          </div>
        )}
        {phone && <div className="money-sticky"><Button icon={<Sparkles aria-hidden="true" />} onClick={() => setCustom(true)}>Write a custom nudge</Button></div>}
      </div>
      {nudging && <NudgeSheet person={nudging} onClose={() => setNudging(null)} />}
      <Sheet open={custom} onClose={() => setCustom(false)} title="Custom nudge"><CustomNudge data={data} onDone={() => setCustom(false)} /></Sheet>
    </div>
  );
}

function AutoNudges({ rules }: { rules: InsightsData["rules"] }) {
  const adapter = useAdapter();
  return (
    <section className="card-box">
      <h2>Automatic nudges</h2>
      {rules.map((r) => (
        <div key={r.id} className="rule-row">
          <span>{r.title}<small>{r.sub}</small></span>
          <label className="sw"><input type="checkbox" checked={r.on} onChange={(e) => void adapter.mutate("nudges/rules", { rule: r.id, on: e.target.checked })} aria-label={r.title} /><i /></label>
        </div>
      ))}
    </section>
  );
}

const CHANNELS = [["inapp", "In-app"], ["email", "Email"], ["whatsapp", "WhatsApp link"]] as const;

function CustomNudge({ data, onDone }: { data: InsightsData; onDone?: () => void }) {
  const adapter = useAdapter();
  const [audience, setAudience] = useState(data.audiences[0]?.id ?? "");
  const [text, setText] = useState(data.template);
  const [channels, setChannels] = useState<string[]>(["inapp"]);
  const [when, setWhen] = useState("");
  const [result, setResult] = useState<{ msg: string; wa: { name: string; phone: string; text: string }[] } | null>(null);
  const send = async () => {
    const r = await adapter.mutate<{ scheduled: boolean; sendAt: string; recipients: number; whatsapp: { name: string; phone: string; text: string }[] }>("nudges", { audience, text, channels, ...(when ? { sendAt: new Date(when).toISOString() } : {}) });
    setResult({ msg: r.scheduled ? `Scheduled for ${new Date(r.sendAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })} · ${r.recipients} people` : `Sent to ${r.recipients} ${r.recipients === 1 ? "person" : "people"}`, wa: r.whatsapp });
    onDone?.();
  };
  return (
    <section className="card-box">
      <h2>Custom nudge</h2>
      <label className="nudge-to"><span>To</span>
        <select value={audience} onChange={(e) => setAudience(e.target.value)} aria-label="Who gets the nudge">
          {data.audiences.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </label>
      <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} aria-label="Nudge text" />
      <div className="step__ch" role="group" aria-label="Channels">
        {CHANNELS.map(([c, label]) => <label key={c}><input type="checkbox" checked={channels.includes(c)} onChange={(e) => setChannels(e.target.checked ? [...channels, c] : channels.filter((x) => x !== c))} />{label}</label>)}
        <label className="is-off" title="Push arrives with the installed app"><input type="checkbox" disabled />Push · soon</label>
      </div>
      <div className="nudge-foot">
        <label className="nudge-when"><Clock aria-hidden="true" /><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Send at (empty = now)" /></label>
        <Button icon={<Clock aria-hidden="true" />} onClick={() => void send()} disabled={!audience || !text.trim() || !channels.length}>{when ? "Schedule" : "Send now"}</Button>
      </div>
      {IS_PREVIEW && channels.includes("email") && <p className="money-foot">Preview: email is simulated here.</p>}
      {result && <p className="banner-box banner-box--info" role="status">{result.msg}</p>}
      {result?.wa.length ? <ul className="more-list" role="list">{result.wa.map((w) => <li key={w.name}><a href={whatsappLink(w.phone, w.text)} target="_blank" rel="noopener noreferrer"><Send aria-hidden="true" />WhatsApp {w.name}</a></li>)}</ul> : null}
      {data.scheduled.length > 0 && <p className="money-foot">Scheduled: {data.scheduled.map((s) => `${s.label} · ${new Date(s.sendAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`).join("; ")}</p>}
    </section>
  );
}

function NudgeSheet({ person, onClose }: { person: Person; onClose: () => void }) {
  const adapter = useAdapter();
  const [text, setText] = useState(defaultText(person));
  const [sent, setSent] = useState(false);
  return (
    <Sheet open onClose={onClose} title={`Nudge ${person.name}`} actions={<div className="sheet-actions"><Button variant="ghost" onClick={onClose}>{sent ? "Done" : "Cancel"}</Button>{!sent && <Button icon={<Bell aria-hidden="true" />} onClick={async () => { await adapter.mutate("nudges", { userId: person.userId, text, channels: ["inapp"] }); setSent(true); }}>Send in-app</Button>}</div>}>
      <h2 className="sheet-title">Nudge {person.name.split(" ")[0]}</h2>
      {person.reasons.length > 0 && <p className="muted-note">At risk: {person.reasons.join(" · ")}</p>}
      <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
      <a className="lf-btn lf-btn--secondary" href={whatsappLink(person.phone, text)} target="_blank" rel="noopener noreferrer"><Send aria-hidden="true" />Open in WhatsApp</a>
      {sent && <p className="banner-box banner-box--info" role="status">Sent in-app. You'll see it in "This week" once it's opened.</p>}
    </Sheet>
  );
}
