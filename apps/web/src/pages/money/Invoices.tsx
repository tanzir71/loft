import { useState, type ReactElement } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, Bell, Check, ChevronLeft, ChevronRight, CircleCheck, Copy, CreditCard, Download, Eye, FileText, MoreHorizontal, Pencil, Plus, Printer, Send, Trash2, UserPlus, X } from "lucide-react";
import { Avatar, Badge, Button, Sheet } from "@loft/ui";
import { formatUSD, monthRange, parseUSD, type InvoiceLine, type InvoiceStatus } from "@loft/core";
import { useAdapter, useQuery } from "../../lib/data";
import { appUrl, IS_PREVIEW } from "../../lib/env";
import { useBreakpoint } from "../../lib/media";
import { ErrorState, Loading } from "../../components/bits";
import { dateTime, dayLabel, InvoiceRows, MoneyFrame, STATUS_TONE, usd, type ListInvoice } from "./Money";

// ---------- the invoice document ----------

export interface DocLine extends InvoiceLine {
  idx: number;
  spaceCode?: string;
  who?: string;
  items: { id?: string; at: string; title: string; minutes: number; status: string; amountCents: number; who: string; recap?: string | null }[];
}
export interface DocData {
  number: string | null; payerName: string; period: string; dueAt: string | null; lines: DocLine[]; totalCents: number; paidCents: number; balanceCents: number;
  payLink: string | null; footer: string; host: { name: string; brandLine: string };
}

export function periodLabel(period: string) {
  const { start, end } = monthRange(period);
  const a = new Date(start);
  const b = new Date(Date.parse(end) - 86_400_000);
  return `${a.getDate()}–${b.getDate()} ${b.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`;
}
const initials = (n: string) => n.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();

/** The invoice as the payer sees it: grouped lines (I3 preview) or one row per session (I4, pay page, print). */
export function InvoiceDoc({ d, mode = "items", onAsk, payable = true }: { d: DocData; mode?: "grouped" | "items"; onAsk?: (idx: number) => void; payable?: boolean }) {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <article className="inv-doc" aria-label={`Invoice ${d.number ?? "draft"}`}>
      <header className="inv-doc__head">
        <span className="inv-doc__mono" aria-hidden="true">{initials(d.host.name)}</span>
        <span className="inv-doc__host"><b>{d.host.name}</b>{d.host.brandLine && <small>{d.host.brandLine}</small>}</span>
        <span className="inv-doc__no"><small>INVOICE</small>{d.number ?? "Draft"}</span>
      </header>
      <div className="inv-doc__meta">
        <div><small>Billed to</small><span>{d.payerName}</span></div>
        <div><small>Period</small><span>{periodLabel(d.period)}</span></div>
        <div><small>Due</small><span>{d.dueAt ? dayLabel(d.dueAt) : "On sending"}</span></div>
      </div>
      <ul className="inv-lines" role="list">
        {d.lines.map((l) => {
          if (mode === "grouped" || !l.items.length) {
            return (
              <li key={l.idx}>
                <span className="inv-lines__main"><span>{l.description.split(" · ")[0]}{l.spaceCode ? ` · ${l.spaceCode}` : ""}</span><small>{lineDetail(l)}</small></span>
                {l.items[0]?.recap && <a className="recap" href={`#${l.items[0].recap}`} onClick={(e) => e.preventDefault()}>recap <ArrowUpRight aria-hidden="true" /></a>}
                {onAsk && <button type="button" className="ask" onClick={() => onAsk(l.idx)}>Ask</button>}
                <span className="inv-lines__amt">{usd(l.amountCents)}</span>
              </li>
            );
          }
          const shown = open[l.idx] ? l.items : l.items.slice(0, 4);
          const rest = l.items.slice(shown.length);
          return [
            ...shown.map((it, k) => (
              <li key={`${l.idx}-${k}`}>
                <span className="inv-lines__main"><span>{dayLabel(it.at)} · {it.title}</span><small>{it.minutes} min · {it.who}{it.status !== "attended" ? ` · ${it.status === "late_cancel" ? "late cancel" : it.status.replace("_", "-")}` : ""}</small></span>
                {it.recap && <Link className="recap" to={it.recap}>recap <ArrowUpRight aria-hidden="true" /></Link>}
                {onAsk && k === 0 && <button type="button" className="ask" onClick={() => onAsk(l.idx)}>Ask</button>}
                <span className="inv-lines__amt">{usd(it.amountCents)}</span>
              </li>
            )),
            rest.length ? (
              <li key={`${l.idx}-more`}>
                <span className="inv-lines__main"><button type="button" className="link" onClick={() => setOpen({ ...open, [l.idx]: true })}>+ {rest.length} more session{rest.length === 1 ? "" : "s"}</button><small>{dayLabel(rest.at(-1)!.at)} – {dayLabel(rest[0]!.at)}</small></span>
                <span className="inv-lines__amt">{usd(rest.reduce((n, x) => n + x.amountCents, 0))}</span>
              </li>
            ) : null
          ];
        })}
      </ul>
      <div className="inv-total"><span>{d.paidCents > 0 && d.balanceCents > 0 ? "Left to pay" : "Total due"}</span><b>{usd(d.paidCents > 0 && d.balanceCents > 0 ? d.balanceCents : d.totalCents)}</b></div>
      {d.paidCents > 0 && d.balanceCents > 0 && <p className="inv-foot">{usd(d.totalCents)} total · {usd(d.paidCents)} received</p>}
      {payable && d.balanceCents > 0 && (d.payLink ? (
        <a className="pay-bar" href={d.payLink.startsWith("http") ? d.payLink : `https://${d.payLink}`} target="_blank" rel="noopener noreferrer"><CreditCard aria-hidden="true" /><span>Pay {usd(d.balanceCents || d.totalCents)}</span><span className="pay-bar__link">{d.payLink.replace(/^https?:\/\//, "")}</span></a>
      ) : <span className="pay-bar pay-bar--none"><CreditCard aria-hidden="true" /><span>No payment link yet · set one in Money</span></span>)}
      {d.footer && <p className="inv-foot">{d.footer}</p>}
    </article>
  );
}

function lineDetail(l: DocLine) {
  if (l.kind === "sessions") return `${l.qty} session${l.qty === 1 ? "" : "s"} × ${usd(l.unitCents)}`;
  if (l.kind === "hours") return `${l.description.split(" · ").slice(1).join(" · ")} × ${usd(l.unitCents)}/h`;
  if (l.kind === "credit") return `${l.qty} × ${usd(-l.unitCents)} makeup credit`;
  if (l.kind === "monthly") return `Monthly · ${l.description.split(" · ").slice(1).join(" · ")}`;
  return l.description.split(" · ").slice(1).join(" · ") || (l.kind === "adjustment" ? "Adjustment" : "");
}

// ---------- Invoices tab: draft run (I3) + sent invoices ----------

interface InvoicesData { draftPeriod: string | null; draftLabel: string | null; ready: ListInvoice[]; attention: ListInvoice[]; sent: ListInvoice[]; footer: string }
export interface DetailData extends ListInvoice, DocData {
  lines: DocLine[];
  payments: { id: string; amountCents: number; at: string; receipt: string; method: string }[];
  claims: { id: string; at: string; amountCents: number; method: string; reference: string; note: string; status: string; reason?: string }[];
  comments: { id: string; lineIdx: number | null; name: string; body: string; at: string; fromPayer: boolean }[];
  activity: { kind: string; at: string; text: string }[];
  viewCount: number;
  payer: { id: string; name: string; email: string; phone: string | null; pays: string[]; invoices: number; record: string } | null;
  revisionOf: { id: string; number: string | null } | null;
  replacedBy: { id: string; number: string | null } | null;
  template: string;
}

export function MoneyInvoices() {
  const adapter = useAdapter();
  const phone = useBreakpoint() === "phone";
  const { data, error, reload } = useQuery<InvoicesData>("money/invoices");
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [via, setVia] = useState({ email: true, whatsapp: true, inapp: true });
  const [sentNow, setSentNow] = useState<ListInvoice[] | null>(null);
  const [addPayer, setAddPayer] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "overdue" | "paid">("all");
  if (error) return <ErrorState what="invoices" onRetry={reload} />;
  if (!data) return <Loading label="Loading invoices" />;
  const selected = picked ?? new Set(data.ready.map((r) => r.id));
  const chosen = data.ready.filter((r) => selected.has(r.id));
  const total = chosen.reduce((n, r) => n + r.totalCents, 0);
  const previewId = preview && [...data.ready, ...data.attention].some((r) => r.id === preview) ? preview : data.ready[0]?.id ?? null;
  const send = async () => {
    const r = await adapter.mutate<{ sent: ListInvoice[] }>("invoices/send", { ids: chosen.map((c) => c.id), ...via });
    setSentNow(r.sent);
    setPicked(null);
  };
  const sent = data.sent.filter((i) => filter === "all" || (filter === "paid" ? i.status === "paid" : filter === "overdue" ? i.status === "overdue" : !["paid", "void"].includes(i.status)));
  const hasDrafts = data.ready.length + data.attention.length > 0;
  return (
    <MoneyFrame
      month={false}
      eyebrow={hasDrafts ? "Money · invoices" : undefined}
      title={hasDrafts ? `Draft invoices · ${data.draftLabel}` : "Money"}
      meta={hasDrafts && !phone ? `${chosen.length} payer${chosen.length === 1 ? "" : "s"} · ${usd(total)}` : undefined}
      actions={hasDrafts && !phone ? <Button icon={<Send aria-hidden="true" />} disabled={!chosen.length} onClick={() => void send()}>Send {chosen.length} ready</Button> : undefined}
    >
      {sentNow && <SentResult sent={sentNow} via={via} onClose={() => setSentNow(null)} />}
      {hasDrafts ? (
        <div className="money-grid">
          <section className="money-col">
            <div className="sec-head">
              <h2>Ready</h2><span className="pill-count">{data.ready.length}</span><span className="sec-head__spacer" />
              {data.ready.length > 0 && <label className="check-row"><input type="checkbox" checked={chosen.length === data.ready.length} onChange={(e) => setPicked(new Set(e.target.checked ? data.ready.map((r) => r.id) : []))} /> Select all</label>}
            </div>
            {data.ready.length > 0 && (
              <div className="inv-list">
                {data.ready.map((r) => (
                  <div key={r.id} className={`inv-row${previewId === r.id ? " is-on" : ""}`}>
                    <input type="checkbox" checked={selected.has(r.id)} aria-label={`Send to ${r.payerName}`} onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(r.id); else n.delete(r.id); setPicked(n); }} />
                    <button type="button" className="inv-row__main" onClick={() => setPreview(r.id)}><b>{r.payerName}</b><small>{r.summary}</small></button>
                    {r.tags.map((t) => <span key={t} className={`tag ${t.startsWith("credit") ? "tag--ok" : "tag--info"}`}>{t}</span>)}
                    <span className="inv-row__amt">{usd(r.totalCents)}</span>
                    <Link to={`/money/invoices/${r.id}`} aria-label={`Open draft for ${r.payerName}`}><ChevronRight className="chev" aria-hidden="true" /></Link>
                  </div>
                ))}
              </div>
            )}
            {data.attention.length > 0 && (
              <>
                <div className="sec-head"><h2>Needs attention</h2><span className="pill-count pill-count--warn">{data.attention.length}</span></div>
                <div className="inv-list">
                  {data.attention.map((r) => (
                    <div key={r.id} className={`inv-row${previewId === r.id ? " is-on" : ""}`}>
                      <AlertTriangle className="warn-ic" aria-hidden="true" />
                      <button type="button" className="inv-row__main" onClick={() => setPreview(r.id)}><b>{r.payerName}</b><small>{r.summary} · {usd(r.totalCents)} · {r.needsAttention}</small></button>
                      <Button size="sm" variant="secondary" icon={<UserPlus aria-hidden="true" />} onClick={() => setAddPayer(r.id)}>Add payer</Button>
                    </div>
                  ))}
                </div>
              </>
            )}
            <p className="money-foot">Drafts are built from unbilled log rows, grouped by payer. Nothing is sent until you press Send. Edit any draft before sending; skipped drafts stay as drafts.</p>
          </section>
          <aside className="money-col">
            {previewId && <DraftPreview id={previewId} />}
            <div className="send-via" role="group" aria-label="Send via">
              Send via
              <label><input type="checkbox" checked={via.email} onChange={(e) => setVia({ ...via, email: e.target.checked })} /> Email</label>
              <label><input type="checkbox" checked={via.whatsapp} onChange={(e) => setVia({ ...via, whatsapp: e.target.checked })} /> WhatsApp link</label>
              <label><input type="checkbox" checked={via.inapp} onChange={(e) => setVia({ ...via, inapp: e.target.checked })} /> In-app</label>
            </div>
            {IS_PREVIEW && via.email && <p className="money-foot">Preview: email is simulated here. In production your server sends it.</p>}
          </aside>
        </div>
      ) : (
        <section className="empty">
          <h2 className="empty__title">No drafts waiting</h2>
          <p className="empty__lead">Drafts are made for you on the 1st of each month from the session log. You can also draft them now from the Log tab.</p>
          <Link className="lf-btn lf-btn--secondary" to="/money/log">Open the log</Link>
        </section>
      )}
      <div className="sec-head"><h2>Sent</h2><span className="sec-head__spacer" />
        {(["all", "open", "overdue", "paid"] as const).map((f) => <button key={f} type="button" className={`filter-chip${filter === f ? " is-on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "open" ? "Waiting" : f === "overdue" ? "Overdue" : "Paid"}</button>)}
      </div>
      <InvoiceRows rows={sent} empty="Nothing here yet." />
      {phone && hasDrafts && <div className="money-sticky"><Button icon={<Send aria-hidden="true" />} disabled={!chosen.length} onClick={() => void send()}>Send {chosen.length} ready · {usd(total)}</Button></div>}
      {addPayer && <AddPayerSheet invoiceId={addPayer} onClose={() => setAddPayer(null)} />}
    </MoneyFrame>
  );
}

function DraftPreview({ id }: { id: string }) {
  const { data } = useQuery<DetailData>(`invoices/${id}`);
  if (!data) return <div className="skeleton skeleton--hero" />;
  return (
    <>
      <div className="preview-head"><span className="eyebrow-mono">Preview · {data.number ?? "next number on send"}</span><Link className="link" to={`/money/invoices/${id}`}>Edit</Link></div>
      <InvoiceDoc d={data} mode="grouped" />
    </>
  );
}

function SentResult({ sent, via, onClose }: { sent: ListInvoice[]; via: { whatsapp: boolean }; onClose: () => void }) {
  return (
    <section className="card-box" role="status">
      <div className="card-box__head"><h3><CircleCheck aria-hidden="true" style={{ width: 18, height: 18, verticalAlign: "-3px" }} /> Sent {sent.length} invoice{sent.length === 1 ? "" : "s"}</h3><button type="button" className="lf-icon-btn" onClick={onClose} aria-label="Dismiss"><X aria-hidden="true" /></button></div>
      {via.whatsapp ? (
        <>
          <p className="muted-note">WhatsApp can't be sent for you. Tap each link to open your own WhatsApp with the message ready.</p>
          <ul className="more-list" role="list">
            {sent.map((s) => (
              <li key={s.id}><a href={`https://wa.me/${(s.payerPhone ?? "").replace(/\D/g, "")}?text=${encodeURIComponent(`Hi ${s.payerName.split(" ")[0]}, your invoice ${s.number} for ${usd(s.totalCents)} is ready: ${appUrl(s.payPath)}`)}`} target="_blank" rel="noopener noreferrer"><Send aria-hidden="true" />{s.number} · WhatsApp {s.payerName}</a></li>
            ))}
          </ul>
        </>
      ) : <p className="muted-note">{sent.map((s) => s.number).join(", ")}</p>}
    </section>
  );
}

interface BillingInfo { space: { id: string }; billing: { per: string }; people: { id: string; name: string }[]; members: { memberId: string; name: string }[] }

function AddPayerSheet({ invoiceId, onClose }: { invoiceId: string; onClose: () => void }) {
  const adapter = useAdapter();
  const { data: inv } = useQuery<DetailData>(`invoices/${invoiceId}`);
  const line = inv?.lines[0];
  const { data: b } = useQuery<BillingInfo>(line ? `spaces/${line.spaceId}/billing` : null);
  const [payer, setPayer] = useState("");
  const memberId = line?.memberId?.startsWith("space:") ? "*" : line?.memberId ?? "";
  const options = b ? [...(memberId && memberId !== "*" ? b.people.filter((p) => p.id === memberId).map((p) => ({ ...p, name: `${p.name} (pays for themself)` })) : []), ...b.people.filter((p) => p.id !== memberId)] : [];
  const save = async () => {
    if (!line || !payer) return;
    await adapter.mutate(`spaces/${line.spaceId}/billing/payer`, { memberId, payerId: payer });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title="Add payer" actions={<div className="sheet-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void save()} disabled={!payer}>Save payer</Button></div>}>
      <h2 className="sheet-title">Who pays for {inv?.payerName ?? "this member"}?</h2>
      <label className="form-col">Payer
        <select className="field" value={payer} onChange={(e) => setPayer(e.target.value)} autoFocus>
          <option value="">Choose a person</option>
          {options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <p className="muted-note">Their unbilled sessions move to this payer and the draft moves to Ready. You can change it later in the space's Billing tab.</p>
    </Sheet>
  );
}

// ---------- Invoice detail (I4) ----------

export function InvoiceDetail() {
  const { id = "" } = useParams();
  const adapter = useAdapter();
  const nav = useNavigate();
  const phone = useBreakpoint() === "phone";
  const { data: d, error, reload } = useQuery<DetailData>(`invoices/${id}`);
  const [params, setParams] = useSearchParams();
  const editParam = params.get("edit") === "1";
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState("");
  const [copied, setCopied] = useState(false);
  const [more, setMore] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (error) return <ErrorState what="this invoice" onRetry={reload} />;
  if (!d) return <Loading label="Loading invoice" />;
  const status: InvoiceStatus = d.status;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(appUrl(d.payPath));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setNote(appUrl(d.payPath));
    }
  };
  const revise = async (thenAdd = false) => {
    if (d.status === "draft") {
      setEditing(true);
      return;
    }
    const r = await adapter.mutate<{ id: string }>(`invoices/${d.id}/revise`);
    nav(`/money/invoices/${r.id}${thenAdd ? "?edit=1" : ""}`);
  };
  const primary = status === "claimed" ? (
    <Button icon={<Check aria-hidden="true" />} onClick={() => nav(`/money/payments?invoice=${d.id}`)}>Confirm payment</Button>
  ) : status === "draft" ? (
    <Button icon={<Send aria-hidden="true" />} disabled={!d.payerId} onClick={async () => { await adapter.mutate("invoices/send", { ids: [d.id] }); setNote("Sent. The payer gets an in-app notice and a pay link."); }}>Send</Button>
  ) : d.balanceCents > 0 && status !== "void" ? (
    <Button icon={<Check aria-hidden="true" />} onClick={async () => { const r = await adapter.mutate<{ receipt: string }>(`invoices/${d.id}/confirm`, { method: "Marked paid" }); setNote(`Marked paid · receipt ${r.receipt}.`); }}>Mark paid</Button>
  ) : null;
  const moreList = (
    <ul className="more-list" role="list">
      {status !== "void" && status !== "paid" && <li><button type="button" onClick={() => void revise()}><Pencil aria-hidden="true" />{d.status === "draft" ? "Edit lines" : `Edit lines (creates revision ${d.number?.endsWith("-B") ? "C" : "B"})`}</button></li>}
      {status !== "void" && status !== "paid" && <li><button type="button" onClick={() => void revise(true)}><Plus aria-hidden="true" />Add a discount or fee</button></li>}
      {d.status !== "draft" && <li><button type="button" onClick={() => void copy()}><Copy aria-hidden="true" />{copied ? "Copied" : "Copy pay link"}</button></li>}
      {d.status !== "draft" && <li><a href={appUrl(d.payPath)} target="_blank" rel="noopener noreferrer"><Eye aria-hidden="true" />Open the payer's view</a></li>}
      {d.status === "sent" && <li><button type="button" onClick={async () => { await adapter.mutate(`invoices/${d.id}/resend`); setNote("Resent in-app."); }}><Send aria-hidden="true" />Resend</button></li>}
      <li><Link to={`/print/invoice/${d.id}`}><Printer aria-hidden="true" />Print or save as PDF</Link></li>
      {status !== "void" && <li><button type="button" className="danger" onClick={() => setConfirmVoid(true)}><X aria-hidden="true" />{d.status === "draft" ? "Delete draft" : "Void invoice"}</button></li>}
    </ul>
  );
  return (
    <div className="money-page">
      <header className="money-top">
        {phone && <button type="button" className="lf-icon-btn" onClick={() => nav(-1)} aria-label="Back"><ChevronLeft aria-hidden="true" /></button>}
        <h1><span className="money-top__eyebrow">{phone ? `${d.payerName}${d.dueAt ? ` · due ${dayLabel(d.dueAt)}` : ""}` : <><Link to="/money">Money</Link> · <Link to="/money/invoices">Invoices</Link></>}</span>{d.number ?? "Draft"}</h1>
        <Badge status={STATUS_TONE[status]}>{d.statusLabel}</Badge>
        <span className="money-top__spacer" />
        {!phone && <Link className="lf-btn lf-btn--secondary" to={`/print/invoice/${d.id}`}><Download aria-hidden="true" />Download PDF</Link>}
        {!phone && primary}
      </header>
      <div className="money-body">
        {note && <p className="banner-box banner-box--info" role="status"><Check aria-hidden="true" />{note}</p>}
        {d.replacedBy && <p className="banner-box banner-box--muted">Replaced by <Link className="link" to={`/money/invoices/${d.replacedBy.id}`}>{d.replacedBy.number}</Link>.</p>}
        {d.revisionOf && d.status === "draft" && <p className="banner-box banner-box--info"><FileText aria-hidden="true" />Revision of {d.revisionOf.number}. Sending it voids the original and keeps its payments.</p>}
        {d.needsAttention && <p className="banner-box banner-box--warn"><AlertTriangle aria-hidden="true" />{d.needsAttention}: add a payer from the Invoices tab before sending.</p>}
        <div className="money-grid">
          <section className="money-col">
            <InvoiceDoc d={d} />
            <Questions d={d} reply={reply} setReply={setReply} />
          </section>
          <aside className="money-col">
            {d.payer && (
              <section className="card-box">
                <div className="who-card"><Avatar name={d.payer.name} size="sm" /><span><b>{d.payer.name}</b>{[d.payer.email, d.payer.phone].filter(Boolean).join(" · ")}</span></div>
                <p className="muted-note" style={{ padding: 0 }}>{d.payer.pays.length ? `Pays for ${d.payer.pays.join(" and ")} · ` : ""}{d.payer.invoices} invoice{d.payer.invoices === 1 ? "" : "s"} · {d.payer.record}</p>
              </section>
            )}
            <section className="card-box">
              <h2>Activity</h2>
              <ul className="act-list" role="list">
                {d.activity.map((a, i) => (
                  <li key={i}>{ACT_ICON[a.kind] ?? <FileText aria-hidden="true" />}<span>{a.text}<small>{dateTime(a.at)}</small></span></li>
                ))}
                {d.status === "sent" && d.nextReminderAt && !d.openClaims && <li><Bell aria-hidden="true" /><span>{d.paused ? "Reminders paused for this payer" : "Next reminder"}<small>{d.paused ? "Resume from Reminders" : dayLabel(new Date(d.nextReminderAt).toISOString())}</small></span></li>}
                {d.openClaims > 0 && <li><Bell aria-hidden="true" /><span>Reminders paused while you check<small>{d.nextReminderAt ? `next would be ${dayLabel(new Date(d.nextReminderAt).toISOString())}` : "no reminders left"}</small></span></li>}
              </ul>
            </section>
            {!phone && <section className="card-box"><h2>More</h2>{moreList}</section>}
          </aside>
        </div>
      </div>
      {phone && (
        <div className="money-sticky" style={{ margin: 0 }}>
          <Button variant="secondary" icon={<MoreHorizontal aria-hidden="true" />} onClick={() => setMore(true)}>More</Button>
          {primary}
        </div>
      )}
      <Sheet open={more} onClose={() => setMore(false)} title="More">{moreList}</Sheet>
      {(editing || (d.status === "draft" && editParam)) && <LineEditor d={d} addLine={editParam} onClose={() => { setEditing(false); if (editParam) setParams({}, { replace: true }); }} />}
      <Sheet open={confirmVoid} onClose={() => setConfirmVoid(false)} title={d.status === "draft" ? "Delete draft" : "Void invoice"} actions={<div className="sheet-actions"><Button variant="ghost" onClick={() => setConfirmVoid(false)}>Keep it</Button><Button variant="danger" icon={<Trash2 aria-hidden="true" />} onClick={async () => { const r = await adapter.mutate<{ deleted?: boolean }>(`invoices/${d.id}/void`); setConfirmVoid(false); if (r.deleted) nav("/money/invoices"); }}>{d.status === "draft" ? "Delete draft" : "Void"}</Button></div>}>
        <h2 className="sheet-title">{d.status === "draft" ? "Delete this draft?" : `Void ${d.number}?`}</h2>
        <p className="muted-note">{d.status === "draft" ? "Its sessions go back to the log and will be drafted again next run." : "The payer is told it's cancelled. Its sessions go back to the log, unbilled. The number is never reused."}</p>
      </Sheet>
    </div>
  );
}

const ACT_ICON: Record<string, ReactElement> = {
  drafted: <FileText aria-hidden="true" />,
  sent: <Send aria-hidden="true" />,
  viewed: <Eye aria-hidden="true" />,
  claimed: <CircleCheck aria-hidden="true" />,
  paid: <Check aria-hidden="true" />,
  paused: <Bell aria-hidden="true" />,
  reminder: <Bell aria-hidden="true" />,
  rejected: <X aria-hidden="true" />,
  void: <X aria-hidden="true" />,
  edited: <Pencil aria-hidden="true" />,
  asked: <Send aria-hidden="true" />
};

function Questions({ d, reply, setReply }: { d: DetailData; reply: string; setReply: (s: string) => void }) {
  const adapter = useAdapter();
  if (!d.comments.length && d.status === "draft") return null;
  const lineName = (idx: number | null) => {
    if (idx === null) return "";
    const l = d.lines[idx];
    const it = l?.items[0];
    return it ? ` · on '${dayLabel(it.at)} · ${it.title}'` : l ? ` · on '${l.description}'` : "";
  };
  return (
    <section className="card-box">
      <h2>Questions on this invoice</h2>
      {d.comments.length === 0 && <p className="muted-note">The payer can ask about any line from their pay page.</p>}
      <ul className="q-list" role="list">
        {d.comments.map((c) => (
          <li key={c.id}><Avatar name={c.name} size="sm" /><span><small>{c.fromPayer ? c.name : "You"}{c.fromPayer ? lineName(c.lineIdx) : ` · ${new Date(c.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}</small>{c.body}</span></li>
        ))}
      </ul>
      {d.comments.length > 0 && (
        <form className="q-reply" onSubmit={async (e) => { e.preventDefault(); if (!reply.trim()) return; await adapter.mutate(`invoices/${d.id}/comments`, { body: reply, lineIdx: d.comments.at(-1)?.lineIdx ?? null }); setReply(""); }}>
          <input className="field" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to the payer" aria-label="Reply to the payer" />
          <Button type="submit" variant="secondary" disabled={!reply.trim()}>Reply</Button>
        </form>
      )}
    </section>
  );
}

function LineEditor({ d, onClose, addLine }: { d: DetailData; onClose: () => void; addLine: boolean }) {
  const adapter = useAdapter();
  const [lines, setLines] = useState<(InvoiceLine & { text: string })[]>(() => [
    ...d.lines.map((l) => ({ ...l, text: (l.amountCents / 100).toFixed(2) })),
    ...(addLine ? [{ spaceId: d.lines[0]?.spaceId ?? "", memberId: null, description: "Discount", qty: 1, unitCents: 0, amountCents: 0, logIds: [], sessionIds: [], kind: "adjustment" as const, text: "-0.00" }] : [])
  ]);
  const save = async () => {
    await adapter.mutate(`invoices/${d.id}/lines`, { lines: lines.map(({ text, ...l }) => { const c = parseUSD(text) ?? l.amountCents; return { ...l, amountCents: c, unitCents: l.kind === "adjustment" ? c : l.unitCents }; }) });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title="Edit lines" actions={<div className="sheet-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => void save()}>Save lines</Button></div>}>
      <h2 className="sheet-title">Edit lines · {d.number ?? "draft"}</h2>
      {lines.map((l, i) => (
        <div key={i} className="part-row">
          <input className="field" value={l.description} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, description: e.target.value } : x)))} aria-label={`Line ${i + 1} description`} />
          <span className="money-input" style={{ maxWidth: 140 }}><span>$</span><input inputMode="decimal" value={l.text} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} aria-label={`Line ${i + 1} amount`} /></span>
          <button type="button" className="lf-icon-btn" aria-label={`Remove line ${i + 1}`} onClick={() => setLines(lines.filter((_, k) => k !== i))}><Trash2 aria-hidden="true" /></button>
        </div>
      ))}
      <Button variant="ghost" icon={<Plus aria-hidden="true" />} onClick={() => setLines([...lines, { spaceId: d.lines[0]?.spaceId ?? "", memberId: null, description: "Fee", qty: 1, unitCents: 0, amountCents: 0, logIds: [], sessionIds: [], kind: "adjustment", text: "0.00" }])}>Add a discount or fee</Button>
      <p className="muted-note">Use a minus amount for a discount. Total: {formatUSD(lines.reduce((n, l) => n + (parseUSD(l.text) ?? 0), 0))}</p>
    </Sheet>
  );
}

// ---------- print (A4 / Letter) ----------

export function PrintFrame({ d, back }: { d: DocData; back: () => void }) {
  const [size, setSize] = useState<"A4" | "Letter">(() => (navigator.language === "en-US" ? "Letter" : "A4"));
  return (
    <div className="print-page">
      <style>{`@page { size: ${size}; margin: 16mm; }`}</style>
      <div className="print-bar">
        <Button variant="ghost" icon={<ChevronLeft aria-hidden="true" />} onClick={back}>Back</Button>
        <span className="print-bar__spacer" />
        <select className="field month-pick" value={size} onChange={(e) => setSize(e.target.value as "A4" | "Letter")} aria-label="Paper size"><option>A4</option><option>Letter</option></select>
        <Button icon={<Printer aria-hidden="true" />} onClick={() => window.print()}>Print or save as PDF</Button>
      </div>
      <div className="print-sheet"><InvoiceDoc d={d} payable={false} />{d.payLink && d.balanceCents > 0 && <p className="inv-foot">Pay online: {d.payLink}</p>}</div>
    </div>
  );
}

export function InvoicePrint() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { data, error } = useQuery<DetailData>(`invoices/${id}`);
  if (error) return <ErrorState what="this invoice" />;
  if (!data) return <Loading label="Loading invoice" />;
  return <PrintFrame d={data} back={() => nav(`/money/invoices/${id}`)} />;
}
