import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Download, Plus, Trash2 } from "lucide-react";
import { Avatar, BrandIcon, Button, PreviewBanner } from "@loft/ui";
import { buildIcsCalendar, formatTime, formatUSD, parseUSD } from "@loft/core";
import { useAdapter, useQuery } from "../lib/data";
import { IS_PREVIEW } from "../lib/env";
import { ErrorState, Loading } from "../components/bits";
import { PageHeader } from "../shell/PageHeader";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ZONES = ["UTC", "Europe/London", "Europe/Berlin", "Asia/Dhaka", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney", "America/New_York", "America/Chicago", "America/Los_Angeles"];
const viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

interface AvailData {
  tz: string; handle: string; bio: string; busyIcs?: string; busyUrl?: string; busyCount: number;
  weekly: Record<number, { start: string; end: string }[]>;
  rules: { bufferMin: number; noticeHours: number; maxPerDay: number; horizonDays: number };
  types: { id: string; name: string; minutes: number; priceCents: number; destSpaceId: string | null; approval: "auto" | "manual"; blurb: string }[];
  spaces: { id: string; name: string }[];
}

/** Figma 06 · S3 "Availability + booking types". */
export function AvailabilityPage() {
  const adapter = useAdapter();
  const { data, error, reload } = useQuery<AvailData>("availability");
  const [weekly, setWeekly] = useState<AvailData["weekly"] | null>(null);
  const [rules, setRules] = useState<AvailData["rules"] | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (data && !weekly) {
      setWeekly(data.weekly);
      setRules(data.rules);
    }
  }, [data, weekly]);
  if (error) return <ErrorState what="availability" onRetry={reload} />;
  if (!data || !weekly || !rules) return <Loading label="Loading availability" />;
  const bookingUrl = `${location.origin}${import.meta.env.BASE_URL}${IS_PREVIEW ? "#/" : ""}book/${data.handle}`;
  const setDay = (d: number, ranges: { start: string; end: string }[]) => setWeekly({ ...weekly, [d]: ranges });
  const save = async () => {
    await adapter.mutate("availability", { weekly, rules });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="page avail">
      <PageHeader title="Availability" actions={<Link to="/calendar" className="lf-btn lf-btn--ghost lf-btn--sm"><ChevronLeft aria-hidden="true" /> Calendar</Link>} />
      <div className="avail-grid">
        <section className="panel">
          <header className="panel__head"><h2>Bookable hours</h2><span className="muted-note">{data.tz}</span></header>
          <ul className="hours" role="list">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const ranges = weekly[d] ?? [];
              return (
                <li key={d}>
                  <span className="hours__day">{DOW[d]}</span>
                  <div className="hours__ranges">
                    {ranges.length === 0 && <span className="muted-note">Unavailable</span>}
                    {ranges.map((r, i) => (
                      <span key={i} className="hours__range">
                        <input type="time" className="field field--time" value={r.start} step={900} aria-label={`${DOW[d]} from`} onChange={(e) => setDay(d, ranges.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)))} />
                        –
                        <input type="time" className="field field--time" value={r.end} step={900} aria-label={`${DOW[d]} until`} onChange={(e) => setDay(d, ranges.map((x, k) => (k === i ? { ...x, end: e.target.value } : x)))} />
                        <button type="button" className="lf-icon-btn" aria-label="Remove range" onClick={() => setDay(d, ranges.filter((_, k) => k !== i))}><Trash2 aria-hidden="true" /></button>
                      </span>
                    ))}
                  </div>
                  <button type="button" className="lf-icon-btn" aria-label={`Add hours on ${DOW[d]}`} onClick={() => setDay(d, [...ranges, { start: "10:00", end: "12:00" }])}><Plus aria-hidden="true" /></button>
                </li>
              );
            })}
          </ul>
          <h3 className="panel__sub">Rules</h3>
          <div className="rules">
            <label>Buffer between calls<select className="field" value={rules.bufferMin} onChange={(e) => setRules({ ...rules, bufferMin: Number(e.target.value) })}>{[0, 5, 10, 15, 30].map((v) => <option key={v} value={v}>{v} min</option>)}</select></label>
            <label>Minimum notice<select className="field" value={rules.noticeHours} onChange={(e) => setRules({ ...rules, noticeHours: Number(e.target.value) })}>{[1, 2, 4, 12, 24, 48].map((v) => <option key={v} value={v}>{v} h</option>)}</select></label>
            <label>Max per day<select className="field" value={rules.maxPerDay} onChange={(e) => setRules({ ...rules, maxPerDay: Number(e.target.value) })}>{[1, 2, 3, 4, 6, 8].map((v) => <option key={v} value={v}>{v}</option>)}</select></label>
            <label>Booking horizon<select className="field" value={rules.horizonDays} onChange={(e) => setRules({ ...rules, horizonDays: Number(e.target.value) })}>{[7, 14, 30, 60].map((v) => <option key={v} value={v}>{v} days</option>)}</select></label>
          </div>
          <div className="panel__actions"><Button onClick={() => void save()}>{saved ? "Saved" : "Save hours"}</Button></div>
        </section>
        <div className="avail-side">
          <BookingTypes data={data} />
          <BusyCalendar data={data} />
          <section className="panel">
            <h2>Your booking page</h2>
            <p className="muted-note">Share it anywhere. Clients pick a time in their own time zone.</p>
            <a className="link-action" href={bookingUrl} target="_blank" rel="noreferrer">{IS_PREVIEW ? `/book/${data.handle}` : `tanziro.com/spaces/book/${data.handle}`}</a>
          </section>
        </div>
      </div>
    </div>
  );
}

function BookingTypes({ data }: { data: AvailData }) {
  const adapter = useAdapter();
  const [edit, setEdit] = useState<AvailData["types"][number] | null>(null);
  const [price, setPrice] = useState("");
  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Booking types</h2>
        <Button size="sm" variant="secondary" icon={<Plus aria-hidden="true" />} onClick={() => { setEdit({ id: "", name: "", minutes: 30, priceCents: 0, destSpaceId: null, approval: "auto", blurb: "" }); setPrice(""); }}>Add</Button>
      </header>
      <ul className="types" role="list">
        {data.types.map((t) => (
          <li key={t.id}>
            <button type="button" className="types__row" onClick={() => { setEdit(t); setPrice(t.priceCents ? (t.priceCents / 100).toFixed(2) : ""); }}>
              <b>{t.name}</b>
              <small>{t.minutes} min · {t.priceCents ? formatUSD(t.priceCents, { dropZeroCents: true }) : "free"} · {t.approval === "manual" ? "you approve" : "instant"}</small>
            </button>
          </li>
        ))}
      </ul>
      {edit && (
        <form
          className="type-form"
          onSubmit={async (e) => {
            e.preventDefault();
            await adapter.mutate("booking-types", { ...edit, ...(edit.id ? {} : { id: undefined }), priceCents: parseUSD(price || "0") ?? 0 });
            setEdit(null);
          }}
        >
          <label>Name<input className="field" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={60} /></label>
          <label>Length<select className="field" value={edit.minutes} onChange={(e) => setEdit({ ...edit, minutes: Number(e.target.value) })}>{[15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
          <label>Price (USD, blank = free)<input className="field" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" /></label>
          <label>Goes into<select className="field" value={edit.destSpaceId ?? ""} onChange={(e) => setEdit({ ...edit, destSpaceId: e.target.value || null })}><option value="">My first space</option>{data.spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className="check-row"><input type="checkbox" checked={edit.approval === "manual"} onChange={(e) => setEdit({ ...edit, approval: e.target.checked ? "manual" : "auto" })} /> I approve each booking</label>
          <label className="form-wide">Description<input className="field" value={edit.blurb} onChange={(e) => setEdit({ ...edit, blurb: e.target.value })} maxLength={200} /></label>
          <div className="form-wide panel__actions">
            {edit.id && <Button variant="ghost" onClick={async () => { await adapter.mutate(`booking-types/${edit.id}/delete`); setEdit(null); }}>Delete</Button>}
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button type="submit">Save type</Button>
          </div>
        </form>
      )}
    </section>
  );
}

function BusyCalendar({ data }: { data: AvailData }) {
  const adapter = useAdapter();
  const [url, setUrl] = useState(data.busyUrl ?? "");
  const [ics, setIcs] = useState("");
  return (
    <section className="panel">
      <h2>Busy times from your calendar</h2>
      <p className="muted-note">Paste your calendar's private iCal link. Loft only reads start and end times, at most every 15 minutes, and never writes back.</p>
      <div className="inline-form">
        <input className="field" type="url" placeholder="https://calendar.google.com/…/basic.ics" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Private iCal link" />
        <Button size="sm" variant="secondary" onClick={() => adapter.mutate("availability", { busyUrl: url })}>Save</Button>
      </div>
      {IS_PREVIEW && (
        <>
          <p className="field-help">Preview: browsers can't fetch calendar feeds directly (the server does this in production). Paste the .ics text to try it.</p>
          <textarea className="field field--area" rows={3} value={ics} onChange={(e) => setIcs(e.target.value)} placeholder="BEGIN:VCALENDAR…" aria-label="Calendar file text" />
          <Button size="sm" variant="secondary" onClick={() => adapter.mutate("availability", { busyIcs: ics })}>Use these busy times</Button>
        </>
      )}
      <p className="muted-note">{data.busyCount} busy block{data.busyCount === 1 ? "" : "s"} in the next 30 days.</p>
    </section>
  );
}

interface PublicPage { name: string; bio: string; tz: string; types: { id: string; name: string; minutes: number; priceCents: number; approval: "auto" | "manual"; blurb: string }[] }

/** Figma 06 · S4 "Public booking page": no account needed. */
export function BookingPage() {
  const { handle = "" } = useParams();
  const adapter = useAdapter();
  const { data, error } = useQuery<PublicPage>(`book/${handle}`);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [tz, setTz] = useState(viewerTz);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", note: "", website: "" });
  const [done, setDone] = useState<{ status: string; manageToken: string; startsAt: string; minutes: number; typeName: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const type = data?.types.find((t) => t.id === (typeId ?? data.types[0]?.id));
  const { data: slots = [] } = useQuery<string[]>(type ? `book/${handle}/slots` : null, type ? { type: type.id } : undefined);
  const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots) m.set(dayKey(s), [...(m.get(dayKey(s)) ?? []), s]);
    return m;
  }, [slots, tz]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstDay = [...byDay.keys()].sort()[0] ?? null;
  const activeDay = day && byDay.has(day) ? day : firstDay;
  const timeIn = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

  if (error) return <div className="book-page"><ErrorState what="this booking page" /></div>;
  if (!data) return <Loading label="Loading booking page" />;
  const cells = (() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + i));
  })();
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return (
    <div className="book-page">
      {IS_PREVIEW && <PreviewBanner />}
      <header className="book-top">
        <BrandIcon />
        <span className="book-top__word">loft</span>
        <span className="book-top__spacer" />
        <label className="book-top__tz">Times in {tz}{tz === viewerTz ? " (detected)" : ""}
          <select className="field" value={tz} onChange={(e) => setTz(e.target.value)} aria-label="Time zone">
            {[...new Set([viewerTz, ...ZONES])].map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
      </header>
      {done ? (
        <main className="book-card book-card--done">
          <div className="state-icon state-icon--accent" aria-hidden="true"><Check /></div>
          <h1 className="state-screen__title">{done.status === "requested" ? "Request sent" : "You're booked"}</h1>
          <p className="state-screen__lead">{done.typeName} with {data.name} · {new Date(done.startsAt).toLocaleString("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}. {done.status === "requested" ? `${data.name.split(" ")[0]} approves bookings like this one; you'll get an email either way.` : "A calendar invite with the room link is on its way."}</p>
          <div className="book-done__actions">
            <Button variant="secondary" icon={<Download aria-hidden="true" />} onClick={() => {
              const text = buildIcsCalendar({ name: "Loft", method: "REQUEST", events: [{ id: done.manageToken, startsAt: Date.parse(done.startsAt), endsAt: Date.parse(done.startsAt) + done.minutes * 60_000, summary: `${done.typeName} with ${data.name}` }] });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(new Blob([text], { type: "text/calendar" }));
              a.download = "booking.ics";
              a.click();
            }}>Add to calendar</Button>
            <Link className="lf-btn lf-btn--ghost" to={`/manage/${done.manageToken}`}>Reschedule or cancel</Link>
          </div>
          <button type="button" className="link-action" onClick={() => { setDone(null); setSlot(null); setForm({ name: "", email: "", note: "", website: "" }); }}>Book another time</button>
        </main>
      ) : (
        <main className="book-card">
          <section className="book-col book-col--host">
            <Avatar name={data.name} size="lg" tone="lilac" />
            <h1 className="book-host">{data.name}</h1>
            <p className="muted-note">{data.bio}</p>
            <span className="list-label">Booking</span>
            <div className="book-types" role="radiogroup" aria-label="Booking type">
              {data.types.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={type?.id === t.id} className={`book-type${type?.id === t.id ? " is-on" : ""}`} onClick={() => { setTypeId(t.id); setSlot(null); }}>
                  <b>{t.name}</b>
                  <small>{t.minutes} min · {t.priceCents ? formatUSD(t.priceCents, { dropZeroCents: true }) : "free"}</small>
                </button>
              ))}
            </div>
            {type?.blurb && <p className="book-blurb">{type.blurb}</p>}
          </section>
          <section className="book-col">
            <header className="book-month">
              <h2>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h2>
              <button type="button" className="lf-icon-btn" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft aria-hidden="true" /></button>
              <button type="button" className="lf-icon-btn" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight aria-hidden="true" /></button>
            </header>
            <div className="mini-cal">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} className="mini-cal__dow">{d}</span>)}
              {cells.map((d) => {
                const k = key(d);
                const has = byDay.has(k);
                return (
                  <button key={k} type="button" disabled={!has} className={`mini-cal__day${d.getMonth() !== month.getMonth() ? " is-out" : ""}${has ? " has-slots" : ""}${activeDay === k ? " is-on" : ""}`} onClick={() => { setDay(k); setSlot(null); }} aria-label={`${d.toDateString()}${has ? ", open times" : ""}`}>
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            <p className="muted-note">Highlighted days have open times.</p>
          </section>
          <section className="book-col">
            {activeDay ? (
              <form
                className="book-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!type || !slot) return;
                  setErr(null);
                  try {
                    const r = await adapter.mutate<{ status: string; manageToken: string; startsAt: string; minutes: number; typeName: string }>(`book/${handle}`, { typeId: type.id, startsAt: slot, ...form });
                    setDone(r);
                  } catch (x) {
                    setErr(x instanceof Error ? x.message : "That didn't work. Try another time.");
                  }
                }}
              >
                <h2>{new Date(`${activeDay}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}</h2>
                <div className="slot-list" role="radiogroup" aria-label="Times">
                  {(byDay.get(activeDay) ?? []).map((s) => (
                    <button key={s} type="button" role="radio" aria-checked={slot === s} className={`slot${slot === s ? " is-on" : ""}`} onClick={() => setSlot(s)} title={`${formatTime(s, data.tz)} in ${data.tz}`}>{timeIn(s)}</button>
                  ))}
                </div>
                <label>Your name<input className="field" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" maxLength={80} /></label>
                <label>Email<input className="field" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" maxLength={200} /></label>
                <label>What would you like to cover?<input className="field" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={500} /></label>
                <label className="hp" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} /></label>
                {err && <p className="state-error" role="alert">{err}</p>}
                <Button type="submit" block icon={<Check aria-hidden="true" />} disabled={!slot}>{slot ? `Book ${new Date(slot).toLocaleDateString("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" })} · ${timeIn(slot)}` : "Pick a time"}</Button>
                {type?.approval === "manual" && <p className="field-help">{data.name.split(" ")[0]} approves bookings like this one; you'll get an email either way.</p>}
              </form>
            ) : (
              <p className="muted-note">No open times in the next few weeks. Check back soon.</p>
            )}
          </section>
        </main>
      )}
    </div>
  );
}

interface ManageData { booking: { status: string; guestName: string }; session: { title: string; startsAt: string; minutes: number } | null; typeName: string; handle: string; minutes: number }

/** Manage link from the booking email: reschedule or cancel without logging in. */
export function ManagePage() {
  const { token = "" } = useParams();
  const adapter = useAdapter();
  const { data, error, reload } = useQuery<ManageData>(`manage/${token}`);
  const [moving, setMoving] = useState(false);
  const typeId = useQuery<PublicPage>(data ? `book/${data.handle}` : null).data?.types.find((t) => t.name === data?.typeName)?.id;
  const { data: slots = [] } = useQuery<string[]>(moving && data && typeId ? `book/${data.handle}/slots` : null, typeId ? { type: typeId } : undefined);
  if (error) return <div className="book-page"><ErrorState what="this booking" /></div>;
  if (!data) return <Loading label="Loading booking" />;
  const s = data.session;
  return (
    <div className="book-page">
      {IS_PREVIEW && <PreviewBanner />}
      <main className="book-card book-card--done">
        <h1 className="state-screen__title">{data.typeName}</h1>
        <p className="state-screen__lead">{s ? new Date(s.startsAt).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : ""} · {data.booking.status}</p>
        {data.booking.status !== "cancelled" && (
          <div className="book-done__actions">
            <Button variant="secondary" onClick={() => setMoving(!moving)}>Reschedule</Button>
            <Button variant="ghost" onClick={async () => { if (confirm("Cancel this booking?")) { await adapter.mutate(`manage/${token}/cancel`); reload(); } }}>Cancel booking</Button>
          </div>
        )}
        {moving && (
          <div className="slot-list slot-list--wide">
            {slots.slice(0, 24).map((t) => (
              <button key={t} type="button" className="slot" onClick={async () => { await adapter.mutate(`manage/${token}/move`, { startsAt: t }); setMoving(false); reload(); }}>
                {new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
