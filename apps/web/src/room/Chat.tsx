import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { Avatar } from "@loft/ui";
import { formatTime } from "@loft/core";
import { useAdapter, useQuery } from "../lib/data";

interface Msg {
  id: string;
  userId: string;
  name: string;
  body: string;
  createdAt: string;
}

/** Room chat: a minimised pill (last message + unread) that opens into a panel or phone sheet. */
export function RoomChat({ roomId, meId, compact }: { roomId: string; meId: string; compact: boolean }) {
  const adapter = useAdapter();
  const { data: msgs = [] } = useQuery<Msg[]>(`rooms/${roomId}/messages`);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const unread = open ? 0 : Math.max(0, msgs.filter((m) => m.userId !== meId).length - seen);
  const last = msgs[msgs.length - 1];

  useEffect(() => {
    if (open) setSeen(msgs.filter((m) => m.userId !== meId).length);
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, msgs, meId]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    await adapter.mutate(`rooms/${roomId}/messages`, { body });
  };

  if (!open) {
    return (
      <button type="button" className={`island chat-pill${compact ? " chat-pill--compact" : ""}`} data-board-ui="" onClick={() => setOpen(true)} aria-label={`Open chat${unread ? `, ${unread} unread` : ""}`}>
        <MessageCircle aria-hidden="true" />
        {!compact && last && (
          <span className="chat-pill__last">
            <b>{last.name.split(" ")[0]}:</b> {last.body}
          </span>
        )}
        {!compact && !last && <span className="chat-pill__last chat-pill__last--muted">Chat</span>}
        {unread > 0 && <span className="lf-count lf-count--primary">{unread}</span>}
      </button>
    );
  }

  return (
    <section className={`island chat-panel${compact ? " chat-panel--sheet" : ""}`} data-board-ui="" aria-label="Room chat">
      <header className="chat-panel__head">
        <b>Chat</b>
        <span className="chat-panel__note">Everyone in the room</span>
        <button type="button" className="lf-icon-btn" onClick={() => setOpen(false)} aria-label="Minimise chat">
          <X aria-hidden="true" />
        </button>
      </header>
      <ol className="chat-panel__list" ref={listRef} aria-live="polite">
        {msgs.length === 0 && <li className="chat-panel__empty">No messages yet. Say hi.</li>}
        {msgs.map((m) => (
          <li key={m.id} className={m.userId === meId ? "is-me" : ""}>
            <Avatar name={m.name} size="sm" />
            <div>
              <span className="chat-panel__meta">
                {m.userId === meId ? "You" : m.name} · {formatTime(m.createdAt)}
              </span>
              <p>{m.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <form
        className="chat-panel__form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="chat-input">Message</label>
        <input id="chat-input" className="field" placeholder="Message the room" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" maxLength={2000} />
        <button type="submit" className="lf-icon-btn lf-icon-btn--primary chat-panel__send" aria-label="Send" disabled={!text.trim()}>
          <Send aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
