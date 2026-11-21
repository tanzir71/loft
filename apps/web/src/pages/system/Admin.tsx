import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Database, LayoutGrid, Link2, Palette, Plug, Shield, Video, Zap } from "lucide-react";
import { Badge, Button } from "@loft/ui";
import { formatUSD, parseUSD } from "@loft/core";
import { useAdapter, useQuery } from "../../lib/data";
import { IS_PREVIEW } from "../../lib/env";
import { useBreakpoint } from "../../lib/media";
import { ErrorState, Loading } from "../../components/bits";

interface Provider { on: boolean; keyLast4?: string | null; tokenLast4?: string | null }
interface CallsData {
  settings: { ownLink: string; stun: string; p2p: boolean; cloudflare: Provider; daily: Provider; jitsi: Provider; budgetCents: number; freeMinutes: number; neverCut: boolean; savedAt: string | null };
  pool: number | null; activeMembers: number; perMember: number | null; today: { minutes: number; videoMinutes: number }; step: string;
  last14: { day: string; minutes: number; videoMinutes: number }[]; spentCents: number;
}

/** Figma 04 · "Org admin (self-serve) · Calls & budget". Everything works with every provider off. */
export function AdminPage() {
  const phone = useBreakpoint() === "phone";
  const { data, error, reload } = useQuery<CallsData>("admin/calls");
  if (error) return <ErrorState what="Admin" onRetry={reload} />;
  if (!data) return <Loading label="Loading Admin" />;
  return (
    <div className="owner">
      {!phone && (
        <aside className="owner__side">
          <div className="owner__brand"><span className="owner__lock" aria-hidden="true"><Shield /></span><span><b>Admin</b><small>your organisation</small></span></div>
          <nav className="owner__nav" aria-label="Admin">
            <Link to="/brand" className="owner__navlink"><Palette aria-hidden="true" />Brand studio</Link>
            <button type="button" className="is-on"><Video aria-hidden="true" />Calls &amp; budget</button>
            <a href="#integrations" className="owner__navlink"><Plug aria-hidden="true" />Integrations</a>
            <Link to="/money" className="owner__navlink"><LayoutGrid aria-hidden="true" />Payment links</Link>
            <span className="owner__navlink is-off" title="Arrives in M12"><Database aria-hidden="true" />Backups &amp; updates</span>
          </nav>
          <p className="owner__foot">Every integration is optional and uses your own keys. Loft fully works with all of them off.</p>
        </aside>
      )}
      <main className="owner__main"><CallsForm key={data.settings.savedAt ?? "new"} data={data} /></main>
    </div>
  );
}

function CallsForm({ data }: { data: CallsData }) {
  const adapter = useAdapter();
  const s = data.settings;
  const [ownLink, setOwnLink] = useState(s.ownLink);
  const [stun, setStun] = useState(s.stun);
  const [budget, setBudget] = useState((s.budgetCents / 100).toFixed(2));
  const [free, setFree] = useState(String(s.freeMinutes ?? 0));
  const [neverCut, setNeverCut] = useState(s.neverCut);
  const [prov, setProv] = useState({ cloudflare: { on: s.cloudflare.on, key: "", token: "" }, daily: { on: s.daily.on, key: "" }, jitsi: { on: s.jitsi.on } });
  const [note, setNote] = useState<string | null>(null);
  const [stunTest, setStunTest] = useState<string | null>(null);
  const save = async () => {
    setNote(null);
    try {
      await adapter.mutate("admin/calls", { ownLink, stun, budgetCents: parseUSD(budget) ?? 0, freeMinutes: Number(free) || 0, neverCut, providers: prov });
      setNote("Saved.");
    } catch (e) {
      setNote((e as Error).message);
    }
  };
  // STUN test: gather ICE candidates and look for a server-reflexive one.
  const testStun = async () => {
    setStunTest("Testing…");
    try {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: `stun:${stun}` }] });
      pc.createDataChannel("t");
      let ok = false;
      pc.onicecandidate = (e) => { if (e.candidate?.type === "srflx") ok = true; };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((r) => setTimeout(r, 2500));
      pc.close();
      setStunTest(ok ? "Works: your public address was found." : "No answer from that STUN server.");
    } catch {
      setStunTest("This browser couldn't run the test.");
    }
  };
  const max = Math.max(1, ...data.last14.map((d) => d.videoMinutes), data.pool ? (data.pool * 0.8) : 1);
  return (
    <>
      <header className="money-top owner__top">
        <h1>Calls &amp; budget</h1>
        <span className="money-top__spacer" />
        {s.savedAt && <span className="money-top__meta">Saved {new Date(s.savedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
        <Button onClick={() => void save()}>Save</Button>
      </header>
      <div className="money-body">
        {note && <p className="banner-box banner-box--info" role="status">{note}</p>}
        {IS_PREVIEW && <p className="banner-box banner-box--muted">Preview: keys you type here stay in this browser and only their last 4 characters are kept. On your server they're encrypted with the install key.</p>}
        <div className="money-grid">
          <section className="money-col">
            <div><h2 className="sec-title">Providers, cheapest first</h2><p className="muted-note" style={{ padding: 0 }}>Loft always tries the top tier that fits the room. Keys are stored encrypted; only the last 4 characters are shown.</p></div>
            <section className="card-box prov">
              <div className="prov__head"><span><b>Your own Meet / Zoom link</b><small>Always on. Used when every built-in tier is capped or off, and for rooms over 12.</small></span><Badge status="neutral">Fallback</Badge></div>
              <input className="field" value={ownLink} onChange={(e) => setOwnLink(e.target.value)} placeholder="https://meet.example.com/your-room" aria-label="Your own link" />
            </section>
            <section className="card-box prov">
              <div className="prov__head"><span><b>Peer-to-peer audio</b><small>1:1 and small groups (up to 6 talking), plus stage mode (host as hub, up to 12). Free.</small></span><Badge status="success">Free</Badge></div>
              <div className="part-row"><span className="money-input"><span>STUN</span><input value={stun} onChange={(e) => setStun(e.target.value)} aria-label="STUN server" /></span><Button variant="secondary" icon={<Zap aria-hidden="true" />} onClick={() => void testStun()}>Test</Button></div>
              {stunTest && <small className="muted-note" style={{ padding: 0 }}>{stunTest}</small>}
            </section>
            <ProviderCard title="Cloudflare Realtime · TURN + SFU" sub="Bigger groups, and TURN for blocked networks. Uses your Cloudflare account." on={prov.cloudflare.on} onToggle={(on) => setProv({ ...prov, cloudflare: { ...prov.cloudflare, on } })} saved={[s.cloudflare.keyLast4, s.cloudflare.tokenLast4]}>
              <div className="part-row">
                <span className="money-input"><span>Key ID</span><input value={prov.cloudflare.key} onChange={(e) => setProv({ ...prov, cloudflare: { ...prov.cloudflare, key: e.target.value } })} placeholder={s.cloudflare.keyLast4 ? `••••${s.cloudflare.keyLast4}` : ""} aria-label="Cloudflare key ID" /></span>
                <span className="money-input"><span>API token</span><input type="password" value={prov.cloudflare.token} onChange={(e) => setProv({ ...prov, cloudflare: { ...prov.cloudflare, token: e.target.value } })} placeholder={s.cloudflare.tokenLast4 ? `••••${s.cloudflare.tokenLast4}` : ""} aria-label="Cloudflare API token" /></span>
              </div>
            </ProviderCard>
            <ProviderCard title="Daily" sub="Polished video tier, metered per participant-minute. Uses your Daily account." on={prov.daily.on} onToggle={(on) => setProv({ ...prov, daily: { ...prov.daily, on } })} saved={[s.daily.keyLast4]}>
              <span className="money-input"><span>API key</span><input type="password" value={prov.daily.key} onChange={(e) => setProv({ ...prov, daily: { ...prov.daily, key: e.target.value } })} placeholder={s.daily.keyLast4 ? `••••${s.daily.keyLast4}` : ""} aria-label="Daily API key" /></span>
            </ProviderCard>
            <ProviderCard title="Jitsi as a Service (8×8)" sub="Alternative video tier, priced per monthly active user." on={prov.jitsi.on} onToggle={(on) => setProv({ ...prov, jitsi: { on } })} saved={[]} />
            <section className="card-box" id="integrations">
              <h3>Integrations (all optional)</h3>
              <ul className="more-list" role="list">
                <li><Link to="/money"><Link2 aria-hidden="true" />Payment links · set in Money</Link></li>
                <li><span className="muted-note" style={{ padding: 0 }}>AI drafting uses your own key once you add one; until then agents work through the agent link only.</span></li>
                <li><span className="muted-note" style={{ padding: 0 }}>Email goes out with your server's mail(); SMTP is optional.</span></li>
              </ul>
            </section>
          </section>
          <aside className="money-col">
            <section className="card-box">
              <h2>Monthly call budget</h2>
              <div className="part-row"><span className="money-input" style={{ maxWidth: 140 }}><span>$</span><input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} aria-label="Monthly call budget" /></span><span className="muted-note" style={{ padding: 0 }}>per month, on top of free tiers</span></div>
              <label className="form-col">Free participant-minutes a month (from your plan)<input className="field" inputMode="numeric" value={free} onChange={(e) => setFree(e.target.value.replace(/\D/g, ""))} /></label>
              <dl className="kv note-box">
                <dt>Daily pool</dt><dd>{data.pool === null ? "P2P only" : `≈ ${data.pool} participant-min`}</dd>
                <dt>Active members (30 days)</dt><dd>{data.activeMembers}</dd>
                <dt>Per active member</dt><dd>{data.perMember === null ? "—" : `≈ ${data.perMember} min / day`}</dd>
                <dt>Today</dt><dd>{Math.round(data.today.minutes)} min{data.today.videoMinutes ? ` · ${Math.round(data.today.videoMinutes)} video` : ""}</dd>
              </dl>
              <h3>When a host's cap fills</h3>
              <ul className="cap-steps" role="list"><li><span className="tag">80%</span>Suggest switching to audio</li><li><span className="tag">100%</span>Video stops, audio continues</li><li><span className="tag">Audio capped</span>Offer the host's own link</li></ul>
              <label className="switch-row">Never cut a live session · 10 min grace<span className="sw"><input type="checkbox" checked={neverCut} onChange={(e) => setNeverCut(e.target.checked)} aria-label="Never cut a live session" /><i /></span></label>
            </section>
            <section className="card-box">
              <div className="card-box__head"><h2>Last 14 days</h2><span className="mono muted-note" style={{ padding: 0 }}>{formatUSD(data.spentCents)} spent</span></div>
              <div className="usage-chart" role="img" aria-label="Video and SFU minutes per day for the last 14 days">
                {data.pool !== null && <span className="usage-chart__cap" style={{ bottom: `${((data.pool * 0.8) / max) * 100}%` }} />}
                {data.last14.map((d) => <span key={d.day} className={`usage-chart__bar${data.pool !== null && d.videoMinutes >= data.pool * 0.8 ? " is-high" : ""}`} style={{ height: `${Math.max(2, (d.videoMinutes / max) * 100)}%` }} title={`${d.day}: ${Math.round(d.minutes)} min (${Math.round(d.videoMinutes)} video)`} />)}
              </div>
              <p className="money-foot">Bars: video + SFU minutes. Line: 80% of the daily cap. P2P audio is free and not counted against it.</p>
            </section>
          </aside>
        </div>
      </div>
    </>
  );
}

function ProviderCard({ title, sub, on, onToggle, saved, children }: { title: string; sub: string; on: boolean; onToggle: (on: boolean) => void; saved: (string | null | undefined)[]; children?: ReactNode }) {
  const connected = on && saved.some(Boolean);
  return (
    <section className="card-box prov">
      <div className="prov__head">
        <span><b>{title}</b><small>{sub}</small></span>
        <Badge status={connected ? "success" : on ? "warning" : "neutral"}>{connected ? "Keys saved" : on ? "Add keys" : "Off"}</Badge>
        <label className="sw"><input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} aria-label={title} /><i /></label>
      </div>
      {on && children}
    </section>
  );
}
