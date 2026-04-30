import { useEffect, useRef, useState } from "react";
import { Send, MessageCircle, Minus, Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  id: string;
  author: string;
  avatarColor: string;
  text: string;
  time: string;
  mine?: boolean;
}

const SEED: ChatMessage[] = [
  {
    id: "1",
    author: "Ada",
    avatarColor: "#6d5cff",
    text: "Dropping the wireframe sketch now ✏️",
    time: "08:30",
  },
  {
    id: "2",
    author: "Kenji",
    avatarColor: "#1fc7a8",
    text: "Love the asymmetry. Maybe pull the CTA right?",
    time: "08:31",
  },
];

// Demo incoming messages so users can see auto-expand in action
const DEMO_INCOMING: Omit<ChatMessage, "id" | "time">[] = [
  { author: "Ada", avatarColor: "#6d5cff", text: "Just added a sticky note on the canvas 📌" },
  { author: "Kenji", avatarColor: "#1fc7a8", text: "Looks great — shipping the v2 now." },
  { author: "Ada", avatarColor: "#6d5cff", text: "Anyone want to jump on a quick call?" },
];

const AUTO_COLLAPSE_MS = 4500;

export const ChatOverlay = () => {
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false); // user-forced open
  const [messages, setMessages] = useState<ChatMessage[]>(SEED);
  const [input, setInput] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [unread, setUnread] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const collapseTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const now = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const scheduleCollapse = () => {
    if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
    collapseTimer.current = window.setTimeout(() => {
      if (!pinned && document.activeElement !== inputRef.current) {
        setExpanded(false);
      }
    }, AUTO_COLLAPSE_MS);
  };

  const expand = (auto = false) => {
    setExpanded(true);
    setUnread(0);
    if (auto) scheduleCollapse();
  };

  // Scroll to bottom when messages change & expanded
  useEffect(() => {
    if (!expanded) return;
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, expanded]);

  // Simulate incoming messages on a loop
  useEffect(() => {
    let i = 0;
    const tick = () => {
      const next = DEMO_INCOMING[i % DEMO_INCOMING.length];
      i++;
      const msg: ChatMessage = {
        ...next,
        id: crypto.randomUUID(),
        time: now(),
      };
      setMessages((m) => [...m, msg]);
      // Auto-expand on new message
      setExpanded(true);
      setUnread(0);
      if (!pinned) scheduleCollapse();
    };
    const interval = window.setInterval(tick, 9000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned]);

  // When a new message arrives while collapsed, count unread
  useEffect(() => {
    if (!expanded && messages.length > 0) {
      setUnread((u) => u + 0); // handled in tick; placeholder for clarity
    }
  }, [messages, expanded]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setMessages((m) => [
      ...m,
      {
        id: crypto.randomUUID(),
        author: "Me",
        avatarColor: "#ff6b6b",
        text,
        time: now(),
        mine: true,
      },
    ]);
    setInput("");
    if (!pinned) scheduleCollapse();
  };

  const latest = messages[messages.length - 1];

  // Cancel auto-collapse while hovering
  const onMouseEnter = () => {
    if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
  };
  const onMouseLeave = () => {
    if (!pinned && expanded) scheduleCollapse();
  };

  return (
    <div
      className="fixed bottom-5 right-5 z-40 w-[340px]"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-white/10 bg-black/55 text-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.6)] backdrop-blur-2xl",
          "transition-all duration-300 ease-out",
        )}
        style={{
          height: expanded ? 440 : 56,
        }}
      >
        {/* Header (always visible) */}
        <button
          onClick={() => {
            if (expanded) {
              setPinned(false);
              setExpanded(false);
              if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
            } else {
              setPinned(true);
              expand(false);
            }
          }}
          className="flex h-14 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-white/5"
          aria-label={expanded ? "Collapse chat" : "Expand chat"}
        >
          <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10">
            <MessageCircle className="h-4 w-4" />
            <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 anim-pulse-dot" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
          </div>

          {/* Collapsed: show latest message preview */}
          {!expanded && latest ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-xs font-semibold text-white/90">
                {latest.author}
              </span>
              <span className="truncate text-xs text-white/70">{latest.text}</span>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-xs font-semibold tracking-wide text-white/90">
                LIVE CHAT
              </span>
              <span className="text-[11px] text-white/50">· 3 here</span>
            </div>
          )}

          {expanded ? (
            <Minus className="h-4 w-4 text-white/60" />
          ) : (
            unread > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold">
                {unread}
              </span>
            )
          )}
        </button>

        {/* Expanded body */}
        <div
          className={cn(
            "flex flex-col px-3 transition-opacity duration-200",
            expanded ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          style={{ height: 440 - 56 }}
        >
          <div
            ref={listRef}
            className="chat-fade-mask flex-1 overflow-y-auto pb-2 pt-2"
          >
            <div className="flex flex-col gap-2.5">
              {messages.map((m) => (
                <Message key={m.id} m={m} />
              ))}
            </div>
          </div>

          {/* Composer */}
          <div className="pb-3 pt-1">
            <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 p-1 pl-3">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => {
                  setPinned(true);
                  if (collapseTimer.current) window.clearTimeout(collapseTimer.current);
                }}
                onBlur={() => {
                  setPinned(false);
                  scheduleCollapse();
                }}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Say something…"
                className="flex-1 bg-transparent py-1.5 text-[13px] text-white placeholder:text-white/40 focus:outline-none"
              />
              <button
                onClick={() => setMicOn((v) => !v)}
                className={cn(
                  "grid h-7 w-7 place-items-center rounded-lg text-white/80 transition-colors",
                  micOn ? "hover:bg-white/10" : "bg-rose-500/80 hover:bg-rose-500",
                )}
                aria-label="Toggle mic"
              >
                {micOn ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={send}
                disabled={!input.trim()}
                className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-white transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Message = ({ m }: { m: ChatMessage }) => {
  return (
    <div className={cn("flex gap-2 anim-rise", m.mine && "flex-row-reverse")}>
      <div
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white shadow-md"
        style={{ backgroundColor: m.avatarColor }}
        aria-hidden
      >
        {m.author.slice(0, 1).toUpperCase()}
      </div>
      <div className={cn("flex max-w-[78%] flex-col gap-0.5", m.mine && "items-end")}>
        <div className="flex items-center gap-1.5 px-1 text-[10px] text-white/55">
          <span className="font-medium text-white/80">{m.author}</span>
          <span>{m.time}</span>
        </div>
        <div
          className={cn(
            "rounded-xl px-3 py-1.5 text-[12.5px] leading-snug text-white shadow-md",
            m.mine
              ? "bg-primary/85 rounded-tr-sm"
              : "bg-white/10 rounded-tl-sm border border-white/10",
          )}
        >
          {m.text}
        </div>
      </div>
    </div>
  );
};
