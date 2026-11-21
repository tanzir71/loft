import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Link2, UserPlus } from "lucide-react";
import { Button, Sheet } from "@loft/ui";
import { DEFAULT_REMINDERS, parseUSD, type AttendanceStatus, type BillingModel, type ReminderStep, type SpaceBilling } from "@loft/core";
import { useAdapter, useQuery } from "../../lib/data";
import { ErrorState, Loading } from "../../components/bits";

interface BillingData {
  space: { id: string; name: string; slug: string; code: string; mode: string };
  billing: SpaceBilling;
  configured: boolean;
  members: { memberId: string; name: string; payerId: string | null; payerName: string | null; payerContact: string | null; self: boolean }[];
  people: { id: string; name: string; email: string; phone: string | null }[];
  defaultLink: string;
  settings: { prefix: string; nextNumber: string; footer: string; reminders: ReminderStep[] };
}

const MODELS: { v: BillingModel; label: string; sub: string }[] = [
  { v: "per_session", label: "Per session", sub: "per member, per attended session" },
  { v: "per_hour", label: "Per hour", sub: "prorated by minutes in the room" },
  { v: "monthly", label: "Monthly", sub: "flat per member per month" },
  { v: "package", label: "Package", sub: "prepaid sessions, e.g. 8 for $110" },
  { v: "free", label: "Free", sub: "no billing in this space" }
];

/** Figma 06 · I1 "Billing for this space" (the space's Billing tab, hosts only). */
export function BillingSetup({ spaceId }: { spaceId: string }) {
  const { data, error, reload } = useQuery<BillingData>(`spaces/${spaceId}/billing`);
  if (error) return <ErrorState what="billing" onRetry={reload} />;
  if (!data) return <Loading label="Loading billing" />;
  return <BillingForm key={data.space.id} data={data} />;
}

function BillingForm({ data }: { data: BillingData }) {
  const adapter = useAdapter();
  const [b, setB] = useState<SpaceBilling>(data.billing);
  const [price, setPrice] = useState((data.billing.unitPriceCents / 100).toFixed(2));
  const [next, setNext] = useState(data.settings.nextNumber);
  const [footer, setFooter] = useState(data.settings.footer);
  const [override, setOverride] = useState(!!data.billing.paymentLink);
  const [saved, setSaved] = useState(false);
  const [linkSheet, setLinkSheet] = useState(false);
  const set = (patch: Partial<SpaceBilling>) => setB((x) => ({ ...x, ...patch }));
  const billable = (s: AttendanceStatus) => b.billable.includes(s);
  const toggleBillable = (s: AttendanceStatus, on: boolean) => set({ billable: on ? [...new Set([...b.billable, s])] : b.billable.filter((x) => x !== s) });
  const save = async () => {
    const num = Number(next.replace(/^\D+-?/, ""));
    await adapter.mutate(`spaces/${data.space.id}/billing`, { billing: { ...b, unitPriceCents: parseUSD(price) ?? b.unitPriceCents, paymentLink: override ? b.paymentLink ?? "" : null }, settings: { footer, ...(num > 0 ? { nextNumber: num } : {}) } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  const steps = data.settings.reminders.length ? data.settings.reminders : DEFAULT_REMINDERS;
  const unitLabel = b.model === "per_hour" ? "per hour, prorated" : b.model === "monthly" ? "per month" : b.model === "package" ? "per session in a package" : "per attended session";
  return (
    <div className="money-col">
      <div className="sec-head">
        <div>
          <span className="eyebrow-mono">{data.space.code} · settings</span>
          <h2 style={{ font: "var(--text-display-m)" }}>Billing for this space</h2>
        </div>
        <span className="sec-head__spacer" />
        <span className="money-top__meta">Changes apply to sessions from today</span>
        <Button onClick={() => void save()}>{saved ? "Saved" : "Save"}</Button>
      </div>
      <div className="bill-grid">
        <div className="money-col">
          <section className="card-box">
            <h3>How you charge</h3>
            <div className="model-opts" role="radiogroup" aria-label="How you charge">
              {MODELS.map((m) => (
                <label key={m.v} className="model-opt">
                  <b><input type="radio" name="model" checked={b.model === m.v} onChange={() => set({ model: m.v })} />{m.label}</b>
                  <small>{m.sub}</small>
                </label>
              ))}
            </div>
            {b.model !== "free" && (
              <div className="price-row">
                <label className="form-col">Price<span className="money-input"><span>$</span><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price" /></span></label>
                <label className="form-col">Unit
                  <select className="field" value={b.per} onChange={(e) => set({ per: e.target.value as SpaceBilling["per"] })}>
                    <option value="member">per member · {unitLabel}</option>
                    <option value="session">whole space · {unitLabel}</option>
                  </select>
                </label>
                <label className="form-col">Currency<input className="field field--mono" value="USD" readOnly aria-readonly="true" /></label>
              </div>
            )}
          </section>
          <section className="card-box">
            <div className="card-box__head">
              <h3>Who pays</h3>
              {b.per === "member" && <label className="switch-row">Combine siblings on one invoice <span className="sw"><input type="checkbox" checked={b.combineSiblings} onChange={(e) => set({ combineSiblings: e.target.checked })} aria-label="Combine siblings on one invoice" /><i /></span></label>}
            </div>
            <ul className="payer-list" role="list">
              {data.members.map((m) => {
                const pid = b.payers[m.memberId] ?? null;
                const p = data.people.find((x) => x.id === pid);
                return (
                  <li key={m.memberId}>
                    <span>{m.name}</span>
                    <ArrowRight aria-hidden="true" />
                    {p ? <span>{p.name}{pid === m.memberId ? " · self" : ""}<small>{p.email || p.phone || ""}</small></span> : <span className="warn-text">No payer yet</span>}
                    <label className="sr-only" htmlFor={`payer-${m.memberId}`}>Payer for {m.name}</label>
                    <select id={`payer-${m.memberId}`} className="field" value={pid ?? ""} onChange={(e) => set({ payers: e.target.value ? { ...b.payers, [m.memberId]: e.target.value } : Object.fromEntries(Object.entries(b.payers).filter(([k]) => k !== m.memberId)) })}>
                      <option value="">{pid ? "Remove payer" : "Add payer"}</option>
                      {m.memberId !== "*" && <option value={m.memberId}>{m.name} (self)</option>}
                      {data.people.filter((x) => x.id !== m.memberId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                  </li>
                );
              })}
            </ul>
            {data.members.length === 0 && <p className="muted-note"><UserPlus aria-hidden="true" style={{ width: 14, height: 14, verticalAlign: "-2px" }} /> Invite members first; each one gets a payer here.</p>}
          </section>
          <section className="card-box">
            <h3>Attendance policy</h3>
            <div className="policy-row">Late cancel (under {b.lateCancelHours} h)
              <select className="field" value={billable("late_cancel") ? "y" : "n"} onChange={(e) => toggleBillable("late_cancel", e.target.value === "y")} aria-label="Late cancel"><option value="y">Billable</option><option value="n">Not billed</option></select>
            </div>
            <div className="policy-row">No-show
              <select className="field" value={billable("no_show") ? "y" : "n"} onChange={(e) => toggleBillable("no_show", e.target.value === "y")} aria-label="No-show"><option value="y">Billable</option><option value="n">Not billed</option></select>
            </div>
            <div className="policy-row">Excused absence
              <select className="field" value={b.excused} onChange={(e) => set({ excused: e.target.value as SpaceBilling["excused"] })} aria-label="Excused absence"><option value="makeup">Not billed · makeup credit</option><option value="none">Not billed</option></select>
            </div>
          </section>
        </div>
        <aside className="money-col">
          <section className="card-box">
            <h3>Invoices</h3>
            <div className="radio-col" role="radiogroup" aria-label="When invoices are drafted">
              <label><input type="radio" name="schedule" checked={b.schedule === "monthly"} onChange={() => set({ schedule: "monthly" })} />Monthly, on the 1st</label>
              <label><input type="radio" name="schedule" checked={b.schedule === "after_session"} onChange={() => set({ schedule: "after_session" })} />After each session</label>
              <label><input type="radio" name="schedule" checked={b.schedule === "package_out"} onChange={() => set({ schedule: "package_out" })} />When a package runs out</label>
            </div>
            <div className="form-pair">
              <label className="form-col">Due after
                <select className="field" value={b.dueDays} onChange={(e) => set({ dueDays: Number(e.target.value) })}>{[0, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d === 0 ? "On receipt" : `${d} days`}</option>)}</select>
              </label>
              <label className="form-col">Next number<input className="field field--mono" value={next} onChange={(e) => setNext(e.target.value)} /></label>
            </div>
            <label className="form-col">Footer note<input className="field" value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Thank you! Bank transfer: … · reference {ref}" /></label>
          </section>
          <section className="card-box">
            <div className="card-box__head"><h3>Payment link</h3><button type="button" className="link" onClick={() => setLinkSheet(true)}>Edit in Money</button></div>
            <span className="link-box"><Link2 aria-hidden="true" />{data.defaultLink ? data.defaultLink.replace(/^https?:\/\//, "") : "No link yet"}</span>
            <p className="muted-note" style={{ padding: 0 }}>Your default link goes on every invoice. Override it for this space only:</p>
            <label className="switch-row">Use a different link here<span className="sw"><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} aria-label="Use a different link here" /><i /></span></label>
            {override && <input className="field" value={b.paymentLink ?? ""} onChange={(e) => set({ paymentLink: e.target.value })} placeholder="https://… (use {amount} and {ref} if your link supports them)" aria-label="Payment link for this space" />}
          </section>
          <section className="card-box">
            <div className="card-box__head"><h3>Reminders</h3><Link className="link" to="/money/reminders">Change</Link></div>
            <p className="muted-note" style={{ padding: 0 }}>{steps.map((s) => (s.offsetDays < 0 ? `${-s.offsetDays} days before due` : s.offsetDays === 0 ? "on the due date" : `${s.offsetDays} days after${s.final ? " (final)" : ""}`)).join(" · ")}</p>
          </section>
        </aside>
      </div>
      {linkSheet && <PaymentLinkSheet onClose={() => setLinkSheet(false)} />}
    </div>
  );
}

interface MoneySettingsView { paymentLink: { mode: "same" | "template" | "per_payer"; link: string; template: string; perPayer: Record<string, string> } }

/** The host's default payment link: one link, a template with {amount}/{ref}, or a link per payer. */
export function PaymentLinkSheet({ onClose }: { onClose: () => void }) {
  const adapter = useAdapter();
  const { data } = useQuery<MoneySettingsView>("money/settings");
  if (!data) return null;
  return <PaymentLinkForm initial={data.paymentLink} onClose={onClose} save={(pl) => adapter.mutate("money/settings", { paymentLink: pl })} />;
}

function PaymentLinkForm({ initial, onClose, save }: { initial: MoneySettingsView["paymentLink"]; onClose: () => void; save: (pl: MoneySettingsView["paymentLink"]) => Promise<unknown> }) {
  const [pl, setPl] = useState(initial);
  return (
    <Sheet open onClose={onClose} title="Payment link" actions={<div className="sheet-actions"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={async () => { await save(pl); onClose(); }}>Save link</Button></div>}>
      <h2 className="sheet-title">Your payment link</h2>
      <p className="muted-note">Loft never handles money. Paste the link you already use (Stripe, PayPal, bKash, your bank's page). Payers pay there, then tap "I've paid".</p>
      <div className="radio-col" role="radiogroup" aria-label="Link type">
        <label><input type="radio" name="plmode" checked={pl.mode === "same"} onChange={() => setPl({ ...pl, mode: "same" })} />The same link for everyone</label>
        <label><input type="radio" name="plmode" checked={pl.mode === "template"} onChange={() => setPl({ ...pl, mode: "template" })} />A template with the amount filled in</label>
        <label><input type="radio" name="plmode" checked={pl.mode === "per_payer"} onChange={() => setPl({ ...pl, mode: "per_payer" })} />A link per payer (set on their invoice)</label>
      </div>
      <label className="form-col">Link<input className="field" value={pl.link} onChange={(e) => setPl({ ...pl, link: e.target.value })} placeholder="https://pay.example.com/you" /></label>
      {pl.mode === "template" && <label className="form-col">Template<input className="field field--mono" value={pl.template} onChange={(e) => setPl({ ...pl, template: e.target.value })} placeholder="https://pay.example.com/you?amount={amount}&ref={ref}" /></label>}
    </Sheet>
  );
}
