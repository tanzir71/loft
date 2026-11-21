import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, CircleCheck, Download, MessageCircle } from "lucide-react";
import { Avatar, Badge, Button, Sheet } from "@loft/ui";
import { parseUSD, type InvoiceStatus } from "@loft/core";
import { useAdapter, useQuery } from "../../lib/data";
import { ErrorState, Loading } from "../../components/bits";
import { InvoiceDoc, PrintFrame, type DocData } from "./Invoices";
import { dateTime, STATUS_TONE, usd } from "./Money";

interface PayData extends Omit<DocData, "period"> {
  number: string; status: InvoiceStatus; statusLabel: string; period: string; periodLabel: string; sentAt: string | null;
  comments: { id: string; lineIdx: number | null; name: string; body: string; at: string; fromPayer: boolean }[];
  claims: { id: string; at: string; amountCents: number; method: string; status: string; reason: string | null }[];
  receipts: { receipt: string; amountCents: number; at: string }[];
}

const METHODS = ["Payment link", "Bank transfer", "Mobile wallet", "Cash", "Other"];

/** The payer's view of one invoice (phone-first, no sign-in: the link is the key). */
export function PayPage() {
  const { token = "" } = useParams();
  const adapter = useAdapter();
  const { data, error, reload } = useQuery<PayData>(`pay/${token}`);
  const [claiming, setClaiming] = useState(false);
  const [asking, setAsking] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(METHODS[0]!);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (error) return <div className="pay-page"><ErrorState what="this invoice" onRetry={reload} /></div>;
  if (!data) return <Loading label="Loading invoice" />;
  const open = data.claims.find((c) => c.status === "open");
  const rejected = [...data.claims].reverse().find((c) => c.status === "rejected");
  const claim = async () => {
    setBusy(true);
    try {
      await adapter.mutate(`pay/${token}/claim`, { amountCents: parseUSD(amount) ?? data.balanceCents, method, reference, note });
      setClaiming(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="pay-page">
      <header className="pay-head">
        <Avatar name={data.host.name} />
        <span className="pay-head__who"><b>{data.host.name}</b><small>Invoice {data.number} · {data.periodLabel}</small></span>
        <Badge status={STATUS_TONE[data.status]}>{data.status === "claimed" ? "Waiting for confirmation" : data.statusLabel}</Badge>
      </header>
      {data.status === "void" && <p className="banner-box banner-box--muted">This invoice was cancelled. Nothing to pay.</p>}
      {data.status === "paid" && <p className="pay-done" role="status"><CircleCheck aria-hidden="true" style={{ width: 20, height: 20, verticalAlign: "-4px" }} /> Paid in full. Thank you!</p>}
      {open && <p className="banner-box banner-box--info" role="status"><Check aria-hidden="true" />You said you paid {usd(open.amountCents)} ({open.method}) on {dateTime(open.at)}. {data.host.name.split(" ")[0]} will confirm and send a receipt. Reminders are paused.</p>}
      {rejected && !open && data.balanceCents > 0 && <p className="banner-box banner-box--warn">{data.host.name.split(" ")[0]} couldn't find your payment yet: {rejected.reason}</p>}
      <InvoiceDoc d={data} onAsk={data.status !== "void" ? (idx) => setAsking(idx) : undefined} />
      {data.balanceCents > 0 && data.status !== "void" && !open && (
        <div className="pay-actions">
          <p className="muted-note" style={{ padding: 0 }}>Pay with the link above, then tell {data.host.name.split(" ")[0]} so they can confirm it.</p>
          <Button block variant="secondary" icon={<Check aria-hidden="true" />} onClick={() => { setAmount((data.balanceCents / 100).toFixed(2)); setClaiming(true); }}>I've paid</Button>
        </div>
      )}
      {data.receipts.length > 0 && (
        <section className="card-box">
          <h3>Receipts</h3>
          <ul className="act-list" role="list">{data.receipts.map((r) => <li key={r.receipt}><CircleCheck aria-hidden="true" /><span>{r.receipt} · {usd(r.amountCents)}<small>{dateTime(r.at)}</small></span></li>)}</ul>
        </section>
      )}
      {data.comments.length > 0 && (
        <section className="card-box">
          <h3>Questions</h3>
          <ul className="q-list" role="list">{data.comments.map((c) => <li key={c.id}><Avatar name={c.name} size="sm" /><span><small>{c.fromPayer ? "You" : c.name} · {dateTime(c.at)}</small>{c.body}</span></li>)}</ul>
        </section>
      )}
      <div className="pay-actions">
        <Button variant="ghost" icon={<MessageCircle aria-hidden="true" />} onClick={() => setAsking(-1)}>Ask a question</Button>
        <Link className="lf-btn lf-btn--ghost" to={`/pay/${token}/print`}><Download aria-hidden="true" />Download PDF</Link>
      </div>
      <p className="money-foot" style={{ textAlign: "center" }}>Payments go straight to {data.host.name.split(" ")[0]}. Loft never sees your card or bank details.</p>

      <Sheet open={claiming} onClose={() => setClaiming(false)} title="I've paid" actions={<div className="sheet-actions"><Button variant="ghost" onClick={() => setClaiming(false)}>Cancel</Button><Button onClick={() => void claim()} disabled={busy || !(parseUSD(amount) ?? 0)}>Tell {data.host.name.split(" ")[0]}</Button></div>}>
        <h2 className="sheet-title">Tell {data.host.name.split(" ")[0]} you've paid</h2>
        <div className="pay-form">
          <label className="form-col">Amount<span className="money-input"><span>$</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount paid" /></span></label>
          <label className="form-col">How you paid<select className="field" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select></label>
          <label className="form-col">Receipt or reference (optional)<input className="field" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="#1093" /></label>
          <label className="form-col">Note (optional)<input className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Paid by card this morning" /></label>
        </div>
      </Sheet>
      <Sheet open={asking !== null} onClose={() => setAsking(null)} title="Ask a question" actions={<div className="sheet-actions"><Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button><Button disabled={!question.trim()} onClick={async () => { await adapter.mutate(`pay/${token}/comments`, { body: question, lineIdx: asking !== null && asking >= 0 ? asking : null }); setQuestion(""); setAsking(null); }}>Send question</Button></div>}>
        <h2 className="sheet-title">Ask about {asking !== null && asking >= 0 ? `'${data.lines[asking]?.description ?? "this line"}'` : "this invoice"}</h2>
        <textarea className="textarea" value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Your question" autoFocus />
      </Sheet>
    </main>
  );
}

export function PayPrint() {
  const { token = "" } = useParams();
  const nav = useNavigate();
  const { data, error } = useQuery<PayData>(`pay/${token}`);
  if (error) return <ErrorState what="this invoice" />;
  if (!data) return <Loading label="Loading invoice" />;
  return <PrintFrame d={data} back={() => nav(`/pay/${token}`)} />;
}
