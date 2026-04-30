import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Whiteboard,
  type Stroke,
  type TextItem,
  type Tool,
} from "@/components/whiteboard/Whiteboard";
import { Toolbar } from "@/components/whiteboard/Toolbar";
import { ChatOverlay, type ChatMessage } from "@/components/whiteboard/ChatOverlay";
import { TopBar } from "@/components/whiteboard/TopBar";
import { toast } from "@/hooks/use-toast";

type CanvasState = {
  strokes: Stroke[];
  items: TextItem[];
};

type PresenceUser = {
  id: string;
  name: string;
  avatarColor: string;
  lastSeen: number;
};

type RoomFileV1 = {
  v: 1;
  room: string;
  updatedAt: number;
  updatedBy: string;
  canvas: CanvasState;
  chat: ChatMessage[];
  users?: PresenceUser[];
  user?: PresenceUser;
};

const makeRoomId = () => {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
};

const makeId = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

const ADJECTIVES = [
  "lazy",
  "humble",
  "brave",
  "curious",
  "gentle",
  "swift",
  "calm",
  "mighty",
  "witty",
  "bright",
  "quiet",
  "happy",
  "kind",
  "clever",
  "bold",
  "silly",
  "sunny",
  "cosmic",
  "crispy",
  "glossy",
];

const ANIMALS = [
  "panda",
  "penguin",
  "tiger",
  "otter",
  "fox",
  "koala",
  "lemur",
  "dolphin",
  "owl",
  "whale",
  "lion",
  "rabbit",
  "alpaca",
  "squid",
  "falcon",
  "badger",
  "yak",
  "gecko",
  "zebra",
  "seal",
];

const USER_COLORS = ["#6d5cff", "#1fc7a8", "#ff6b6b", "#3aa0ff", "#ffb020", "#22c55e"];

const makeName = () => {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const b = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${a}${b}`;
};

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
};

const isJsonResponse = (res: Response) => {
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json");
};

const Index = () => {
  const [roomId] = useState(() => {
    const url = new URL(window.location.href);
    const fromParam = url.searchParams.get("room")?.trim();
    const ok = !!fromParam && /^[a-zA-Z0-9_-]{1,64}$/.test(fromParam);
    const id = ok ? fromParam! : makeRoomId();
    url.searchParams.set("room", id);
    window.history.replaceState(null, "", url.toString());
    return id;
  });

  const clientId = useRef<string>("");
  if (!clientId.current) {
    const key = `whiteboard-client:${roomId}`;
    const existing = localStorage.getItem(key);
    if (existing && /^[a-zA-Z0-9_-]{8,128}$/.test(existing)) clientId.current = existing;
    else {
      const created = makeId();
      localStorage.setItem(key, created);
      clientId.current = created;
    }
  }

  const [self, setSelf] = useState<Pick<PresenceUser, "id" | "name" | "avatarColor">>(() => {
    const key = `whiteboard-profile:${roomId}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<PresenceUser>;
        if (
          parsed &&
          typeof parsed.name === "string" &&
          parsed.name.trim().length > 0 &&
          typeof parsed.avatarColor === "string" &&
          parsed.avatarColor.trim().length > 0
        ) {
          return {
            id: clientId.current,
            name: parsed.name.trim(),
            avatarColor: parsed.avatarColor,
          };
        }
      } catch {
        // ignore
      }
    }
    const created = {
      id: clientId.current,
      name: makeName(),
      avatarColor: USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
    };
    localStorage.setItem(key, JSON.stringify(created));
    return created;
  });

  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState("#1a1d2e");
  const [size, setSize] = useState(4);
  const [clearSignal, setClearSignal] = useState(0);
  const [exportSignal, setExportSignal] = useState(0);
  const [dictationEnabled, setDictationEnabled] = useState(true);
  const [isDictating, setIsDictating] = useState(false);

  const [canvasState, setCanvasState] = useState<CanvasState>({ strokes: [], items: [] });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [users, setUsers] = useState<PresenceUser[]>([]);

  const canvasRef = useRef(canvasState);
  const messagesRef = useRef(messages);
  useEffect(() => {
    canvasRef.current = canvasState;
  }, [canvasState]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const applyingRemoteRef = useRef(false);
  const lastSeenUpdatedAtRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const backendModeRef = useRef<"unknown" | "php" | "local">("unknown");
  const toastGateRef = useRef<Record<string, number>>({});

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const el = document.activeElement as HTMLElement | null;
        el?.blur?.();
        setTool("move");
        e.preventDefault();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.key === "p" || e.key === "P") setTool("pen");
      if (e.key === "e" || e.key === "E") setTool("eraser");
      if (e.key === "t" || e.key === "T") setTool("text");
      if (e.key === "s" || e.key === "S") setTool("sticky");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const now = () =>
    new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const sendChatText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setMessages((m) => [
        ...m,
        {
          id: makeId(),
          author: self.name,
          avatarColor: self.avatarColor,
          text: trimmed,
          time: now(),
          mine: true,
        },
      ]);
    },
    [self.avatarColor, self.name],
  );

  const saveUrl = useMemo(() => {
    const url = new URL("./save.php", window.location.href);
    url.searchParams.set("room", roomId);
    return url.toString();
  }, [roomId]);

  const storageKey = useMemo(() => `whiteboard-room:${roomId}`, [roomId]);
  const presenceKey = useMemo(() => `whiteboard-presence:${roomId}`, [roomId]);

  const gatedToast = useCallback(
    (key: string, title: string, description?: string) => {
      const nowMs = Date.now();
      const last = toastGateRef.current[key] || 0;
      if (nowMs - last < 5000) return;
      toastGateRef.current[key] = nowMs;
      toast({ title, description });
    },
    [],
  );

  const upsertLocalPresence = useCallback(
    (me: PresenceUser) => {
      const nowMs = Date.now();
      const ttlMs = 30000;
      let map: Record<string, PresenceUser> = {};
      const raw = localStorage.getItem(presenceKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Record<string, PresenceUser>;
          if (parsed && typeof parsed === "object") map = parsed;
        } catch {
          map = {};
        }
      }
      map[me.id] = me;
      for (const [id, u] of Object.entries(map)) {
        if (!u || typeof u.lastSeen !== "number") {
          delete map[id];
          continue;
        }
        if (nowMs - u.lastSeen > ttlMs) delete map[id];
      }
      try {
        localStorage.setItem(presenceKey, JSON.stringify(map));
      } catch {
        // ignore
      }
      setUsers(Object.values(map));
    },
    [presenceKey],
  );

  const sendPresence = useCallback(
    async (override?: Partial<Pick<PresenceUser, "name" | "avatarColor">>) => {
      const nowMs = Date.now();
      const me: PresenceUser = {
        id: clientId.current,
        name: (override?.name ?? self.name).trim(),
        avatarColor: override?.avatarColor ?? self.avatarColor,
        lastSeen: nowMs,
      };
      if (backendModeRef.current === "local") {
        upsertLocalPresence(me);
        return;
      }
      try {
        const res = await fetch(`${saveUrl}&mode=presence&t=${nowMs}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: me, updatedBy: clientId.current }),
          cache: "no-store",
        });
        if (!res.ok || !isJsonResponse(res)) throw new Error("backend");
        const data = (await res.json()) as { saved?: RoomFileV1 };
        backendModeRef.current = "php";
        const list = data?.saved?.users;
        if (Array.isArray(list)) setUsers(list);
      } catch {
        backendModeRef.current = "local";
        upsertLocalPresence(me);
      }
    },
    [saveUrl, self.avatarColor, self.name, upsertLocalPresence],
  );

  const applyRemote = useCallback((remote: RoomFileV1) => {
    applyingRemoteRef.current = true;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    lastSeenUpdatedAtRef.current = remote.updatedAt || 0;
    setCanvasState(remote.canvas ?? { strokes: [], items: [] });
    setMessages(remote.chat ?? []);
    setUsers(remote.users ?? []);
    window.setTimeout(() => {
      applyingRemoteRef.current = false;
    }, 0);
  }, []);

  useEffect(() => {
    sendPresence();
    const id = window.setInterval(() => sendPresence(), 5000);
    return () => window.clearInterval(id);
  }, [sendPresence]);

  const loadFromLocal = useCallback(() => {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as RoomFileV1;
      if (!parsed || parsed.v !== 1) return null;
      if (parsed.room !== roomId) return null;
      return parsed;
    } catch {
      return null;
    }
  }, [roomId, storageKey]);

  const saveToLocal = useCallback(
    (payload: RoomFileV1) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(payload));
      } catch {
        return;
      }
    },
    [storageKey],
  );

  const saveNow = useCallback(async () => {
    const nowMs = Date.now();
    const me: PresenceUser = {
      id: clientId.current,
      name: self.name,
      avatarColor: self.avatarColor,
      lastSeen: nowMs,
    };
    const payload: RoomFileV1 = {
      v: 1,
      room: roomId,
      updatedAt: nowMs,
      updatedBy: clientId.current,
      canvas: canvasRef.current,
      chat: messagesRef.current,
      user: me,
      users: backendModeRef.current === "local" ? users : undefined,
    };
    lastSeenUpdatedAtRef.current = payload.updatedAt;
    try {
      const res = await fetch(saveUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      if (!res.ok || !isJsonResponse(res)) throw new Error("backend");
      backendModeRef.current = "php";
    } catch {
      backendModeRef.current = "local";
      saveToLocal(payload);
    }
  }, [roomId, saveToLocal, saveUrl, self.avatarColor, self.name, users]);

  useEffect(() => {
    if (applyingRemoteRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveNow();
    }, 350);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [canvasState, messages, saveNow]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`${saveUrl}&t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        if (!isJsonResponse(res)) throw new Error("backend");
        const data = (await res.json()) as RoomFileV1;
        if (!data || data.v !== 1) return;
        backendModeRef.current = "php";
        if ((data.updatedAt || 0) > lastSeenUpdatedAtRef.current) applyRemote(data);
      } catch {
        backendModeRef.current = "local";
        const local = loadFromLocal();
        if (local && (local.updatedAt || 0) > lastSeenUpdatedAtRef.current) applyRemote(local);
      }
    };
    load();
  }, [applyRemote, loadFromLocal, saveUrl]);

  useEffect(() => {
    const poll = async () => {
      try {
        if (backendModeRef.current === "local") return;
        const res = await fetch(`${saveUrl}&t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) return;
        if (!isJsonResponse(res)) throw new Error("backend");
        const data = (await res.json()) as RoomFileV1;
        if (!data || data.v !== 1) return;
        backendModeRef.current = "php";
        if (data.updatedBy === clientId.current) return;
        if ((data.updatedAt || 0) <= lastSeenUpdatedAtRef.current) return;
        applyRemote(data);
      } catch {
        if (backendModeRef.current !== "php") backendModeRef.current = "local";
      }
    };

    const id = window.setInterval(poll, 1200);
    return () => window.clearInterval(id);
  }, [applyRemote, saveUrl]);

  useEffect(() => {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition: any = SpeechRecognitionCtor ? new SpeechRecognitionCtor() : null;
    if (recognition) {
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
    }

    const dictatingRef = { current: false };
    const commitOnEndRef = { current: false };
    const transcriptRef = { current: "" };

    if (recognition) {
      recognition.onresult = (event: any) => {
        let appended = "";
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const t = (res?.[0]?.transcript ?? "").toString();
          if (res.isFinal) appended += t;
          else interim = t;
        }
        transcriptRef.current = `${transcriptRef.current} ${appended} ${interim}`.trim();
      };

      recognition.onend = () => {
        dictatingRef.current = false;
        setIsDictating(false);
        if (!commitOnEndRef.current) return;
        commitOnEndRef.current = false;
        const text = transcriptRef.current.trim();
        transcriptRef.current = "";
        if (text) sendChatText(text);
      };
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!dictationEnabled) return;
      if (e.code !== "Space") return;
      if (isTypingTarget(e.target)) return;
      if (dictatingRef.current) return;
      e.preventDefault();
      if (!recognition) {
        gatedToast("dictation-unsupported", "Dictation unavailable", "Use Chrome/Edge (SpeechRecognition) to dictate.");
        return;
      }
      if (!window.isSecureContext && window.location.hostname !== "localhost") {
        gatedToast(
          "dictation-insecure",
          "Dictation requires HTTPS",
          "Open on localhost during dev, or use HTTPS in production.",
        );
        return;
      }
      transcriptRef.current = "";
      commitOnEndRef.current = false;
      dictatingRef.current = true;
      setIsDictating(true);
      try {
        recognition.start();
      } catch {
        dictatingRef.current = false;
        setIsDictating(false);
        gatedToast("dictation-start-failed", "Couldn't start dictation", "Allow microphone access and try again.");
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!dictationEnabled) return;
      if (e.code !== "Space") return;
      if (isTypingTarget(e.target)) return;
      if (!dictatingRef.current) return;
      e.preventDefault();
      if (!recognition) return;
      commitOnEndRef.current = true;
      setIsDictating(false);
      try {
        recognition.stop();
      } catch {
        commitOnEndRef.current = false;
        dictatingRef.current = false;
        setIsDictating(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      try {
        recognition?.stop();
      } catch {
        return;
      }
    };
  }, [dictationEnabled, gatedToast, sendChatText]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (backendModeRef.current !== "local") return;
      if (e.key !== storageKey) return;
      if (!e.newValue) return;
      try {
        const data = JSON.parse(e.newValue) as RoomFileV1;
        if (!data || data.v !== 1) return;
        if (data.room !== roomId) return;
        if ((data.updatedAt || 0) <= lastSeenUpdatedAtRef.current) return;
        applyRemote(data);
      } catch {
        return;
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [applyRemote, roomId, storageKey]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (backendModeRef.current !== "local") return;
      if (e.key !== presenceKey) return;
      if (!e.newValue) return;
      try {
        const map = JSON.parse(e.newValue) as Record<string, PresenceUser>;
        if (!map || typeof map !== "object") return;
        setUsers(Object.values(map));
      } catch {
        return;
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [presenceKey]);

  const renameSelf = useCallback(
    (name: string) => {
      const nextName = name.trim().replace(/\s+/g, "").slice(0, 32);
      if (!nextName) return;
      setSelf((prev) => {
        const next = { ...prev, name: nextName };
        localStorage.setItem(`whiteboard-profile:${roomId}`, JSON.stringify(next));
        return next;
      });
      sendPresence({ name: nextName });
    },
    [roomId, sendPresence],
  );

  const usersForBar = useMemo(() => {
    const nowMs = Date.now();
    const ttlMs = 30000;
    const map = new Map<string, PresenceUser>();
    for (const u of users) {
      if (!u || typeof u.lastSeen !== "number") continue;
      if (nowMs - u.lastSeen > ttlMs) continue;
      map.set(u.id, u);
    }
    map.set(self.id, { ...self, lastSeen: nowMs });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [self, users]);

  const setStrokes = useCallback((updater: (prev: Stroke[]) => Stroke[]) => {
    setCanvasState((prev) => ({ ...prev, strokes: updater(prev.strokes) }));
  }, []);

  const setItems = useCallback((updater: (prev: TextItem[]) => TextItem[]) => {
    setCanvasState((prev) => ({ ...prev, items: updater(prev.items) }));
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden canvas-bg">
      {/* Dot grid layer */}
      <div className="pointer-events-none absolute inset-0 dot-grid opacity-70" />

      {/* SEO H1 (visually hidden but present) */}
      <h1 className="sr-only">
        WhiteboardChat — collaborative whiteboard with live chat overlay
      </h1>

      {/* Drawing surface — full bleed */}
      <Whiteboard
        tool={tool}
        color={color}
        size={size}
        clearSignal={clearSignal}
        exportSignal={exportSignal}
        strokes={canvasState.strokes}
        setStrokes={setStrokes}
        items={canvasState.items}
        setItems={setItems}
      />

      {/* Floating chrome */}
      <TopBar roomId={roomId} users={usersForBar} selfId={self.id} onRenameSelf={renameSelf} />
      <Toolbar
        tool={tool}
        setTool={setTool}
        color={color}
        setColor={setColor}
        size={size}
        setSize={setSize}
        onClear={() => setClearSignal((n) => n + 1)}
        onExport={() => setExportSignal((n) => n + 1)}
      />
      <ChatOverlay
        messages={messages}
        userCount={usersForBar.length}
        onSendText={sendChatText}
        onClearChat={() => setMessages([])}
        dictationEnabled={dictationEnabled}
        setDictationEnabled={setDictationEnabled}
        isDictating={isDictating}
      />
    </main>
  );
};

export default Index;
