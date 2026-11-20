import type { BoardObj, BoardOp, BoardState, Page } from "./types";

export const PAGE_W = 1200;
export const PAGE_H = 750;
export const PAGE_GAP = 80;

export function pageAt(order: number, id = `p${order + 1}`, title = `Page ${order + 1}`): Page {
  return { id, title, order, x: order * (PAGE_W + PAGE_GAP), y: 0, w: PAGE_W, h: PAGE_H, bg: null };
}

export function emptyBoard(): BoardState {
  const p = pageAt(0);
  return { pages: { [p.id]: p }, objects: {}, seq: 0 };
}

/**
 * Apply one op. Ops arrive in seq order from the op-log, so applying them in order gives
 * last-writer-wins per field. Unknown targets are ignored (an object removed by someone else).
 */
export function applyOp(state: BoardState, op: BoardOp): BoardState {
  switch (op.kind) {
    case "add": {
      if ("obj" in op.payload) {
        const o = op.payload.obj;
        return { ...state, objects: { ...state.objects, [o.id]: o } };
      }
      const p = op.payload.page;
      return { ...state, pages: { ...state.pages, [p.id]: p } };
    }
    case "update": {
      const { id, patch, target = "obj" } = op.payload;
      if (target === "page") {
        const cur = state.pages[id];
        if (!cur) return state;
        return { ...state, pages: { ...state.pages, [id]: { ...cur, ...patch, id } as Page } };
      }
      const cur = state.objects[id];
      if (!cur) return state;
      return { ...state, objects: { ...state.objects, [id]: { ...cur, ...patch, id, kind: cur.kind } as BoardObj } };
    }
    case "remove": {
      const { id, target = "obj" } = op.payload;
      if (target === "page") {
        if (!state.pages[id] || Object.keys(state.pages).length <= 1) return state;
        const { [id]: _gone, ...pages } = state.pages;
        return { ...state, pages };
      }
      if (!state.objects[id]) return state;
      const { [id]: _gone, ...objects } = state.objects;
      return { ...state, objects };
    }
    case "batch":
      return op.payload.ops.reduce(applyOp, state);
    default:
      return state;
  }
}

export function applyOps(state: BoardState, ops: { seq: number; kind: string; payload: unknown }[]): BoardState {
  let s = state;
  for (const o of ops) {
    if (o.seq <= s.seq) continue;
    s = { ...applyOp(s, { kind: o.kind, payload: o.payload } as BoardOp), seq: o.seq };
  }
  return s;
}

export function sortedObjects(state: BoardState): BoardObj[] {
  return Object.values(state.objects).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
}

export function sortedPages(state: BoardState): Page[] {
  return Object.values(state.pages).sort((a, b) => a.order - b.order);
}

export function nextZ(state: BoardState): number {
  let z = 0;
  for (const o of Object.values(state.objects)) if (o.z > z) z = o.z;
  return z + 1;
}

/** The op that undoes `op`, computed against the state *before* `op` was applied. */
export function inverseOf(before: BoardState, op: BoardOp): BoardOp | null {
  switch (op.kind) {
    case "add":
      return "obj" in op.payload
        ? { kind: "remove", payload: { id: op.payload.obj.id } }
        : { kind: "remove", payload: { id: op.payload.page.id, target: "page" } };
    case "remove": {
      const { id, target = "obj" } = op.payload;
      if (target === "page") {
        const p = before.pages[id];
        return p ? { kind: "add", payload: { page: p } } : null;
      }
      const o = before.objects[id];
      return o ? { kind: "add", payload: { obj: o } } : null;
    }
    case "update": {
      const { id, patch, target = "obj" } = op.payload;
      const cur = (target === "page" ? before.pages[id] : before.objects[id]) as unknown as Record<string, unknown> | undefined;
      if (!cur) return null;
      const old: Record<string, unknown> = {};
      for (const k of Object.keys(patch)) old[k] = cur[k];
      return { kind: "update", payload: { id, target, patch: old } };
    }
    case "batch": {
      const inv: BoardOp[] = [];
      let s = before;
      for (const o of op.payload.ops) {
        const i = inverseOf(s, o);
        if (i) inv.unshift(i);
        s = applyOp(s, o);
      }
      return { kind: "batch", payload: { ops: inv } };
    }
  }
}
