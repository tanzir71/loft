import { useState } from "react";
import { Check, CircleCheck, CreditCard, Eye, Globe, Mail } from "lucide-react";
import { Badge, Button } from "@loft/ui";
import { useAdapter, useQuery } from "../../lib/data";
import { ErrorState, Loading } from "../../components/bits";

interface BrandData {
  org: { id: string; name: string; monogram: string; theme: "loft" | "sunrise" | "northwind" | "aurelian"; slug: string; branded: boolean; brandedUntil: string | null; published: boolean; applies: Record<string, boolean> };
  active: boolean; endsInDays: number | null; ownerEmail: string; link: string; request: { to: string; subject: string; body: string };
}
// The four Figma brand-theme modes (packages/ui/tokens.json): presets keep contrast AA.
const THEMES = [
  { id: "loft", label: "Loft", primary: "#213a8c", highlight: "#fbbd23" },
  { id: "sunrise", label: "Sunrise", primary: "#841f30", highlight: "#f6b531" },
  { id: "northwind", label: "Northwind", primary: "#1a6144", highlight: "#9cdd3c" },
  { id: "aurelian", label: "Aurelian", primary: "#17150f", highlight: "#c9a96e" }
] as const;
const APPLIES: [string, string][] = [["app", "App, sign-in and room links"], ["invoices", "Invoices, receipts and pay page"], ["certificates", "Certificates and progress reports"], ["exports", "Board PDF exports"], ["templates", "Email and WhatsApp templates"], ["poweredBy", "Hide “Powered by Loft”"]];

/** Figma 04 · "Org admin · Brand studio" (on) and "· branding off (preview only)". */
export function BrandPage() {
  const { data, error, reload } = useQuery<BrandData>("brand");
  if (error) return <ErrorState what="Brand studio" onRetry={reload} />;
  if (!data) return <Loading label="Loading Brand studio" />;
  return <BrandForm key={data.org.id} data={data} />;
}

function BrandForm({ data }: { data: BrandData }) {
  const adapter = useAdapter();
  const [name, setName] = useState(data.org.name);
  const [mono, setMono] = useState(data.org.monogram);
  const [theme, setTheme] = useState(data.org.theme);
  const [slug, setSlug] = useState(data.org.slug);
  const [applies, setApplies] = useState<Record<string, boolean>>(data.org.applies ?? {});
  const [note, setNote] = useState<string | null>(null);
  const t = THEMES.find((x) => x.id === theme) ?? THEMES[0];
  const save = async (publish?: boolean) => {
    setNote(null);
    try {
      await adapter.mutate("brand", { name, monogram: mono, theme, slug, applies, ...(publish !== undefined ? { publish } : {}) });
      setNote(publish ? "Published. Your brand is live." : "Saved.");
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  const mailto = `mailto:${data.request.to}?subject=${encodeURIComponent(data.request.subject)}&body=${encodeURIComponent(data.request.body)}`;
  return (
    <div className="money-page brand-page" style={{ ["--b-primary" as string]: t.primary, ["--b-high" as string]: t.highlight }}>
      <header className="money-top">
        <h1>Brand</h1>
        {data.active ? <Badge status="danger">Branding on · to {data.org.brandedUntil ? new Date(`${data.org.brandedUntil}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</Badge> : <Badge status="danger">Branding off · preview</Badge>}
        <span className="money-top__spacer" />
        <Button variant="secondary" icon={<Eye aria-hidden="true" />} onClick={() => void save()}>Save draft</Button>
        <Button className="brand-publish" icon={<Check aria-hidden="true" />} disabled={!data.active} onClick={() => void save(true)}>{data.active ? (data.org.published ? "Publish changes" : "Publish") : "Publish · needs branding"}</Button>
      </header>
      {!data.active && (
        <p className="brand-banner"><Eye aria-hidden="true" /><span>Preview only. Set up everything here and preview it. To publish, email {data.ownerEmail || "the owner"}: branding is switched on once the invoice is paid.</span><a className="link" href={mailto} onClick={() => void adapter.mutate("brand", { requested: true })}><Mail aria-hidden="true" style={{ width: 14, height: 14, verticalAlign: "-2px" }} /> Email the request</a></p>
      )}
      <div className="money-body">
        {note && <p className="banner-box banner-box--info" role="status">{note}</p>}
        <div className="money-grid brand-grid">
          <section className="money-col">
            <section className="card-box">
              <h2>Identity</h2>
              <div className="brand-id">
                <span className="brand-mono" aria-hidden="true">{mono || "?"}</span>
                <label className="form-col" style={{ flex: 1 }}>Name<input className="field" value={name} onChange={(e) => setName(e.target.value)} /></label>
                <label className="form-col" style={{ width: 90 }}>Initials<input className="field" value={mono} maxLength={2} onChange={(e) => setMono(e.target.value.toUpperCase())} /></label>
              </div>
            </section>
            <section className="card-box">
              <h2>Colours</h2>
              <div className="brand-themes" role="radiogroup" aria-label="Colours">
                {THEMES.map((x) => (
                  <label key={x.id} className="brand-theme">
                    <input type="radio" name="theme" checked={theme === x.id} onChange={() => setTheme(x.id)} />
                    <span className="brand-sw" style={{ background: x.primary }} /><span className="brand-sw" style={{ background: x.highlight }} />
                    <b>{x.label}</b>
                  </label>
                ))}
              </div>
              <p className="muted-note" style={{ padding: 0 }}><CircleCheck aria-hidden="true" style={{ width: 14, height: 14, verticalAlign: "-2px", color: "var(--color-accent-ink)" }} /> Each set passes AA contrast on white and on its dark surfaces.</p>
            </section>
            <section className="card-box">
              <h2>Your address</h2>
              <span className="money-input"><Globe aria-hidden="true" style={{ width: 16, height: 16 }} /><span className="brand-host">{data.link.replace(/[^/]+$/, "")}</span><input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} aria-label="Address" /><Badge status={data.active && data.org.published ? "success" : "neutral"}>{data.active && data.org.published ? "Live" : "Not live yet"}</Badge></span>
              <p className="muted-note" style={{ padding: 0 }}>Your branded sign-in page. Change the last part any time.</p>
            </section>
            <section className="card-box">
              <h2>Applies to</h2>
              {APPLIES.map(([k, label]) => <label key={k} className="switch-row">{label}<span className="sw"><input type="checkbox" checked={applies[k] !== false} onChange={(e) => setApplies({ ...applies, [k]: e.target.checked })} aria-label={label} /><i /></span></label>)}
            </section>
          </section>
          <aside className="money-col">
            <span className="eyebrow-mono">Live preview</span>
            <div className="brand-preview">
              <article className="inv-doc brand-inv">
                <header className="inv-doc__head"><span className="inv-doc__mono brand-bg">{mono}</span><span className="inv-doc__host"><b>{name}</b><small>Invoice</small></span></header>
                <div className="inv-lines"><li>Ayaan Karim · November<span className="inv-lines__amt">{slug.slice(0, 2).toUpperCase()}-0412</span></li></div>
                <div className="inv-total"><span>Total due</span><b className="brand-fg">$120.00</b></div>
                <span className="pay-bar brand-bg"><CreditCard aria-hidden="true" /><span>Pay $120.00</span></span>
              </article>
              <article className="brand-space">
                <div className="brand-space__banner brand-bg"><h3>English Literature</h3><p>ENG 201 · Grade 10</p><i aria-hidden="true">ENG</i></div>
                <p>Next · Mon 09:00</p>
                <small>{data.link.replace(/[^/]+$/, "")}{slug}</small>
              </article>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
