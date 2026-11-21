import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Bot, ChevronDown, ChevronLeft, ChevronRight, Code, Copy, Download, Eraser, Eye, Grid2x2, Hand, Link2, Mail, MessageCircle, MonitorUp, MousePointer2, Pause, Pencil, Plus, Redo2, RefreshCw, Search, Shapes, Share2, Spline, StickyNote, Type, Undo2, Upload, Users, X, ZoomIn, ZoomOut } from "lucide-react";
import { Avatar, Button, PreviewBanner } from "@loft/ui";
import { normaliseCode, type User } from "@loft/core";
import { applyOp, bounds, pageAt, sortedPages, PAGE_GAP, type BoardOp, type Viewport, type ConnectorObj, type Page, type ShapeKind, type StickyColour } from "@loft/board";
import type { LocalAdapter } from "@loft/data";
import { useAdapter, useQuery } from "../lib/data";
import { relTime } from "../components/bits";
import { useBreakpoint, useOnline } from "../lib/media";
import { IS_PREVIEW } from "../lib/env";
import { Board, type BoardHandle, type Tool } from "./Board";
import { RoomChat } from "./Chat";
import { contentBounds, exportPdf, exportPng } from "./board/render";
import { googleExportUrl, renderImage, renderPdf } from "./board/pdfImport";
import { DiagramPanel, FindBar, PenOptions, SelectionBar, ShapesFlyout } from "./BoardPanels";
import { useFileUrls } from "./useFileUrls";
import { JoinForm, RoomFull, SessionEnded, StateScreen, WaitingForHost } from "./screens";
import { useBoard } from "./useBoard";
import { PlanRail } from "./PlanRail";
import { usePresence } from "./usePresence";
import { useCall } from "./calls/useCall";
import { useVideo, type VideoConfig } from "./calls/useVideo";
import { AudioPill, FollowChip, HandToasts, OpenPrompt, RemoteAudio, ShareOverlay, VideoPanel, VideoPill } from "./calls/CallUI";
import "./calls/calls.css";

export interface RoomRes {
  id: string;
  code: string;
  name: string;
  capacity: number;
  guestJoin: boolean;
  createdBy: string;
  createdAt: string;
  endedAt: string | null;
  hostName: string;
  sessionId?: string | null;
}
interface Admission {
  id: string;
  name: string;
  status: "pending" | "admitted" | "denied";
}

const PEN_COLOURS_ALL = [
  { name: "Ink", value: "#1a1c23" },
  { name: "Blue", value: "#213a8c" },
  { name: "Red", value: "#ef4343" },
  { name: "Mint", value: "#1dd7b2" }
];
const PEN_COLOURS = [...PEN_COLOURS_ALL, { name: "Amber", value: "#f59f0a" }, { name: "Lilac", value: "#a5b6eb" }];
const STICKY_COLOURS: StickyColour[] = ["yellow", "pink", "blue", "green"];
const GUEST_NAME_KEY = "loft.guestName";

const readGuestName = () => {
  try {
    return localStorage.getItem(GUEST_NAME_KEY) ?? "";
  } catch {
    return "";
  }
};

/** Absolute link others can open to join (hash routing on Pages). */
export function roomLink(code: string): string {
  const base = `${location.origin}${import.meta.env.BASE_URL}`;
  return IS_PREVIEW ? `${base}#/r/${code}` : `${base}r/${code}`;
}

/** /r/new: create a room from the "+" sheet or the landing quick start, then open it. */
export function NewRoom() {
  const adapter = useAdapter();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void adapter
      .mutate<RoomRes>("rooms", { name: params.get("name") ?? "", guestJoin: params.get("guests") !== "0" })
      .then((r) => nav(`/r/${r.code}`, { replace: true }));
  }, [adapter, nav, params]);
  return <StateScreen title="Opening your room…" />;
}

/** /join: enter a code + your name. In the preview, joining makes this tab a guest so two tabs are two people. */
export function JoinPage() {
  const adapter = useAdapter();
  const nav = useNavigate();
  const [params] = useSearchParams();
  return (
    <JoinForm
      initialCode={params.get("code") ?? ""}
      initialName={params.get("name") ?? readGuestName()}
      onJoin={async (code, name) => {
        try {
          localStorage.setItem(GUEST_NAME_KEY, name);
        } catch {
          /* private mode */
        }
        const me = await adapter.auth.me();
        let room: RoomRes | null = null;
        try {
          room = await adapter.query<RoomRes>(`rooms/by-code/${code}`);
        } catch {
          room = null;
        }
        if (!room) {
          alert(`No room with the code ${code}. Check it with the host.`);
          return;
        }
        if (!me || me.id !== room.createdBy || params.get("as") === "guest") {
          const g = await adapter.mutate<{ id: string }>("guests", { name });
          if (adapter.kind === "local") (adapter as LocalAdapter).setTabIdentity(g.id);
        }
        nav(`/r/${room.code}`);
      }}
    />
  );
}

export function RoomPage() {
  const { code = "" } = useParams();
  const adapter = useAdapter();
  const nav = useNavigate();
  const loc = useLocation();
  const bp = useBreakpoint();
  const phone = bp === "phone";
  const { data: me, loading: meLoading } = useQuery<User | null>("me");
  const { data: room, error } = useQuery<RoomRes>(`rooms/by-code/${normaliseCode(code)}`);
  const isHost = Boolean(me && room && me.id === room.createdBy);
  const guest = Boolean(me && room && !isHost);
  const [knocked, setKnocked] = useState(false);
  const { data: myAdm } = useQuery<Admission | null>(room && guest && knocked ? `rooms/${room.id}/admission` : null);
  const { data: admissions = [] } = useQuery<Admission[]>(room && isHost ? `rooms/${room.id}/admissions` : null);
  const admitted = isHost || myAdm?.status === "admitted";
  const [joinedAt] = useState(() => Date.now());
  const [seat, setSeat] = useState<"deciding" | "in" | "waiting">("deciding");
  const [settled, setSettled] = useState(false);

  // Guests knock once (guest join on → straight in; off → the host admits).
  useEffect(() => {
    if (!room || !guest || knocked || room.endedAt) return;
    void adapter.mutate(`rooms/${room.id}/knock`).then(() => setKnocked(true)).catch(() => setKnocked(true));
  }, [adapter, room, guest, knocked]);

  const presenceMe =
    me && room && admitted && !room.endedAt
      ? { userId: me.id, name: me.name, role: isHost ? "host" : "guest", status: seat === "in" ? "in" : "waiting", joinedAt, cursor: null, editing: null }
      : null;
  const { peers, update } = usePresence(room?.id ?? null, presenceMe);
  // Calls, screen share, open together and follow-me (M11). Media goes peer to peer, never through the server.
  const { data: callCfg } = useQuery<{ iceServers: RTCIceServer[]; ownLink: string | null; video: VideoConfig | null }>(room && seat === "in" ? `rooms/${room.id}/call-config` : null);
  const call = useCall({ adapter, roomId: room && seat === "in" && !room.endedAt ? room.id : null, tabId: adapter.tabId, me: { userId: me?.id ?? "", name: me?.name ?? "" }, isHost, presence: { update }, peers, iceServers: callCfg?.iceServers });
  // Video with the org's own keys (Cloudflare SFU cameras, or the Daily / Jitsi call); only when the org set it up.
  const video = useVideo({ adapter, roomId: room && seat === "in" && !room.endedAt ? room.id : null, config: callCfg?.video, peers, presence: { update }, leaveAudio: () => call.leave() });
  const lastView = useRef(0);

  useEffect(() => {
    if (!presenceMe) return;
    const t = setTimeout(() => setSettled(true), 600);
    return () => clearTimeout(t);
  }, [Boolean(presenceMe)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Capacity 12 (agents don't count): take a seat, or wait in line until one frees up.
  const humansIn = peers.filter((p) => p.status === "in" && !p.isAgent);
  const waitingAhead = peers.filter((p) => p.status === "waiting" && typeof p.joinedAt === "number" && (p.joinedAt as number) < joinedAt).length;
  const freeSeats = (room?.capacity ?? 12) - humansIn.length;
  const waitingPeers = peers.filter((p) => p.status === "waiting" && !p.isAgent);
  const online = useOnline();
  useEffect(() => {
    if (!room || !admitted || seat === "in") return;
    if (isHost) setSeat("in"); // the host always has a seat
    else if (!settled) return; // wait for presence to tell us who is already inside
    else if (waitingAhead < freeSeats) setSeat("in");
    else setSeat("waiting");
  }, [room, admitted, seat, settled, isHost, waitingAhead, freeSeats]);
  useEffect(() => {
    update({ status: seat === "in" ? "in" : "waiting" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seat]);

  const { state, commit, undo, redo } = useBoard(seat === "in" ? (room?.id ?? null) : null, me?.id ?? "anon");
  // Agent draft layer (Figma 06 · A4): pending board drafts, dashed, visible to the host only.
  const { data: agentLayer } = useQuery<{ ops: BoardOp[]; pending: number; activity: { at: string; text: string }[]; working: { title: string; seat: string } | null; taskId: string | null; paused: boolean }>(isHost && room ? `rooms/${room.id}/agent` : null);
  const boardState = useMemo(() => (agentLayer?.ops.length ? agentLayer.ops.reduce((s2, op) => applyOp(s2, op), state) : state), [agentLayer, state]);
  // Attendance from presence (joined/left), used by the wrap-up.
  useEffect(() => {
    if (seat !== "in" || !room) return;
    void adapter.mutate(`rooms/${room.id}/attendance`, { event: "join" }).catch(() => {});
    const leave = () => void adapter.mutate(`rooms/${room.id}/attendance`, { event: "leave" }).catch(() => {});
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [adapter, seat, room?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const boardRef = useRef<BoardHandle>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [penColour, setPenColour] = useState(PEN_COLOURS[1]!.value);
  const [smoothing, setSmoothing] = useState(0.6);
  const [highlighter, setHighlighter] = useState(false);
  const [recognise, setRecognise] = useState(true);
  const [shapeKind, setShapeKind] = useState<ShapeKind>("process");
  const [connectorRoute] = useState<ConnectorObj["route"]>("elbow");
  const [diagramFor, setDiagramFor] = useState<string | null | "new">(null);
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileUrl = useFileUrls(state);
  const [stickyColour, setStickyColour] = useState<StickyColour>("yellow");
  const [share, setShare] = useState(false);
  const [more, setMore] = useState(false);
  const [pageMenu, setPageMenu] = useState(false);
  const [visiblePage, setVisiblePage] = useState<string | null>("p1");
  const pages = sortedPages(state);
  useEffect(() => {
    if (!isHost && call.follow && call.followingHost) boardRef.current?.setViewport(call.follow.viewport as Viewport);
  }, [call.follow, call.followingHost, isHost]);
  const pageIndex = Math.max(0, pages.findIndex((p) => p.id === visiblePage));

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea")) return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "f") {
        e.preventDefault();
        setFinding(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const map: Record<string, Tool> = { v: "select", h: "hand", p: "pen", e: "eraser", s: "sticky", t: "text", r: "shape", x: "connector", f: "section" };
      if (map[k]) setTool(map[k]!);
      if (k === "u") fileInput.current?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  if (error) {
    return (
      <StateScreen title="That room isn't here" actions={<Button block onClick={() => nav("/join")}>Try another code</Button>}>
        <p className="state-screen__lead">Check the code with the host. Codes look like K7P-42Q.</p>
      </StateScreen>
    );
  }
  if (!room || meLoading) return <StateScreen title="Opening the room…" />;
  if (!me) return <JoinForm initialCode={room.code} initialName={readGuestName()} onJoin={() => nav(`/join?code=${room.code}`)} />;

  const badge = room.name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "LF";

  if (room.endedAt) {
    return <SessionEnded roomName={room.name} isHost={isHost} isGuest={guest} onDownload={() => void exportPdf(state, sortedPages(state), room.name, fileUrl.image)} />;
  }
  if (guest && myAdm?.status === "denied") {
    return (
      <StateScreen title="The host didn't let you in" actions={<Button variant="secondary" block onClick={() => nav("/")}>Close</Button>}>
        <p className="state-screen__lead">You can ask {room.hostName.split(" ")[0]} for a new link.</p>
      </StateScreen>
    );
  }
  if (guest && !admitted) {
    return <WaitingForHost roomName={room.name} hostName={room.hostName} people={peers.length} name={me.name} badge={badge} />;
  }
  if (seat === "deciding") return <StateScreen title="Finding you a seat…" />;
  if (seat === "waiting") {
    return (
      <RoomFull
        roomName={room.name}
        capacity={room.capacity}
        position={waitingAhead + 1}
        onLeave={() => nav("/")}
        onMessage={() => alert("Direct messages arrive in M3.")}
      />
    );
  }

  const people = [{ userId: me.id, name: me.name, tabId: "me" }, ...peers.filter((p) => p.status === "in")];
  const goPage = (i: number) => {
    const pg = pages[Math.max(0, Math.min(pages.length - 1, i))];
    if (pg) boardRef.current?.goToPage(pg.id);
  };
  const addPage = () => {
    const pg = pageAt(pages.length, `p${Date.now().toString(36)}`, `Page ${pages.length + 1}`);
    commit({ kind: "add", payload: { page: pg } });
    setTimeout(() => boardRef.current?.goToPage(pg.id), 50);
    setPageMenu(false);
  };
  // Figma Board v2 · tools spec: one tool active at a time, Esc returns to Select.
  const tools: { id: Tool; label: string; icon: JSX.Element; key: string }[] = [
    { id: "select", label: "Select", icon: <MousePointer2 aria-hidden="true" />, key: "V" },
    { id: "hand", label: "Hand (pan)", icon: <Hand aria-hidden="true" />, key: "H" },
    { id: "pen", label: "Pen", icon: <Pencil aria-hidden="true" />, key: "P" },
    { id: "eraser", label: "Eraser", icon: <Eraser aria-hidden="true" />, key: "E" },
    { id: "sticky", label: "Sticky note", icon: <StickyNote aria-hidden="true" />, key: "S" },
    { id: "shape", label: "Shapes", icon: <Shapes aria-hidden="true" />, key: "R" },
    { id: "connector", label: "Connector", icon: <Spline aria-hidden="true" />, key: "X" },
    { id: "text", label: "Text", icon: <Type aria-hidden="true" />, key: "T" },
    { id: "section", label: "Section", icon: <Grid2x2 aria-hidden="true" />, key: "F" }
  ];
  const phoneTools = tools.filter((t) => ["select", "pen", "sticky", "shape", "connector"].includes(t.id));

  /** PDFs, slides and images become board pages (WebP, rendered in the browser). */
  const importFiles = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length) return;
    let order = pages.length;
    let x = Math.max(0, ...pages.map((pg) => pg.x + pg.w)) + PAGE_GAP;
    const ops: BoardOp[] = [];
    let firstId: string | null = null;
    try {
      for (const f of list) {
        const rendered = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf") ? await renderPdf(f, (d, t) => setBusy(`Importing ${f.name}: page ${d} of ${t}`)) : [await renderImage(f)];
        for (const [i, r] of rendered.entries()) {
          setBusy(`Saving page ${i + 1} of ${rendered.length}`);
          const ref = await adapter.files.put(r.blob, { name: `${f.name.replace(/\.[^.]+$/, "")}-p${i + 1}.webp` });
          const h = 900;
          const w = Math.round((r.width / r.height) * h);
          const pg: Page = { id: `p${Date.now().toString(36)}${order}`, title: rendered.length > 1 ? `${f.name} · p${i + 1}` : f.name, order, x, y: 0, w, h, bg: ref.id };
          firstId ??= pg.id;
          ops.push({ kind: "add", payload: { page: pg } });
          order += 1;
          x += w + PAGE_GAP;
        }
      }
      if (ops.length) commit({ kind: "batch", payload: { ops } });
      if (firstId) setTimeout(() => boardRef.current?.goToPage(firstId!), 80);
    } catch (err) {
      alert(err instanceof Error ? err.message : "That file couldn't be imported.");
    } finally {
      setBusy(null);
    }
  };
  const importLink = async () => {
    const link = prompt("Paste a public Google Slides or Docs link");
    if (!link) return;
    const url = googleExportUrl(link);
    if (!url) return alert("That doesn't look like a Google Slides or Docs link.");
    try {
      setBusy("Fetching the PDF from Google…");
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      await importFiles([new File([await res.blob()], "slides.pdf", { type: "application/pdf" })]);
    } catch {
      setBusy(null);
      alert("Google doesn't let browsers fetch that file directly. Open the link, use File → Download → PDF, then drop the PDF here.");
    }
  };
  const exportCurrentPng = () => {
    const pg = pages[pageIndex];
    void exportPng(state, pg ?? contentBounds(state), `${room.name} ${pg?.title ?? ""}`, fileUrl.image);
  };

  return (
    <div className={`room${phone ? " room--phone" : ""}`}>
      {IS_PREVIEW && <PreviewBanner />}
      <div className="room__stage">
        <Board
          ref={boardRef}
          state={boardState}
          commit={commit}
          tool={tool}
          pen={{ colour: penColour, size: phone ? 3 : 3.5, smoothing, highlighter, recognise }}
          stickyColour={stickyColour}
          shapeKind={shapeKind}
          connectorRoute={connectorRoute}
          fileUrl={fileUrl.url}
          renderSelectionBar={(ids) => (
            <SelectionBar
              state={state}
              ids={ids}
              commit={commit}
              onEditDiagram={(id) => setDiagramFor(id)}
              onExportSection={(id, kind) => {
                const s = state.objects[id];
                if (!s) return;
                const r = bounds(s);
                if (kind === "png") void exportPng(state, r, s.kind === "section" ? s.title : room.name, fileUrl.image);
                else void exportPdf(state, [r], s.kind === "section" ? s.title : room.name, fileUrl.image);
              }}
            />
          )}
          meId={me.id}
          peers={peers.filter((p) => p.status === "in")}
          onCursor={(c) => update({ cursor: c })}
          onEditing={(id) => update({ editing: id })}
          onViewChange={(v, pg) => {
            if (pg) setVisiblePage(pg);
            const t = performance.now();
            if (call.followMe && t - lastView.current > 250) {
              lastView.current = t;
              call.broadcastView(v, pg);
            }
          }}
          onToolDone={() => setTool("select")}
        />

        {/* top-left: room pill */}
        <div className="island room__pill" data-board-ui="">
          {phone ? (
            <button type="button" className="lf-icon-btn" onClick={() => nav("/")} aria-label="Leave the room">
              <ChevronLeft aria-hidden="true" />
            </button>
          ) : (
            <span className="room__badge" aria-hidden="true">{badge}</span>
          )}
          <span className="room__title">
            <b>{room.name}</b>
            {!phone && (
              <small>
                {room.code} · <RoomTimer since={room.createdAt} />
              </small>
            )}
          </span>
          {phone ? (
            <span className="live-pill"><span className="live-dot" aria-hidden="true" /> <RoomTimer since={room.createdAt} /></span>
          ) : (
            <span className="live-dot" title="Live" aria-label="Live" />
          )}
        </div>

        {/* top-right: people, share, end */}
        <div className="island room__people" data-board-ui="">
          {phone ? (
            <span className="room__count" aria-label={`${people.length} in the room`}><Users aria-hidden="true" /> {people.length}</span>
          ) : (
            <span className="avatar-stack" aria-label={`${people.length} in the room`}>
              {people.slice(0, 3).map((p) => (
                <Avatar key={p.tabId} name={p.name} />
              ))}
              {people.length > 3 && <span className="avatar-stack__more">+{people.length - 3}</span>}
            </span>
          )}
          {isHost && !phone && (
            <button type="button" className={`lf-icon-btn${call.followMe ? " is-on" : ""}`} onClick={() => call.setFollowMe(!call.followMe)} aria-pressed={call.followMe} aria-label="Follow me" title="Follow me: everyone sees what you see">
              <Eye aria-hidden="true" />
            </button>
          )}
          {!phone && typeof navigator !== "undefined" && "getDisplayMedia" in (navigator.mediaDevices ?? {}) && (
            <button type="button" className={`lf-icon-btn${call.sharing ? " is-on" : ""}`} onClick={() => (call.sharing ? call.stopShare() : void call.startShare())} aria-pressed={call.sharing} aria-label="Share screen" title="Share a screen, window or tab">
              <MonitorUp aria-hidden="true" />
            </button>
          )}
          <button type="button" className={`lf-icon-btn${share ? " is-on" : ""}`} onClick={() => setShare(!share)} aria-label="Invite to this room" aria-expanded={share}>
            <Share2 aria-hidden="true" />
          </button>
          {!phone &&
            (isHost ? (
              <Button
                variant="dark"
                size="sm"
                onClick={async () => {
                  if (!confirm("End the session for everyone?")) return;
                  await adapter.mutate(`rooms/${room.id}/end`);
                  if (room.sessionId) nav(`/wrapup/${room.sessionId}`);
                }}
              >
                End
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => nav("/join")}>Leave</Button>
            ))}
        </div>

        {room.sessionId && <div className="room__rail"><PlanRail sessionId={room.sessionId} compact={phone} onGoToPage={(id) => boardRef.current?.goToPage(id)} /></div>}
        {share && <SharePopover room={room} isHost={isHost} onClose={() => setShare(false)} phone={phone} onEnd={async () => adapter.mutate(`rooms/${room.id}/end`)} />}

        {isHost && agentLayer && (agentLayer.pending > 0 || agentLayer.working) && (
          <div className="room__agent" data-board-ui="">
            <div className="island room__agent-bar">
              <Bot aria-hidden="true" />
              <span>{agentLayer.working ? `${agentLayer.working.seat} · ${agentLayer.working.title.toLowerCase()}` : "agent drafts waiting"}</span>
              {agentLayer.taskId && agentLayer.pending > 0 && <Link className="lf-btn lf-btn--primary lf-btn--sm" to={`/agents/review/${agentLayer.taskId}`}><Eye aria-hidden="true" />Review {agentLayer.pending} draft{agentLayer.pending === 1 ? "" : "s"}</Link>}
            </div>
            {!phone && agentLayer.activity.length > 0 && (
              <div className="island room__agent-log">
                <div className="room__agent-head"><b>Agent activity</b><Button size="sm" variant="secondary" icon={<Pause aria-hidden="true" />} onClick={() => void adapter.mutate("agents/pause", { paused: !agentLayer.paused })}>{agentLayer.paused ? "Resume agents" : "Pause agents"}</Button></div>
                <ul role="list">{agentLayer.activity.slice(0, 4).map((a, i) => <li key={i}><Bot aria-hidden="true" /><span>{a.text}</span><small>{relTime(a.at)}</small></li>)}</ul>
              </div>
            )}
          </div>
        )}
        {isHost && agentLayer && agentLayer.ops.length > 0 && <p className="island room__draft-legend" data-board-ui=""><span aria-hidden="true" />dashed = draft, only you can see it until you accept</p>}

        {/* Figma 07 states: reconnecting (the board keeps working locally) and room full · host view */}
        {(!online || (isHost && waitingPeers.length > 0)) && (
          <div className="room__states" data-board-ui="" aria-live="polite">
            {!online && <p className="state-banner state-banner--reconnect"><RefreshCw aria-hidden="true" />Reconnecting… the board keeps working.</p>}
            {isHost && waitingPeers.length > 0 && <p className="seat-note"><Users aria-hidden="true" />{humansIn.length} / {room.capacity} · {waitingPeers[0]!.name.split(" ")[0]}{waitingPeers.length > 1 ? ` +${waitingPeers.length - 1}` : ""} {waitingPeers.length > 1 ? "are" : "is"} waiting · <b>Let in when free</b></p>}
          </div>
        )}

        <RemoteAudio streams={call.remote} />
        <ShareOverlay call={call} peers={peers} myName={me?.name ?? ""} onSnapshot={async (blob) => {
          const ref = await adapter.files.put(blob, { name: "screen-snapshot.webp" });
          const x = Math.max(0, ...pages.map((pg) => pg.x + pg.w)) + PAGE_GAP;
          const pg: Page = { id: `p${Date.now().toString(36)}snap`, title: "Screen snapshot", order: pages.length, x, y: 0, w: 1600, h: 900, bg: ref.id };
          commit({ kind: "add", payload: { page: pg } });
        }} />
        <OpenPrompt call={call} total={peers.length} />
        {!isHost && <FollowChip call={call} hostName={room.hostName} />}
        {call.error && <p className="island call-error" role="alert" data-board-ui="">{call.error}<button type="button" className="lf-icon-btn" aria-label="Dismiss" onClick={() => call.setError(null)}><X aria-hidden="true" /></button></p>}
        <div className="room__calls" data-board-ui="" aria-live="polite">
          {isHost && <HandToasts call={call} peers={peers} />}
          <AudioPill call={call} inCallCount={peers.filter((p) => p.inCall).length} isHost={isHost} ownLink={callCfg?.ownLink ?? null} />
          <VideoPill video={video} config={callCfg?.video} />
        </div>
        <VideoPanel video={video} />
        {video.error && <p className="island call-error" role="alert" data-board-ui="">{video.error}<button type="button" className="lf-icon-btn" aria-label="Dismiss" onClick={() => video.setError(null)}><X aria-hidden="true" /></button></p>}

        {/* bottom-left: guest admit toasts */}
        {isHost && admissions.length > 0 && (
          <div className="room__toasts" data-board-ui="" aria-live="polite">
            {admissions.map((a) => (
              <div key={a.id} className="island toast">
                <Avatar name={a.name} size="sm" />
                <span className="toast__text">
                  <b>{a.name} (guest) wants {phone ? "in" : "to join"}</b>
                  <small>via link · no account</small>
                </span>
                <Button size="sm" onClick={() => adapter.mutate(`rooms/${room.id}/admissions/${a.id}`, { decision: "admit" })}>Let in</Button>
                {!phone && <Button size="sm" variant="ghost" onClick={() => adapter.mutate(`rooms/${room.id}/admissions/${a.id}`, { decision: "deny" })}>Deny</Button>}
              </div>
            ))}
          </div>
        )}

        {/* bottom-centre: pen colours, tools, pages */}
        <div className="room__dock" data-board-ui="">
          {tool === "pen" && (
            <PenOptions colour={penColour} colours={PEN_COLOURS} onColour={setPenColour} smoothing={smoothing} onSmoothing={setSmoothing} highlighter={highlighter} onHighlighter={setHighlighter} recognise={recognise} onRecognise={setRecognise} />
          )}
          {tool === "shape" && <ShapesFlyout value={shapeKind} onPick={setShapeKind} />}
          {tool === "sticky" && (
            <div className="island swatches" role="radiogroup" aria-label="Sticky colour">
              {STICKY_COLOURS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={stickyColour === c} aria-label={c} className={`swatch swatch--${c}`} onClick={() => setStickyColour(c)} />
              ))}
            </div>
          )}
          <div className="room__dock-row">
            <div className="island toolbar" role="toolbar" aria-label="Board tools">
              {(phone ? phoneTools : tools).map((t) => (
                <button key={t.id} type="button" className={`tool${tool === t.id ? " is-on" : ""}`} aria-pressed={tool === t.id} aria-label={`${t.label} (${t.key})`} title={`${t.label} (${t.key})`} onClick={() => setTool(t.id)}>
                  {t.icon}
                </button>
              ))}
              <span className="toolbar__sep" aria-hidden="true" />
              {!phone && (
                <>
                  <button type="button" className="tool" aria-label="Upload PDF, slides or images (U)" title="Upload PDF, slides or images (U)" onClick={() => fileInput.current?.click()}><Upload aria-hidden="true" /></button>
                  <button type="button" className="tool" aria-label="Undo (⌘Z)" title="Undo (⌘Z)" onClick={undo}><Undo2 aria-hidden="true" /></button>
                  <button type="button" className="tool" aria-label="Redo (⇧⌘Z)" title="Redo (⇧⌘Z)" onClick={redo}><Redo2 aria-hidden="true" /></button>
                </>
              )}
              <button type="button" className={`tool${more ? " is-on" : ""}`} aria-label="More tools" aria-expanded={more} onClick={() => setMore(!more)}>
                <ChevronDown aria-hidden="true" />
              </button>
              <input ref={fileInput} type="file" hidden multiple accept="application/pdf,image/*" onChange={(e) => { if (e.target.files) void importFiles(e.target.files); e.target.value = ""; }} />
              {more && (
                <div className="island menu menu--up" role="menu" onClick={() => setMore(false)}>
                  {phone && <button type="button" role="menuitem" onClick={() => setTool("eraser")}><Eraser aria-hidden="true" /> Eraser <kbd>E</kbd></button>}
                  {phone && <button type="button" role="menuitem" onClick={() => setTool("text")}><Type aria-hidden="true" /> Text <kbd>T</kbd></button>}
                  {phone && <button type="button" role="menuitem" onClick={() => setTool("hand")}><Hand aria-hidden="true" /> Hand</button>}
                  {phone && <button type="button" role="menuitem" onClick={undo}><Undo2 aria-hidden="true" /> Undo</button>}
                  {phone && <button type="button" role="menuitem" onClick={redo}><Redo2 aria-hidden="true" /> Redo</button>}
                  <button type="button" role="menuitem" onClick={() => setDiagramFor("new")}><Code aria-hidden="true" /> Diagram as code</button>
                  <button type="button" role="menuitem" onClick={() => setFinding(true)}><Search aria-hidden="true" /> Find on board <kbd>⌘F</kbd></button>
                  <button type="button" role="menuitem" onClick={() => fileInput.current?.click()}><Upload aria-hidden="true" /> Upload PDF, slides, images <kbd>U</kbd></button>
                  <button type="button" role="menuitem" onClick={() => void importLink()}><Link2 aria-hidden="true" /> Import a Google Slides link</button>
                  <button type="button" role="menuitem" onClick={exportCurrentPng}><Download aria-hidden="true" /> Export this page (PNG)</button>
                  <button type="button" role="menuitem" onClick={() => void exportPdf(state, sortedPages(state), room.name, fileUrl.image)}><Download aria-hidden="true" /> Export all pages (PDF)</button>
                  <button type="button" role="menuitem" onClick={() => { const u = prompt("Link everyone should open (https://…)"); if (u) call.openTogether(u.trim()); }}><Link2 aria-hidden="true" /> Open together…</button>
                  <button type="button" role="menuitem" onClick={() => boardRef.current?.zoomBy(1.25)}><ZoomIn aria-hidden="true" /> Zoom in</button>
                  <button type="button" role="menuitem" onClick={() => boardRef.current?.zoomBy(0.8)}><ZoomOut aria-hidden="true" /> Zoom out</button>
                  {phone && isHost && <button type="button" role="menuitem" className="danger" onClick={async () => confirm("End the session for everyone?") && adapter.mutate(`rooms/${room.id}/end`)}>End session</button>}
                </div>
              )}
            </div>
            {!phone && (
              <div className="island pages" data-board-ui="">
                <button type="button" className="lf-icon-btn" onClick={() => goPage(pageIndex - 1)} aria-label="Previous page" disabled={pageIndex === 0}>
                  <ChevronLeft aria-hidden="true" />
                </button>
                <button type="button" className="pages__label" onClick={() => setPageMenu(!pageMenu)} aria-expanded={pageMenu}>
                  Page {pageIndex + 1} / {pages.length} <ChevronDown aria-hidden="true" />
                </button>
                <button type="button" className="lf-icon-btn" onClick={() => goPage(pageIndex + 1)} aria-label="Next page" disabled={pageIndex >= pages.length - 1}>
                  <ChevronRight aria-hidden="true" />
                </button>
                {pageMenu && (
                  <div className="island menu menu--up" role="menu">
                    {pages.map((pg, i) => (
                      <button key={pg.id} type="button" role="menuitem" onClick={() => { goPage(i); setPageMenu(false); }}>{pg.title}</button>
                    ))}
                    <button type="button" role="menuitem" onClick={addPage}><Plus aria-hidden="true" /> Add a page</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {diagramFor && <DiagramPanel state={state} editingId={diagramFor === "new" ? null : diagramFor} commit={commit} centre={() => boardRef.current?.centre() ?? { x: 0, y: 0 }} onClose={() => setDiagramFor(null)} onAdded={(id) => { setTool("select"); setTimeout(() => boardRef.current?.focusObject(id), 60); }} />}
        {finding && <FindBar state={state} onFocus={(id) => boardRef.current?.focusObject(id)} onClose={() => setFinding(false)} />}
        {busy && <div className="island busy-toast" role="status" aria-live="polite">{busy}</div>}

        {/* bottom-right: chat */}
        <div className="room__chat">
          <RoomChat roomId={room.id} meId={me.id} compact={phone} />
        </div>
      </div>
      <span className="sr-only" aria-live="polite">{loc.pathname}</span>
    </div>
  );
}

function RoomTimer({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const mm = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return <span className="mono">{mm}:{ss}</span>;
}

function SharePopover({ room, isHost, onClose, phone, onEnd }: { room: RoomRes; isHost: boolean; onClose: () => void; phone: boolean; onEnd: () => Promise<unknown> }) {
  const adapter = useAdapter();
  const link = roomLink(room.code);
  const display = `tanziro.com/spaces/r/${room.code.toLowerCase()}`;
  const [copied, setCopied] = useState(false);
  const [guestJoin, setGuestJoin] = useState(room.guestJoin);
  useEffect(() => setGuestJoin(room.guestJoin), [room.guestJoin]);
  const text = `Join ${room.name} on loft: ${link} (code ${room.code})`;
  return (
    <div className="island share" data-board-ui="" role="dialog" aria-label="Invite to this room">
      <div className="share__head">
        <b>Invite to this room</b>
        <button type="button" className="lf-icon-btn" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="share__link">
        <span className="mono">{IS_PREVIEW ? room.code : display}</span>
        <Button
          size="sm"
          icon={<Copy aria-hidden="true" />}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              prompt("Copy this link", link);
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {isHost && (
        <label className="share__toggle">
          <span>
            <b>Guests join without approval</b>
            <small>{guestJoin ? "On: anyone with the link walks in" : "Off: you'll be asked to let each guest in"}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={guestJoin}
            onChange={(e) => {
              setGuestJoin(e.target.checked);
              void adapter.mutate(`rooms/${room.id}/settings`, { guestJoin: e.target.checked }).catch(() => setGuestJoin(room.guestJoin));
            }}
          />
          <span className="switch" aria-hidden="true" />
        </label>
      )}
      <div className="share__actions">
        <a className="lf-btn lf-btn--secondary lf-btn--sm" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><MessageCircle aria-hidden="true" /> WhatsApp</a>
        <a className="lf-btn lf-btn--secondary lf-btn--sm" href={`mailto:?subject=${encodeURIComponent(`Join ${room.name}`)}&body=${encodeURIComponent(text)}`}><Mail aria-hidden="true" /> Email</a>
        <span className="share__code mono" aria-label={`Room code ${room.code}`}>{room.code}</span>
      </div>
      {IS_PREVIEW && (
        <p className="share__preview">
          Preview: open <a href={`${import.meta.env.BASE_URL}#/join?code=${room.code}&as=guest`} target="_blank" rel="noreferrer">this room as a guest</a> in a new tab to see two people at once.
        </p>
      )}
      {phone && isHost && (
        <Button variant="dark" block size="sm" onClick={async () => confirm("End the session for everyone?") && (await onEnd())}>
          End session
        </Button>
      )}
    </div>
  );
}
