import { useMemo, useState, useEffect } from "react";
import { Share2, Sparkles, Users, Keyboard, X, ChevronDown, PencilLine, Menu } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type PresenceUser = {
  id: string;
  name: string;
  avatarColor: string;
  lastSeen: number;
};

type RoomEntry = {
  id: string;
  name: string;
  lastOpened: number;
};

export const TopBar = ({
  roomId,
  roomName,
  rooms,
  onRenameRoom,
  onSwitchRoom,
  isOwner,
  onDeleteRoom,
  users,
  selfId,
  onRenameSelf,
}: {
  roomId: string;
  roomName: string;
  rooms: RoomEntry[];
  onRenameRoom: (name: string) => void;
  onSwitchRoom: (roomId: string) => void;
  isOwner: boolean;
  onDeleteRoom: () => void;
  users: PresenceUser[];
  selfId: string;
  onRenameSelf: (name: string) => void;
}) => {
  const self = useMemo(() => users.find((u) => u.id === selfId) ?? null, [selfId, users]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState("");

  const [renameRoomOpen, setRenameRoomOpen] = useState(false);
  const [draftRoomName, setDraftRoomName] = useState(roomName);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteRoomOpen, setDeleteRoomOpen] = useState(false);

  const openRename = () => {
    setDraftName(self?.name ?? "");
    setRenameOpen(true);
  };

  const openRoomRename = () => {
    setDraftRoomName(roomName);
    setRenameRoomOpen(true);
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

  const sortedRooms = useMemo(
    () => [...rooms].sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0)),
    [rooms],
  );

  const shareLink = useMemo(
    () => async () => {
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
    },
    [roomId],
  );

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
              tutorapp<span className="text-primary">.</span>quest
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="ml-1 flex items-center gap-2 rounded-full bg-secondary px-2 py-0.5 text-surface-muted transition-colors hover:bg-secondary/80"
                aria-label="Switch room"
                title="Switch room"
              >
                <span className="max-w-[120px] truncate text-[11px] font-semibold text-foreground">
                  {roomName}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-surface-muted">
                  {roomId}
                </span>
                <ChevronDown className="h-3.5 w-3.5 text-surface-muted" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              sideOffset={8}
              className="w-[280px] rounded-2xl border border-black/5 bg-white/95 p-2 shadow-xl backdrop-blur-md"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem
                onSelect={() => openRoomRename()}
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm"
              >
                <PencilLine className="h-4 w-4" />
                Rename this room
              </DropdownMenuItem>
              {isOwner && (
                <DropdownMenuItem
                  onSelect={() => setDeleteRoomOpen(true)}
                  className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-rose-600 focus:text-rose-600"
                >
                  <X className="h-4 w-4" />
                  Delete room
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="my-2" />
              {sortedRooms.length === 0 ? (
                <div className="px-3 py-2 text-xs text-surface-muted">No saved rooms yet.</div>
              ) : (
                sortedRooms.map((r) => {
                  const active = r.id === roomId;
                  return (
                    <DropdownMenuItem
                      key={r.id}
                      onSelect={() => {
                        if (!active) onSwitchRoom(r.id);
                      }}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm",
                        active && "bg-secondary",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-surface-muted">
                        {r.id}
                      </span>
                    </DropdownMenuItem>
                  );
                })
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
        <div className="hidden min-[1200px]:flex items-center gap-2">
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
            onClick={shareLink}
            className="glass flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium text-foreground transition-transform hover:scale-[1.02]"
          >
            <Share2 className="h-4 w-4" />
            Share
          </button>
        </div>

        <div className="flex items-center gap-2 min-[1200px]:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="glass grid h-[42px] w-[42px] place-items-center rounded-2xl text-foreground"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[320px] p-5">
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>

              <div className="mt-5 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    await shareLink();
                    setMenuOpen(false);
                  }}
                  className="glass flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-medium text-foreground"
                >
                  <span className="flex items-center gap-2">
                    <Share2 className="h-4 w-4" />
                    Share link
                  </span>
                  <span className="text-xs text-surface-muted">{roomId}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setControlsOpen(true);
                    setMenuOpen(false);
                  }}
                  className="flex items-center justify-between rounded-2xl border border-black/5 bg-white/80 px-4 py-3 text-sm font-medium text-foreground"
                >
                  <span className="flex items-center gap-2">
                    <Keyboard className="h-4 w-4" />
                    Controls
                  </span>
                </button>

                <div className="rounded-2xl border border-black/5 bg-white/80 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs font-semibold text-foreground">Rooms</div>
                    <button
                      type="button"
                      onClick={() => {
                        openRoomRename();
                        setMenuOpen(false);
                      }}
                      className="grid h-7 w-7 place-items-center rounded-lg text-surface-muted hover:bg-black/5 hover:text-foreground"
                      aria-label="Rename room"
                    >
                      <PencilLine className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {sortedRooms.slice(0, 10).map((r) => {
                      const active = r.id === roomId;
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            if (!active) onSwitchRoom(r.id);
                          }}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm",
                            active ? "bg-secondary text-foreground" : "hover:bg-black/5",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-surface-muted">
                            {r.id}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteRoomOpen(true);
                        setMenuOpen(false);
                      }}
                      className="mt-3 w-full rounded-xl bg-rose-50 px-3 py-2 text-left text-sm font-semibold text-rose-600 hover:bg-rose-100"
                    >
                      Delete room
                    </button>
                  )}
                </div>

                <div className="rounded-2xl border border-black/5 bg-white/80 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <Users className="h-4 w-4" />
                      Users
                    </div>
                    <div className="text-xs text-surface-muted">{users.length}</div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {users.slice(0, 12).map((u) => {
                      const isSelf = u.id === selfId;
                      const letter = (u.name || "?").slice(0, 1).toUpperCase();
                      return (
                        <button
                          key={u.id}
                          type="button"
                          className={cn(
                            "flex items-center justify-between rounded-xl px-2 py-2 text-left",
                            isSelf ? "bg-blue-50/70" : "hover:bg-black/5",
                          )}
                          onClick={() => {
                            if (isSelf) openRename();
                            setMenuOpen(false);
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <Avatar color={u.avatarColor} letter={letter} />
                            <span className="text-sm font-medium text-foreground">
                              {u.name}
                              {isSelf ? " (you)" : ""}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
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

      <Dialog open={renameRoomOpen} onOpenChange={setRenameRoomOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename room</DialogTitle>
            <DialogDescription>This name is saved in your browser for easy switching.</DialogDescription>
          </DialogHeader>
          <Input
            value={draftRoomName}
            onChange={(e) => setDraftRoomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const next = draftRoomName.trim().slice(0, 60);
                if (!next) return;
                onRenameRoom(next);
                setRenameRoomOpen(false);
              }
            }}
            placeholder="Room name"
            autoFocus
          />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRenameRoomOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                const next = draftRoomName.trim().slice(0, 60);
                if (!next) return;
                onRenameRoom(next);
                setRenameRoomOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteRoomOpen} onOpenChange={setDeleteRoomOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete room?</DialogTitle>
            <DialogDescription>
              This will permanently delete the room for everyone. The share link will stop working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDeleteRoomOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                onDeleteRoom();
                setDeleteRoomOpen(false);
              }}
            >
              Delete
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
