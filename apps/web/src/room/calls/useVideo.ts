import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DataAdapter, PresencePeer, PresenceState } from "@loft/data";
import { CloudflareSfu, type CfResponse, type RemoteTrack } from "./sfu";

// Video, the last rung of the call ladder (handoff §7), with the org's own provider keys.
// - Cloudflare Realtime: cameras go through the SFU (audio stays on P2P / stage, so "≤6 talking" holds).
//   Each person publishes { sessionId, tracks } in room presence; everyone pulls the others' cameras.
// - Daily / Jitsi as a Service: the provider's own call (audio + video) opens in a panel, so Loft's P2P
//   audio is left first to avoid hearing everyone twice.
// Minutes are reported once a minute (video: true) and count against the org's daily budget.

export type VideoProvider = "cloudflare" | "daily" | "jitsi";
export interface VideoConfig { provider: VideoProvider; step: "full" | "warn" | "audio-only" | "own-link"; allowed: boolean }
type Join = { provider: "cloudflare"; sessionId: string; iceServers: RTCIceServer[] } | { provider: "daily" | "jitsi"; url: string };
interface PeerVideo { sessionId: string; tracks: string[] }

export interface VideoTile { key: string; name: string; stream: MediaStream; mine?: boolean }

export function videoBlockedReason(cfg: VideoConfig | null | undefined): string | null {
  if (!cfg || cfg.allowed) return null;
  return cfg.step === "warn" ? "Today's video minutes are nearly used up: new video is paused until tomorrow. Audio still works." : "Today's video minutes are used up. Audio still works.";
}

export function useVideo(o: {
  adapter: DataAdapter;
  roomId: string | null;
  config: VideoConfig | null | undefined;
  peers: PresencePeer[];
  presence: { update: (patch: Partial<PresenceState>) => void };
  /** Called before a provider call that carries its own audio (Daily, Jitsi) opens. */
  leaveAudio: () => void;
}) {
  const { adapter, roomId, peers, presence, leaveAudio } = o;
  const [active, setActive] = useState<VideoProvider | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remotes, setRemotes] = useState<RemoteTrack[]>([]);
  const sfu = useRef<CloudflareSfu | null>(null);
  const session = useRef<string | null>(null);
  const camera = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    const sid = session.current;
    sfu.current?.close();
    sfu.current = null;
    session.current = null;
    camera.current?.getTracks().forEach((t) => t.stop());
    camera.current = null;
    setLocal(null);
    setRemotes([]);
    setActive(null);
    setUrl(null);
    setNote(null);
    presence.update({ video: null });
    if (sid && roomId) void adapter.mutate(`rooms/${roomId}/video/leave`, { sessionId: sid }).catch(() => {});
  }, [adapter, presence, roomId]);

  const start = useCallback(async () => {
    if (!roomId || busy || active) return;
    setBusy(true);
    setError(null);
    try {
      const j = await adapter.mutate<Join>(`rooms/${roomId}/video/join`);
      if (j.provider !== "cloudflare") {
        leaveAudio();
        setUrl(j.url);
        setActive(j.provider);
        return;
      }
      const s = new CloudflareSfu((op, body) => adapter.mutate<CfResponse>(`rooms/${roomId}/video/cf`, { sessionId: j.sessionId, op, body }), j.iceServers);
      s.onChange = () => setRemotes([...s.remotes.values()]);
      sfu.current = s;
      session.current = j.sessionId;
      let tracks: string[] = [];
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { max: 24 } }, audio: false });
        camera.current = cam;
        setLocal(cam);
        tracks = await s.publish(cam.getVideoTracks());
        await s.connected().catch(() => {});
      } catch (e) {
        if (sfu.current !== s) return;
        if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "NotFoundError")) setNote("No camera: you can still see everyone else.");
        else throw e;
      }
      presence.update({ video: { sessionId: j.sessionId, tracks } });
      setActive("cloudflare");
    } catch (e) {
      stop();
      setError(e instanceof Error ? e.message : "Couldn't start video");
    } finally {
      setBusy(false);
    }
  }, [active, adapter, busy, leaveAudio, presence, roomId, stop]);

  // Cloudflare: pull everyone else's cameras; drop people who left or stopped.
  const peerVideo = useMemo(() => peers.map((p) => ({ p, v: (p as PresencePeer & { video?: PeerVideo | null }).video })).filter((x): x is { p: PresencePeer; v: PeerVideo } => !!x.v?.sessionId && Array.isArray(x.v.tracks)), [peers]);
  useEffect(() => {
    const s = sfu.current;
    if (active !== "cloudflare" || !s) return;
    const live = new Set<string>();
    for (const { v } of peerVideo) {
      if (v.sessionId === session.current) continue;
      live.add(v.sessionId);
      if (v.tracks.length) s.pull(v.sessionId, v.tracks).catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't get someone's video"));
    }
    for (const sid of s.pulling()) if (!live.has(sid)) void s.drop(sid);
  }, [active, peerVideo]);

  // Minutes against the daily budget, once a minute while video is on.
  useEffect(() => {
    if (!active || !roomId) return;
    const t = setInterval(() => void adapter.mutate(`rooms/${roomId}/usage`, { minutes: 1, video: true }).catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [active, adapter, roomId]);

  // Leaving the room ends your video.
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });
  useEffect(() => () => stopRef.current(), [roomId]);

  const tiles = useMemo<VideoTile[]>(() => {
    const out: VideoTile[] = [];
    if (local) out.push({ key: "me", name: "You", stream: local, mine: true });
    for (const r of remotes) {
      const who = peerVideo.find((x) => x.v.sessionId === r.sessionId)?.p.name;
      if (who) out.push({ key: r.key, name: who, stream: r.stream });
    }
    return out;
  }, [local, peerVideo, remotes]);

  return { active, url, busy, error, setError, note, tiles, start, stop, onVideo: peerVideo.length + (active === "cloudflare" ? 1 : 0) };
}

export type Video = ReturnType<typeof useVideo>;
