import { useState } from "react";
import { Link } from "react-router-dom";
import { Calendar, Clock, Database, Download, History, Inbox, Lock, Search, Users, X } from "lucide-react";
import { Badge, Button } from "@loft/ui";
import { useAdapter, useQuery } from "../../lib/data";
import { ADAPTER, IS_PREVIEW } from "../../lib/env";
import { useBreakpoint } from "../../lib/media";
import { ErrorState, Loading } from "../../components/bits";

interface Org { id: string; name: string; slug: string; hostName: string; hostEmail: string; branded: boolean; brandedUntil: string | null; note: string; active: boolean; activeMembers: number; spaces: number; members: number; endsInDays: number | null; askedByEmail: boolean }
interface OwnerData { orgs: Org[]; log: { at: string; actor: string; action: string; data: Record<string, unknown> }[]; contacts: { id: string; organisation: string; email: string; people: string; period: string; createdAt: string }[]; version: string }

const longDate = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const addDays = (d: string | null, months: number) => {
  const base = d ? new Date(`${d}T12:00:00`) : new Date();
  base.setMonth(base.getMonth() + months);
  return base.toISOString().slice(0, 10);
};

/** Figma 04 · "Owner · Organisations + branding switch" (and the phone version). */
export function OwnerPage() {
  const phone = useBreakpoint() === "phone";
  const { data, error, reload } = useQuery<OwnerData>("owner");
  const [tab, setTab] = useState<"orgs" | "requests" | "log" | "backups">("orgs");
  const [filter, setFilter] = useState<"all" | "branded" | "asked" | "ending">("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  if (error) return <ErrorState what="the owner console" detail={error.message === "Only the owner can do that" ? "Only the owner of this Loft can open this page." : undefined} onRetry={reload} />;
  if (!data) return <Loading label="Loading organisations" />;
  const ending = data.orgs.filter((o) => o.branded && o.endsInDays !== null && o.endsInDays <= 14);
  const rows = data.orgs.filter((o) => (filter === "all" || (filter === "branded" ? o.branded : filter === "asked" ? o.askedByEmail : ending.includes(o))) && (!q || `${o.name} ${o.hostEmail}`.toLowerCase().includes(q.toLowerCase())));
  const current = data.orgs.find((o) => o.id === sel) ?? null;
  return (
    <div className="owner">
      {!phone && (
        <aside className="owner__side">
          <div className="owner__brand"><span className="owner__lock" aria-hidden="true"><Lock /></span><span><b>Owner</b><small>{location.host}{import.meta.env.BASE_URL}</small></span></div>
          <nav className="owner__nav" aria-label="Owner">
            <button type="button" className={tab === "orgs" ? "is-on" : ""} onClick={() => setTab("orgs")}><Users aria-hidden="true" />Organisations</button>
            <button type="button" className={tab === "requests" ? "is-on" : ""} onClick={() => setTab("requests")}><Inbox aria-hidden="true" />Requests{data.contacts.length + data.orgs.filter((o) => o.askedByEmail).length > 0 && <span className="lf-count lf-count--primary">{data.contacts.length + data.orgs.filter((o) => o.askedByEmail).length}</span>}</button>
            <button type="button" className={tab === "log" ? "is-on" : ""} onClick={() => setTab("log")}><History aria-hidden="true" />Change log</button>
            <button type="button" className={tab === "backups" ? "is-on" : ""} onClick={() => setTab("backups")}><Database aria-hidden="true" />Backups</button>
          </nav>
          <p className="owner__foot">Only you see this. Everything else is configured by each organisation in its own admin.</p>
        </aside>
      )}
      <main className="owner__main">
        <header className="money-top owner__top">
          <h1>{tab === "orgs" ? "Organisations" : tab === "requests" ? "Requests" : tab === "log" ? "Change log" : "Backups"}</h1>
          <span className="money-top__spacer" />
          {tab === "orgs" && <span className="money-input owner__search"><Search aria-hidden="true" style={{ width: 16, height: 16 }} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or admin email" aria-label="Search organisations" /></span>}
        </header>
        <div className="money-body">
          {IS_PREVIEW && <p className="banner-box banner-box--muted">Preview: the demo host plays the owner here. On your server only the owner account created by the install wizard can open this page.</p>}
          {tab === "orgs" && (
            <div className={`money-grid${current ? "" : " owner__grid--full"}`}>
              <section className="money-col">
                <div className="filter-row">
                  {([["all", `All ${data.orgs.length}`], ["branded", `Branded ${data.orgs.filter((o) => o.branded).length}`], ["asked", `Asked by email ${data.orgs.filter((o) => o.askedByEmail).length}`], ["ending", `Ending soon ${ending.length}`]] as const).map(([k, label]) => (
                    <button key={k} type="button" className={`filter-chip${filter === k ? " is-on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
                  ))}
                </div>
                <div className="mtable-wrap">
                  <table className="mtable">
                    <thead><tr><th>Organisation</th><th>Active</th><th>Branding</th><th>Paid until</th></tr></thead>
                    <tbody>
                      {rows.map((o) => (
                        <tr key={o.id} className={sel === o.id ? "is-sel" : ""} onClick={() => setSel(o.id)} style={{ cursor: "pointer" }}>
                          <td><button type="button" className="link-plain" onClick={() => setSel(o.id)}><b>{o.name}</b></button>{o.endsInDays !== null && o.endsInDays >= 0 && o.endsInDays <= 14 && <> <Badge status="warning">ends in {o.endsInDays} days</Badge></>}{o.askedByEmail && <> <Badge status="info">asked by email</Badge></>}<br /><small>{o.hostEmail}</small></td>
                          <td className="mono">{o.activeMembers}</td>
                          <td><OrgSwitch org={o} /></td>
                          <td className="mono">{o.branded ? longDate(o.brandedUntil) : "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="money-foot">Active = joined at least one session in the last 30 days. Shown so you can pick the right price; nothing is limited by it.</p>
              </section>
              {current && <OrgPanel key={current.id} org={current} onClose={() => setSel(null)} />}
            </div>
          )}
          {tab === "requests" && (
            <section className="money-col">
              {data.orgs.filter((o) => o.askedByEmail).map((o) => <div key={o.id} className="inv-row card-like"><span className="inv-row__main"><b>{o.name}</b><small>{o.hostEmail} · asked for branding</small></span><Button size="sm" variant="secondary" onClick={() => { setTab("orgs"); setSel(o.id); }}>Open</Button></div>)}
              {data.contacts.map((c) => <div key={c.id} className="inv-row card-like"><span className="inv-row__main"><b>{c.organisation}</b><small>{c.email} · {c.people || "?"} people · {c.period || "?"} · {new Date(c.createdAt).toLocaleDateString("en-GB")}</small></span></div>)}
              {!data.contacts.length && !data.orgs.some((o) => o.askedByEmail) && <p className="muted-note">No requests yet. The organisations page on the landing site sends them here.</p>}
            </section>
          )}
          {tab === "backups" && (
            <section className="card-box" style={{ maxWidth: 640 }}>
              <h2>Download a backup</h2>
              <p className="muted-note" style={{ padding: 0 }}>A zip of the data/ folder: a consistent copy of the database (taken while Loft keeps running), every uploaded file and config.php with the encryption key. Keep it somewhere private.</p>
              {ADAPTER === "http" ? (
                <a className="lf-btn lf-btn--primary" href={`${import.meta.env.VITE_API_BASE ?? "/spaces/api/v1"}/owner/backup`} download><Download aria-hidden="true" />Download backup</a>
              ) : (
                <p className="banner-box banner-box--muted">Preview: there's no server here. On your server this downloads data/ as a zip.</p>
              )}
              <h3>Restore</h3>
              <ol className="restore-steps">
                <li>In cPanel → File Manager, rename <code>loft-app/data</code> to <code>data-old</code>.</li>
                <li>Upload the backup zip to <code>loft-app/</code> and extract it: it creates <code>data/</code> with <code>loft.sqlite</code>, <code>files/</code> and <code>config.php</code>.</li>
                <li>Open Loft. If everything is there, delete <code>data-old</code>.</li>
              </ol>
            </section>
          )}
          {tab === "log" && (
            <ul className="act-list card-box" role="list">
              {data.log.map((l, i) => <li key={i}><History aria-hidden="true" /><span>{l.actor} · {l.action} · {String(l.data.org ?? "")} {l.data.branded === true ? `on until ${String(l.data.until ?? "—")}` : l.data.branded === false ? "off" : ""}{l.data.note ? ` · ${String(l.data.note)}` : ""}<small>{new Date(l.at).toLocaleString("en-GB")}</small></span></li>)}
              {!data.log.length && <li><span className="muted-note">Nothing changed yet.</span></li>}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}

function OrgSwitch({ org }: { org: Org }) {
  const adapter = useAdapter();
  return (
    <label className="sw" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={org.branded} aria-label={`Branding for ${org.name}`} onChange={(e) => void adapter.mutate(`owner/orgs/${org.id}`, { branded: e.target.checked, ...(e.target.checked && !org.brandedUntil ? { brandedUntil: addDays(null, 12) } : {}) })} />
      <i />
    </label>
  );
}

function OrgPanel({ org, onClose }: { org: Org; onClose: () => void }) {
  const adapter = useAdapter();
  const [branded, setBranded] = useState(org.branded);
  const [until, setUntil] = useState(org.brandedUntil ?? addDays(null, 12));
  const [note, setNote] = useState(org.note);
  const [notify, setNotify] = useState(true);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    await adapter.mutate(`owner/orgs/${org.id}`, { branded, brandedUntil: branded ? until : org.brandedUntil, note, notify: notify && branded && !org.branded });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <aside className="card-box owner__panel" aria-label={org.name}>
      <div className="card-box__head"><div><h2>{org.name}</h2><small className="muted-note" style={{ padding: 0 }}>{org.hostEmail} · {org.activeMembers} active · {org.spaces} space{org.spaces === 1 ? "" : "s"}</small></div><button type="button" className="lf-icon-btn" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button></div>
      <label className="owner__toggle"><span><b>Branding</b><small>Lets their admin publish a brand. Nothing else changes.</small></span><span className="sw"><input type="checkbox" checked={branded} onChange={(e) => setBranded(e.target.checked)} aria-label="Branding" /><i /></span></label>
      <label className="form-col">Paid until<span className="money-input"><Calendar aria-hidden="true" style={{ width: 16, height: 16 }} /><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></span></label>
      <div className="chips"><button type="button" className="chip-pill" onClick={() => setUntil(addDays(until, 1))}>+1 month</button><button type="button" className="chip-pill" onClick={() => setUntil(addDays(until, 12))}>+1 year</button></div>
      <label className="form-col">Note · only you see this<input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="INV-0042 · bank transfer · $290" /></label>
      {!org.branded && <label className="check-row"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email their admins that branding is on</label>}
      {branded && <p className="note-box"><b>Branding is on for {org.name}</b><small>Open Brand studio to publish your logo, colours and link: {location.host}{import.meta.env.BASE_URL}{org.slug}</small></p>}
      <p className="muted-note" style={{ padding: 0 }}><Clock aria-hidden="true" style={{ width: 14, height: 14, verticalAlign: "-2px" }} /> After {longDate(until)}: reminders 14 and 3 days before, 14 days' grace, then the standard look returns. Nothing is deleted.</p>
      <div className="card-box__head"><span className="money-foot">Saved to the <Link className="link" to="#" onClick={(e) => e.preventDefault()}>change log</Link></span><Button onClick={() => void save()}>{saved ? "Saved" : "Save"}</Button></div>
    </aside>
  );
}
