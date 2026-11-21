import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Lock } from "lucide-react";
import {
  anchorPoint,
  arrowHead,
  bounds,
  connectorsTouching,
  facingAnchor,
  fitRect,
  isAttachable,
  nearestAnchor,
  nextZ,
  normRect,
  pageAtPoint,
  quantise,
  recogniseShape,
  rectInside,
  rectsIntersect,
  routeConnector,
  screenToWorld,
  simplify,
  smartSnap,
  sortedObjects,
  sortedPages,
  strokeHit,
  strokeOutline,
  zoomAt,
  type Anchor,
  type BoardObj,
  type BoardOp,
  type BoardState,
  type ConnectorEnd,
  type ConnectorObj,
  type Guide,
  type Pt,
  type Rect,
  type ShapeKind,
  type ShapeObj,
  type StickyColour,
  type Viewport
} from "@loft/board";
import { newId } from "@loft/core";
import { toneFor } from "@loft/ui";
import type { PresencePeer } from "@loft/data";
import { expandDiagrams } from "./board/render";
import { SHAPES, shapePath } from "./board/shapes";

export type Tool = "select" | "hand" | "pen" | "eraser" | "sticky" | "text" | "shape" | "connector" | "section";

export interface BoardHandle {
  /** Follow-me: show exactly the host's view. */
  setViewport(v: Viewport): void;
  goToPage(id: string): void;
  zoomBy(f: number): void;
  fit(): void;
  focusObject(id: string): void;
  centre(): Pt;
}

export interface PenSettings {
  colour: string;
  size: number;
  smoothing: number;
  highlighter: boolean;
  recognise: boolean;
}

export interface BoardProps {
  state: BoardState;
  commit: (op: BoardOp) => void;
  tool: Tool;
  pen: PenSettings;
  stickyColour: StickyColour;
  shapeKind: ShapeKind;
  connectorRoute: ConnectorObj["route"];
  meId: string;
  peers: PresencePeer[];
  fileUrl: (fileId: string) => string | undefined;
  onCursor: (p: Pt | null) => void;
  onEditing: (id: string | null) => void;
  onSelection?: (ids: string[]) => void;
  onViewChange?: (v: Viewport, visiblePage: string | null) => void;
  onToolDone?: () => void;
  renderSelectionBar?: (ids: string[]) => ReactNode;
}

const STICKY_W = 180;
const STICKY_H = 132;
type Gesture =
  | { mode: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { mode: "draw" }
  | { mode: "erase"; hit: Set<string> }
  | { mode: "move"; ids: string[]; sx: number; sy: number; moved: boolean }
  | { mode: "resize"; id: string; sx: number; sy: number; orig: Rect }
  | { mode: "marquee"; start: Pt; additive: boolean }
  | { mode: "connect"; from: ConnectorEnd; fromPt: Pt }
  | { mode: "create"; kind: "shape" | "section"; start: Pt }
  | { mode: "pinch"; d: number; c: Pt };

type Boxed = Extract<BoardObj, { kind: "shape" | "sticky" | "section" | "text" }>;
const hasRect = (o: BoardObj): o is Boxed => o.kind === "shape" || o.kind === "sticky" || o.kind === "section" || o.kind === "text";
const shiftEnd = (e: ConnectorEnd, dx: number, dy: number): ConnectorEnd => ("x" in e ? { x: e.x + dx, y: e.y + dy } : e);

export const Board = forwardRef<BoardHandle, BoardProps>(function Board(p, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const livePath = useRef<SVGPathElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef(view);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [offset, setOffset] = useState<{ ids: Set<string>; dx: number; dy: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ id: string; rect: Rect } | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [draft, setDraft] = useState<{ a: Pt; b: Pt; target: string | null } | null>(null);
  const [createRect, setCreateRect] = useState<Rect | null>(null);
  const [hoverShape, setHoverShape] = useState<string | null>(null);
  const live = useRef<{ pts: number[]; pressure: number[] | null } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const fitted = useRef(false);

  const display = useMemo(() => expandDiagrams(p.state), [p.state]);
  const pages = sortedPages(p.state);
  const objects = sortedObjects(display);

  useLayoutEffect(() => {
    viewRef.current = view;
  });
  useEffect(() => {
    p.onSelection?.(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  useEffect(() => {
    p.onEditing(editing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);
  // Drop selections of objects someone else deleted.
  useEffect(() => {
    setSelected((s) => (s.some((id) => !p.state.objects[id]) ? s.filter((id) => p.state.objects[id]) : s));
  }, [p.state.objects]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (fitted.current || !size.w || !pages[0]) return;
    fitted.current = true;
    setView(fitRect(pages[0], size, size.w < 768 ? 16 : 64));
  }, [size, pages]);

  const visiblePage = useCallback((v: Viewport) => pageAtPoint(pages, screenToWorld(v, { x: size.w / 2, y: size.h / 2 }))?.id ?? null, [pages, size]);
  useEffect(() => {
    p.onViewChange?.(view, visiblePage(view));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useImperativeHandle(
    ref,
    () => ({
      setViewport(v) {
        setView(v);
      },
      goToPage(id) {
        const pg = p.state.pages[id];
        if (pg) setView(fitRect(pg, size, size.w < 768 ? 16 : 64));
      },
      zoomBy(f) {
        setView((v) => zoomAt(v, { x: size.w / 2, y: size.h / 2 }, f));
      },
      fit() {
        const pg = pages[0];
        if (pg) setView(fitRect(pg, size, 64));
      },
      focusObject(id) {
        const o = display.objects[id];
        if (!o) return;
        const b = bounds(o);
        setView(fitRect({ x: b.x - 160, y: b.y - 160, w: b.w + 320, h: b.h + 320 }, size, 64));
        setSelected([id]);
      },
      centre() {
        return screenToWorld(viewRef.current, { x: size.w / 2, y: size.h / 2 });
      }
    }),
    [p.state.pages, pages, size, display.objects]
  );

  const editingLocks = new Map(p.peers.filter((x) => typeof x.editing === "string").map((x) => [x.editing as string, x.name]));

  // Preview geometry while dragging/resizing; ops are committed on pointer-up.
  const previewState = useMemo<BoardState>(() => {
    if (!offset && !resizePreview) return display;
    const objs: Record<string, BoardObj> = {};
    for (const [id, o] of Object.entries(display.objects)) {
      const parent = id.includes(":") ? id.split(":")[0]! : null;
      const moving = offset && (offset.ids.has(id) || (parent !== null && offset.ids.has(parent)));
      let next: BoardObj = o;
      if (resizePreview && resizePreview.id === id && hasRect(o)) next = { ...o, ...resizePreview.rect } as BoardObj;
      else if (moving && offset) {
        if (hasRect(o) || o.kind === "diagram") next = { ...o, x: o.x + offset.dx, y: o.y + offset.dy } as BoardObj;
        else if (o.kind === "stroke") next = { ...o, points: o.points.map((v, i) => v + (i % 2 ? offset.dy : offset.dx)) };
        else if (o.kind === "connector") next = { ...o, from: shiftEnd(o.from, offset.dx, offset.dy), to: shiftEnd(o.to, offset.dx, offset.dy) };
      }
      objs[id] = next;
    }
    return { ...display, objects: objs };
  }, [display, offset, resizePreview]);
  const shown = sortedObjects(previewState);

  function removeIds(ids: string[]) {
    const set = new Set(ids);
    const extra = connectorsTouching(p.state, set).map((c) => c.id).filter((id) => !set.has(id));
    const ops: BoardOp[] = [...ids, ...extra].filter((id) => p.state.objects[id]).map((id) => ({ kind: "remove", payload: { id } }));
    if (ops.length) p.commit(ops.length === 1 ? ops[0]! : { kind: "batch", payload: { ops } });
    setSelected([]);
  }

  /** The selection plus everything fully inside a selected section (sections carry their contents). */
  function movingSet(ids: string[]): string[] {
    const out = new Set(ids);
    for (const id of ids) {
      const s = p.state.objects[id];
      if (s?.kind !== "section") continue;
      for (const o of Object.values(p.state.objects)) {
        if (o.id === id || o.kind === "connector" || o.kind === "diagram") continue;
        if (rectInside(bounds(o), s)) out.add(o.id);
      }
    }
    return [...out];
  }

  function commitMove(ids: string[], dx: number, dy: number) {
    if (!dx && !dy) return;
    const ops: BoardOp[] = [];
    for (const id of movingSet(ids)) {
      const o = p.state.objects[id];
      if (!o) continue;
      if (hasRect(o) || o.kind === "diagram") ops.push({ kind: "update", payload: { id, patch: { x: Math.round(o.x + dx), y: Math.round(o.y + dy) } } });
      else if (o.kind === "stroke") ops.push({ kind: "update", payload: { id, patch: { points: quantise(o.points.map((v, i) => v + (i % 2 ? dy : dx))) } } });
      else if (o.kind === "connector" && ("x" in o.from || "x" in o.to)) {
        const r = (e: ConnectorEnd) => ("x" in e ? { x: Math.round(e.x + dx), y: Math.round(e.y + dy) } : e);
        ops.push({ kind: "update", payload: { id, patch: { from: r(o.from), to: r(o.to) } } });
      }
    }
    if (ops.length) p.commit(ops.length === 1 ? ops[0]! : { kind: "batch", payload: { ops } });
  }

  // Keyboard: space pans, delete removes, arrows nudge, Enter edits, ⌘A selects all.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      if (e.code === "Space") {
        setSpaceDown(true);
        e.preventDefault();
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
        removeIds(selected);
      } else if (e.key === "Escape") {
        setSelected([]);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(Object.keys(p.state.objects));
      } else if (e.key === "Enter" && selected.length === 1) {
        const o = p.state.objects[selected[0]!];
        if (o && (o.kind === "shape" || o.kind === "sticky" || o.kind === "text" || o.kind === "section" || o.kind === "connector")) {
          e.preventDefault();
          setEditing(o.id);
        }
      } else if (e.key.startsWith("Arrow") && selected.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        commitMove(selected, e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
      } else if (!(e.target as HTMLElement)?.closest?.('[role="application"]')) {
        return;
      } else if (e.key === "Tab") {
        // Keyboard users step through objects in reading order; at either end focus leaves the board.
        const order = Object.values(p.state.objects)
          .filter((o) => !o.id.includes(":") && o.kind !== "stroke")
          .map((o) => ({ id: o.id, b: bounds(o) }))
          .sort((a, b) => Math.round(a.b.y / 40) - Math.round(b.b.y / 40) || a.b.x - b.b.x)
          .map((x) => x.id);
        const at = selected.length === 1 ? order.indexOf(selected[0]!) : -1;
        const next = e.shiftKey ? (at < 0 ? order.length - 1 : at - 1) : at + 1;
        if (next >= 0 && next < order.length) {
          e.preventDefault();
          const id = order[next]!;
          setSelected([id]);
          const b = bounds(p.state.objects[id]!);
          setView(fitRect({ x: b.x - 240, y: b.y - 240, w: b.w + 480, h: b.h + 480 }, size, 64));
        } else setSelected([]);
      } else if (e.key.startsWith("Arrow")) {
        // Nothing selected: arrows pan the board (Shift = faster).
        e.preventDefault();
        const d = e.shiftKey ? 240 : 60;
        setView((v) => ({ ...v, x: v.x + (e.key === "ArrowLeft" ? d : e.key === "ArrowRight" ? -d : 0), y: v.y + (e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0) }));
      } else if (e.key === "+" || e.key === "=" || e.key === "-") {
        e.preventDefault();
        setView((v) => zoomAt(v, { x: size.w / 2, y: size.h / 2 }, e.key === "-" ? 1 / 1.2 : 1.2));
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (e.ctrlKey || e.metaKey) setView((v) => zoomAt(v, at, Math.exp(-e.deltaY * 0.01)));
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const effectiveTool: Tool = spaceDown ? "hand" : p.tool;

  const eraseAt = (w: Pt, hit: Set<string>) => {
    const radius = 8 / viewRef.current.scale;
    const ops: BoardOp[] = [];
    for (const o of objects) {
      if (o.kind === "stroke" && !hit.has(o.id) && p.state.objects[o.id] && strokeHit(o, w, radius + (o.highlighter ? o.size * 1.5 : 0))) {
        hit.add(o.id);
        ops.push({ kind: "remove", payload: { id: o.id } });
      }
    }
    if (ops.length === 1) p.commit(ops[0]!);
    else if (ops.length > 1) p.commit({ kind: "batch", payload: { ops } });
  };

  const objAt = (target: EventTarget | null): BoardObj | null => {
    const el = (target as HTMLElement | null)?.closest?.("[data-obj]") as HTMLElement | null;
    const id = el?.dataset.obj;
    if (!id) return null;
    return p.state.objects[id.includes(":") ? id.split(":")[0]! : id] ?? null; // diagram parts select the diagram
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-board-ui]")) return;
    e.preventDefault();
    const s = local(e);
    pointers.current.set(e.pointerId, s);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      live.current = null;
      livePath.current?.setAttribute("d", "");
      const [a, b] = [...pointers.current.values()] as [Pt, Pt];
      gesture.current = { mode: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    const w = screenToWorld(viewRef.current, s);
    const t = e.button === 1 ? "hand" : effectiveTool;
    if (editing) setEditing(null);
    if ((e.target as HTMLElement).closest("[data-handle]") && selected.length === 1) {
      const o = p.state.objects[selected[0]!];
      if (o && hasRect(o)) {
        const h = o.kind === "text" ? bounds(o).h : o.h;
        gesture.current = { mode: "resize", id: o.id, sx: s.x, sy: s.y, orig: { x: o.x, y: o.y, w: o.w, h } };
        return;
      }
    }
    const hit = objAt(e.target);
    if (t === "hand") {
      gesture.current = { mode: "pan", sx: s.x, sy: s.y, vx: viewRef.current.x, vy: viewRef.current.y };
    } else if (t === "pen") {
      live.current = { pts: [w.x, w.y], pressure: e.pointerType === "pen" ? [e.pressure || 0.5] : null };
      gesture.current = { mode: "draw" };
    } else if (t === "eraser") {
      const set = new Set<string>();
      gesture.current = { mode: "erase", hit: set };
      eraseAt(w, set);
    } else if (t === "sticky") {
      const id = newId("st");
      p.commit({ kind: "add", payload: { obj: { id, kind: "sticky", z: nextZ(p.state), by: p.meId, x: w.x - STICKY_W / 2, y: w.y - STICKY_H / 2, w: STICKY_W, h: STICKY_H, text: "", colour: p.stickyColour } } });
      setSelected([id]);
      setEditing(id);
      p.onToolDone?.();
    } else if (t === "text") {
      const id = newId("tx");
      p.commit({ kind: "add", payload: { obj: { id, kind: "text", z: nextZ(p.state), by: p.meId, x: w.x, y: w.y - 12, w: 320, text: "", colour: "#1a1c23", size: 20 } } });
      setSelected([id]);
      setEditing(id);
      p.onToolDone?.();
    } else if (t === "shape" || t === "section") {
      gesture.current = { mode: "create", kind: t, start: w };
      setCreateRect({ x: w.x, y: w.y, w: 0, h: 0 });
    } else if (t === "connector") {
      let from: ConnectorEnd = { x: Math.round(w.x), y: Math.round(w.y) };
      let fromPt = w;
      if (hit && isAttachable(hit)) {
        const a = nearestAnchor(hit, w);
        from = { id: hit.id, anchor: a };
        fromPt = anchorPoint(hit, a);
      }
      gesture.current = { mode: "connect", from, fromPt };
      setDraft({ a: fromPt, b: w, target: null });
    } else if (hit) {
      let next = selected;
      if (e.shiftKey) next = selected.includes(hit.id) ? selected.filter((x) => x !== hit.id) : [...selected, hit.id];
      else if (!selected.includes(hit.id)) next = [hit.id];
      setSelected(next);
      if (next.includes(hit.id)) gesture.current = { mode: "move", ids: next, sx: s.x, sy: s.y, moved: false };
    } else {
      gesture.current = { mode: "marquee", start: w, additive: e.shiftKey };
      setMarquee({ x: w.x, y: w.y, w: 0, h: 0 });
    }
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = local(e);
    const w = screenToWorld(viewRef.current, s);
    p.onCursor(w);
    if (p.tool === "connector") {
      const h = objAt(e.target);
      setHoverShape(h && isAttachable(h) ? h.id : null);
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, s);
    const g = gesture.current;
    if (!g) return;
    const scale = viewRef.current.scale;
    if (g.mode === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()] as [Pt, Pt];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      setView((v) => {
        const z = zoomAt(v, c, d / (g.d || d));
        return { ...z, x: z.x + (c.x - g.c.x), y: z.y + (c.y - g.c.y) };
      });
      gesture.current = { mode: "pinch", d, c };
    } else if (g.mode === "pan") {
      setView((v) => ({ ...v, x: g.vx + (s.x - g.sx), y: g.vy + (s.y - g.sy) }));
    } else if (g.mode === "draw") {
      const L = live.current;
      if (!L) return;
      const lx = L.pts[L.pts.length - 2]!, ly = L.pts[L.pts.length - 1]!;
      if (Math.hypot(w.x - lx, w.y - ly) * scale >= 1.5) {
        L.pts.push(w.x, w.y);
        if (L.pressure) L.pressure.push(e.pressure || 0.5);
        livePath.current?.setAttribute("d", strokeOutline({ points: L.pts, size: p.pen.highlighter ? p.pen.size * 4 : p.pen.size, smoothing: p.pen.smoothing, ...(L.pressure ? { pressure: L.pressure } : {}) }));
      }
    } else if (g.mode === "erase") {
      eraseAt(w, g.hit);
    } else if (g.mode === "move") {
      let dx = (s.x - g.sx) / scale, dy = (s.y - g.sy) / scale;
      if (!g.moved && Math.hypot(dx, dy) * scale < 3) return;
      g.moved = true;
      const ids = new Set(movingSet(g.ids));
      if (g.ids.length === 1) {
        const o = p.state.objects[g.ids[0]!];
        if (o && hasRect(o) && o.kind !== "text") {
          const r = bounds(o);
          const others = Object.values(p.state.objects).filter((x) => !ids.has(x.id) && hasRect(x) && x.kind !== "section").map(bounds);
          const snap = smartSnap({ ...r, x: r.x + dx, y: r.y + dy }, others, 6 / scale);
          dx += snap.dx;
          dy += snap.dy;
          setGuides(snap.guides);
        }
      }
      setOffset({ ids, dx, dy });
    } else if (g.mode === "resize") {
      const dx = (s.x - g.sx) / scale, dy = (s.y - g.sy) / scale;
      setResizePreview({ id: g.id, rect: { x: g.orig.x, y: g.orig.y, w: Math.max(40, g.orig.w + dx), h: Math.max(32, g.orig.h + dy) } });
    } else if (g.mode === "marquee") {
      setMarquee(normRect(g.start, w));
    } else if (g.mode === "create") {
      setCreateRect(normRect(g.start, w));
    } else if (g.mode === "connect") {
      const h = objAt(e.target);
      const target = h && isAttachable(h) && !("id" in g.from && g.from.id === h.id) ? h : null;
      setDraft({ a: g.fromPt, b: target ? anchorPoint(target, facingAnchor(target, g.fromPt)) : w, target: target?.id ?? null });
    }
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (!g) return;
    const w = screenToWorld(viewRef.current, local(e));
    if (g.mode === "draw") {
      const L = live.current;
      live.current = null;
      livePath.current?.setAttribute("d", "");
      if (!L || L.pts.length < 2) return;
      const pts = quantise(simplify(L.pts, 0.3 / viewRef.current.scale));
      const id = newId("sk");
      const stroke = { id, kind: "stroke" as const, z: nextZ(p.state), by: p.meId, points: pts, colour: p.pen.colour, size: p.pen.size, smoothing: p.pen.smoothing, ...(p.pen.highlighter ? { highlighter: true } : {}), ...(L.pressure ? { pressure: L.pressure.map((v) => Math.round(v * 100) / 100) } : {}) };
      p.commit({ kind: "add", payload: { obj: stroke } });
      // A closed rough box / circle / diamond becomes a clean shape; one undo brings the stroke back.
      if (p.pen.recognise && !p.pen.highlighter) {
        const r = recogniseShape(pts);
        if (r) {
          const shape: ShapeObj = { id: newId("sh"), kind: "shape", shape: r.kind, z: stroke.z, by: p.meId, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), text: "", fill: r.kind === "decision" ? "peach" : "card" };
          p.commit({ kind: "batch", payload: { ops: [{ kind: "remove", payload: { id } }, { kind: "add", payload: { obj: shape } }] } });
        }
      }
    } else if (g.mode === "move") {
      const o = offset;
      setOffset(null);
      setGuides([]);
      if (g.moved && o) commitMove(g.ids, o.dx, o.dy);
    } else if (g.mode === "resize") {
      const rp = resizePreview;
      setResizePreview(null);
      if (rp) p.commit({ kind: "update", payload: { id: g.id, patch: { w: Math.round(rp.rect.w), h: Math.round(rp.rect.h) } } });
    } else if (g.mode === "marquee") {
      const r = normRect(g.start, w);
      setMarquee(null);
      if (r.w < 3 && r.h < 3) {
        if (!g.additive) setSelected([]);
        return;
      }
      const ids = Object.values(p.state.objects)
        .filter((o) => {
          if (o.kind === "connector") {
            const rt = routeConnector(p.state, o);
            return !!rt && rt.pts.every((q) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h);
          }
          if (o.kind === "diagram") return false;
          return o.kind === "section" ? rectInside(bounds(o), r) : rectsIntersect(bounds(o), r);
        })
        .map((o) => o.id);
      setSelected(g.additive ? [...new Set([...selected, ...ids])] : ids);
    } else if (g.mode === "create") {
      const r = normRect(g.start, w);
      setCreateRect(null);
      if (g.kind === "shape") {
        const def = SHAPES.find((x) => x.kind === p.shapeKind) ?? SHAPES[0]!;
        const tall = def.kind === "decision";
        const sized = r.w > 20 && r.h > 20 ? r : { x: g.start.x - 80, y: g.start.y - (tall ? 50 : 36), w: 160, h: tall ? 100 : 72 };
        const id = newId("sh");
        p.commit({ kind: "add", payload: { obj: { id, kind: "shape", shape: def.kind, z: nextZ(p.state), by: p.meId, x: Math.round(sized.x), y: Math.round(sized.y), w: Math.round(sized.w), h: Math.round(sized.h), text: "", fill: def.fill } } });
        setSelected([id]);
        setEditing(id);
      } else {
        const sized = r.w > 60 && r.h > 40 ? r : { x: g.start.x, y: g.start.y, w: 480, h: 320 };
        const n = Object.values(p.state.objects).filter((o) => o.kind === "section").length + 1;
        const id = newId("se");
        p.commit({ kind: "add", payload: { obj: { id, kind: "section", z: 0, by: p.meId, x: Math.round(sized.x), y: Math.round(sized.y), w: Math.round(sized.w), h: Math.round(sized.h), title: `Section ${n}` } } });
        setSelected([id]);
      }
      p.onToolDone?.();
    } else if (g.mode === "connect") {
      const d = draft;
      setDraft(null);
      if (!d) return;
      const target = d.target ? p.state.objects[d.target] : null;
      let to: ConnectorEnd;
      if (target && isAttachable(target)) to = { id: target.id, anchor: facingAnchor(target, g.fromPt) };
      else if (Math.hypot(w.x - g.fromPt.x, w.y - g.fromPt.y) < 12) return;
      else to = { x: Math.round(w.x), y: Math.round(w.y) };
      const id = newId("cn");
      p.commit({ kind: "add", payload: { obj: { id, kind: "connector", z: nextZ(p.state), by: p.meId, from: g.from, to, route: p.connectorRoute, startCap: "none", endCap: "arrow", weight: 1.5, dash: false, colour: "#434656", label: "" } } });
      setSelected([id]);
      p.onToolDone?.();
    }
  };

  /** Quick-create arrows: the same shape 80 px away, already connected. */
  const quickCreate = (o: ShapeObj, dir: Anchor) => {
    const gap = 80;
    const pos = { n: { x: o.x, y: o.y - o.h - gap }, s: { x: o.x, y: o.y + o.h + gap }, e: { x: o.x + o.w + gap, y: o.y }, w: { x: o.x - o.w - gap, y: o.y } }[dir];
    const opposite: Record<Anchor, Anchor> = { n: "s", s: "n", e: "w", w: "e" };
    const id = newId("sh");
    const z = nextZ(p.state);
    p.commit({
      kind: "batch",
      payload: {
        ops: [
          { kind: "add", payload: { obj: { ...o, id, z, text: "", by: p.meId, ...pos } } },
          { kind: "add", payload: { obj: { id: newId("cn"), kind: "connector", z: z + 1, by: p.meId, from: { id: o.id, anchor: dir }, to: { id, anchor: opposite[dir] }, route: p.connectorRoute, startCap: "none", endCap: "arrow", weight: 1.5, dash: false, colour: "#434656", label: "" } } }
        ]
      }
    });
    setSelected([id]);
    setEditing(id);
  };

  const cursorClass = { select: "", hand: "is-hand", pen: "is-pen", eraser: "is-eraser", sticky: "is-place", text: "is-text", shape: "is-place", connector: "is-pen", section: "is-place" }[effectiveTool];
  const dot = (view.scale < 0.5 ? 48 : 24) * view.scale;

  const selObjs = selected.map((id) => previewState.objects[id]).filter(Boolean) as BoardObj[];
  const rectOf = (o: BoardObj): Rect | null => {
    if (o.kind === "connector") {
      const r = routeConnector(previewState, o);
      if (!r) return null;
      const xs = r.pts.map((q) => q.x), ys = r.pts.map((q) => q.y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    if (o.kind === "diagram") {
      const parts = Object.values(previewState.objects).filter((x) => x.id.startsWith(`${o.id}:`) && x.kind !== "connector").map(bounds);
      if (!parts.length) return { x: o.x, y: o.y, w: 120, h: 60 };
      const x0 = Math.min(...parts.map((b) => b.x)), y0 = Math.min(...parts.map((b) => b.y));
      return { x: x0, y: y0, w: Math.max(...parts.map((b) => b.x + b.w)) - x0, h: Math.max(...parts.map((b) => b.y + b.h)) - y0 };
    }
    return bounds(o);
  };
  const selRects = selObjs.map(rectOf).filter(Boolean) as Rect[];
  const selBox = selRects.length
    ? (() => {
        const x = Math.min(...selRects.map((r) => r.x)), y = Math.min(...selRects.map((r) => r.y));
        return { x, y, w: Math.max(...selRects.map((r) => r.x + r.w)) - x, h: Math.max(...selRects.map((r) => r.y + r.h)) - y };
      })()
    : null;
  const single = selObjs.length === 1 ? selObjs[0]! : null;
  const canResize = single && (single.kind === "shape" || single.kind === "sticky" || single.kind === "section");
  const showQuick = single?.kind === "shape" && !editing && !offset && p.tool === "select";
  const isSel = (id: string) => selected.includes(id) || (id.includes(":") && selected.includes(id.split(":")[0]!));

  return (
    <div
      ref={wrapRef}
      className={`board ${cursorClass}`}
      style={{ backgroundSize: `${dot}px ${dot}px`, backgroundPosition: `${view.x}px ${view.y}px`, backgroundImage: view.scale < 0.15 ? "none" : undefined }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => p.onCursor(null)}
      role="application"
      aria-label="Shared board. Pick a tool from the toolbar. Space and drag pans, ctrl and scroll zooms, arrow keys nudge the selection, Enter edits it."
      tabIndex={0}
    >
      <div className="board__world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        {pages.map((pg) => {
          const bg = pg.bg ? p.fileUrl(pg.bg) : undefined;
          return (
            <div key={pg.id} className="board__page" style={{ left: pg.x, top: pg.y, width: pg.w, height: pg.h }}>
              <span className="board__page-label">{pg.title}</span>
              {bg && <img src={bg} alt="" draggable={false} />}
            </div>
          );
        })}
        {shown.map((o) =>
          o.kind !== "section" ? null : (
            <div key={o.id} data-obj={o.id} className={`bsection${isSel(o.id) ? " is-selected" : ""}${o.draft ? " is-draft-section" : ""}`} style={{ left: o.x, top: o.y, width: o.w, height: o.h }}>
              {editing === o.id ? (
                <input
                  className="bsection__title bsection__title--edit"
                  data-board-ui=""
                  defaultValue={o.title}
                  autoFocus
                  aria-label="Section name"
                  onBlur={(e) => {
                    setEditing(null);
                    const v = e.target.value.trim().slice(0, 60);
                    if (v && v !== o.title) p.commit({ kind: "update", payload: { id: o.id, patch: { title: v } } });
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
                  }}
                />
              ) : (
                <span className="bsection__title" onDoubleClick={() => setEditing(o.id)}>{o.title}{o.draft && o.by?.startsWith("agent:") && <small className="bsection__draft"> · draft by {o.by.slice(6)}</small>}</span>
              )}
            </div>
          )
        )}

        <svg className="board__svg" aria-hidden="true">
          {shown.map((o) => (o.kind === "stroke" && o.highlighter ? <path key={o.id} data-obj={o.id} d={strokeOutline({ ...o, size: o.size * 4 })} fill={o.colour} opacity={0.4} className={isSel(o.id) ? "is-sel-stroke" : ""} /> : null))}
          {shown.map((o) =>
            o.kind === "shape" ? (
              <g key={o.id} transform={`translate(${o.x},${o.y})`} className={`bshape fill-${o.fill}${o.draft ? " is-draft" : ""}${isSel(o.id) ? " is-selected" : ""}`}>
                <path d={shapePath(o.shape, o.w, o.h)} />
              </g>
            ) : null
          )}
          {shown.map((o) => {
            if (o.kind !== "connector") return null;
            const r = routeConnector(previewState, o);
            if (!r) return null;
            return (
              <g key={o.id} className={`bconn${isSel(o.id) ? " is-selected" : ""}${o.draft ? " is-draft" : ""}`} style={{ color: o.colour }}>
                <path d={r.d} fill="none" stroke="currentColor" strokeWidth={o.weight} strokeDasharray={o.dash ? "6 5" : undefined} />
                {o.endCap === "arrow" && <polygon points={arrowHead(r.end, r.endDir, 9)} fill="currentColor" />}
                {o.endCap === "dot" && <circle cx={r.end.x} cy={r.end.y} r={3.5} fill="currentColor" />}
                {o.startCap === "arrow" && <polygon points={arrowHead(r.start, { x: -r.startDir.x, y: -r.startDir.y }, 9)} fill="currentColor" />}
                {o.startCap === "dot" && <circle cx={r.start.x} cy={r.start.y} r={3.5} fill="currentColor" />}
                <path d={r.d} data-obj={o.id} fill="none" stroke="transparent" strokeWidth={Math.max(14, 14 / view.scale)} className="bconn__hit" />
              </g>
            );
          })}
          {draft && <line x1={draft.a.x} y1={draft.a.y} x2={draft.b.x} y2={draft.b.y} className="bconn-draft" />}
        </svg>

        {shown.map((o) => {
          if (o.kind === "shape") {
            const isEditing = editing === o.id;
            return (
              <div key={o.id} data-obj={o.id} className="bshape-label" style={{ left: o.x, top: o.y, width: o.w, height: o.h, zIndex: o.z }} onDoubleClick={() => !o.id.includes(":") && setEditing(o.id)} data-board-ui={isEditing ? "" : undefined}>
                {isEditing ? <EditText value={o.text} placeholder="Label" onChange={(text) => p.commit({ kind: "update", payload: { id: o.id, patch: { text } } })} onDone={() => setEditing(null)} /> : <span>{o.text}</span>}
              </div>
            );
          }
          if (o.kind === "connector" && (o.label || editing === o.id)) {
            const r = routeConnector(previewState, o);
            if (!r) return null;
            return (
              <div key={o.id} data-obj={o.id} className="bconn-label" style={{ left: r.label.x, top: r.label.y }} data-board-ui={editing === o.id ? "" : undefined} onDoubleClick={() => !o.id.includes(":") && setEditing(o.id)}>
                {editing === o.id ? (
                  <input
                    autoFocus
                    defaultValue={o.label}
                    aria-label="Connector label"
                    onBlur={(e) => {
                      setEditing(null);
                      if (e.target.value !== o.label) p.commit({ kind: "update", payload: { id: o.id, patch: { label: e.target.value.slice(0, 80) } } });
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  o.label
                )}
              </div>
            );
          }
          if (o.kind !== "sticky" && o.kind !== "text") return null;
          const lockedBy = editingLocks.get(o.id);
          const isEditing = editing === o.id && !lockedBy;
          return (
            <div
              key={o.id}
              data-obj={o.id}
              data-board-ui={isEditing ? "" : undefined}
              className={`${o.kind === "sticky" ? `sticky sticky--${o.colour}` : "btext"}${isSel(o.id) ? " is-selected" : ""}${o.draft ? " is-draft" : ""}`}
              style={o.kind === "sticky" ? { left: o.x, top: o.y, width: o.w, height: o.h, zIndex: o.z } : { left: o.x, top: o.y, width: o.w, fontSize: o.size, color: o.colour, zIndex: o.z }}
              onDoubleClick={() => !lockedBy && setEditing(o.id)}
            >
              {isEditing ? (
                <EditText
                  value={o.text}
                  placeholder={o.kind === "sticky" ? "Type a note" : "Type something"}
                  onChange={(text) => p.commit({ kind: "update", payload: { id: o.id, patch: { text } } })}
                  onDone={(text) => {
                    setEditing(null);
                    if (!text.trim()) p.commit({ kind: "remove", payload: { id: o.id } });
                  }}
                />
              ) : (
                <span className="obj-text">{o.text || (o.kind === "sticky" ? "" : " ")}</span>
              )}
              {lockedBy && (
                <span className="obj-lock" title={`${lockedBy} is typing`}>
                  <Lock aria-hidden="true" /> {lockedBy.split(" ")[0]}
                </span>
              )}
            </div>
          );
        })}

        {Object.values(p.state.objects).map((o) => {
          if (o.kind !== "diagram") return null;
          const r = rectOf(previewState.objects[o.id] ?? o);
          if (!r) return null;
          return (
            <div key={o.id} className={`bdiagram${isSel(o.id) ? " is-selected" : ""}`} style={{ left: r.x - 16, top: r.y - 36, width: r.w + 32, height: r.h + 52 }}>
              <span className="bdiagram__chip" data-obj={o.id}>diagram · code</span>
            </div>
          );
        })}

        <svg className="board__svg board__svg--ink" aria-hidden="true">
          {shown.map((o) => (o.kind === "stroke" && !o.highlighter ? <path key={o.id} data-obj={o.id} d={strokeOutline(o)} fill={o.colour} opacity={o.draft ? 0.55 : 1} className={isSel(o.id) ? "is-sel-stroke" : ""} /> : null))}
          <path ref={livePath} fill={p.pen.colour} opacity={p.pen.highlighter ? 0.4 : 1} />
          {guides.map((g, i) => (g.axis === "x" ? <line key={i} className="guide" x1={g.at} x2={g.at} y1={-1e5} y2={1e5} /> : <line key={i} className="guide" y1={g.at} y2={g.at} x1={-1e5} x2={1e5} />))}
          {marquee && <rect className="marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} />}
          {createRect && createRect.w > 2 && <rect className="marquee" x={createRect.x} y={createRect.y} width={createRect.w} height={createRect.h} />}
          {selBox && selObjs.length > 1 && <rect className="sel-box" x={selBox.x - 6} y={selBox.y - 6} width={selBox.w + 12} height={selBox.h + 12} />}
          {p.tool === "connector" &&
            (draft?.target ?? hoverShape) &&
            (() => {
              const o = p.state.objects[(draft?.target ?? hoverShape)!];
              if (!o || !isAttachable(o)) return null;
              return (["n", "e", "s", "w"] as Anchor[]).map((a) => {
                const q = anchorPoint(o, a);
                return <circle key={a} className="anchor-dot" cx={q.x} cy={q.y} r={5 / view.scale} />;
              });
            })()}
        </svg>

        {canResize && selBox && !editing && <span data-handle="se" className="resize-handle" style={{ left: selBox.x + selBox.w, top: selBox.y + selBox.h, transform: `translate(-50%, -50%) scale(${1 / view.scale})` }} aria-hidden="true" />}
        {showQuick &&
          single?.kind === "shape" &&
          (["n", "e", "s", "w"] as Anchor[]).map((a) => {
            const q = anchorPoint(single, a);
            const off = 28 / view.scale;
            const pos = { n: { x: q.x, y: q.y - off }, s: { x: q.x, y: q.y + off }, e: { x: q.x + off, y: q.y }, w: { x: q.x - off, y: q.y } }[a];
            const Icon = { n: ArrowUp, s: ArrowDown, e: ArrowRight, w: ArrowLeft }[a];
            return (
              <button key={a} type="button" data-board-ui="" className="quick-arrow" style={{ left: pos.x, top: pos.y, transform: `translate(-50%, -50%) scale(${1 / view.scale})` }} aria-label={`Add a connected shape ${{ n: "above", s: "below", e: "to the right", w: "to the left" }[a]}`} onClick={() => quickCreate(single, a)}>
                <Icon aria-hidden="true" />
              </button>
            );
          })}
      </div>

      {selBox && !offset && !editing && p.renderSelectionBar && size.w > 0 && (
        <div className="sel-bar-wrap" data-board-ui="" style={{ left: Math.min(Math.max(8, selBox.x * view.scale + view.x), Math.max(8, size.w - 640)), top: Math.max(84, selBox.y * view.scale + view.y - 60) }}>
          {p.renderSelectionBar(selected)}
        </div>
      )}

      {p.peers.map((peer) => (peer.cursor && size.w ? <Cursor key={peer.tabId} name={peer.name} at={{ x: peer.cursor.x * view.scale + view.x, y: peer.cursor.y * view.scale + view.y }} agent={Boolean(peer.isAgent)} /> : null))}
    </div>
  );
});

function Cursor({ name, at, agent }: { name: string; at: Pt; agent: boolean }) {
  const tone = toneFor(name);
  return (
    <div className={`cursor cursor--${agent ? "agent" : tone}`} style={{ transform: `translate(${at.x}px, ${at.y}px)` }} aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 14 14">
        <path d="M1 1l11 4.5-4.6 1.4L5.8 12z" />
      </svg>
      <span>{name.split(" ")[0]}</span>
    </div>
  );
}

function EditText({ value, placeholder, onChange, onDone }: { value: string; placeholder: string; onChange: (v: string) => void; onDone: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const flush = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (v !== value) onChange(v);
  };
  return (
    <textarea
      ref={ref}
      className="obj-edit"
      value={text}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onChange(v), 250);
      }}
      onBlur={() => {
        flush(text);
        onDone(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) (e.target as HTMLTextAreaElement).blur();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
