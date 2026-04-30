import { Share2, Sparkles, Users } from "lucide-react";

export const TopBar = ({ session = "default" }: { session?: string }) => {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between p-5">
      {/* Brand */}
      <div className="pointer-events-auto glass flex items-center gap-3 rounded-2xl px-3.5 py-2 anim-rise">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-foreground text-background">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="leading-tight">
          <div className="font-display text-[17px] italic text-foreground">
            Whiteboard<span className="text-primary">.</span>chat
          </div>
        </div>
        <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-surface-muted">
          {session}
        </span>
      </div>

      {/* Right cluster */}
      <div className="pointer-events-auto flex items-center gap-2 anim-rise">
        <div className="glass flex items-center gap-2 rounded-2xl px-3 py-2">
          <div className="flex -space-x-2">
            <Avatar color="#6d5cff" letter="A" />
            <Avatar color="#1fc7a8" letter="K" />
            <Avatar color="#ff6b6b" letter="M" />
          </div>
          <Users className="ml-1 h-3.5 w-3.5 text-surface-muted" />
          <span className="text-xs font-medium text-foreground">3</span>
        </div>
        <button className="glass flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium text-foreground transition-transform hover:scale-[1.02]">
          <Share2 className="h-4 w-4" />
          Share
        </button>
      </div>
    </div>
  );
};

const Avatar = ({ color, letter }: { color: string; letter: string }) => (
  <div
    className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white ring-2 ring-white"
    style={{ backgroundColor: color }}
  >
    {letter}
  </div>
);
