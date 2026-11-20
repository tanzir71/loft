import { openDB, type IDBPDatabase } from "idb";
import type { Op } from "../types";

export type Row = { id: string; [k: string]: unknown };
type Stored = Row & { _key: string; _table: string };

export interface LocalDb {
  list<T extends Row>(table: string, filter?: (row: T) => boolean): Promise<T[]>;
  get<T extends Row>(table: string, id: string): Promise<T | undefined>;
  put<T extends Row>(table: string, row: T): Promise<T>;
  patch<T extends Row>(table: string, id: string, patch: Partial<T>): Promise<T>;
  del(table: string, id: string): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  appendOps(roomId: string, ops: Omit<Op, "seq" | "roomId">[]): Promise<Op[]>;
  opsSince(roomId: string, since: number): Promise<Op[]>;
  putBlob(id: string, blob: Blob, meta: Record<string, unknown>): Promise<void>;
  getBlob(id: string): Promise<{ id: string; blob: Blob; [k: string]: unknown } | undefined>;
  findBlobBySha(sha: string): Promise<{ id: string; [k: string]: unknown } | undefined>;
  clear(): Promise<void>;
  close(): void;
}

const strip = <T extends Row>(s: Stored): T => {
  const { _key: _k, _table: _t, ...rest } = s;
  return rest as unknown as T;
};

export async function openLocalDb(name: string): Promise<LocalDb> {
  const db: IDBPDatabase = await openDB(name, 1, {
    upgrade(d) {
      const rows = d.createObjectStore("rows", { keyPath: "_key" });
      rows.createIndex("table", "_table");
      d.createObjectStore("ops", { keyPath: ["roomId", "seq"] });
      const blobs = d.createObjectStore("blobs", { keyPath: "id" });
      blobs.createIndex("sha256", "sha256");
      d.createObjectStore("meta", { keyPath: "key" });
    }
  });

  const api: LocalDb = {
    async list<T extends Row>(table: string, filter?: (row: T) => boolean) {
      const all = (await db.getAllFromIndex("rows", "table", table)) as Stored[];
      const rows = all.map((s) => strip<T>(s));
      return filter ? rows.filter(filter) : rows;
    },
    async get<T extends Row>(table: string, id: string) {
      const s = (await db.get("rows", `${table}/${id}`)) as Stored | undefined;
      return s ? strip<T>(s) : undefined;
    },
    async put<T extends Row>(table: string, row: T) {
      await db.put("rows", { ...row, _key: `${table}/${row.id}`, _table: table });
      return row;
    },
    async patch<T extends Row>(table: string, id: string, patch: Partial<T>) {
      const tx = db.transaction("rows", "readwrite");
      const cur = (await tx.store.get(`${table}/${id}`)) as Stored | undefined;
      if (!cur) throw new Error(`${table}/${id} not found`);
      const next = { ...cur, ...patch, id, _key: cur._key, _table: table } as Stored;
      await tx.store.put(next);
      await tx.done;
      return strip<T>(next);
    },
    async del(table: string, id: string) {
      await db.delete("rows", `${table}/${id}`);
    },
    async getMeta<T>(key: string) {
      const m = (await db.get("meta", key)) as { key: string; value: T } | undefined;
      return m?.value;
    },
    async setMeta(key: string, value: unknown) {
      await db.put("meta", { key, value });
    },
    async appendOps(roomId, ops) {
      // One readwrite transaction serialises seq assignment across tabs.
      const tx = db.transaction("ops", "readwrite");
      const range = IDBKeyRange.bound([roomId, -Infinity], [roomId, Infinity]);
      const last = await tx.store.openCursor(range, "prev");
      let seq = last ? (last.value as Op).seq : 0;
      const out: Op[] = [];
      for (const o of ops) {
        seq += 1;
        const op = { ...o, roomId, seq } as Op;
        await tx.store.put(op);
        out.push(op);
      }
      await tx.done;
      return out;
    },
    async opsSince(roomId, since) {
      const range = IDBKeyRange.bound([roomId, since + 1], [roomId, Infinity]);
      return (await db.getAll("ops", range)) as Op[];
    },
    async putBlob(id, blob, meta) {
      await db.put("blobs", { ...meta, id, blob });
    },
    async getBlob(id) {
      return (await db.get("blobs", id)) as { id: string; blob: Blob } | undefined;
    },
    async findBlobBySha(sha) {
      return (await db.getFromIndex("blobs", "sha256", sha)) as { id: string } | undefined;
    },
    async clear() {
      for (const s of ["rows", "ops", "blobs", "meta"] as const) await db.clear(s);
    },
    close() {
      db.close();
    }
  };
  return api;
}
