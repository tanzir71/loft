import { useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { Check, ChevronRight, Download, FileText, MessageCircle, Pause, Play, Plus, Search, Send, X } from "lucide-react";
import { Avatar, Badge, Button } from "@loft/ui";
import { formatUSD, monthKey, monthLabel, parseUSD, reminderMessage, toCsv, whatsappLink, type AttendanceStatus, type InvoiceStatus, type ReminderStep } from "@loft/core";
import { useAdapter, useQuery } from "../../lib/data";
import { appUrl } from "../../lib/env";
import { useBreakpoint } from "../../lib/media";
import { ErrorState, Loading } from "../../components/bits";

// ---------- shared ----------

export interface ListInvoice {
  id: string; number: string | null; kind: string; period: string; payerId: string | null; payerName: string; payerPhone: string | null; payerEmail: string | null;
  summary: string; tags: string[]; totalCents: number; paidCents: number; balanceCents: number; status: InvoiceStatus; statusLabel: string;
  needsAttention: string | null; sentAt: string | null; dueAt: string | null; overdueDays: number; nextReminderAt: number | null; nextReminderDays: number | null; finalSent: boolean; paused: boolean;
  openClaims: number; payPath: string; members: string;
}

export const STATUS_TONE: Record<InvoiceStatus, "neutral" | "info" | "success" | "warning" | "danger"> = { draft: "neutral", sent: "info", viewed: "info", claimed: "info", partial: "warning", paid: "success", overdue: "danger", void: "neutral" };
export const usd = (c: number) => formatUSD(c);
export const dayLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
export const dateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const firstName = (n: string) => n.split(" ")[0] ?? n;

/** The month in ?m=YYYY-MM (defaults to this month). */
export function useMonth(): [string, (m: string) => void] {
  const [params, setParams] = useSearchParams();
  const m = /^\d{4}-\d{2}$/.test(params.get("m") ?? "") ? params.get("m")! : monthKey(new Date());
  return [m, (next) => setParams((p) => { p.set("m", next); return p; }, { replace: true })];
}

function MonthPick() {
  const [month, setMonth] = useMonth();
  const options = useMemo(() => {
    const d = new Date();
    return Array.from({ length: 6 }, (_, i) => monthKey(new Date(d.getFullYear(), d.getMonth() - i, 1)));
  }, []);
  return (
    <select className="field month-pick" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
      {options.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
    </select>
  );
}

const TABS = [
  { to: "/money", label: "Overview", end: true },
  { to: "/money/log", label: "Log" },
  { to: "/money/invoices", label: "Invoices" },
  { to: "/money/packages", label: "Packages" },
  { to: "/money/payments", label: "Payments" },
  { to: "/money/reminders", label: "Reminders" }
];

/** Money header + tabs (Figma 06 · I2/I5/I6/I7). */
export function MoneyFrame({ actions, children, month = true, title = "Money", eyebrow, meta }: { actions?: ReactNode; children: ReactNode; month?: boolean; title?: string; eyebrow?: string; meta?: ReactNode }) {
  const [params] = useSearchParams();
  const q = params.get("m") ? `?m=${params.get("m")}` : "";
  return (
    <div className="money-page">
      <header className="money-top">
        <h1>{eyebrow && <span className="money-top__eyebrow">{eyebrow}</span>}{title}</h1>
        {month && <MonthPick />}
        <span className="money-top__spacer" />
        {meta && <span className="money-top__meta">{meta}</span>}
        {actions}
      </header>
      <nav className="money-tabs" aria-label="Money sections">
        {TABS.map((t) => (
          <NavLink key={t.to} to={`${t.to}${q}`} end={t.end} className={({ isActive }) => `money-tab${isActive ? " is-on" : ""}`}>{t.label}</NavLink>
        ))}
      </nav>
      <div className="money-body">{children}</div>
    </div>
  );
}

function Kpi({ label, value, tone, to }: { label: string; value: string | number; tone?: "warn" | "ok" | "bad"; to?: string }) {
  const body = (<><small>{label}</small><b>{value}</b></>);
  return to ? <Link to={to} className={`kpi${tone ? ` kpi--${tone}` : ""}`}>{body}</Link> : <div className={`kpi${tone ? ` kpi--${tone}` : ""}`}>{body}</div>;
}

export function DraftButton({ month }: { month: string }) {
  const adapter = useAdapter();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <Button icon={<FileText aria-hidden="true" />} disabled={busy} onClick={async () => { setBusy(true); try { await adapter.mutate("money/run", { month }); nav("/money/invoices"); } finally { setBusy(false); } }}>
      Draft {monthLabel(month).split(" ")[0]} invoices
    </Button>
  );
}

// ---------- Overview ----------

interface Overview {
  month: string; label: string;
  kpis: { notInvoicedCents: number; billableSessions: number; lateCancels: number; makeupCredits: number; outstandingCents: number; overdue: number; overdueCents: number; claims: number; drafts: number; paidCents: number };
  recent: ListInvoice[];
  review: { id: string; kind: string; title: string; sub: string; action: string; link: string }[];
  unconfigured: { id: string; name: string; slug: string }[];
}

export function MoneyOverview() {
  const [month] = useMonth();
  const { data, error, reload } = useQuery<Overview>("money/overview", { month });
  if (error) return <ErrorState what="Money" onRetry={reload} />;
  if (!data) return <Loading label="Loading Money" />;
  const k = data.kpis;
  return (
    <MoneyFrame actions={<DraftButton month={month} />}>
      <div className="kpis">
        <Kpi label="Not invoiced yet" value={formatUSD(k.notInvoicedCents, { dropZeroCents: true })} to={`/money/log?m=${month}`} />
        <Kpi label="Waiting to be paid" value={formatUSD(k.outstandingCents, { dropZeroCents: true })} to="/money/invoices" />
        <Kpi label="Overdue" value={k.overdue ? `${k.overdue} · ${formatUSD(k.overdueCents, { dropZeroCents: true })}` : "0"} tone={k.overdue ? "bad" : undefined} to="/money/reminders" />
        <Kpi label={`Paid in ${data.label.split(" ")[0]}`} value={formatUSD(k.paidCents, { dropZeroCents: true })} tone="ok" />
      </div>
      <div className="money-grid">
        <section className="money-col">
          <div className="sec-head"><h2>To do</h2>{data.review.length > 0 && <span className="pill-count pill-count--warn">{data.review.length}</span>}</div>
          {data.review.length === 0 ? <p className="muted-note">Nothing waiting. Drafts appear on the 1st; claims and reminders show up here.</p> : (
            <div className="inv-list">
              {data.review.map((r) => (
                <Link key={r.id} to={r.link} className="inv-row">
                  <span className="inv-row__main"><b>{r.title}</b><small>{r.sub}</small></span>
                  <span className="tag tag--info">{r.action}</span>
                  <ChevronRight className="chev" aria-hidden="true" />
                </Link>
              ))}
            </div>
          )}
          <div className="sec-head"><h2>Recent invoices</h2><span className="sec-head__spacer" /><Link className="link" to="/money/invoices">All invoices</Link></div>
          <InvoiceRows rows={data.recent} />
        </section>
        <aside className="money-col">
          <section className="card-box">
            <h2>{data.label}</h2>
            <dl className="kv">
              <dt>Billable sessions</dt><dd>{k.billableSessions}</dd>
              <dt>Late cancels · billable</dt><dd>{k.lateCancels}</dd>
              <dt>Makeup credits open</dt><dd>{k.makeupCredits}</dd>
              <dt>Drafts waiting</dt><dd>{k.drafts}</dd>
              <dt>Payer says paid</dt><dd>{k.claims}</dd>
            </dl>
          </section>
          {data.unconfigured.length > 0 && (
            <section className="card-box">
              <h3>Set up billing</h3>
              <p className="muted-note">These spaces have no price yet, so their sessions aren't billed.</p>
              <ul className="more-list" role="list">
                {data.unconfigured.map((s) => <li key={s.id}><Link to={`/s/${s.slug}/billing`}><Plus aria-hidden="true" />{s.name}</Link></li>)}
              </ul>
            </section>
          )}
          <p className="money-foot">Money never touches Loft: invoices carry your own payment link, payers tap "I've paid", and you confirm.</p>
        </aside>
      </div>
    </MoneyFrame>
  );
}

export function InvoiceRows({ rows, empty = "No invoices yet." }: { rows: ListInvoice[]; empty?: string }) {
  if (!rows.length) return <p className="muted-note">{empty}</p>;
  return (
    <div className="inv-list">
      {rows.map((i) => (
        <Link key={i.id} to={`/money/invoices/${i.id}`} className="inv-row">
          <span className="inv-row__main"><b>{i.number ?? "Draft"} · {i.payerName}</b><small>{i.summary}</small></span>
          <Badge status={STATUS_TONE[i.status]}>{i.statusLabel}</Badge>
          <span className="inv-row__amt">{usd(i.balanceCents && i.status !== "void" && i.status !== "paid" ? i.balanceCents : i.totalCents)}</span>
          <ChevronRight className="chev" aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}

// ---------- Log (I2) ----------

interface LogData {
  month: string; label: string;
  spaces: { id: string; code: string; name: string }[];
  kpis: { notInvoicedCents: number; billableSessions: number; lateCancels: number; makeupCredits: number };
  rows: { id: string; sessionId: string; spaceId: string; spaceCode: string; spaceName: string; memberId: string; memberName: string; payerName: string | null; minutes: number; status: AttendanceStatus; billable: boolean; amountCents: number; invoiceId: string | null; invoiceNumber: string | null; at: string; title?: string; package: { used: number; size: number } | null; credit: boolean }[];
}
const LOG_STATUSES: { v: AttendanceStatus; label: string }[] = [
  { v: "attended", label: "Attended" },
  { v: "late_cancel", label: "Late cancel" },
  { v: "no_show", label: "No-show" },
  { v: "excused", label: "Excused · credit" },
  { v: "absent", label: "Absent" }
];
const statusLabel = (s: AttendanceStatus) => LOG_STATUSES.find((x) => x.v === s)?.label ?? s;

export function MoneyLog() {
  const [month] = useMonth();
  const adapter = useAdapter();
  const phone = useBreakpoint() === "phone";
  const { data, error, reload } = useQuery<LogData>("money/log", { month });
  const [space, setSpace] = useState<string>("all");
  const [status, setStatus] = useState<string>("any");
  const [invoiced, setInvoiced] = useState<string>("all");
  if (error) return <ErrorState what="the session log" onRetry={reload} />;
  if (!data) return <Loading label="Loading the session log" />;
  const rows = data.rows.filter((r) => (space === "all" || r.spaceId === space) && (status === "any" || r.status === status) && (invoiced === "all" || (invoiced === "no" ? !r.invoiceId : !!r.invoiceId)));
  const exportCsv = () => {
    const csv = toCsv(rows, [
      { key: "at", label: "Date", format: (v) => String(v).slice(0, 10) },
      { key: "spaceCode", label: "Space" },
      { key: "title", label: "Session" },
      { key: "memberName", label: "Member" },
      { key: "payerName", label: "Payer", format: (v) => (v ? String(v) : "no payer") },
      { key: "minutes", label: "Minutes" },
      { key: "status", label: "Status", format: (v) => statusLabel(v as AttendanceStatus) },
      { key: "amountCents", label: "Amount (USD)", format: (v) => (Number(v) / 100).toFixed(2) },
      { key: "invoiceNumber", label: "Invoice", format: (v) => (v ? String(v) : "") }
    ]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `loft-session-log-${month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <MoneyFrame actions={<><Button variant="secondary" icon={<Download aria-hidden="true" />} onClick={exportCsv}>{phone ? "CSV" : "Export CSV"}</Button>{!phone && <DraftButton month={month} />}</>}>
      <div className="kpis">
        <Kpi label="Not invoiced yet" value={formatUSD(data.kpis.notInvoicedCents, { dropZeroCents: true })} />
        <Kpi label="Billable sessions" value={data.kpis.billableSessions} />
        <Kpi label="Late cancels · billable" value={data.kpis.lateCancels} tone="warn" />
        <Kpi label="Makeup credits" value={data.kpis.makeupCredits} tone="ok" />
      </div>
      <div className="filter-row">
        <button type="button" className={`filter-chip${space === "all" ? " is-on" : ""}`} aria-pressed={space === "all"} onClick={() => setSpace("all")}>All spaces</button>
        {data.spaces.map((s) => <button key={s.id} type="button" className={`filter-chip${space === s.id ? " is-on" : ""}`} aria-pressed={space === s.id} onClick={() => setSpace(s.id)}>{s.code} · {s.name}</button>)}
        <span className="filter-row__spacer" />
        <select className="field" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="any">Status: any</option>
          {LOG_STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
        <select className="field" value={invoiced} onChange={(e) => setInvoiced(e.target.value)} aria-label="Invoiced filter">
          <option value="all">Invoiced or not</option>
          <option value="no">Not invoiced</option>
          <option value="yes">Invoiced</option>
        </select>
      </div>
      {rows.length === 0 ? (
        <section className="empty"><h2 className="empty__title">No sessions in {data.label}</h2><p className="empty__lead">Rows appear here when you wrap up a session (or 24 h after it ends).</p></section>
      ) : (
        <div className="mtable-wrap">
          <table className="mtable">
            <thead><tr><th>Date</th><th>Session</th><th>Member</th><th className="hide-phone">Payer</th><th className="hide-phone">Min</th><th>Status</th><th>Amount</th><th className="hide-phone">Invoice</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={!r.payerName && r.billable && !r.invoiceId ? "is-warn" : ""}>
                  <td className="mono">{dayLabel(r.at)}</td>
                  <td>{r.spaceCode} · {r.title ?? "Session"}</td>
                  <td><b>{r.memberName}</b></td>
                  <td className="hide-phone">{r.payerName ?? <span className="warn-text">no payer</span>}</td>
                  <td className="mono hide-phone">{r.minutes}</td>
                  <td>
                    {r.package ? <Badge status="neutral">Package {r.package.used}/{r.package.size}</Badge> : r.invoiceId ? (
                      <Badge status={r.status === "attended" ? "success" : r.status === "excused" ? "info" : r.status === "absent" ? "neutral" : "warning"}>{statusLabel(r.status)}</Badge>
                    ) : (
                      <select className={`field status-pick st-${r.status}`} value={r.status} aria-label={`${r.memberName} ${dayLabel(r.at)} status`} onChange={async (e) => { await adapter.mutate(`money/log/${encodeURIComponent(r.id)}`, { status: e.target.value }); }}>
                        {LOG_STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="num">{r.package ? "credit" : usd(r.amountCents)}</td>
                  <td className="hide-phone">{r.invoiceId && r.invoiceNumber !== "draft" ? <Link className="inv-link" to={`/money/invoices/${r.invoiceId}`}>{r.invoiceNumber}</Link> : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="money-foot">Rows come from wrap-up. Change a status and the amount re-prices from the space's policy. Invoiced rows are locked; edit them on the invoice.</p>
      {phone && <div className="money-sticky"><DraftButton month={month} /></div>}
    </MoneyFrame>
  );
}

// ---------- Packages (I5) ----------

interface PackagesData {
  packages: { id: string; memberName: string; spaceCode: string; plan: string; size: number; used: number; left: number; status: "awaiting" | "active" | "renewal" | "used"; priceCents: number; ledger: { id: string; kind: string; qty: number; active: boolean; at: string; note: string }[]; invoice: { id: string; number: string | null; status: InvoiceStatus } | null; renewal: { id: string; number: string | null; priceCents: number; at: string } | null }[];
  credits: { memberId: string; memberName: string; spaceCode: string; count: number; expiresAt: string | null }[];
  hourly: { name: string; code: string; plan: string }[];
  rules: { renew: boolean; renewAt: number; expire: boolean; expireDays: number; warnDays: number; excusedCredit: boolean };
  members: { spaceId: string; memberId: string; label: string; priceCents: number }[];
}
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Runs of the same entry collapse into one row: "6 Oct – 20 Nov · 6 attended sessions · −6" (I5). */
function groupLedger(rows: PackagesData["packages"][number]["ledger"]) {
  const out: { id: string; when: string; note: string; qty: number; minus: boolean; active: boolean }[] = [];
  let run: typeof rows = [];
  const flush = () => {
    if (!run.length) return;
    const first = run[0]!;
    const last = run.at(-1)!;
    const n = run.reduce((k, r) => k + r.qty, 0);
    out.push({ id: first.id, when: run.length > 1 ? `${shortDay(first.at)} – ${shortDay(last.at)}` : shortDay(first.at), note: run.length > 1 ? `${n} ${first.note.toLowerCase()} sessions` : first.note, qty: n, minus: true, active: true });
    run = [];
  };
  for (const r of rows) {
    if (r.kind === "use" && (!run.length || run[0]!.note === r.note)) {
      run.push(r);
      continue;
    }
    flush();
    if (r.kind === "use") {
      run.push(r);
      continue;
    }
    out.push({ id: r.id, when: shortDay(r.at), note: r.note, qty: r.qty, minus: r.kind === "expiry", active: r.active });
  }
  flush();
  return out;
}

const PKG_BADGE = { awaiting: ["warning", "Awaiting payment"], active: ["success", "Active"], renewal: ["info", "Renewal drafted"], used: ["neutral", "Used up"] } as const;

export function MoneyPackages() {
  const adapter = useAdapter();
  const nav = useNavigate();
  const { data, error, reload } = useQuery<PackagesData>("money/packages");
  const [sel, setSel] = useState<string | null>(null);
  const [member, setMember] = useState("");
  const [size, setSize] = useState("8");
  const [price, setPrice] = useState("");
  if (error) return <ErrorState what="packages" onRetry={reload} />;
  if (!data) return <Loading label="Loading packages" />;
  const picked = data.packages.find((p) => p.id === sel) ?? data.packages.find((p) => p.status === "renewal") ?? data.packages[0];
  const m = data.members.find((x) => `${x.spaceId}|${x.memberId}` === member) ?? data.members[0];
  const priceCents = parseUSD(price || (m ? ((m.priceCents * Number(size || 0) * 0.92) / 100).toFixed(2) : "0"));
  const rule = (patch: Partial<PackagesData["rules"]>) => adapter.mutate("money/settings", { packages: patch });
  const sell = async () => {
    if (!m || !priceCents) return;
    const r = await adapter.mutate<{ invoiceId: string }>("money/packages", { spaceId: m.spaceId, memberId: m.memberId, size: Number(size), priceCents });
    nav(`/money/invoices/${r.invoiceId}`);
  };
  return (
    <MoneyFrame month={false} actions={<Button icon={<Plus aria-hidden="true" />} onClick={() => document.getElementById("sell-member")?.focus()}>Sell a package</Button>}>
      <div className="money-grid money-grid--wide">
        <section className="money-col">
          <div className="mtable-wrap">
            <table className="mtable">
              <thead><tr><th>Member</th><th>Plan</th><th>Used</th><th>Left</th><th>Status</th></tr></thead>
              <tbody>
                {data.packages.map((p) => (
                  <tr key={p.id} onClick={() => setSel(p.id)} style={{ cursor: "pointer" }} className={picked?.id === p.id ? "is-sel" : ""}>
                    <td><button type="button" className="link-plain" onClick={() => setSel(p.id)}><b>{p.memberName}</b></button><br /><small>{p.spaceCode}</small></td>
                    <td>{p.plan}</td>
                    <td>{p.used} of {p.size}<div className={`bar${p.left <= data.rules.renewAt ? " bar--warn" : ""}`} aria-hidden="true"><i style={{ width: `${Math.min(100, (p.used / p.size) * 100)}%` }} /></div></td>
                    <td className="num">{p.left}</td>
                    <td><Badge status={PKG_BADGE[p.status][0]}>{PKG_BADGE[p.status][1]}</Badge></td>
                  </tr>
                ))}
                {data.hourly.map((h) => (
                  <tr key={h.code}><td><b>{h.name}</b><br /><small>{h.code}</small></td><td>{h.plan}</td><td>—</td><td>–</td><td><Badge status="neutral">Billed monthly</Badge></td></tr>
                ))}
                {data.credits.map((c) => (
                  <tr key={c.memberId}><td><b>{c.memberName}</b><br /><small>{c.spaceCode}</small></td><td>Makeup credit</td><td>{c.count} credit{c.count === 1 ? "" : "s"}</td><td className="num">{c.count}</td><td>{c.expiresAt ? <Badge status="warning">Expires {new Date(c.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</Badge> : <Badge status="success">Open</Badge>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {picked && (
            <section className="card-box">
              <h2>{picked.memberName} · {picked.plan}</h2>
              <ul className="ledger" role="list">
                {groupLedger(picked.ledger).map((r) => (
                  <li key={r.id}>
                    <small>{r.when}</small>
                    <span>{r.note}{!r.active ? " · not active yet" : ""}</span>
                    <span className={`q ${r.minus ? "q--minus" : "q--plus"}`}>{r.minus ? `−${r.qty}` : `+${r.qty}`}</span>
                  </li>
                ))}
                {picked.renewal && (
                  <li><small>{new Date(picked.renewal.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</small><span>Renewal drafted · <Link className="link" to={`/money/invoices/${picked.renewal.id}`}>{picked.renewal.number ?? "draft"}</Link> · {formatUSD(picked.renewal.priceCents, { dropZeroCents: true })}</span><span className="q">–</span></li>
                )}
              </ul>
            </section>
          )}
        </section>
        <aside className="money-col">
          <section className="card-box">
            <h2>Package rules</h2>
            <div className="rule-row"><span>Draft a renewal when {data.rules.renewAt} sessions are left<small>Same size and price · same payer</small></span><label className="sw"><input type="checkbox" checked={data.rules.renew} onChange={(e) => void rule({ renew: e.target.checked })} aria-label="Draft renewals" /><i /></label></div>
            <div className="rule-row"><span>Credits expire after {data.rules.expireDays} days<small>Warn the payer {data.rules.warnDays} days before</small></span><label className="sw"><input type="checkbox" checked={data.rules.expire} onChange={(e) => void rule({ expire: e.target.checked })} aria-label="Credits expire" /><i /></label></div>
            <div className="rule-row"><span>Excused absence gives a makeup credit<small>From the space policy</small></span><label className="sw"><input type="checkbox" checked={data.rules.excusedCredit} onChange={(e) => void rule({ excusedCredit: e.target.checked })} aria-label="Makeup credits" /><i /></label></div>
          </section>
          <section className="card-box">
            <h2>Sell a package</h2>
            <label className="form-col">Member
              <select id="sell-member" className="field" value={member || (m ? `${m.spaceId}|${m.memberId}` : "")} onChange={(e) => { setMember(e.target.value); setPrice(""); }}>
                {data.members.map((x) => <option key={`${x.spaceId}|${x.memberId}`} value={`${x.spaceId}|${x.memberId}`}>{x.label}</option>)}
              </select>
            </label>
            <div className="form-pair">
              <label className="form-col">Sessions<input className="field" inputMode="numeric" value={size} onChange={(e) => { setSize(e.target.value.replace(/\D/g, "")); setPrice(""); }} /></label>
              <label className="form-col">Price<span className="money-input"><span>$</span><input inputMode="decimal" value={price || (priceCents ? (priceCents / 100).toFixed(2) : "")} onChange={(e) => setPrice(e.target.value)} aria-label="Package price" /></span></label>
            </div>
            <p className="muted-note">Creates an invoice draft now; credits start when it's paid.</p>
            <Button onClick={() => void sell()} disabled={!m || !priceCents || !Number(size)}>Create draft</Button>
          </section>
        </aside>
      </div>
    </MoneyFrame>
  );
}

// ---------- Payments (I6) ----------

interface ClaimsData {
  open: { id: string; at: string; amountCents: number; method: string; reference: string; note: string; invoice: ListInvoice }[];
  unpaid: ListInvoice[];
  confirmedThisMonth: { count: number; cents: number };
}

export function MoneyPayments() {
  const adapter = useAdapter();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { data, error, reload } = useQuery<ClaimsData>("money/claims");
  const [sel, setSel] = useState<string | null>(null);
  const [part, setPart] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<string | null>(null);
  if (error) return <ErrorState what="payments" onRetry={reload} />;
  if (!data) return <Loading label="Loading payments" />;
  const wanted = params.get("invoice");
  const claim = data.open.find((c) => c.id === sel) ?? data.open.find((c) => c.invoice.id === wanted) ?? data.open[0];
  const confirm = async (amountCents?: number) => {
    if (!claim) return;
    const r = await adapter.mutate<{ receipt: string; balanceCents: number }>(`invoices/${claim.invoice.id}/confirm`, { claimId: claim.id, ...(amountCents ? { amountCents } : {}) });
    setDone(`Receipt ${r.receipt} sent to ${firstName(claim.invoice.payerName)}${r.balanceCents ? ` · ${usd(r.balanceCents)} still due` : " · paid in full"}.`);
    setPart("");
    setSel(null);
  };
  const partCents = parseUSD(part);
  return (
    <MoneyFrame month={false}>
      {done && <p className="banner-box banner-box--info" role="status"><Check aria-hidden="true" />{done}</p>}
      <div className="money-grid">
        <section className="money-col">
          <div className="sec-head"><h2>Payers told us they paid · {data.open.length}</h2></div>
          {data.open.length === 0 ? <p className="muted-note">No claims to check. When a payer taps "I've paid", it shows up here.</p> : (
            <div className="inv-list">
              {data.open.map((c) => (
                <button key={c.id} type="button" className={`inv-row claim-row${claim?.id === c.id ? " is-on" : ""}`} onClick={() => { setSel(c.id); setRejecting(false); }} aria-pressed={claim?.id === c.id}>
                  <Avatar name={c.invoice.payerName} size="sm" />
                  <span className="inv-row__main"><b>{c.invoice.payerName}</b><small>{c.invoice.number} · {usd(c.invoice.balanceCents)} · {c.method}{c.reference ? ` · ${c.reference}` : ""}</small></span>
                  {c.amountCents < c.invoice.balanceCents && <span className="tag tag--warn">part payment</span>}
                  <span className="inv-row__amt">{usd(c.amountCents)}</span>
                </button>
              ))}
            </div>
          )}
          <p className="money-foot">Confirmed this month · {data.confirmedThisMonth.count} · {formatUSD(data.confirmedThisMonth.cents, { dropZeroCents: true })}</p>
          <div className="sec-head"><h2>Paid without telling us?</h2></div>
          <p className="muted-note">Mark an invoice paid when money arrives without a claim (cash, a bank transfer you spotted).</p>
          <div className="inv-list">
            {data.unpaid.map((i) => (
              <div key={i.id} className="inv-row">
                <span className="inv-row__main"><b>{i.number} · {i.payerName}</b><small>{i.statusLabel} · {usd(i.balanceCents)} due</small></span>
                <Button size="sm" variant="secondary" onClick={async () => { const r = await adapter.mutate<{ receipt: string }>(`invoices/${i.id}/confirm`, { method: "Marked paid" }); setDone(`${i.number} marked paid · receipt ${r.receipt}.`); }}>Mark paid</Button>
              </div>
            ))}
            {data.unpaid.length === 0 && <p className="muted-note" style={{ padding: "12px 16px" }}>Every sent invoice is paid or claimed.</p>}
          </div>
        </section>
        {claim && (
          <aside className="card-box" aria-label="Claim">
            <div className="who-card"><Avatar name={claim.invoice.payerName} size="sm" /><span><b>{claim.invoice.payerName} says it's paid</b>{dateTime(claim.at)} · for {claim.invoice.number}</span></div>
            {claim.note && <div className="note-box"><small>Payer's note</small>{claim.note}</div>}
            <dl className="kv">
              <dt>Amount</dt><dd>{usd(claim.amountCents)} of {usd(claim.invoice.balanceCents)}</dd>
              <dt>Method</dt><dd>{claim.method}</dd>
              <dt>Reference</dt><dd>{claim.reference || "—"}</dd>
            </dl>
            <p className="banner-box banner-box--info"><Search aria-hidden="true" />Check your payment account{claim.reference ? ` for '${claim.reference}'` : ""}. Loft can't see your bank or payment account.</p>
            <Button block icon={<Check aria-hidden="true" />} onClick={() => void confirm()}>Confirm {usd(claim.amountCents)} · send receipt</Button>
            <label className="form-col">Got part of it?
              <div className="part-row">
                <span className="money-input"><span>$</span><input inputMode="decimal" value={part} onChange={(e) => setPart(e.target.value)} placeholder={(claim.amountCents / 200).toFixed(2)} aria-label="Part amount received" /></span>
                <Button variant="secondary" disabled={!partCents || partCents <= 0 || partCents >= claim.invoice.balanceCents} onClick={() => partCents && void confirm(partCents)}>Mark part paid</Button>
              </div>
            </label>
            <Button variant="ghost" icon={<MessageCircle aria-hidden="true" />} onClick={async () => { const r = await adapter.mutate<{ dm: string }>(`invoices/${claim.invoice.id}/ask`); nav(r.dm); }}>Can't find it · ask {firstName(claim.invoice.payerName)}</Button>
            {rejecting ? (
              <div className="pay-form">
                <label className="form-col">Why it's not confirmed (the payer sees this)<input className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Not in my account yet" /></label>
                <div className="part-row"><Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button><Button variant="danger" onClick={async () => { await adapter.mutate(`invoices/${claim.invoice.id}/reject`, { claimId: claim.id, reason }); setRejecting(false); setReason(""); setDone(`Told ${firstName(claim.invoice.payerName)} the payment wasn't found. Reminders resume.`); }}>Not received</Button></div>
              </div>
            ) : <Button variant="ghost" icon={<X aria-hidden="true" />} onClick={() => setRejecting(true)}>Not received</Button>}
            <p className="money-foot">Confirming sends a receipt, stops reminders and starts package credits.</p>
          </aside>
        )}
      </div>
    </MoneyFrame>
  );
}

// ---------- Reminders (I7) ----------

interface RemindersData { steps: ReminderStep[]; subject: string; text: string; overdue: ListInvoice[]; queued: ListInvoice[]; pausedPayers: { id: string; name: string }[] }
const STEP_LABEL = (s: ReminderStep) => (s.offsetDays < 0 ? `${-s.offsetDays} days before due` : s.offsetDays === 0 ? "On the due date" : `${s.offsetDays} days after${s.final ? " · final" : ""}`);
const CHANNELS = [["inapp", "In-app"], ["email", "Email"], ["whatsapp", "WhatsApp"]] as const;
const VARS = ["{payer_first}", "{amount}", "{invoice}", "{due}", "{pay_link}", "{members}"];

export function MoneyReminders() {
  const { data, error, reload } = useQuery<RemindersData>("money/reminders");
  if (error) return <ErrorState what="reminders" onRetry={reload} />;
  if (!data) return <Loading label="Loading reminders" />;
  return <RemindersForm data={data} />;
}

function RemindersForm({ data }: { data: RemindersData }) {
  const adapter = useAdapter();
  const [steps, setSteps] = useState(data.steps);
  const [subject, setSubject] = useState(data.subject);
  const [text, setText] = useState(data.text);
  const [saved, setSaved] = useState(false);
  const list = [...data.queued, ...data.overdue.filter((o) => !data.queued.some((q) => q.id === o.id))];
  const sample = list[0];
  const preview = sample ? reminderMessage({ payerName: sample.payerName, number: sample.number ?? "", amountCents: sample.balanceCents, dueAt: sample.dueAt ?? new Date().toISOString(), payLink: appUrl(sample.payPath), members: sample.members, template: text }) : reminderMessage({ payerName: "Tania Roy", number: "LF-0414", amountCents: 3500, dueAt: new Date().toISOString(), payLink: appUrl("/pay/example"), template: text });
  const save = async () => {
    await adapter.mutate("money/settings", { reminders: { steps, subject, text } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <MoneyFrame month={false} actions={<Button onClick={() => void save()}>{saved ? "Saved" : "Save"}</Button>}>
      <div className="money-grid money-grid--wide">
        <section className="money-col">
          <section className="card-box">
            <h2>When reminders go out</h2>
            <div className="steps">
              {steps.map((s, i) => (
                <div key={s.offsetDays} className={`step${s.final ? " step--final" : s.offsetDays > 0 ? " step--late" : ""}`}>
                  <b><i aria-hidden="true" />{STEP_LABEL(s)}</b>
                  <div className="step__ch" role="group" aria-label={`${STEP_LABEL(s)} channels`}>
                    {CHANNELS.map(([c, label]) => (
                      <label key={c}><input type="checkbox" checked={s.channels.includes(c)} onChange={(e) => setSteps(steps.map((x, k) => (k === i ? { ...x, channels: e.target.checked ? [...x.channels, c] : x.channels.filter((y) => y !== c) } : x)))} />{label}</label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="money-foot">Email and in-app go out automatically on the first visit of the day. WhatsApp can't be sent for you: those appear in To review as "Reminders to send", with one-tap links that open your own WhatsApp.</p>
          </section>
          <section className="card-box">
            <h2>Message</h2>
            <label className="form-col">Subject<input className="field" value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
            <label className="form-col">Text<textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} /></label>
            <div className="var-chips" aria-label="Insert a variable">
              {VARS.map((v) => <button key={v} type="button" onClick={() => setText((t) => `${t}${t.endsWith(" ") ? "" : " "}${v}`)}>{v}</button>)}
            </div>
          </section>
        </section>
        <aside className="money-col">
          <section className="card-box">
            <h2>Overdue now · {data.overdue.length}</h2>
            {list.length === 0 && <p className="muted-note">Nothing overdue.</p>}
            {list.map((i) => <OverdueCard key={i.id} inv={i} template={text} />)}
          </section>
          <section className="card-box">
            <h2>WhatsApp preview</h2>
            <p className="wa-bubble">{preview}</p>
          </section>
        </aside>
      </div>
    </MoneyFrame>
  );
}

function OverdueCard({ inv, template }: { inv: ListInvoice; template: string }) {
  const adapter = useAdapter();
  const msg = reminderMessage({ payerName: inv.payerName, number: inv.number ?? "", amountCents: inv.balanceCents, dueAt: inv.dueAt ?? new Date().toISOString(), payLink: appUrl(inv.payPath), members: inv.members, template, final: inv.finalSent });
  const next = inv.nextReminderDays;
  return (
    <div className="od-card">
      <div className="od-card__top"><b>{inv.payerName}</b><span>{inv.number} · {formatUSD(inv.balanceCents, { dropZeroCents: true })} left</span></div>
      <small>{inv.overdueDays ? `${inv.overdueDays} day${inv.overdueDays === 1 ? "" : "s"} overdue` : "WhatsApp reminder to send"} · {inv.paused ? "reminders paused" : inv.finalSent ? "final sent" : next !== null ? `next reminder in ${next} day${next === 1 ? "" : "s"}` : "no reminders left"}</small>
      <div className="od-card__actions">
        <a className="lf-btn lf-btn--secondary lf-btn--sm" href={whatsappLink(inv.payerPhone, msg)} target="_blank" rel="noopener noreferrer" onClick={() => void adapter.mutate(`invoices/${inv.id}/resend`, { nudge: true })}><Send aria-hidden="true" />Send nudge now</a>
        {inv.payerId && (
          <Button size="sm" variant="ghost" icon={inv.paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />} onClick={() => void adapter.mutate(`money/payers/${inv.payerId}/pause`, { paused: !inv.paused })}>{inv.paused ? "Resume" : "Pause"}</Button>
        )}
      </div>
    </div>
  );
}

