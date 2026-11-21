import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, DoorOpen, Hand, Pencil, Play, Plus, Search } from "lucide-react";
import { Avatar, Button, Count } from "@loft/ui";
import { useAdapter, useQuery } from "../lib/data";
import { useBreakpoint } from "../lib/media";
import { ErrorState, Loading } from "../components/bits";
import { ChatThread } from "./Space";
import type { NavData } from "../shell/AppShell";

interface DmThread {
  peer: { id: string; name: string; status: string; title: string };
  messages: { id: string; userId: string; name: string; body: string; createdAt: string; kind?: string; roomCode?: string; roomName?: string }[];
}

const STATUS: Record<string, string> = { available: "Available", away: "Away", busy: "In a room", offline: "Offline" };

/** Figma 04 · "Host · Hallway — DM + start a room" and 05 · "Host · DM + start a room (phone)". */
export function DmPage() {
  const { userId = "" } = useParams();
  const adapter = useAdapter();
  const nav = useNavigate();
  const phone = useBreakpoint() === "phone";
  const { data, error, reload } = useQuery<DmThread>(`dms/${userId}`);

  useEffect(() => {
    if (data) void adapter.mutate(`dms/${userId}/read`);
  }, [adapter, userId, data?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorState what="this conversation" onRetry={reload} />;
  if (!data) return <Loading label="Loading conversation" />;
  const first = data.peer.name.split(" ")[0];
  const room = async (knock: boolean) => {
    const r = await adapter.mutate<{ code: string }>(`dms/${userId}/room`, { knock });
    nav(`/r/${r.code}`);
  };

  return (
    <div className="dm-page">
      <header className="dm-top">
        {phone && <button type="button" className="lf-icon-btn" onClick={() => nav("/chats")} aria-label="Back to chats"><ChevronLeft aria-hidden="true" /></button>}
        <Avatar name={data.peer.name} presence={data.peer.status as "available"} />
        <span className="dm-top__who">
          <b>{data.peer.name}</b>
          <small><span className={`dot dot--${data.peer.status}`} aria-hidden="true" /> {STATUS[data.peer.status] ?? data.peer.status}{data.peer.title && ` · ${data.peer.title}`}</small>
        </span>
        <Button variant="secondary" size={phone ? "sm" : "md"} icon={<Hand aria-hidden="true" />} onClick={() => void room(true)} disabled={data.peer.status === "offline"}>Knock</Button>
        <Button size={phone ? "sm" : "md"} icon={<Play aria-hidden="true" />} onClick={() => void room(false)}>{phone ? "Room" : "Start a room together"}</Button>
      </header>
      <ChatThread
        msgs={data.messages}
        placeholder={`Message ${first}`}
        onSend={(body) => adapter.mutate(`dms/${userId}/messages`, { body })}
        extraActions={
          <button type="button" className="lf-icon-btn" aria-label="Start a room together" onClick={() => void room(false)}>
            <Play aria-hidden="true" />
          </button>
        }
        renderMsg={(m) => {
          const full = data.messages.find((x) => x.id === m.id);
          if (full?.kind !== "room") return null;
          return (
            <div className="room-card">
              <span className="room-card__ic" aria-hidden="true"><Pencil /></span>
              <span className="room-card__text">
                <b>{full.body === "knocked" ? `Knocked · ${full.roomName}` : `Room · ${full.roomName}`}</b>
                <small><span className="live-dot" aria-hidden="true" /> Live · room {full.roomCode}</small>
              </span>
              <Button size="sm" onClick={() => nav(`/r/${full.roomCode}`)}>Join</Button>
            </div>
          );
        }}
      />
      {adapter.kind === "local" && <p className="preview-note">Preview: {first} is a demo person and won't answer or join.</p>}
    </div>
  );
}

interface DmRow { id: string; name: string; status: string; last: { body: string; mine: boolean } | null; unread: number }
interface SpaceRow { id: string; slug: string; name: string }

/** Figma 05 · "Host · Chats / Hallway (phone)": live rooms, spaces as channels, DMs. */
export function ChatsPage() {
  const nav = useNavigate();
  const adapter = useAdapter();
  const { data: navData } = useQuery<NavData>("nav");
  const { data: dms = [] } = useQuery<DmRow[]>("dms");
  const { data: spaces = [] } = useQuery<SpaceRow[]>("spaces");
  const unread = new Map((navData?.spaces ?? []).map((s) => [s.slug, s.unread ?? 0]));
  return (
    <div className="page chats">
      <header className="phone-header">
        <span className="lf-mark" aria-hidden="true">L</span>
        <h1 className="phone-header__title">Chats</h1>
        <button type="button" className="lf-icon-btn" aria-label="Search"><Search aria-hidden="true" /></button>
        <Link to="/spaces/new" className="lf-icon-btn" aria-label="New space"><Plus aria-hidden="true" /></Link>
      </header>
      <h2 className="list-label">Live rooms</h2>
      <ul className="chat-list" role="list">
        {(navData?.rooms ?? []).map((r) => (
          <li key={r.id}>
            <span className="chat-list__tile chat-list__tile--live" aria-hidden="true"><span className="live-dot" /></span>
            <span className="chat-list__text"><b>{r.name}</b><small>live now</small></span>
            <Button size="sm" variant="soft" onClick={() => nav(r.to)}>Join</Button>
          </li>
        ))}
        <li>
          <Link to="/join" className="chat-list__join"><DoorOpen aria-hidden="true" /> Join with a code</Link>
        </li>
      </ul>
      <h2 className="list-label">Spaces</h2>
      <ul className="chat-list" role="list">
        {spaces.map((s) => (
          <li key={s.id}>
            <Link to={`/s/${s.slug}/chat`} className="chat-list__link">
              <span className="chat-list__tile" aria-hidden="true">#</span>
              <span className="chat-list__text"><b>{s.slug}</b><small>{s.name}</small></span>
              <Count n={unread.get(s.slug) ?? 0} tone="primary" />
            </Link>
          </li>
        ))}
      </ul>
      <h2 className="list-label">Direct messages</h2>
      <ul className="chat-list" role="list">
        {dms.map((d) => (
          <li key={d.id}>
            <Link to={`/dm/${d.id}`} className="chat-list__link">
              <Avatar name={d.name} size="lg" presence={d.status as "available"} />
              <span className="chat-list__text"><b>{d.name}</b><small>{d.last ? `${d.last.mine ? "You: " : ""}${d.last.body}` : "Say hello"}</small></span>
              <Count n={d.unread} tone="primary" />
            </Link>
            {d.status === "available" && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Hand aria-hidden="true" />}
                onClick={async () => {
                  const r = await adapter.mutate<{ code: string }>(`dms/${d.id}/room`, { knock: true });
                  nav(`/r/${r.code}`);
                }}
              >
                Knock
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
