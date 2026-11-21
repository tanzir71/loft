import type { User } from "@loft/core";

export type Unsubscribe = () => void;

/** One board/room operation in the op-log (handoff §7.2). */
export interface Op {
  seq: number;
  roomId: string;
  actor: string;
  ts: number;
  kind: "add" | "update" | "remove" | "batch";
  payload: unknown;
}
export type NewOp = Omit<Op, "seq" | "ts" | "roomId"> & { ts?: number };

export interface PresenceState {
  userId: string;
  name: string;
  role?: string;
  cursor?: { x: number; y: number } | null;
  status?: string;
  isAgent?: boolean;
  [k: string]: unknown;
}
export interface PresencePeer extends PresenceState {
  lastSeen: number;
  tabId: string;
}
export interface PresenceHandle {
  update(patch: Partial<PresenceState>): void;
  stop(): void;
}

export interface SignalMsg {
  from: string;
  to?: string;
  type: string;
  data?: unknown;
}

export interface FileRef {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  sha256: string;
}

/** The single data interface the SPA talks to (handoff §7.1). */
export interface DataAdapter {
  readonly kind: "local" | "http";
  /** One id per browser tab (presence rows and signalling are addressed per tab). */
  readonly tabId: string;
  auth: {
    me(): Promise<User | null>;
    requestLink(email: string): Promise<void>;
    signOut(): Promise<void>;
  };
  query<T>(resource: string, params?: Record<string, unknown>): Promise<T>;
  mutate<T>(resource: string, body?: Record<string, unknown>): Promise<T>;
  /** Re-run reads when data a resource depends on changes (this tab or another). */
  subscribe(listener: (tables: string[]) => void): Unsubscribe;
  append(roomId: string, ops: NewOp[]): Promise<Op[]>;
  sync(roomId: string, since: number, signal?: AbortSignal): AsyncIterable<Op[]>;
  presence(roomId: string, me: PresenceState, onPeers?: (peers: PresencePeer[]) => void): PresenceHandle;
  signal(roomId: string, msg: SignalMsg): void;
  onSignal(roomId: string, handler: (msg: SignalMsg) => void): Unsubscribe;
  files: {
    put(file: Blob, meta: { name: string; spaceId?: string | null }): Promise<FileRef>;
    url(ref: FileRef | string): string;
  };
}

export class NotFoundError extends Error {
  status = 404;
}
export class ForbiddenError extends Error {
  status = 403;
}
