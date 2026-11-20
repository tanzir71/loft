import { useEffect, useRef, useState } from "react";
import { Send, MessageCircle, Minus, Mic, MicOff, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  id: string;
  author: string;
  avatarColor: string;
  text: string;
  time: string;
  mine?: boolean;
}

const AUTO_COLLAPSE_MS = 12000;

export const ChatOverlay = ({
  messages,
  userCount,
  onSendText,
  onClearChat,
  dictationEnabled,
  setDictationEnabled,
  isDictating,
}: {
  messages: ChatMessage[];
  userCount: number;
  onSendText: (text: string) => void;
  onClearChat: () => void;
  dictationEnabled: boolean;
  setDictationEnabled: (enabled: boolean) => void;
  isDictating: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false); // user-forced open
  const [input, setInput] = useState("");
  const [unread, setUnread] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);
  const collapseTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const prevLenRef = useRef(messages.length);

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

  useEffect(() => {
    const prevLen = prevLenRef.current;
    const nextLen = messages.length;
    prevLenRef.current = nextLen;
    if (!expanded && nextLen > prevLen) setUnread((u) => u + (nextLen - prevLen));
    if (expanded && nextLen > prevLen) setUnread(0);
  }, [messages, expanded]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    onSendText(text);
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
      className={cn(
        "fixed z-40 transition-all duration-300 ease-out",
        expanded
          ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-32px)] max-w-[420px]"
          : "bottom-5 right-5",
        expanded ? "" : "",
        "min-[1200px]:bottom-5 min-[1200px]:right-5 min-[1200px]:left-auto min-[1200px]:top-auto min-[1200px]:translate-x-0 min-[1200px]:translate-y-0",
        expanded ? "min-[1200px]:w-[360px]" : "",
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-black/5 bg-white/75 text-foreground shadow-[0_20px_60px_-15px_rgba(20,20,40,0.18)] backdrop-blur-2xl",
          "transition-all duration-300 ease-out",
          !expanded ? "w-[52px] min-[1200px]:w-[220px]" : "w-full"
        )}
        style={{
          height: expanded ? 440 : 52,
        }}
      >
        {/* Header (always visible) */}
        <div
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
          className="flex h-[52px] w-full cursor-pointer items-center justify-center min-[1200px]:justify-start gap-2.5 px-0 min-[1200px]:px-3 text-left transition-colors hover:bg-black/[0.03]"
          aria-label={expanded ? "Collapse chat" : "Expand chat"}
        >
          <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary">
            <MessageCircle className="h-4 w-4 text-foreground/70" />
            <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 anim-pulse-dot" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            {!expanded && unread > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground min-[1200px]:hidden">
                {unread}
              </span>
            )}
          </div>

          {/* Collapsed: show latest message preview */}
          {!expanded && latest ? (
            <div className="hidden min-[1200px]:flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-xs font-semibold text-foreground">
                {latest.author}
              </span>
              <span className="truncate text-xs text-surface-muted">{latest.text}</span>
            </div>
          ) : (
            <div
              className={cn(
                "min-w-0 flex-1 items-center gap-2",
                expanded ? "flex" : "hidden min-[1200px]:flex",
              )}
            >
              <span className="text-xs font-semibold tracking-wide text-foreground">
                LIVE CHAT
              </span>
              <span className="text-[11px] text-surface-muted">· {userCount} here</span>
            </div>
          )}

          {expanded ? (
            <div className="flex items-center gap-1 pr-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClearChat();
                }}
                className="grid h-7 w-7 place-items-center rounded-lg text-surface-muted hover:bg-rose-50 hover:text-rose-500"
                aria-label="Clear chat"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                className="grid h-7 w-7 place-items-center rounded-lg text-surface-muted"
                aria-label="Collapse chat"
              >
                <Minus className="h-4 w-4" />
              </button>
            </div>
          ) : (
            unread > 0 && (
              <span className="hidden min-[1200px]:grid h-5 min-w-5 mr-3 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                {unread}
              </span>
            )
          )}
        </div>

        {/* Expanded body */}
        <div
          className={cn(
            "flex flex-col px-3 transition-opacity duration-200",
            expanded ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          style={{ height: 440 - 52 }}
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
          <div className="flex flex-col gap-1.5 pb-3 pt-1">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-xl border bg-secondary/70 p-1 pl-3 transition-colors",
                isDictating ? "border-rose-400 bg-rose-50" : "border-black/5"
              )}
            >
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
                placeholder={isDictating ? "Listening..." : "Say something…"}
                className="flex-1 bg-transparent py-1.5 text-[13px] text-foreground placeholder:text-surface-muted focus:outline-none"
              />
              <button
                onClick={() => setDictationEnabled(!dictationEnabled)}
                className={cn(
                  "grid h-7 w-7 place-items-center rounded-lg transition-colors",
                  dictationEnabled
                    ? isDictating
                      ? "bg-rose-500 text-white shadow-sm ring-2 ring-rose-200"
                      : "bg-rose-100 text-rose-600 hover:bg-rose-200"
                    : "text-surface-muted hover:bg-black/5 hover:text-foreground"
                )}
                aria-label="Toggle dictation"
              >
                {dictationEnabled ? (
                  <Mic className="h-3.5 w-3.5" />
                ) : (
                  <MicOff className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                onClick={send}
                disabled={!input.trim()}
                className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-primary-foreground transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
            {dictationEnabled && (
              <div className="text-center text-[10px] font-medium text-surface-muted">
                Hold <kbd className="rounded border border-black/10 bg-black/5 px-1 py-0.5 font-sans">Space</kbd> to dictate
              </div>
            )}
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
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white shadow-sm ring-2 ring-white"
        style={{ backgroundColor: m.avatarColor }}
        aria-hidden
      >
        {m.author.slice(0, 1).toUpperCase()}
      </div>
      <div className={cn("flex max-w-[78%] flex-col gap-0.5", m.mine && "items-end")}>
        <div className="flex items-center gap-1.5 px-1 text-[10px] text-surface-muted">
          <span className="font-medium text-foreground/80">{m.author}</span>
          <span>{m.time}</span>
        </div>
        <div
          className={cn(
            "rounded-xl px-3 py-1.5 text-[12.5px] leading-snug shadow-sm",
            m.mine
              ? "rounded-tr-sm bg-primary text-primary-foreground"
              : "rounded-tl-sm border border-black/5 bg-white text-foreground",
          )}
        >
          {m.text}
        </div>
      </div>
    </div>
  );
};
