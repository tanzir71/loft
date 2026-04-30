import { useEffect, useRef, useState } from "react";
import { Send, MessageCircle, X, Mic, MicOff, ChevronDown } from "lucide-react";
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
    text: "Love the asymmetry. Maybe pull the CTA to the right?",
    time: "08:31",
  },
  {
    id: "3",
    author: "Me",
    avatarColor: "#ff6b6b",
    text: "Trying that now — give me a sec.",
    time: "08:32",
    mine: true,
  },
];

export const ChatOverlay = () => {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>(SEED);
  const [input, setInput] = useState("");
  const [micOn, setMicOn] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open]);

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
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        mine: true,
      },
    ]);
    setInput("");
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full px-4 py-3",
          "glass-dark text-white anim-pop hover:scale-[1.02] transition-transform",
        )}
        aria-label="Open chat"
      >
        <MessageCircle className="h-4 w-4" />
        <span className="text-sm font-medium">Chat</span>
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold">
          {messages.length}
        </span>
      </button>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-y-0 right-0 z-30 flex w-full max-w-md flex-col">
      {/* Gradient veil so chat reads on any background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--gradient-chat)" }}
      />

      {/* Header */}
      <div className="pointer-events-auto relative z-10 flex items-center justify-between px-5 pt-5">
        <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-white/90 backdrop-blur-md">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 anim-pulse-dot" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-xs font-medium tracking-wide">LIVE CHAT</span>
          <span className="text-xs text-white/60">· 3 here</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-white/80 hover:bg-white/20"
          aria-label="Hide chat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={listRef}
        className="pointer-events-auto chat-fade-mask relative z-10 flex-1 overflow-y-auto px-5 pb-3 pt-6"
      >
        <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <Message key={m.id} m={m} />
          ))}
        </div>
      </div>

      {/* Composer */}
      <div className="pointer-events-auto relative z-10 px-4 pb-5">
        <div
          className={cn(
            "flex items-center gap-2 rounded-2xl border border-white/15 bg-black/40 p-1.5 pl-4 backdrop-blur-xl",
            "shadow-[0_10px_40px_-10px_rgba(0,0,0,0.6)]",
          )}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Say something…"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
          <button
            onClick={() => setMicOn((v) => !v)}
            className={cn(
              "grid h-9 w-9 place-items-center rounded-xl text-white/80 transition-colors",
              micOn ? "bg-white/10 hover:bg-white/20" : "bg-rose-500/80 hover:bg-rose-500",
            )}
            aria-label="Toggle mic"
            title="Hold SPACE to dictate"
          >
            {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
          </button>
          <button
            onClick={send}
            disabled={!input.trim()}
            className={cn(
              "grid h-9 w-9 place-items-center rounded-xl text-white transition-all",
              "bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed",
            )}
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 px-1 text-[11px] text-white/50">
          Hold <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">Space</kbd> to dictate · <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-white/70">Enter</kbd> to send
        </p>
      </div>
    </div>
  );
};

const Message = ({ m }: { m: ChatMessage }) => {
  return (
    <div className={cn("flex gap-2.5 anim-rise", m.mine && "flex-row-reverse")}>
      <div
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white shadow-lg"
        style={{ backgroundColor: m.avatarColor }}
        aria-hidden
      >
        {m.author.slice(0, 1).toUpperCase()}
      </div>
      <div className={cn("flex max-w-[85%] flex-col gap-1", m.mine && "items-end")}>
        <div className="flex items-center gap-2 px-1 text-[11px] text-white/60">
          <span className="font-medium text-white/85">{m.author}</span>
          <span>{m.time}</span>
        </div>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed text-white shadow-lg backdrop-blur-md",
            m.mine
              ? "bg-primary/85 rounded-tr-md"
              : "bg-white/10 rounded-tl-md border border-white/10",
          )}
        >
          {m.text}
        </div>
      </div>
    </div>
  );
};
