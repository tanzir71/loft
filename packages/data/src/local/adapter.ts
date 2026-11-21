import type { User } from "@loft/core";
import { newId, PRESENCE_HEARTBEAT_MS, PRESENCE_TTL_MS } from "@loft/core";
import type { DataAdapter, FileRef, NewOp, Op, PresenceHandle, PresencePeer, PresenceState, SignalMsg, Unsubscribe } from "../types";
import { NotFoundError } from "../types";
import { Bus } from "./bus";
import { openLocalDb, type LocalDb } from "./db";
import { routes, type LocalCtx } from "./routes";
import "./routes-spaces";
import "./routes-schedule";
import "./routes-plans";
import "./routes-money";
import "./routes-insights";
import "./routes-checks";
import "./routes-agents";
import "./routes-owner";
import "./routes-admin";
import { seed, SEED_VERSION } from "./seed";

export interface LocalAdapterOptions {
  dbName?: string;
  channel?: string;
  now?: () => Date;
  /** Per-tab identity store (sessionStorage in browsers) so two tabs can be two users. */
  tabStore?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  autoSeed?: boolean;
}

const IDENTITY_KEY = "loft.identity";

async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class LocalAdapter implements DataAdapter {
  readonly kind = "local" as const;
  readonly tabId = newId("tab");
  private dbp: Promise<LocalDb>;
  private bus: Bus;
  private now: () => Date;
  private tabStore: LocalAdapterOptions["tabStore"];
  private objectUrls = new Map<string, string>();

  constructor(opts: LocalAdapterOptions = {}) {
    const dbName = opts.dbName ?? "loft-preview";
    this.now = opts.now ?? (() => new Date());
    this.bus = new Bus(opts.channel ?? dbName);
    this.tabStore = opts.tabStore === undefined ? (typeof sessionStorage !== "undefined" ? sessionStorage : null) : opts.tabStore;
    this.dbp = openLocalDb(dbName).then(async (db) => {
      if (opts.autoSeed !== false && (await db.getMeta<number>("seedVersion")) !== SEED_VERSION) {
        // Preview data is disposable: an older seed is wiped and replaced.
        await db.clear();
        await seed(db, this.now());
      }
      return db;
    });
  }

  /** Wipe this browser's preview data and re-seed (the demo workspace, or an empty one for the first-run state). */
  async reset(opts: { empty?: boolean } = {}): Promise<void> {
    const db = await this.dbp;
    await db.clear();
    await seed(db, this.now(), opts);
    this.tabStore?.removeItem(IDENTITY_KEY);
    this.bus.post({ type: "changed", tables: ["*"] });
  }

  /** Act as another user in this tab only (e.g. a guest joining in a second tab). */
  setTabIdentity(userId: string | null): void {
    if (userId) this.tabStore?.setItem(IDENTITY_KEY, userId);
    else this.tabStore?.removeItem(IDENTITY_KEY);
    this.bus.post({ type: "changed", tables: ["me"] }, { self: true });
  }

  private async ctx(): Promise<LocalCtx> {
    const db = await this.dbp;
    const override = this.tabStore?.getItem(IDENTITY_KEY) ?? null;
    const meId = override ?? (await db.getMeta<string>("currentUserId")) ?? null;
    return {
      db,
      meId,
      now: this.now,
      changed: (...tables) => this.bus.post({ type: "changed", tables }),
      opsChanged: (roomId) => this.bus.post({ type: "ops", roomId })
    };
  }

  auth = {
    me: async (): Promise<User | null> => (await this.query<User | null>("me")) ?? null,
    requestLink: async (_email: string): Promise<void> => {
      // Preview builds never send email. Sign-in is simulated: the demo host is always signed in.
    },
    signOut: async (): Promise<void> => {
      this.setTabIdentity(null);
    }
  };

  async query<T>(resource: string, params: Record<string, unknown> = {}): Promise<T> {
    const m = routes.match("GET", resource);
    if (!m) throw new NotFoundError(`GET ${resource}`);
    return (await m.handler(await this.ctx(), m.params, params)) as T;
  }

  async mutate<T>(resource: string, body: Record<string, unknown> = {}): Promise<T> {
    const m = routes.match("POST", resource);
    if (!m) throw new NotFoundError(`POST ${resource}`);
    return (await m.handler(await this.ctx(), m.params, body)) as T;
  }

  subscribe(listener: (tables: string[]) => void): Unsubscribe {
    return this.bus.on((msg) => {
      if (msg.type === "changed") listener(msg.tables);
    });
  }

  async append(roomId: string, ops: NewOp[]): Promise<Op[]> {
    const db = await this.dbp;
    const ts = this.now().getTime();
    const saved = await db.appendOps(roomId, ops.map((o) => ({ ...o, ts: o.ts ?? ts })));
    this.bus.post({ type: "ops", roomId });
    return saved;
  }

  async *sync(roomId: string, since: number, signal?: AbortSignal): AsyncIterable<Op[]> {
    const db = await this.dbp;
    let cursor = since;
    let wake: (() => void) | null = null;
    let dirty = true;
    const off = this.bus.on((msg) => {
      if (msg.type === "ops" && msg.roomId === roomId) {
        dirty = true;
        wake?.();
      }
    });
    const onAbort = () => wake?.();
    signal?.addEventListener("abort", onAbort);
    try {
      while (!signal?.aborted) {
        if (dirty) {
          dirty = false;
          const ops = await db.opsSince(roomId, cursor);
          if (ops.length) {
            cursor = ops[ops.length - 1]!.seq;
            yield ops;
            continue;
          }
        }
        await new Promise<void>((r) => {
          wake = r;
          if (dirty || signal?.aborted) r();
        });
        wake = null;
      }
    } finally {
      off();
      signal?.removeEventListener("abort", onAbort);
    }
  }

  presence(roomId: string, me: PresenceState, onPeers?: (peers: PresencePeer[]) => void): PresenceHandle {
    const peers = new Map<string, PresencePeer>();
    let state: PresenceState = { ...me };
    const emit = () => {
      const cutoff = Date.now() - PRESENCE_TTL_MS;
      for (const [k, p] of peers) if (p.lastSeen < cutoff) peers.delete(k);
      onPeers?.([...peers.values()].sort((a, b) => a.name.localeCompare(b.name)));
    };
    const beat = () => this.bus.post({ type: "presence", roomId, peer: { ...state, tabId: this.tabId } }, { self: false });
    const off = this.bus.on((msg, fromSelf) => {
      if (fromSelf) return;
      if (msg.type === "presence" && msg.roomId === roomId) {
        peers.set(msg.peer.tabId, { ...(msg.peer as unknown as PresencePeer), lastSeen: Date.now() });
        emit();
      } else if (msg.type === "presence-leave" && msg.roomId === roomId) {
        peers.delete(msg.tabId);
        emit();
      } else if (msg.type === "presence-hello" && msg.roomId === roomId && msg.tabId !== this.tabId) {
        beat();
      }
    });
    beat();
    this.bus.post({ type: "presence-hello", roomId, tabId: this.tabId }, { self: false });
    const timer = setInterval(() => {
      beat();
      emit();
    }, PRESENCE_HEARTBEAT_MS);
    let throttle: ReturnType<typeof setTimeout> | null = null;
    return {
      update: (patch) => {
        state = { ...state, ...patch };
        if (!throttle) {
          throttle = setTimeout(() => {
            throttle = null;
            beat();
          }, 40);
        }
      },
      stop: () => {
        clearInterval(timer);
        if (throttle) clearTimeout(throttle);
        off();
        this.bus.post({ type: "presence-leave", roomId, tabId: this.tabId }, { self: false });
      }
    };
  }

  signal(roomId: string, msg: SignalMsg): void {
    this.bus.post({ type: "signal", roomId, msg }, { self: false });
  }

  onSignal(roomId: string, handler: (msg: SignalMsg) => void): Unsubscribe {
    return this.bus.on((m, fromSelf) => {
      if (!fromSelf && m.type === "signal" && m.roomId === roomId) handler(m.msg);
    });
  }

  files = {
    put: async (file: Blob, meta: { name: string; spaceId?: string | null }): Promise<FileRef> => {
      const db = await this.dbp;
      const sha256 = await sha256Hex(file);
      const existing = await db.findBlobBySha(sha256);
      const id = existing?.id ?? newId("f");
      const ref: FileRef = { id, name: meta.name, mime: file.type || "application/octet-stream", bytes: file.size, sha256 };
      if (!existing) await db.putBlob(id, file, { ...ref, spaceId: meta.spaceId ?? null });
      if (typeof URL !== "undefined" && "createObjectURL" in URL) this.objectUrls.set(id, URL.createObjectURL(file));
      return ref;
    },
    url: (ref: FileRef | string): string => {
      const id = typeof ref === "string" ? ref : ref.id;
      return this.objectUrls.get(id) ?? "";
    },
    /** Local only: load a stored blob (and cache its object URL). */
    load: async (id: string): Promise<string> => {
      const cached = this.objectUrls.get(id);
      if (cached) return cached;
      const db = await this.dbp;
      const rec = await db.getBlob(id);
      if (!rec) return "";
      const url = URL.createObjectURL(rec.blob);
      this.objectUrls.set(id, url);
      return url;
    }
  };

  close(): void {
    this.bus.close();
    void this.dbp.then((d) => d.close());
  }
}
