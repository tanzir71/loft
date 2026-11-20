import { useEffect, useRef, useState } from "react";
import type { PresenceHandle, PresencePeer, PresenceState } from "@loft/data";
import { useAdapter } from "../lib/data";

/** Join a room's presence (heartbeat 5 s, TTL 30 s). Returns the other peers and an update function. */
export function usePresence(roomId: string | null, me: PresenceState | null) {
  const adapter = useAdapter();
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const handle = useRef<PresenceHandle | null>(null);
  const meKey = me ? `${me.userId}|${me.name}` : null;
  const meRef = useRef(me);

  useEffect(() => {
    meRef.current = me;
  });

  useEffect(() => {
    if (!roomId || !meKey || !meRef.current) return;
    const h = adapter.presence(roomId, meRef.current, setPeers);
    handle.current = h;
    const leave = () => h.stop();
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      h.stop();
      handle.current = null;
      setPeers([]);
    };
  }, [adapter, roomId, meKey]);

  return {
    peers,
    update: (patch: Partial<PresenceState>) => handle.current?.update(patch)
  };
}
