import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Calendar, ChevronRight, Copy, DoorOpen, FileCheck, Hand, LayoutDashboard, Link as LinkIcon, MessageCircle, Play, Plus, Share2, Wallet } from "lucide-react";
import { Badge, Button } from "@loft/ui";
import { formatTime, greeting, type User } from "@loft/core";
import type { LocalAdapter } from "@loft/data";
import { useAdapter, useQuery } from "../lib/data";
import { useBreakpoint } from "../lib/media";
import { PageHeader } from "../shell/PageHeader";
import { StartSheet } from "../shell/StartSheet";
import { TopBar } from "../shell/TopBar";
import { ErrorState, Loading, SectionHead, SpaceTile, whenLabel } from "../components/bits";

interface HomeSpace { id: string; slug: string; name: string; sub: string; code: string; colour: string; modeLabel: string; next: string | null }
interface TodayItem { id: string; title: string; startsAt: string; code: string; colour: string; slug: string; live: boolean; roomCode: string | null }
interface ReviewItem { id: string; kind: string; title: string; sub: string; action: string; link: string }
interface HomeData {
  me: User;
  settings: { roomLink: string; bookingPage: string | null; paymentLink: string | null; guestJoin?: boolean };
  spaces: HomeSpace[];
  today: TodayItem[];
  review: ReviewItem[];
}

export function Home() {
  const { data, error, reload } = useQuery<HomeData>("home");
  if (error) return <ErrorState what="Home" onRetry={reload} />;
  if (!data) return <Loading label="Loading Home" />;
  return data.spaces.length === 0 ? <FirstRun data={data} /> : <Hybrid data={data} />;
}

/** Figma 04 · "Host · Home (hybrid: side panel + Classroom calm)" and 05 · "Host · Home (phone)". */
function Hybrid({ data }: { data: HomeData }) {
  const bp = useBreakpoint();
  const phone = bp === "phone";
  const nav = useNavigate();
  const adapter = useAdapter();
  const [start, setStart] = useState(false);
  const first = data.me.name.split(" ")[0];
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  const startForSpace = async (s: HomeSpace) => {
    const r = await adapter.mutate<{ code: string }>("rooms", { name: s.name, spaceId: s.id });
    nav(`/r/${r.code}`);
  };

  return (
    <div className="page page--home">
      {phone ? <PageHeader title="Home" /> : (<>
        <TopBar />
        <header className="home-head">
          <h1 className="home-head__title">{greeting()}, {first}</h1>
          <p className="home-head__date">{today}</p>
        </header>
      </>)}
      <RoomLinkCard link={data.settings.roomLink} phone={phone} onStart={() => setStart(true)} />
      <div className="home-grid">
        <div className="home-main">
          <SectionHead title="Today" />
          {data.today.length === 0 ? (
            <p className="muted-note">Nothing scheduled today. <Link to="/calendar" className="link">Open the calendar</Link></p>
          ) : (
            <ul className="today" role="list">
              {data.today.map((t) => (
                <li key={t.id} className={`today-card${t.live ? " is-live" : ""}`}>
                  <span className="today-card__top">
                    <SpaceTile code={t.code} colour={t.colour} size="sm" />
                    <span className="mono">{formatTime(t.startsAt)}</span>
                    {t.live && <Badge status="live" dot={false}>LIVE</Badge>}
                  </span>
                  <b>{t.title}</b>
                  {t.live && (
                    <Button size="sm" icon={<DoorOpen aria-hidden="true" />} onClick={async () => (t.roomCode ? nav(`/r/${t.roomCode}`) : nav(`/s/${t.slug}`))}>
                      {t.roomCode ? "Rejoin" : "Open"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <SectionHead title="Your spaces" action={<Link to="/spaces/new" className="link-action">New space</Link>} />
          {phone ? (
            <ul className="space-rows" role="list">
              {data.spaces.map((s) => (
                <li key={s.id}>
                  <Link to={`/s/${s.slug}`} className="space-row">
                    <SpaceTile code={s.code} colour={s.colour} size="lg" />
                    <span className="space-row__text">
                      <b>{s.name}</b>
                      <span>{s.sub}</span>
                      {s.next && <span>Next · {whenLabel(s.next)}</span>}
                    </span>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="space-cards" role="list">
              {data.spaces.map((s) => (
                <li key={s.id} className="space-card">
                  <Link to={`/s/${s.slug}`} className={`space-card__head sc-${s.colour}`}>
                    <b>{s.name}</b>
                    <span>{s.sub}</span>
                    <i aria-hidden="true">{s.code}</i>
                  </Link>
                  <div className="space-card__foot">
                    <Calendar aria-hidden="true" />
                    <span>{s.next ? `Next · ${whenLabel(s.next)}` : "Nothing scheduled"}</span>
                    <button type="button" className="lf-icon-btn" aria-label={`Start a room in ${s.name}`} onClick={() => void startForSpace(s)}>
                      <Play aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!phone && (
          <aside className="home-rail" aria-label="Needs you">
            <section className="rail-card">
              <header>
                <h2>To review</h2>
                <span className="rail-card__count">{data.review.length}</span>
              </header>
              {data.review.length === 0 ? (
                <p className="muted-note">All caught up.</p>
              ) : (
                <ul role="list">
                  {data.review.slice(0, 5).map((r) => (
                    <li key={r.id}>
                      <Link to={r.link} className="rail-row">
                        {r.kind === "handin" ? <FileCheck aria-hidden="true" /> : r.kind === "knock" ? <Hand aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
                        <span>{r.title}<small className="rail-row__sub">{r.sub}</small></span>
                        <ChevronRight aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="rail-card">
              <header>
                <h2>Money</h2>
              </header>
              <p className="muted-note">Invoices that link every line to its session arrive in M7.</p>
              <Link to="/money" className="rail-row"><Wallet aria-hidden="true" /><span>{data.settings.paymentLink ? "Default payment link set" : "Add your payment link"}</span><ChevronRight aria-hidden="true" /></Link>
            </section>
          </aside>
        )}
      </div>
      <StartSheet open={start} onClose={() => setStart(false)} />
    </div>
  );
}

function RoomLinkCard({ link, phone, onStart }: { link: string; phone: boolean; onStart: () => void }) {
  const [guests, setGuests] = useState(true);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`https://${link}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt("Copy your room link", `https://${link}`);
    }
  };
  const toggle = (
    <label className="mini-toggle">
      <input type="checkbox" role="switch" checked={guests} onChange={(e) => setGuests(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
      <span className="mini-toggle__text">
        <b>Guests join without approval</b>
        {!phone && <small>{guests ? "On: anyone with the link walks in" : "Off: you're asked to let each guest in"}</small>}
      </span>
    </label>
  );
  if (phone) {
    return (
      <section className="link-card link-card--phone" aria-label="Your room link">
        <div className="link-card__row">
          <LinkIcon aria-hidden="true" className="link-card__ic" />
          <span className="mono link-card__url">{link}</span>
          <button type="button" className="lf-icon-btn" onClick={copy} aria-label="Copy room link"><Copy aria-hidden="true" /></button>
        </div>
        {toggle}
        <div className="link-card__actions">
          <Button variant="secondary" icon={<Share2 aria-hidden="true" />} onClick={copy}>{copied ? "Copied" : "Share"}</Button>
          <Button icon={<Play aria-hidden="true" />} onClick={onStart}>Start room</Button>
        </div>
      </section>
    );
  }
  return (
    <section className="link-card" aria-label="Your room link">
      <span className="link-card__chip" aria-hidden="true"><LinkIcon /></span>
      <span className="link-card__text">
        <b>Your room link</b>
        <span className="mono">{link}</span>
      </span>
      {toggle}
      <span className="link-card__sep" aria-hidden="true" />
      <Button variant="secondary" size="sm" icon={<Copy aria-hidden="true" />} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
      <a className="lf-btn lf-btn--secondary lf-btn--sm" href={`https://wa.me/?text=${encodeURIComponent(`Join my room: https://${link}`)}`} target="_blank" rel="noreferrer"><MessageCircle aria-hidden="true" /> WhatsApp</a>
      <Button size="sm" icon={<Play aria-hidden="true" />} onClick={onStart}>Start room</Button>
    </section>
  );
}

/** Figma 07 · "Home · first run (desktop)" and its phone version. */
function FirstRun({ data }: { data: HomeData }) {
  const bp = useBreakpoint();
  const navigate = useNavigate();
  const adapter = useAdapter();
  const [start, setStart] = useState(false);
  const first = data.me.name.split(" ")[0] ?? data.me.name;
  return (
    <div className="page page--home">
      {bp === "phone" && <PageHeader title="Home" />}
      <section className="first-run" aria-labelledby="welcome">
        <div className="first-run__icon" aria-hidden="true">
          <LayoutDashboard />
        </div>
        <h1 id="welcome" className="first-run__title">Welcome, {first}</h1>
        <p className="first-run__lead">Start a room right now, or make a space for a group you meet regularly: a client, a team, a class.</p>
        <div className="first-run__actions">
          <Button variant="secondary" icon={<Play aria-hidden="true" />} onClick={() => setStart(true)} block={bp === "phone"}>
            Start a room
          </Button>
          <Button icon={<Plus aria-hidden="true" />} onClick={() => navigate("/spaces/new")} block={bp === "phone"}>
            New space
          </Button>
        </div>
        <ul className="first-run__cards" role="list">
          <li className="setup-card">
            <LinkIcon aria-hidden="true" />
            <span className="setup-card__title">Your room link</span>
            <span className="setup-card__sub">{data.settings.roomLink}</span>
          </li>
          <li className="setup-card">
            <Calendar aria-hidden="true" />
            <span className="setup-card__title">Booking page</span>
            <span className="setup-card__sub">{data.settings.bookingPage ?? "set your hours later"}</span>
          </li>
          <li className="setup-card">
            <Wallet aria-hidden="true" />
            <span className="setup-card__title">Payment link</span>
            <span className="setup-card__sub">{data.settings.paymentLink ?? "add it once, used on every invoice"}</span>
          </li>
        </ul>
        {adapter.kind === "local" && (
          <button type="button" className="link muted-link" onClick={() => void (adapter as LocalAdapter).reset()}>
            Load the demo workspace
          </button>
        )}
      </section>
      <StartSheet open={start} onClose={() => setStart(false)} />
    </div>
  );
}
