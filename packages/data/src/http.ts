import type { User } from "@loft/core";
import type { DataAdapter, FileRef, NewOp, Op, PresenceHandle, PresencePeer, PresenceState, SignalMsg, Unsubscribe } from "./types";
import { ForbiddenError, NotFoundError } from "./types";

export interface HttpAdapterOptions {
  base?: string;
  fetch?: typeof fetch;
  pollMs?: number;
}

/** Talks to the PHP 8 + SQLite API at /spaces/api/v1 (production). Live features poll (no WebSockets). */
export class HttpAdapter implements DataAdapter {
  readonly kind = "http" as const;
  private base: string;
  private f: typeof fetch;
  private pollMs: number;
  private listeners = new Set<(tables: string[]) => void>();

  constructor(opts: HttpAdapterOptions = {}) {
    this.base = (opts.base ?? "/spaces/api/v1").replace(/\/+$/, "");
    this.f = opts.fetch ?? fetch.bind(globalThis);
    this.pollMs = opts.pollMs ?? 1500;
  }

  private async req<T>(method: "GET" | "POST", resource: string, body?: unknown, params?: Record<string, unknown>): Promise<T> {
    const qs = params && Object.keys(params).length ? "?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : "";
    const res = await this.f(`${this.base}/${resource.replace(/^\/+/, "")}${qs}`, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (res.status === 404) throw new NotFoundError(`${method} ${resource}`);
    if (res.status === 401 || res.status === 403) throw new ForbiddenError(`${method} ${resource}`);
    if (!res.ok) throw new Error(`${method} ${resource} failed: ${res.status}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  auth = {
    me: async (): Promise<User | null> => {
      try {
        return await this.req<User>("GET", "me");
      } catch (e) {
        if (e instanceof ForbiddenError || e instanceof NotFoundError) return null;
        throw e;
      }
    },
    requestLink: async (email: string): Promise<void> => {
      await this.req("POST", "auth/link", { email });
    },
    signOut: async (): Promise<void> => {
      await this.req("POST", "auth/signout", {});
    }
  };

  query<T>(resource: string, params?: Record<string, unknown>): Promise<T> {
    return this.req<T>("GET", resource, undefined, params);
  }

  async mutate<T>(resource: string, body: Record<string, unknown> = {}): Promise<T> {
    const out = await this.req<T>("POST", resource, body);
    const table = resource.split("/")[0] ?? resource;
    for (const l of this.listeners) l([table]);
    return out;
  }

  subscribe(listener: (tables: string[]) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  append(roomId: string, ops: NewOp[]): Promise<Op[]> {
    return this.req<Op[]>("POST", `rooms/${encodeURIComponent(roomId)}/ops`, { ops });
  }

  async *sync(roomId: string, since: number, signal?: AbortSignal): AsyncIterable<Op[]> {
    let cursor = since;
    while (!signal?.aborted) {
      const ops = await this.req<Op[]>("GET", `rooms/${encodeURIComponent(roomId)}/ops`, undefined, { since: cursor });
      if (ops.length) {
        cursor = ops[ops.length - 1]!.seq;
        yield ops;
      } else {
        await new Promise((r) => setTimeout(r, this.pollMs));
      }
    }
  }

  presence(roomId: string, me: PresenceState, onPeers?: (peers: PresencePeer[]) => void): PresenceHandle {
    let state = { ...me };
    let stopped = false;
    const beat = async () => {
      if (stopped) return;
      try {
        const peers = await this.req<PresencePeer[]>("POST", `rooms/${encodeURIComponent(roomId)}/presence`, { state });
        onPeers?.(peers.filter((p) => p.userId !== state.userId));
      } catch {
        /* offline: the next beat retries */
      }
    };
    void beat();
    const timer = setInterval(beat, 5000);
    return {
      update: (patch) => {
        state = { ...state, ...patch };
      },
      stop: () => {
        stopped = true;
        clearInterval(timer);
        void this.req("POST", `rooms/${encodeURIComponent(roomId)}/presence/leave`, {}).catch(() => {});
      }
    };
  }

  signal(roomId: string, msg: SignalMsg): void {
    void this.req("POST", "signal", { roomId, msg }).catch(() => {});
  }

  onSignal(roomId: string, handler: (msg: SignalMsg) => void): Unsubscribe {
    let since = 0;
    let stopped = false;
    const loop = async () => {
      while (!stopped) {
        try {
          const res = await this.req<{ seq: number; msgs: SignalMsg[] }>("GET", "signal", undefined, { roomId, since });
          since = res.seq;
          res.msgs.forEach(handler);
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    void loop();
    return () => {
      stopped = true;
    };
  }

  files = {
    put: async (file: Blob, meta: { name: string; spaceId?: string | null }): Promise<FileRef> => {
      const form = new FormData();
      form.append("file", file, meta.name);
      if (meta.spaceId) form.append("spaceId", meta.spaceId);
      const res = await this.f(`${this.base}/files`, { method: "POST", body: form, credentials: "same-origin" });
      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
      return (await res.json()) as FileRef;
    },
    url: (ref: FileRef | string): string => `${this.base}/files/${encodeURIComponent(typeof ref === "string" ? ref : ref.id)}`
  };
}
