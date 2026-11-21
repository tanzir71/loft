import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ladderMode, canTalk, canViewShare, nextTurn, raiseHand as raise, shouldOffer, tickStage, type CallMode, type StageState } from "@loft/core";
import type { DataAdapter, PresencePeer, PresenceState, SignalMsg } from "@loft/data";

/**
 * Calls in the room (handoff §7.3, Figma "Live Room" + "Room · screen share"): peer-to-peer audio
 * over a WebRTC mesh (≤6 talking), stage mode (host as hub, raised hands, 60 s turns), screen share
 * on its own connections (≤6 viewers, stills every 3 s when a viewer can't connect), annotations,
 * "open together" and follow-me. Signalling reuses the adapter: BroadcastChannel in the preview,
 * /signal polling on the PHP server. No media ever goes through the server.
 */
export const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type Kind = "audio" | "screen";
interface Sig { type: string; from: string; to?: string; data?: Record<string, unknown> }
export interface Stroke { id: string; points: number[]; colour: string; by: string }

interface Options {
  adapter: DataAdapter;
  roomId: string | null;
  tabId: string;
  me: { userId: string; name: string };
  isHost: boolean;
  presence: { update(patch: Partial<PresenceState>): void } | null;
  peers: PresencePeer[];
  iceServers?: RTCIceServer[];
}

export function useCall(o: Options) {
  const { adapter, roomId, tabId, me, isHost, presence, peers } = o;
  const ice = o.iceServers ?? ICE_SERVERS;
  const [inCall, setInCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<Record<string, MediaStream>>({});
  const [stage, setStage] = useState<StageState & { on: boolean }>({ on: false, hands: [], turn: null });
  const [share, setShare] = useState<{ from: string; name: string; stream: MediaStream | null; still: string | null } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [openPrompt, setOpenPrompt] = useState<{ url: string; from: string } | null>(null);
  const [lastOpen, setLastOpen] = useState<string | null>(null);
  const [followingHost, setFollowingHost] = useState(true);
  const [followMe, setFollowMe] = useState(false);
  const [follow, setFollow] = useState<{ viewport: unknown; page: string | null; at: number } | null>(null);

  const local = useRef<MediaStream | null>(null);
  const screen = useRef<MediaStream | null>(null);
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const screenPcs = useRef(new Map<string, RTCPeerConnection>());
  const viewerPc = useRef<RTCPeerConnection | null>(null);
  const pendingIce = useRef(new Map<string, RTCIceCandidateInit[]>());
  const stillTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const send = useCallback(
    (type: string, data?: Record<string, unknown>, to?: string) => {
      if (roomId) adapter.signal(roomId, { type, from: tabId, ...(to ? { to } : {}), data } as SignalMsg);
    },
    [adapter, roomId, tabId]
  );

  const mode: CallMode = ladderMode(peers.filter((p) => p.inCall).length + (inCall ? 1 : 0), { stage: stage.on });
  const talkingNow = peers.filter((p) => p.inCall && p.audio === "on").length;
  const hasTurn = stage.turn?.id === tabId;
  const mayTalk = canTalk(mode, { isHost, hasTurn, talkingNow, amTalking: inCall && !muted });

  const closePc = useCallback((map: Map<string, RTCPeerConnection>, tab: string) => {
    map.get(tab)?.close();
    map.delete(tab);
  }, []);

  const makePc = useCallback(
    (tab: string, kind: Kind): RTCPeerConnection => {
      const pc = new RTCPeerConnection({ iceServers: ice });
      pc.onicecandidate = (e) => e.candidate && send("rtc-ice", { kind, candidate: e.candidate.toJSON() }, tab);
      if (kind === "audio") {
        pc.ontrack = (e) => setRemote((r) => ({ ...r, [tab]: e.streams[0] ?? new MediaStream([e.track]) }));
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed" || pc.connectionState === "closed") setRemote((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== tab)));
        };
      } else {
        pc.ontrack = (e) => setShare((s) => (s ? { ...s, stream: e.streams[0] ?? new MediaStream([e.track]) } : s));
        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === "failed") send("share-fail", {}, tab);
        };
      }
      return pc;
    },
    [ice, send]
  );

  const offer = useCallback(
    async (tab: string, kind: Kind) => {
      const map = kind === "audio" ? pcs.current : screenPcs.current;
      closePc(map, tab);
      const pc = makePc(tab, kind);
      map.set(tab, pc);
      const stream = kind === "audio" ? local.current : screen.current;
      stream?.getTracks().forEach((t) => pc.addTrack(t, stream));
      const sdp = await pc.createOffer();
      await pc.setLocalDescription(sdp);
      send("rtc-offer", { kind, sdp: pc.localDescription?.toJSON() }, tab);
    },
    [closePc, makePc, send]
  );

  const flushIce = useCallback(async (key: string, pc: RTCPeerConnection) => {
    for (const c of pendingIce.current.get(key) ?? []) await pc.addIceCandidate(c).catch(() => {});
    pendingIce.current.delete(key);
  }, []);

  // ---- screen share ----
  const stopShareLocal = useCallback(
    (announce = true) => {
      screen.current?.getTracks().forEach((t) => t.stop());
      screen.current = null;
      for (const tab of [...screenPcs.current.keys()]) closePc(screenPcs.current, tab);
      if (stillTimer.current) clearInterval(stillTimer.current);
      stillTimer.current = null;
      setSharing(false);
      setViewers(0);
      presence?.update({ sharing: false });
      if (announce) send("share-stop");
    },
    [closePc, presence, send]
  );

  const startStills = useCallback(() => {
    if (stillTimer.current || !screen.current) return;
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = screen.current;
    void video.play();
    const canvas = document.createElement("canvas");
    stillTimer.current = setInterval(() => {
      if (!video.videoWidth) return;
      const scale = Math.min(1, 1280 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/webp", 0.7);
      if (adapter.kind === "http" && roomId) {
        // On the server, stills are too big for /signal: upload (overwritten, not kept) and point viewers at it.
        const api = adapter.files.url("x").replace(/\/files\/x$/, "");
        void adapter.mutate(`rooms/${roomId}/still`, { dataUrl }).then(() => send("share-still", { url: `${api}/rooms/${roomId}/still?t=${Date.now()}` })).catch(() => {});
      } else send("share-still", { url: dataUrl });
    }, 3000);
  }, [adapter, roomId, send]);

  // ---- signalling ----
  useEffect(() => {
    if (!roomId) return;
    return adapter.onSignal(roomId, (raw) => {
      const m = raw as unknown as Sig;
      if (m.to && m.to !== tabId) return;
      const d = m.data ?? {};
      void (async () => {
        switch (m.type) {
          case "call-hello":
            if (!local.current) return;
            if (shouldOffer(tabId, m.from)) await offer(m.from, "audio");
            else send("call-here", {}, m.from);
            return;
          case "call-here":
            if (local.current && shouldOffer(tabId, m.from)) await offer(m.from, "audio");
            return;
          case "call-bye":
            closePc(pcs.current, m.from);
            setRemote((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== m.from)));
            return;
          case "rtc-offer": {
            const kind = d.kind as Kind;
            if (kind === "audio" && !local.current) return;
            const pc = makePc(m.from, kind);
            if (kind === "audio") {
              closePc(pcs.current, m.from);
              pcs.current.set(m.from, pc);
              local.current?.getTracks().forEach((t) => pc.addTrack(t, local.current!));
            } else {
              viewerPc.current?.close();
              viewerPc.current = pc;
            }
            await pc.setRemoteDescription(d.sdp as RTCSessionDescriptionInit);
            await flushIce(`${kind}:${m.from}`, pc);
            const ans = await pc.createAnswer();
            await pc.setLocalDescription(ans);
            send("rtc-answer", { kind, sdp: pc.localDescription?.toJSON() }, m.from);
            return;
          }
          case "rtc-answer": {
            const kind = d.kind as Kind;
            const pc = (kind === "audio" ? pcs.current : screenPcs.current).get(m.from);
            if (pc && pc.signalingState === "have-local-offer") {
              await pc.setRemoteDescription(d.sdp as RTCSessionDescriptionInit);
              await flushIce(`${kind}:${m.from}`, pc);
            }
            return;
          }
          case "rtc-ice": {
            const kind = d.kind as Kind;
            const pc = kind === "audio" ? pcs.current.get(m.from) : screenPcs.current.get(m.from) ?? viewerPc.current;
            const cand = d.candidate as RTCIceCandidateInit;
            if (pc?.remoteDescription) await pc.addIceCandidate(cand).catch(() => {});
            else pendingIce.current.set(`${kind}:${m.from}`, [...(pendingIce.current.get(`${kind}:${m.from}`) ?? []), cand]);
            return;
          }
          case "stage":
            setStage({ on: !!d.on, hands: (d.hands as string[]) ?? [], turn: (d.turn as StageState["turn"]) ?? null });
            return;
          case "share-start":
            setShare({ from: m.from, name: String(d.name ?? "Someone"), stream: null, still: null });
            setStrokes([]);
            if (screen.current) stopShareLocal(false);
            send("share-join", {}, m.from);
            return;
          case "share-join":
            if (screen.current && screenPcs.current.size < 6 && canViewShare(screenPcs.current.size)) {
              await offer(m.from, "screen");
              setViewers(screenPcs.current.size);
            }
            return;
          case "share-fail":
            startStills();
            return;
          case "share-still":
            setShare((s) => (s && s.from === m.from ? { ...s, still: String(d.url) } : s));
            return;
          case "share-stop":
            viewerPc.current?.close();
            viewerPc.current = null;
            setShare((s) => (s && s.from === m.from ? null : s));
            setTimeout(() => setStrokes((st) => (st.length && !st.some((x) => x.id === "keep") ? [] : st)), 10_000);
            return;
          case "ann":
            setStrokes((st) => [...st, d.stroke as Stroke]);
            return;
          case "ann-clear":
            setStrokes([]);
            return;
          case "open":
            setOpenPrompt({ url: String(d.url), from: String(d.name ?? "The host") });
            return;
          case "follow":
            setFollow({ viewport: d.viewport, page: (d.page as string) ?? null, at: Date.now() });
            return;
        }
      })().catch((e: Error) => setError(e.message));
    });
  }, [adapter, roomId, tabId, offer, makePc, closePc, flushIce, send, stopShareLocal, startStills]);

  // ---- audio ----
  const join = useCallback(async () => {
    setError(null);
    try {
      local.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      setInCall(true);
      setMuted(false);
      presence?.update({ inCall: true, audio: "on", tabId });
      send("call-hello", { name: me.name });
    } catch {
      setError("Loft couldn't use your microphone. Allow it in the browser, or keep going without audio.");
    }
  }, [me.name, presence, send, tabId]);

  const leave = useCallback(() => {
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    for (const tab of [...pcs.current.keys()]) closePc(pcs.current, tab);
    setRemote({});
    setInCall(false);
    presence?.update({ inCall: false, audio: "off", hand: false });
    send("call-bye");
  }, [closePc, presence, send]);

  const setMic = useCallback(
    (on: boolean) => {
      local.current?.getAudioTracks().forEach((t) => (t.enabled = on));
      setMuted(!on);
      presence?.update({ audio: on ? "on" : "muted" });
    },
    [presence]
  );

  // Stage mode: force-mute anyone without the turn; turns end on their own after 60 s.
  useEffect(() => {
    if (inCall && !mayTalk && !muted) setMic(false);
  }, [inCall, mayTalk, muted, setMic]);
  useEffect(() => {
    if (!stage.turn) return;
    const t = setTimeout(() => setStage((s) => ({ ...s, ...tickStage(s, Date.now() + 1) })), Math.max(0, stage.turn.endsAt - Date.now()));
    return () => clearTimeout(t);
  }, [stage.turn]);

  const broadcastStage = useCallback(
    (next: StageState & { on: boolean }) => {
      setStage(next);
      send("stage", { on: next.on, hands: next.hands, turn: next.turn });
    },
    [send]
  );

  const startShare = useCallback(async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true });
      screen.current = s;
      s.getVideoTracks()[0]?.addEventListener("ended", () => stopShareLocal());
      setSharing(true);
      setShare(null);
      setStrokes([]);
      presence?.update({ sharing: true });
      send("share-start", { name: me.name });
    } catch {
      setError("Sharing was cancelled or isn't allowed in this browser.");
    }
  }, [me.name, presence, send, stopShareLocal]);

  const annotate = useCallback(
    (points: number[], colour: string) => {
      const stroke: Stroke = { id: `${tabId}-${Date.now()}`, points, colour, by: tabId };
      setStrokes((st) => [...st, stroke]);
      send("ann", { stroke: stroke as unknown as Record<string, unknown> });
    },
    [send, tabId]
  );

  // ---- open together + follow me ----
  const openTogether = useCallback(
    (url: string) => {
      if (!/^https?:\/\//i.test(url)) return;
      send("open", { url, name: me.name });
      presence?.update({ opened: url });
      setLastOpen(url);
    },
    [me.name, presence, send]
  );
  const broadcastView = useCallback(
    (viewport: unknown, page: string | null) => {
      if (followMe && isHost) send("follow", { viewport: viewport as Record<string, unknown>, page });
    },
    [followMe, isHost, send]
  );

  // Call minutes once a minute while in a call (feeds Admin · Calls & budget).
  useEffect(() => {
    if (!inCall || !roomId) return;
    const t = setInterval(() => void adapter.mutate(`rooms/${roomId}/usage`, { minutes: 1, video: false }).catch(() => {}), 60_000);
    return () => clearInterval(t);
  }, [adapter, inCall, roomId]);

  // Clean up on unmount / room change.
  useEffect(
    () => () => {
      local.current?.getTracks().forEach((t) => t.stop());
      screen.current?.getTracks().forEach((t) => t.stop());
      for (const pc of pcs.current.values()) pc.close();
      for (const pc of screenPcs.current.values()) pc.close();
      viewerPc.current?.close();
      if (stillTimer.current) clearInterval(stillTimer.current);
    },
    []
  );

  const openedCount = useMemo(() => {
    const url = lastOpen ?? openPrompt?.url;
    return url ? peers.filter((p) => p.opened === url).length : 0;
  }, [lastOpen, openPrompt, peers]);

  return {
    inCall, muted, mode, mayTalk, error, setError, remote,
    join, leave, mute: () => setMic(false), unmute: () => mayTalk && setMic(true),
    stage, hasTurn,
    raiseHand: () => presence?.update({ hand: true }),
    lowerHand: () => presence?.update({ hand: false }),
    setStageOn: (on: boolean) => broadcastStage({ on, hands: [], turn: null }),
    giveTurn: (tab: string) => broadcastStage({ ...nextTurn({ hands: stage.hands, turn: null }, Date.now(), tab), on: true }),
    endTurn: () => broadcastStage({ ...stage, turn: null }),
    queueHand: (tab: string) => setStage((s) => ({ ...s, ...raise(s, tab) })),
    share, sharing, viewers, startShare, stopShare: () => stopShareLocal(), localScreen: screen,
    strokes, annotate, clearStrokes: () => { setStrokes([]); send("ann-clear"); }, keepStrokes: () => setStrokes((st) => [...st, { id: "keep", points: [], colour: "", by: tabId }]),
    openPrompt, dismissOpen: () => setOpenPrompt(null), lastOpen, clearLastOpen: () => setLastOpen(null), openTogether, markOpened: (url: string) => { presence?.update({ opened: url }); setOpenPrompt(null); }, openedCount,
    followMe, setFollowMe, followingHost, setFollowingHost, follow, broadcastView
  };
}
