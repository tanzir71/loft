import { useMemo, useState, useEffect } from "react";
import { Share2, Sparkles, Users, Keyboard, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PresenceUser = {
  id: string;
  name: string;
  avatarColor: string;
  lastSeen: number;
};

export const TopBar = ({
  roomId,
  users,
  selfId,
  onRenameSelf,
}: {
  roomId: string;
  users: PresenceUser[];
  selfId: string;
  onRenameSelf: (name: string) => void;
}) => {
  const self = useMemo(() => users.find((u) => u.id === selfId) ?? null, [selfId, users]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState("");

  const openRename = () => {
    setDraftName(self?.name ?? "");
    setRenameOpen(true);
  };

  const [controlsOpen, setControlsOpen] = useState(true);

  // Auto close controls dialog when user clicks outside or starts interacting
  useEffect(() => {
    if (!controlsOpen) return;
    let timer: number | null = null;
    
    // Auto close after 15 seconds if no interaction
    timer = window.setTimeout(() => setControlsOpen(false), 15000);

    const onInteract = () => {
      setControlsOpen(false);
    };

    window.addEventListener("pointerdown", onInteract, { capture: true });
    window.addEventListener("keydown", onInteract, { capture: true });

    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onInteract, { capture: true });
      window.removeEventListener("keydown", onInteract, { capture: true });
    };
  }, [controlsOpen]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between p-5">
      {/* Brand & Info */}
      <div className="flex flex-col gap-3">
        <div 
          className="pointer-events-auto glass flex cursor-pointer items-center gap-3 rounded-2xl px-3.5 py-2 transition-transform hover:scale-[1.02] anim-rise"
          onClick={(e) => {
            e.stopPropagation();
            setControlsOpen(true);
          }}
          title="View controls"
        >
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-foreground text-background">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="leading-tight">
            <div className="font-display text-[17px] italic text-foreground">
              Whiteboard<span className="text-primary">.</span>chat
            </div>
          </div>
          <span className="ml-1 rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-surface-muted">
            {roomId}
          </span>
        </div>

        {/* Minimal Controls Dialog */}
        <div 
          className={cn(
            "pointer-events-auto w-[280px] origin-top-left overflow-hidden rounded-2xl border border-black/5 bg-white/90 p-4 shadow-xl backdrop-blur-md transition-all duration-300 ease-out",
            controlsOpen ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between text-foreground/80">
            <div className="flex items-center gap-2">
              <Keyboard className="h-4 w-4" />
              <h3 className="text-sm font-semibold">Controls</h3>
            </div>
            <button
              onClick={() => setControlsOpen(false)}
              className="grid h-6 w-6 place-items-center rounded-md text-surface-muted hover:bg-black/5 hover:text-foreground"
              aria-label="Close controls"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-2.5 text-xs text-surface-muted">
            <div className="flex items-center justify-between">
              <span>Zoom</span>
              <kbd className="rounded bg-black/5 px-1.5 py-0.5 font-sans">Ctrl + Scroll</kbd>
            </div>
            <div className="flex items-center justify-between">
              <span>Pan Canvas</span>
              <div className="flex gap-1">
                <kbd className="rounded bg-black/5 px-1.5 py-0.5 font-sans">Esc</kbd>
                <span>or</span>
                <kbd className="rounded bg-black/5 px-1.5 py-0.5 font-sans">Right-Click</kbd>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span>Voice Dictation</span>
              <kbd className="rounded bg-black/5 px-1.5 py-0.5 font-sans">Hold Space</kbd>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-black/5 text-center text-[10px] text-surface-muted/70">
            Built with ❤️ by <a href="https://tanziro.com" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">tanziro.com</a>
          </div>
        </div>
      </div>

      {/* Right cluster */}
      <div className="pointer-events-auto flex items-center gap-2 anim-rise">
        <div className="glass flex items-center gap-2 rounded-2xl px-3 py-2">
          <div className="flex -space-x-2">
            {users.slice(0, 5).map((u) => {
              const letter = (u.name || "?").slice(0, 1).toUpperCase();
              const isSelf = u.id === selfId;
              return (
                <button
                  key={u.id}
                  type="button"
                  title={isSelf ? `${u.name} (you)` : u.name}
                  className={cn(
                    "pointer-events-auto rounded-full ring-2 ring-white transition-transform hover:scale-[1.03]",
                    isSelf && "ring-2 ring-blue-500 ring-offset-2 ring-offset-white",
                  )}
                  onClick={() => {
                    if (isSelf) openRename();
                  }}
                >
                  <Avatar color={u.avatarColor} letter={letter} />
                </button>
              );
            })}
            {users.length > 5 && (
              <div className="grid h-6 w-6 place-items-center rounded-full bg-secondary text-[10px] font-semibold text-foreground ring-2 ring-white">
                +{users.length - 5}
              </div>
            )}
          </div>
          <Users className="ml-1 h-3.5 w-3.5 text-surface-muted" />
          <span className="text-xs font-medium text-foreground">{users.length}</span>
        </div>
        <button
          onClick={async () => {
            const url = new URL(window.location.href);
            url.searchParams.set("room", roomId);
            try {
              await navigator.clipboard.writeText(url.toString());
              toast({
                title: "Share link copied",
                description: url.toString(),
              });
            } catch {
              window.prompt("Copy this link to share:", url.toString());
            }
          }}
          className="glass flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium text-foreground transition-transform hover:scale-[1.02]"
        >
          <Share2 className="h-4 w-4" />
          Share
        </button>
      </div>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit your name</DialogTitle>
            <DialogDescription>Your name is shown to others in this room.</DialogDescription>
          </DialogHeader>
          <Input
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const next = draftName.trim().replace(/\s+/g, "").slice(0, 32);
                if (!next) return;
                onRenameSelf(next);
                setRenameOpen(false);
              }
            }}
            placeholder="yourname"
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRenameOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                const next = draftName.trim().replace(/\s+/g, "").slice(0, 32);
                if (!next) return;
                onRenameSelf(next);
                setRenameOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Avatar = ({ color, letter }: { color: string; letter: string }) => (
  <div
    className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white"
    style={{ backgroundColor: color }}
  >
    {letter}
  </div>
);
