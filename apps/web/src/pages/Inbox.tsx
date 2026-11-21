import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, CalendarClock, FileCheck, Hand, MessageCircle, Play, Settings, Star } from "lucide-react";
import { Button } from "@loft/ui";
import { useAdapter, useQuery } from "../lib/data";
import { useBreakpoint } from "../lib/media";
import { relTime } from "../components/bits";
import { PageHeader } from "../shell/PageHeader";

interface ReviewItem { id: string; kind: string; title: string; sub: string; action: string; link: string }
interface Note { id: string; kind: string; title: string; sub: string; link: string; createdAt: string; readAt: string | null }

const ICON: Record<string, typeof Bell> = { handin: FileCheck, knock: Hand, message: MessageCircle, ack: Bell, notice: Bell, task: FileCheck, live: Play, move: CalendarClock, brand: Star };

/** Figma 05 · "Host · Inbox (phone)" (To review + Notifications). Desktop "To review" uses the same list. */
export function InboxPage({ initial = "review" }: { initial?: "review" | "notes" }) {
  const phone = useBreakpoint() === "phone";
  const [tab, setTab] = useState<"review" | "notes">(initial);
  const { data: review = [] } = useQuery<ReviewItem[]>("review");
  return (
    <div className="page inbox">
      {phone ? (
        <header className="inbox-head">
          <h1>Inbox</h1>
          <Link to="/settings" className="lf-icon-btn" aria-label="Notification settings"><Settings aria-hidden="true" /></Link>
        </header>
      ) : (
        <PageHeader title={initial === "review" ? "To review" : "Inbox"} />
      )}
      <div className="seg seg--wide" role="tablist" aria-label="Inbox">
        <button type="button" role="tab" aria-selected={tab === "review"} className={tab === "review" ? "is-on" : ""} onClick={() => setTab("review")}>To review · {review.length}</button>
        <button type="button" role="tab" aria-selected={tab === "notes"} className={tab === "notes" ? "is-on" : ""} onClick={() => setTab("notes")}>Notifications</button>
      </div>
      {tab === "review" ? <ReviewList items={review} /> : <NotificationList />}
    </div>
  );
}

function ReviewList({ items }: { items: ReviewItem[] }) {
  const nav = useNavigate();
  if (items.length === 0) return <p className="muted-note">All caught up. Hand-ins, knocks and things to confirm show up here.</p>;
  return (
    <ul className="review-list" role="list">
      {items.map((r) => {
        const Icon = ICON[r.kind] ?? Bell;
        return (
          <li key={r.id} className="review-row">
            <span className={`review-row__ic review-row__ic--${r.kind}`} aria-hidden="true"><Icon /></span>
            <span className="review-row__text"><b>{r.title}</b><small>{r.sub}</small></span>
            <Button size="sm" variant="soft" onClick={() => nav(r.link)}>{r.action}</Button>
          </li>
        );
      })}
    </ul>
  );
}

function NotificationList({ compact = false, onPick }: { compact?: boolean; onPick?: () => void }) {
  const adapter = useAdapter();
  const nav = useNavigate();
  const { data: notes = [] } = useQuery<Note[]>("notifications");
  if (notes.length === 0) return <p className="muted-note">No notifications.</p>;
  return (
    <ul className={`note-list${compact ? " note-list--compact" : ""}`} role="list">
      {notes.map((n) => {
        const Icon = ICON[n.kind] ?? Bell;
        return (
          <li key={n.id}>
            <button
              type="button"
              className={`note-row${n.readAt ? "" : " is-unread"}`}
              onClick={async () => {
                if (!n.readAt) await adapter.mutate(`notifications/${n.id}/read`);
                onPick?.();
                nav(n.link);
              }}
            >
              <span className={`note-row__ic review-row__ic--${n.kind}`} aria-hidden="true"><Icon /></span>
              <span className="note-row__text"><b>{n.title}</b><small>{n.sub} · {relTime(n.createdAt)}</small></span>
              {!n.readAt && <span className="note-row__dot" aria-label="Unread" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Figma 07 · "Notifications panel (desktop)": a bell that opens a popover. */
export function NotificationsBell() {
  const adapter = useAdapter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: notes = [] } = useQuery<Note[]>("notifications");
  const unread = notes.filter((n) => !n.readAt).length;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="bell" ref={ref}>
      <button type="button" className="lf-icon-btn bell__btn" onClick={() => setOpen(!open)} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open}>
        <Bell aria-hidden="true" />
        {unread > 0 && <span className="bell__dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <header>
            <b>Notifications</b>
            <button type="button" className="link-action" onClick={() => adapter.mutate("notifications/read-all")}>Mark all read</button>
          </header>
          <NotificationList compact onPick={() => setOpen(false)} />
          <footer><Link to="/settings" className="link-action" onClick={() => setOpen(false)}>Notification settings</Link></footer>
        </div>
      )}
    </div>
  );
}
