import { forwardRef, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CalendarClock, ChevronLeft, ChevronRight, Copy, Download, DoorOpen, ExternalLink, Link as LinkIcon, Plus, Settings2, X } from "lucide-react";
import { Badge, Button, Sheet } from "@loft/ui";
import { formatTime, tzOffset } from "@loft/core";
import { useAdapter, useQuery } from "../lib/data";
import { useBreakpoint } from "../lib/media";
import { IS_PREVIEW } from "../lib/env";
import { ErrorState, Loading } from "../components/bits";

interface CalSession { id: string; spaceId: string; seriesId?: string | null; title: string; startsAt: string; minutes: number; room: "loft" | "external"; externalUrl?: string | null; status: string; spaceName: string; code: string; colour: string; slug: string; isHost: boolean; bookingId?: string | null }
interface CalRequest { id: string; kind: "move" | "cancel" | "booking"; who: string; title: string; from: string; to: string | null; free: boolean; clash: string | null; late: boolean; note: string }
interface CalData { tz: string; sessions: CalSession[]; requests: CalRequest[]; availability: { tz: string; weekly: Record<number, { start: string; end: string }[]> }; spaces: { id: string; name: string; code: string; colour: string; isHost: boolean }[]; feedToken: string; handle: string }

type ViewMode = "day" | "week" | "month";
const HOUR_PX = 56;
const START_H = 8;
const END_H = 22;
const DAY_MS = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addD = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d: Date) => addD(startOfDay(d), -((d.getDay() + 6) % 7));
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const fmtRange = (a: Date, b: Date) => `${a.getDate()}${a.getMonth() !== b.getMonth() ? ` ${a.toLocaleDateString("en-GB", { month: "short" })}` : ""} – ${b.getDate()} ${b.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`;
const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const gmt = (tz: string) => {
  const o = tzOffset(Date.now(), tz) / 3600_000;
  return `GMT${o >= 0 ? "+" : ""}${Number.isInteger(o) ? o : o.toFixed(1)}`;
};

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Figma 06 · S1 "Calendar (desktop)" and "S1 · phone · calendar agenda". */
export function CalendarPage() {
  const adapter = useAdapter();
  const nav = useNavigate();
  const phone = useBreakpoint() === "phone";
  const [params] = useSearchParams();
  const [mode, setMode] = useState<ViewMode>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const range = useMemo(() => {
    if (mode === "day") return { from: startOfDay(anchor), to: addD(startOfDay(anchor), 1) };
    if (mode === "week") return { from: mondayOf(anchor), to: addD(mondayOf(anchor), 7) };
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    return { from: mondayOf(first), to: addD(mondayOf(first), 42) };
  }, [mode, anchor]);
  const { data, error, reload } = useQuery<CalData>("calendar", phone ? { from: startOfDay(new Date()).toISOString(), to: addD(new Date(), 30).toISOString() } : { from: range.from.toISOString(), to: range.to.toISOString() });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<CalSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [scopeAsk, setScopeAsk] = useState<{ s: CalSession; startsAt: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const requestsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (params.get("requests")) requestsRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [params, data]);

  if (error) return <ErrorState what="the calendar" onRetry={reload} />;
  if (!data) return <Loading label="Loading calendar" />;
  const sessions = data.sessions.filter((s) => s.status !== "cancelled" && !hidden.has(s.spaceId));
  const bookingUrl = `${location.origin}${import.meta.env.BASE_URL}${IS_PREVIEW ? "#/" : ""}book/${data.handle}`;
  const say = (m: string) => {
    setFlash(m);
    setTimeout(() => setFlash(null), 2500);
  };
  const move = async (s: CalSession, startsAt: string, scope = "this") => {
    await adapter.mutate(`sessions/${s.id}/move`, { startsAt, scope });
    say(`${s.title} moved. Updated invites go to everyone in ${s.spaceName}.`);
  };
  const requestMove = (s: CalSession, startsAt: string) => (s.seriesId ? setScopeAsk({ s, startsAt }) : void move(s, startsAt));

  const step = (dir: number) => setAnchor((a) => (mode === "day" ? addD(a, dir) : mode === "week" ? addD(a, dir * 7) : new Date(a.getFullYear(), a.getMonth() + dir, 1)));
  const label = mode === "month" ? anchor.toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : mode === "day" ? anchor.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : fmtRange(range.from, addD(range.to, -1));

  return (
    <div className="cal-page">
      <header className="cal-top">
        <h1 className="cal-top__title">Calendar</h1>
        {!phone && (
          <>
            <div className="cal-nav">
              <button type="button" className="lf-icon-btn" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft aria-hidden="true" /></button>
              <span className="cal-nav__label">{label}</span>
              <button type="button" className="lf-icon-btn" onClick={() => step(1)} aria-label="Next"><ChevronRight aria-hidden="true" /></button>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setAnchor(new Date())}>Today</Button>
            <div className="seg" role="radiogroup" aria-label="View">
              {(["day", "week", "month"] as ViewMode[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "is-on" : ""} onClick={() => setMode(m)}>{m[0]!.toUpperCase() + m.slice(1)}</button>
              ))}
            </div>
            <span className="cal-tz" title="Times are shown in your time zone">{viewerTz} · {gmt(viewerTz)}</span>
          </>
        )}
        <span className="cal-top__spacer" />
        {!phone && <Link to="/calendar/availability" className="lf-btn lf-btn--secondary lf-btn--sm"><Settings2 aria-hidden="true" /> Availability</Link>}
        <Button size="sm" variant="secondary" icon={<LinkIcon aria-hidden="true" />} onClick={async () => { try { await navigator.clipboard.writeText(bookingUrl); say("Booking link copied."); } catch { prompt("Your booking link", bookingUrl); } }}>{phone ? "Link" : "Booking link"}</Button>
        <Button size="sm" icon={<Plus aria-hidden="true" />} onClick={() => setCreating(true)}>{phone ? "New" : "New session"}</Button>
      </header>
      {flash && <p className="flash cal-flash" role="status">{flash}</p>}
      <div className="cal-body">
        {phone ? (
          <Agenda sessions={sessions} requests={data.requests} onOpen={setOpen} />
        ) : mode === "month" ? (
          <MonthGrid from={range.from} anchor={anchor} sessions={sessions} onOpen={setOpen} onDay={(d) => { setAnchor(d); setMode("day"); }} />
        ) : (
          <WeekGrid days={mode === "day" ? [range.from] : Array.from({ length: 7 }, (_, i) => addD(range.from, i))} sessions={sessions} requests={data.requests} availability={data.availability} onOpen={setOpen} onMove={requestMove} />
        )}
        {!phone && (
          <aside className="cal-rail">
            <section className="rail-card">
              <h2>Show</h2>
              <ul className="cal-filters" role="list">
                {data.spaces.map((s) => (
                  <li key={s.id}>
                    <label>
                      <input type="checkbox" checked={!hidden.has(s.id)} onChange={(e) => setHidden((h) => { const n = new Set(h); if (e.target.checked) n.delete(s.id); else n.add(s.id); return n; })} />
                      <span className={`cal-dot sc-${s.colour}`} aria-hidden="true" /> {s.name}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
            <Requests ref={requestsRef} requests={data.requests} onDone={say} />
            <section className="rail-card">
              <h2>Your calendar feed</h2>
              <p className="muted-note">Subscribe in Google, Apple or Outlook. Updates within a few hours.</p>
              <div className="feed-box">
                <span className="mono">…/ics/{data.feedToken.slice(0, 8)}.ics</span>
                {IS_PREVIEW ? (
                  <button type="button" className="lf-icon-btn" aria-label="Download calendar file" onClick={async () => { const f = await adapter.query<{ filename: string; text: string }>("feed"); download(f.filename, f.text); }}><Download aria-hidden="true" /></button>
                ) : (
                  <button type="button" className="lf-icon-btn" aria-label="Copy feed link" onClick={() => void navigator.clipboard.writeText(`${location.origin}/spaces/api/v1/ics/${data.feedToken}.ics`)}><Copy aria-hidden="true" /></button>
                )}
              </div>
              {IS_PREVIEW && <p className="field-help">Preview: the live feed URL arrives with the server (M10). Download a snapshot instead.</p>}
            </section>
          </aside>
        )}
      </div>
      {open && <SessionSheet s={open} onClose={() => setOpen(null)} onMove={(t) => { requestMove(open, t); setOpen(null); }} onCancelled={() => { setOpen(null); say("Session cancelled. Everyone gets an updated invite."); }} onRoom={async () => { const r = await adapter.mutate<{ code: string }>(`sessions/${open.id}/room`); nav(`/r/${r.code}`); }} />}
      {creating && <NewSessionSheet spaces={data.spaces.filter((s) => s.isHost)} tz={data.tz} onClose={() => setCreating(false)} onCreated={(n) => { setCreating(false); say(`${n} session${n === 1 ? "" : "s"} added. Invites sent with calendar files.`); }} />}
      {scopeAsk && (
        <Sheet open onClose={() => setScopeAsk(null)} title="Move a session in a series">
          <h2 className="sheet-title">Move which sessions?</h2>
          <p className="muted-note">{scopeAsk.s.title} is part of a series.</p>
          <div className="scope-list">
            {(["this", "following", "all"] as const).map((scope) => (
              <Button key={scope} variant={scope === "this" ? "primary" : "secondary"} block onClick={() => { void move(scopeAsk.s, scopeAsk.startsAt, scope); setScopeAsk(null); }}>
                {scope === "this" ? "This one" : scope === "following" ? "This and following" : "All in the series"}
              </Button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function WeekGrid({ days, sessions, requests, availability, onOpen, onMove }: { days: Date[]; sessions: CalSession[]; requests: CalRequest[]; availability: CalData["availability"]; onOpen: (s: CalSession) => void; onMove: (s: CalSession, startsAt: string) => void }) {
  const today = new Date();
  const hours = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);
  const [drag, setDrag] = useState<{ id: string; dy: number; dx: number; sx: number; sy: number; colW: number } | null>(null);
  const yOf = (iso: string) => {
    const d = new Date(iso);
    return ((d.getHours() + d.getMinutes() / 60 - START_H) * HOUR_PX);
  };
  const onDown = (e: RPointerEvent, s: CalSession) => {
    if (!s.isHost || s.status === "requested") return;
    const col = (e.currentTarget as HTMLElement).parentElement!;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: s.id, dy: 0, dx: 0, sx: e.clientX, sy: e.clientY, colW: col.getBoundingClientRect().width });
  };
  const onMoveP = (e: RPointerEvent) => drag && setDrag({ ...drag, dy: e.clientY - drag.sy, dx: e.clientX - drag.sx });
  const onUp = (s: CalSession) => {
    if (!drag || drag.id !== s.id) return onOpen(s);
    const mins = Math.round((drag.dy / HOUR_PX) * 4) * 15;
    const dayShift = Math.round(drag.dx / drag.colW);
    setDrag(null);
    if (Math.abs(drag.dy) < 4 && Math.abs(drag.dx) < 4) return onOpen(s);
    if (!mins && !dayShift) return;
    onMove(s, new Date(Date.parse(s.startsAt) + mins * 60_000 + dayShift * DAY_MS).toISOString());
  };
  return (
    <div className="week" style={{ ["--cols" as string]: days.length }}>
      <div className="week__head">
        <span />
        {days.map((d) => (
          <span key={d.toISOString()} className={sameDay(d, today) ? "is-today" : ""}>{d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}</span>
        ))}
      </div>
      <div className="week__body" style={{ height: hours.length * HOUR_PX }}>
        <div className="week__hours">
          {hours.map((h) => (
            <span key={h} style={{ top: (h - START_H) * HOUR_PX }}>{String(h).padStart(2, "0")}:00</span>
          ))}
        </div>
        {days.map((d) => {
          const daySessions = sessions.filter((s) => sameDay(new Date(s.startsAt), d));
          const ranges = availability.weekly[d.getDay()] ?? [];
          const dayReqs = requests.filter((r) => r.kind === "move" && r.to && sameDay(new Date(r.to), d));
          return (
            <div key={d.toISOString()} className="week__col" onPointerMove={onMoveP}>
              {hours.map((h) => <span key={h} className="week__line" style={{ top: (h - START_H) * HOUR_PX }} aria-hidden="true" />)}
              {ranges.map((r, i) => {
                const [sh, sm] = r.start.split(":").map(Number) as [number, number];
                const [eh, em] = r.end.split(":").map(Number) as [number, number];
                return (
                  <div key={i} className="week__open" style={{ top: (sh + sm / 60 - START_H) * HOUR_PX, height: (eh + em / 60 - sh - sm / 60) * HOUR_PX }} aria-hidden="true">
                    <span>open for booking</span>
                  </div>
                );
              })}
              {daySessions.map((s) => {
                const dragging = drag?.id === s.id;
                const top = yOf(s.startsAt) + (dragging ? Math.round((drag.dy / HOUR_PX) * 4) * (HOUR_PX / 4) : 0);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`ev sc-${s.colour}${s.status === "requested" ? " ev--req" : ""}${s.bookingId ? " ev--booked" : ""}${dragging ? " is-dragging" : ""}`}
                    style={{ top, height: Math.max(22, (s.minutes / 60) * HOUR_PX - 4), transform: dragging ? `translateX(${Math.round(drag.dx / drag.colW) * 100}%)` : undefined }}
                    onPointerDown={(e) => onDown(e, s)}
                    onPointerUp={() => onUp(s)}
                    aria-label={`${s.title}, ${formatTime(s.startsAt)}, ${s.spaceName}${s.status === "requested" ? ", waiting for approval" : ""}`}
                  >
                    <b>{s.title}</b>
                    <small>{formatTime(s.startsAt)}{s.seriesId ? " · series" : ""}{s.status === "requested" ? " · request" : ""}</small>
                  </button>
                );
              })}
              {dayReqs.map((r) => (
                <div key={r.id} className="ev ev--move" style={{ top: yOf(r.to!), height: HOUR_PX - 4 }}>
                  <b>Move → {new Date(r.to!).toLocaleDateString("en-GB", { weekday: "short" })} {formatTime(r.to!)}</b>
                  <small>pending · {r.who.split(" ")[0]}</small>
                </div>
              ))}
              {sameDay(d, today) && today.getHours() >= START_H && today.getHours() < END_H && <span className="week__now" style={{ top: (today.getHours() + today.getMinutes() / 60 - START_H) * HOUR_PX }} aria-hidden="true" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthGrid({ from, anchor, sessions, onOpen, onDay }: { from: Date; anchor: Date; sessions: CalSession[]; onOpen: (s: CalSession) => void; onDay: (d: Date) => void }) {
  const today = new Date();
  return (
    <div className="month">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d} className="month__dow">{d}</span>)}
      {Array.from({ length: 42 }, (_, i) => addD(from, i)).map((d) => {
        const list = sessions.filter((s) => sameDay(new Date(s.startsAt), d));
        return (
          <div key={d.toISOString()} className={`month__cell${d.getMonth() !== anchor.getMonth() ? " is-out" : ""}${sameDay(d, today) ? " is-today" : ""}`}>
            <button type="button" className="month__num" onClick={() => onDay(d)} aria-label={d.toDateString()}>{d.getDate()}</button>
            {list.slice(0, 3).map((s) => (
              <button key={s.id} type="button" className={`month__ev sc-${s.colour}`} onClick={() => onOpen(s)}>{formatTime(s.startsAt)} {s.title}</button>
            ))}
            {list.length > 3 && <span className="month__more">+{list.length - 3} more</span>}
          </div>
        );
      })}
    </div>
  );
}

function Agenda({ sessions, requests, onOpen }: { sessions: CalSession[]; requests: CalRequest[]; onOpen: (s: CalSession) => void }) {
  const days = new Map<string, CalSession[]>();
  for (const s of sessions) {
    const k = startOfDay(new Date(s.startsAt)).toISOString();
    days.set(k, [...(days.get(k) ?? []), s]);
  }
  return (
    <div className="agenda">
      {requests.length > 0 && <Link to="/review" className="agenda__req"><CalendarClock aria-hidden="true" /> {requests.length} request{requests.length === 1 ? "" : "s"} to answer</Link>}
      {[...days.entries()].map(([k, list]) => (
        <section key={k}>
          <h2 className="list-label">{sameDay(new Date(k), new Date()) ? "Today" : new Date(k).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}</h2>
          <ul className="agenda__list" role="list">
            {list.map((s) => (
              <li key={s.id}>
                <button type="button" className={`agenda__row sc-${s.colour}${s.status === "requested" ? " ev--req" : ""}`} onClick={() => onOpen(s)}>
                  <span className="mono">{formatTime(s.startsAt)}</span>
                  <span className="agenda__text"><b>{s.title}</b><small>{s.spaceName} · {s.minutes} min{s.status === "requested" ? " · request" : ""}</small></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {days.size === 0 && <p className="muted-note">Nothing in the next 30 days.</p>}
    </div>
  );
}

const Requests = forwardRef<HTMLElement, { requests: CalRequest[]; onDone: (m: string) => void }>(function Requests({ requests, onDone }, ref) {
  const adapter = useAdapter();
  return (
    <section className="rail-card" ref={ref} id="requests">
      <h2>Requests · {requests.length}</h2>
      {requests.length === 0 && <p className="muted-note">No requests waiting.</p>}
      <ul className="req-list" role="list">
        {requests.map((r) => (
          <li key={r.id}>
            <p>
              {r.kind === "booking" ? <><b>{r.who}</b> booked {r.title.split(" · ")[0]} · {new Date(r.from).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</> : r.kind === "move" ? <><b>{r.who}</b> asks to move {new Date(r.from).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} → {new Date(r.to!).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</> : <><b>{r.who}</b> asks to cancel {r.title}</>}
            </p>
            <div className="req-checks">
              <Badge status={r.free ? "success" : "warning"}>{r.free ? "you're free" : `clash: ${r.clash}`}</Badge>
              {r.late && <Badge status="danger">late change</Badge>}
            </div>
            {r.note && <p className="req-note">“{r.note}”</p>}
            <div className="req-actions">
              <Button size="sm" onClick={async () => { await adapter.mutate(`requests/${r.id}`, { decision: "approve" }); onDone(r.kind === "booking" ? "Booking approved. The invite is on its way." : "Approved. Updated invites sent."); }}>Approve</Button>
              <Button size="sm" variant="secondary" onClick={async () => { const res = await adapter.mutate<{ suggest: string[] }>(`requests/${r.id}`, { decision: "decline" }); onDone(`Declined. Suggested: ${res.suggest.map((t) => new Date(t).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })).join(", ") || "no free times soon"}.`); }}>Decline</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
});

function SessionSheet({ s, onClose, onMove, onCancelled, onRoom }: { s: CalSession; onClose: () => void; onMove: (startsAt: string) => void; onCancelled: () => void; onRoom: () => void }) {
  const adapter = useAdapter();
  const local = new Date(Date.parse(s.startsAt) - new Date(s.startsAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  const [when, setWhen] = useState(local);
  return (
    <Sheet open onClose={onClose} title={s.title}>
      <div className="sess">
        <header className="sess__head">
          <span className={`cal-dot sc-${s.colour}`} aria-hidden="true" />
          <div>
            <h2 className="sheet-title">{s.title}</h2>
            <p className="muted-note">{new Date(s.startsAt).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · {s.minutes} min · {s.spaceName}{s.seriesId ? " · series" : ""}</p>
          </div>
          <button type="button" className="lf-icon-btn" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button>
        </header>
        <div className="sess__actions">
          <Button icon={<DoorOpen aria-hidden="true" />} onClick={onRoom}>Open board</Button>
          {s.room === "external" && s.externalUrl && <a className="lf-btn lf-btn--secondary" href={s.externalUrl} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /> Join call</a>}
          <Button variant="secondary" icon={<Download aria-hidden="true" />} onClick={async () => { const f = await adapter.query<{ filename: string; text: string }>(`sessions/${s.id}/ics`); download(f.filename, f.text); }}>Add to calendar (.ics)</Button>
        </div>
        {s.isHost && s.status !== "requested" && (
          <form className="sess__move" onSubmit={(e) => { e.preventDefault(); onMove(new Date(when).toISOString()); }}>
            <label className="field-label" htmlFor="sess-when">Move to</label>
            <div className="sess__move-row">
              <input id="sess-when" type="datetime-local" className="field" value={when} onChange={(e) => setWhen(e.target.value)} step={900} />
              <Button type="submit" variant="secondary">Move</Button>
            </div>
            <Button
              variant="ghost"
              onClick={async () => {
                const scope = s.seriesId ? (confirm("Cancel the whole rest of the series? OK = this and following, Cancel = just this one.") ? "following" : "this") : "this";
                await adapter.mutate(`sessions/${s.id}/cancel`, { scope });
                onCancelled();
              }}
            >
              Cancel session
            </Button>
          </form>
        )}
      </div>
    </Sheet>
  );
}

/** Figma 06 · S2 "New session / series": one form, clash check before anything is created. */
function NewSessionSheet({ spaces, tz, onClose, onCreated }: { spaces: CalData["spaces"]; tz: string; onClose: () => void; onCreated: (n: number) => void }) {
  const adapter = useAdapter();
  const tomorrow = addD(new Date(), 1);
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(`${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`);
  const [time, setTime] = useState("16:00");
  const [minutes, setMinutes] = useState(60);
  const [repeat, setRepeat] = useState(false);
  const [days, setDays] = useState<number[]>([tomorrow.getDay()]);
  const [count, setCount] = useState(8);
  const [room, setRoom] = useState<"loft" | "external">("loft");
  const [externalUrl, setExternalUrl] = useState("");
  const [check, setCheck] = useState<{ starts: string[]; clashes: { startsAt: string; with: string }[] } | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const body = useMemo(() => {
    const startsAt = new Date(`${date}T${time}`).toISOString();
    return { spaceId, title: title || "Session", minutes, room, externalUrl, ...(repeat ? { series: { days, time, tz: viewerTz || tz, from: date, count } } : { startsAt }) };
  }, [spaceId, title, minutes, room, externalUrl, repeat, days, time, tz, date, count]);

  useEffect(() => {
    if (!spaceId) return;
    const t = setTimeout(() => {
      void adapter.mutate<{ starts: string[]; clashes: { startsAt: string; with: string }[] }>("sessions", { ...body, dryRun: true }).then((r) => {
        setCheck(r);
        setSkip(new Set(r.clashes.map((c) => c.startsAt)));
      }).catch(() => setCheck(null));
    }, 250);
    return () => clearTimeout(t);
  }, [adapter, body, spaceId]);

  const n = (check?.starts.length ?? 1) - [...skip].filter((s) => check?.starts.includes(s)).length;
  return (
    <Sheet
      open
      onClose={onClose}
      title="New session"
      actions={
        <div className="sheet-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!spaceId || busy || n <= 0}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await adapter.mutate<{ created: number }>("sessions", { ...body, skip: [...skip] });
                onCreated(r.created);
              } finally {
                setBusy(false);
              }
            }}
          >
            {repeat ? `Create ${n} sessions` : "Create session"}
          </Button>
        </div>
      }
    >
      <h2 className="sheet-title">New session</h2>
      {spaces.length === 0 ? (
        <p className="muted-note">Make a space first; sessions belong to a space.</p>
      ) : (
        <div className="form-grid">
          <label>Space<select className="field" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>{spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label>Title<input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly check-in" maxLength={120} /></label>
          <label>Date<input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Time<input type="time" className="field" value={time} onChange={(e) => setTime(e.target.value)} step={900} /></label>
          <label>Length<select className="field" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>{[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
          <label className="check-row"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Repeat weekly</label>
          {repeat && (
            <div className="form-wide">
              <span className="field-label">On</span>
              <div className="day-pick" role="group" aria-label="Days">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <button key={i} type="button" aria-pressed={days.includes(i)} className={days.includes(i) ? "is-on" : ""} onClick={() => setDays((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))} aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]}>{d}</button>
                ))}
              </div>
              <label className="inline-field">Ends after <input type="number" className="field field--short" min={1} max={52} value={count} onChange={(e) => setCount(Math.max(1, Math.min(52, Number(e.target.value) || 1)))} /> sessions</label>
            </div>
          )}
          <div className="form-wide">
            <span className="field-label">Room</span>
            <div className="seg" role="radiogroup" aria-label="Room">
              <button type="button" role="radio" aria-checked={room === "loft"} className={room === "loft" ? "is-on" : ""} onClick={() => setRoom("loft")}>Loft room</button>
              <button type="button" role="radio" aria-checked={room === "external"} className={room === "external" ? "is-on" : ""} onClick={() => setRoom("external")}>Own Meet/Zoom link</button>
            </div>
            {room === "external" && <input className="field" type="url" placeholder="https://meet.google.com/…" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} aria-label="Call link" />}
          </div>
          <div className="form-wide clash-box" aria-live="polite">
            {check?.clashes.length ? (
              <>
                <b>{check.clashes.length} clash{check.clashes.length === 1 ? "" : "es"}: skipped unless you keep them</b>
                <ul role="list">
                  {check.clashes.map((c) => (
                    <li key={c.startsAt}>
                      <label><input type="checkbox" checked={skip.has(c.startsAt)} onChange={(e) => setSkip((s) => { const n2 = new Set(s); if (e.target.checked) n2.add(c.startsAt); else n2.delete(c.startsAt); return n2; })} /> skip {new Date(c.startsAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {c.with}</label>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <span className="ok-note">No clashes with your sessions or busy times.</span>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}
