import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { AlertTriangle, Camera, ExternalLink, Hand, Mic, MicOff, MonitorUp, Pen, PhoneOff, Trash2, Video as VideoIcon, VideoOff, X } from "lucide-react";
import { Avatar, Button } from "@loft/ui";
import type { PresencePeer } from "@loft/data";
import type { useCall } from "./useCall";
import { videoBlockedReason, type Video, type VideoConfig } from "./useVideo";

type Call = ReturnType<typeof useCall>;

/** Hidden <audio> elements, one per remote stream. */
export function RemoteAudio({ streams }: { streams: Record<string, MediaStream> }) {
  return (
    <div hidden>
      {Object.entries(streams).map(([tab, s]) => (
        <audio key={tab} autoPlay ref={(el) => { if (el && el.srcObject !== s) el.srcObject = s; }} />
      ))}
    </div>
  );
}

/** Figma "Live Room": bottom-left "Audio on · 6 people" (or Join audio). */
export function AudioPill({ call, inCallCount, isHost, ownLink }: { call: Call; inCallCount: number; isHost: boolean; ownLink?: string | null }) {
  if (!call.inCall) {
    return (
      <div className="island call-pill" data-board-ui="">
        <Button size="sm" variant="secondary" icon={<Mic aria-hidden="true" />} onClick={() => void call.join()}>Join audio</Button>
        {ownLink && <a className="lf-btn lf-btn--ghost lf-btn--sm" href={ownLink} target="_blank" rel="noopener noreferrer" title="The host's own Meet/Zoom link">Own link</a>}
        {inCallCount > 0 && <small>{inCallCount} on audio</small>}
      </div>
    );
  }
  return (
    <div className="island call-pill is-on" data-board-ui="">
      <button type="button" className={`call-mic${call.muted ? " is-muted" : ""}`} onClick={() => (call.muted ? call.unmute() : call.mute())} disabled={call.muted && !call.mayTalk} aria-label={call.muted ? "Unmute" : "Mute"} aria-pressed={!call.muted}>
        {call.muted ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
      </button>
      <span className="call-pill__text"><b>{call.muted ? (call.mayTalk ? "Muted" : "Listening") : "Audio on"}</b><small>{inCallCount + 1} {inCallCount === 0 ? "person" : "people"}{call.mode === "stage" ? " · stage" : ""}{call.hasTurn ? " · your turn" : ""}</small></span>
      {call.mode === "stage" && !isHost && !call.hasTurn && <button type="button" className="lf-icon-btn" onClick={() => call.raiseHand()} aria-label="Raise hand" title="Raise hand"><Hand aria-hidden="true" /></button>}
      {isHost && <button type="button" className={`lf-icon-btn${call.stage.on ? " is-on" : ""}`} onClick={() => call.setStageOn(!call.stage.on)} aria-pressed={call.stage.on} title="Stage mode: you lead, others raise a hand" aria-label="Stage mode"><Hand aria-hidden="true" /></button>}
      <button type="button" className="lf-icon-btn" onClick={() => call.leave()} aria-label="Leave audio" title="Leave audio"><PhoneOff aria-hidden="true" /></button>
    </div>
  );
}

/** Host toasts: "Rafi raised a hand · Let him speak" → a 60 s turn. */
export function HandToasts({ call, peers }: { call: Call; peers: PresencePeer[] }) {
  const hands = peers.filter((p) => p.hand && p.inCall);
  if (!hands.length) return null;
  return (
    <>
      {hands.map((p) => (
        <div key={p.tabId} className="island toast">
          <Hand aria-hidden="true" className="toast__ic" />
          <span className="toast__text"><b>{p.name.split(" ")[0]} raised a hand</b></span>
          <Button size="sm" onClick={() => { if (!call.stage.on) call.setStageOn(true); call.giveTurn(p.tabId); }}>Let them speak</Button>
        </div>
      ))}
    </>
  );
}

/** "Nusrat wants everyone on this page" (open together; never proxied or embedded). */
export function OpenPrompt({ call, total }: { call: Call; total: number }) {
  if (!call.openPrompt && call.lastOpen) {
    return (
      <div className="island open-prompt" role="status" data-board-ui="">
        <b>Everyone was asked to open</b>
        <code>{call.lastOpen.replace(/^https?:\/\//, "")}</code>
        <small>{call.openedCount} of {total} have it open</small>
        <div className="open-prompt__actions"><Button size="sm" variant="ghost" onClick={() => call.clearLastOpen()}>Done</Button></div>
      </div>
    );
  }
  if (!call.openPrompt) return null;
  const { url, from } = call.openPrompt;
  return (
    <div className="island open-prompt" role="dialog" aria-label="Open together" data-board-ui="">
      <b>{from.split(" ")[0]} wants everyone on this page</b>
      <code>{url.replace(/^https?:\/\//, "")}</code>
      <div className="open-prompt__actions">
        <a className="lf-btn lf-btn--primary lf-btn--sm" href={url} target="_blank" rel="noopener noreferrer" onClick={() => call.markOpened(url)}><ExternalLink aria-hidden="true" />Open in new tab</a>
        <Button size="sm" variant="ghost" onClick={() => call.dismissOpen()}>Not now</Button>
      </div>
      {total > 0 && <small>{call.openedCount} of {total} have it open</small>}
    </div>
  );
}

/** Screen share overlay (Figma "Room · screen share"): video or stills, annotations, snapshot, open together. */
export function ShareOverlay({ call, peers, myName, onSnapshot }: { call: Call; peers: PresencePeer[]; myName: string; onSnapshot: (blob: Blob) => Promise<void> }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef<number[] | null>(null);
  const [pen, setPen] = useState(true);
  const [busy, setBusy] = useState(false);
  const mine = call.sharing;
  const stream = mine ? call.localScreen.current : call.share?.stream ?? null;
  const name = mine ? myName : call.share?.name ?? "";
  useEffect(() => {
    if (video.current && video.current.srcObject !== stream) video.current.srcObject = stream;
  }, [stream]);
  // Draw annotations (normalised 0..1 coordinates, so they line up on every screen size).
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.width = r.width;
    c.height = r.height;
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    g.lineWidth = 3;
    g.lineCap = "round";
    for (const s of call.strokes) {
      if (s.points.length < 4) continue;
      g.strokeStyle = s.colour;
      g.beginPath();
      g.moveTo(s.points[0]! * c.width, s.points[1]! * c.height);
      for (let i = 2; i < s.points.length; i += 2) g.lineTo(s.points[i]! * c.width, s.points[i + 1]! * c.height);
      g.stroke();
    }
  }, [call.strokes]);
  if (!mine && !call.share) return null;
  const at = (e: RPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  const snapshot = async () => {
    const v = video.current;
    const out = document.createElement("canvas");
    const w = v?.videoWidth || 1280;
    const h = v?.videoHeight || 720;
    out.width = Math.min(1600, w);
    out.height = Math.round((out.width / w) * h);
    const g = out.getContext("2d");
    if (!g) return;
    if (v && v.videoWidth) g.drawImage(v, 0, 0, out.width, out.height);
    else if (call.share?.still) {
      const img = new Image();
      img.src = call.share.still;
      await img.decode().catch(() => {});
      g.drawImage(img, 0, 0, out.width, out.height);
    }
    if (canvas.current) g.drawImage(canvas.current, 0, 0, out.width, out.height);
    const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/webp", 0.85));
    if (!blob) return;
    setBusy(true);
    try {
      await onSnapshot(blob);
    } finally {
      setBusy(false);
    }
  };
  const viewers = peers.filter((p) => p.tabId !== call.share?.from).slice(0, 6);
  return (
    <div className="screenshare" data-board-ui="">
      <div className="island screenshare__chip"><MonitorUp aria-hidden="true" /><b>{mine ? "You're" : `${name.split(" ")[0]} is`} sharing</b><span className="screenshare__live">{mine ? `${call.viewers} watching` : call.share?.stream ? "live" : call.share?.still ? "still every 3 s" : "connecting…"}</span></div>
      <div className="island screenshare__who">
        {viewers.map((p) => <Avatar key={p.tabId} name={p.name} size="sm" />)}
        {mine && <Button size="sm" variant="danger" icon={<X aria-hidden="true" />} onClick={() => call.stopShare()}>Stop sharing</Button>}
      </div>
      <div className="screenshare__frame">
        {call.share?.still && !call.share.stream && !mine ? <img src={call.share.still} alt={`${name}'s screen`} /> : <video ref={video} autoPlay playsInline muted={mine} />}
        <canvas
          ref={canvas}
          className={`screenshare__ink${pen ? " is-pen" : ""}`}
          aria-label="Annotations"
          onPointerDown={(e) => { if (!pen) return; e.currentTarget.setPointerCapture(e.pointerId); drawing.current = at(e); }}
          onPointerMove={(e) => { if (drawing.current) drawing.current.push(...at(e)); }}
          onPointerUp={() => { if (drawing.current && drawing.current.length >= 4) call.annotate(drawing.current, "#ef4444"); drawing.current = null; }}
        />
      </div>
      <div className="island screenshare__tools">
        <button type="button" className={`lf-icon-btn${pen ? " is-on" : ""}`} aria-pressed={pen} aria-label="Pen" onClick={() => setPen(!pen)}><Pen aria-hidden="true" /></button>
        <button type="button" className="lf-icon-btn" aria-label="Clear annotations" onClick={() => call.clearStrokes()}><Trash2 aria-hidden="true" /></button>
        <Button size="sm" variant="ghost" icon={<Camera aria-hidden="true" />} disabled={busy} onClick={() => void snapshot()}>Snapshot to board</Button>
        <Button size="sm" variant="ghost" icon={<ExternalLink aria-hidden="true" />} onClick={() => { const u = prompt("Link to open together (https://…)"); if (u) call.openTogether(u.trim()); }}>Open together</Button>
      </div>
      {mine && call.viewers === 0 && <p className="island screenshare__note"><AlertTriangle aria-hidden="true" />Waiting for viewers. Anyone who can't get video sees a still every 3 s.</p>}
    </div>
  );
}

/** Followers' chip: "Following Nusrat" with a way out. */
export function FollowChip({ call, hostName }: { call: Call; hostName: string }) {
  if (!call.follow) return null;
  return (
    <div className="island follow-chip" data-board-ui="">
      <span>{call.followingHost ? `Following ${hostName.split(" ")[0]}` : `${hostName.split(" ")[0]} is presenting`}</span>
      <Button size="sm" variant="ghost" onClick={() => call.setFollowingHost(!call.followingHost)}>{call.followingHost ? "Stop following" : "Follow"}</Button>
    </div>
  );
}

const PROVIDER_NAME = { cloudflare: "Cloudflare", daily: "Daily", jitsi: "Jitsi" } as const;

/** Video with the org's own keys (the ladder's last rung). Hidden when the org hasn't set it up. */
export function VideoPill({ video, config }: { video: Video; config: VideoConfig | null | undefined }) {
  if (!config) return null;
  const blocked = videoBlockedReason(config);
  if (!video.active) {
    return (
      <div className="island call-pill" data-board-ui="">
        <Button size="sm" variant="secondary" icon={<VideoIcon aria-hidden="true" />} disabled={!!blocked || video.busy} onClick={() => void video.start()} title={blocked ?? `Video through ${PROVIDER_NAME[config.provider]}`}>{video.busy ? "Starting video…" : "Video"}</Button>
        {blocked ? <small>{blocked}</small> : video.onVideo > 0 && <small>{video.onVideo} on video</small>}
      </div>
    );
  }
  return (
    <div className="island call-pill is-on" data-board-ui="">
      <span className="call-pill__text"><b>Video on</b><small>{video.active === "cloudflare" ? `${video.onVideo} on video` : `${PROVIDER_NAME[video.active]} call`}</small></span>
      <button type="button" className="lf-icon-btn" onClick={() => video.stop()} aria-label="Stop video" title="Stop video"><VideoOff aria-hidden="true" /></button>
    </div>
  );
}

function Tile({ stream, name, mine }: { stream: MediaStream; name: string; mine?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <figure className={`video-tile${mine ? " is-mine" : ""}`}>
      <video ref={ref} autoPlay playsInline muted aria-label={`${name}'s camera`} />
      <figcaption>{name}</figcaption>
    </figure>
  );
}

/** Camera tiles (Cloudflare SFU) or the provider's own call (Daily, Jitsi) beside the board. */
export function VideoPanel({ video }: { video: Video }) {
  if (!video.active) return null;
  if (video.url) {
    return (
      <section className="island video-panel video-panel--call" data-board-ui="" aria-label="Video call">
        <header className="video-panel__head"><b>Video · {PROVIDER_NAME[video.active]}</b><small>Audio is in this call</small><button type="button" className="lf-icon-btn" onClick={() => video.stop()} aria-label="Close video"><X aria-hidden="true" /></button></header>
        <iframe src={video.url} title={`${PROVIDER_NAME[video.active]} video call`} allow="camera; microphone; display-capture; fullscreen; autoplay" />
      </section>
    );
  }
  return (
    <section className="island video-panel" data-board-ui="" aria-label="Video">
      <div className="video-panel__grid">
        {video.tiles.map((t) => <Tile key={t.key} stream={t.stream} name={t.name} mine={t.mine} />)}
      </div>
      {video.tiles.length <= 1 && <p className="video-panel__note">Waiting for others to turn on video.</p>}
      {video.note && <p className="video-panel__note">{video.note}</p>}
    </section>
  );
}
