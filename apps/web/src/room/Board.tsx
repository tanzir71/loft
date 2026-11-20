import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Lock, X } from "lucide-react";
import {
  bounds,
  fitRect,
  nextZ,
  pageAtPoint,
  quantise,
  rectContains,
  screenToWorld,
  simplify,
  sortedObjects,
  sortedPages,
  strokeHit,
  tracePath,
  zoomAt,
  type BoardOp,
  type BoardState,
  type Pt,
  type StickyColour,
  type StickyObj,
  type TextObj,
  type Viewport
} from "@loft/board";
import { newId } from "@loft/core";
import { toneFor } from "@loft/ui";
import type { PresencePeer } from "@loft/data";

export type Tool = "select" | "hand" | "pen" | "eraser" | "sticky" | "text";

export interface BoardHandle {
  goToPage(id: string): void;
  zoomBy(f: number): void;
  fit(): void;
}

export interface BoardProps {
  state: BoardState;
  commit: (op: BoardOp) => void;
  tool: Tool;
  penColour: string;
  penSize: number;
  stickyColour: StickyColour;
  meId: string;
  peers: PresencePeer[];
  onCursor: (p: Pt | null) => void;
  onEditing: (id: string | null) => void;
  onViewChange?: (v: Viewport, visiblePage: string | null) => void;
  onToolDone?: () => void;
}

const STICKY_W = 180;
const STICKY_H = 132;

export const Board = forwardRef<BoardHandle, BoardProps>(function Board(p, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef(view);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const live = useRef<number[] | null>(null);
  const gesture = useRef<
    | { mode: "pan"; sx: number; sy: number; vx: number; vy: number }
    | { mode: "draw" }
    | { mode: "erase"; hit: Set<string> }
    | { mode: "drag"; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
    | { mode: "pinch"; d: number; c: Pt }
    | null
  >(null);
  const pointers = useRef(new Map<number, Pt>());
  const fitted = useRef(false);
  const pages = sortedPages(p.state);
  const objects = sortedObjects(p.state);

  useLayoutEffect(() => {
    viewRef.current = view;
  });

  // Size + DPR-aware canvas.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the first page once we know our size.
  useEffect(() => {
    if (fitted.current || !size.w || !pages[0]) return;
    fitted.current = true;
    setView(fitRect(pages[0], size, size.w < 768 ? 16 : 64));
  }, [size, pages]);

  const editingLocks = new Map(p.peers.filter((x) => typeof x.editing === "string").map((x) => [x.editing as string, x.name]));

  // Draw ink.
  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(size.w * dpr) || c.height !== Math.round(size.h * dpr)) {
      c.width = Math.round(size.w * dpr);
      c.height = Math.round(size.h * dpr);
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const v = viewRef.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, dpr * v.x, dpr * v.y);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const o of objects) {
      if (o.kind !== "stroke") continue;
      ctx.beginPath();
      ctx.strokeStyle = o.colour;
      ctx.lineWidth = o.size;
      ctx.globalAlpha = o.draft ? 0.55 : 1;
      tracePath(ctx, o.points);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (live.current && live.current.length >= 2) {
      ctx.beginPath();
      ctx.strokeStyle = p.penColour;
      ctx.lineWidth = p.penSize;
      tracePath(ctx, live.current);
      ctx.stroke();
    }
  }, [objects, size, p.penColour, p.penSize]);

  useEffect(() => {
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [draw, view]);

  const visiblePage = useCallback(
    (v: Viewport) => {
      const centre = screenToWorld(v, { x: size.w / 2, y: size.h / 2 });
      return pageAtPoint(pages, centre)?.id ?? null;
    },
    [pages, size]
  );
  useEffect(() => {
    p.onViewChange?.(view, visiblePage(view));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useImperativeHandle(
    ref,
    () => ({
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
      }
    }),
    [p.state.pages, pages, size]
  );

  // Keyboard: space = temporary hand, delete selected, escape.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
      if (typing) return;
      if (e.code === "Space") {
        setSpaceDown(true);
        e.preventDefault();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        p.commit({ kind: "remove", payload: { id: selected } });
        setSelected(null);
      }
      if (e.key === "Escape") setSelected(null);
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [selected, p]);

  // Wheel: ctrl/⌘ (and trackpad pinch) zooms at the pointer, otherwise pans.
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
      if (o.kind === "stroke" && !hit.has(o.id) && strokeHit(o, w, radius)) {
        hit.add(o.id);
        ops.push({ kind: "remove", payload: { id: o.id } });
      }
    }
    if (ops.length === 1) p.commit(ops[0]!);
    else if (ops.length > 1) p.commit({ kind: "batch", payload: { ops } });
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-board-ui]")) return;
    // No compat mouse events: they would move focus away from a note we are about to edit.
    e.preventDefault();
    const s = local(e);
    pointers.current.set(e.pointerId, s);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      // Two fingers: pinch-zoom and pan, cancel whatever one finger started.
      live.current = null;
      const [a, b] = [...pointers.current.values()] as [Pt, Pt];
      gesture.current = { mode: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y), c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    const w = screenToWorld(viewRef.current, s);
    const t = e.button === 1 ? "hand" : effectiveTool;
    if (editing) setEditing(null);
    if (t === "hand") {
      gesture.current = { mode: "pan", sx: s.x, sy: s.y, vx: viewRef.current.x, vy: viewRef.current.y };
    } else if (t === "pen") {
      live.current = [w.x, w.y];
      gesture.current = { mode: "draw" };
    } else if (t === "eraser") {
      const hit = new Set<string>();
      gesture.current = { mode: "erase", hit };
      eraseAt(w, hit);
    } else if (t === "sticky") {
      const id = newId("st");
      const obj: StickyObj = { id, kind: "sticky", z: nextZ(p.state), by: p.meId, x: w.x - STICKY_W / 2, y: w.y - STICKY_H / 2, w: STICKY_W, h: STICKY_H, text: "", colour: p.stickyColour };
      p.commit({ kind: "add", payload: { obj } });
      setSelected(id);
      setEditing(id);
      p.onToolDone?.();
    } else if (t === "text") {
      const id = newId("tx");
      const obj: TextObj = { id, kind: "text", z: nextZ(p.state), by: p.meId, x: w.x, y: w.y - 12, w: 320, text: "", colour: "#1a1c23", size: 20 };
      p.commit({ kind: "add", payload: { obj } });
      setSelected(id);
      setEditing(id);
      p.onToolDone?.();
    } else {
      setSelected(null);
      gesture.current = { mode: "pan", sx: s.x, sy: s.y, vx: viewRef.current.x, vy: viewRef.current.y };
    }
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = local(e);
    const w = screenToWorld(viewRef.current, s);
    p.onCursor(w);
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, s);
    const g = gesture.current;
    if (!g) return;
    if (g.mode === "pinch" && pointers.current.size >= 2) {
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
    } else if (g.mode === "draw" && live.current) {
      const pts = live.current;
      const lx = pts[pts.length - 2]!, ly = pts[pts.length - 1]!;
      if (Math.hypot(w.x - lx, w.y - ly) * viewRef.current.scale >= 1.5) {
        pts.push(w.x, w.y);
        requestAnimationFrame(draw);
      }
    } else if (g.mode === "erase") {
      eraseAt(w, g.hit);
    } else if (g.mode === "drag") {
      const dx = (s.x - g.sx) / viewRef.current.scale;
      const dy = (s.y - g.sy) / viewRef.current.scale;
      if (!g.moved && Math.hypot(dx, dy) < 3) return;
      g.moved = true;
      const el = wrapRef.current?.querySelector<HTMLElement>(`[data-obj="${g.id}"]`);
      if (el) el.style.translate = `${dx}px ${dy}px`;
    }
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (pointers.current.size > 0) return;
    gesture.current = null;
    if (!g) return;
    if (g.mode === "draw" && live.current) {
      const pts = quantise(simplify(live.current, 0.6 / viewRef.current.scale));
      live.current = null;
      if (pts.length >= 2) {
        p.commit({ kind: "add", payload: { obj: { id: newId("sk"), kind: "stroke", z: nextZ(p.state), by: p.meId, points: pts, colour: p.penColour, size: p.penSize } } });
      }
      requestAnimationFrame(draw);
    } else if (g.mode === "drag") {
      const el = wrapRef.current?.querySelector<HTMLElement>(`[data-obj="${g.id}"]`);
      if (el) el.style.translate = "";
      if (g.moved) {
        const s = local(e);
        const dx = (s.x - g.sx) / viewRef.current.scale;
        const dy = (s.y - g.sy) / viewRef.current.scale;
        p.commit({ kind: "update", payload: { id: g.id, patch: { x: Math.round(g.ox + dx), y: Math.round(g.oy + dy) } } });
      }
    }
  };

  const startDrag = (e: RPointerEvent, o: StickyObj | TextObj) => {
    if (editing === o.id) return;
    if (!(p.tool === "select" || p.tool === "sticky" || p.tool === "text")) return;
    e.stopPropagation();
    e.preventDefault();
    setSelected(o.id);
    const s = local(e);
    wrapRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, s);
    gesture.current = { mode: "drag", id: o.id, sx: s.x, sy: s.y, ox: o.x, oy: o.y, moved: false };
  };

  useEffect(() => {
    p.onEditing(editing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const cursorClass = { select: "", hand: "is-hand", pen: "is-pen", eraser: "is-eraser", sticky: "is-place", text: "is-text" }[effectiveTool];
  // Keep the dot grid subtle and readable: double the world spacing when zoomed far out (stays aligned).
  const dot = (view.scale < 0.5 ? 48 : 24) * view.scale;

  return (
    <div
      ref={wrapRef}
      className={`board ${cursorClass}`}
      style={{
        backgroundSize: `${dot}px ${dot}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        backgroundImage: view.scale < 0.15 ? "none" : undefined
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => p.onCursor(null)}
      role="application"
      aria-label="Shared board. Use the toolbar to pick a tool; space and drag to pan, ctrl and scroll to zoom."
    >
      <div className="board__world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        {pages.map((pg) => (
          <div key={pg.id} className="board__page" style={{ left: pg.x, top: pg.y, width: pg.w, height: pg.h }}>
            <span className="board__page-label">{pg.title}</span>
            {pg.bg && <img src={pg.bg} alt="" draggable={false} />}
          </div>
        ))}
        {objects.map((o) => {
          if (o.kind === "stroke") return null;
          const lockedBy = editingLocks.get(o.id);
          const isEditing = editing === o.id && !lockedBy;
          const common = {
            "data-obj": o.id,
            "data-board-ui": isEditing ? "" : undefined,
            className: `${o.kind === "sticky" ? `sticky sticky--${o.colour}` : "btext"}${selected === o.id ? " is-selected" : ""}${o.draft ? " is-draft" : ""}`,
            style: o.kind === "sticky" ? { left: o.x, top: o.y, width: o.w, height: o.h, zIndex: o.z } : { left: o.x, top: o.y, width: o.w, fontSize: o.size, color: o.colour, zIndex: o.z },
            onPointerDown: (e: RPointerEvent) => startDrag(e, o),
            onDoubleClick: () => !lockedBy && setEditing(o.id)
          };
          return (
            <div key={o.id} {...common}>
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
              {selected === o.id && !isEditing && (
                <button
                  type="button"
                  className="obj-del"
                  data-board-ui=""
                  aria-label="Delete"
                  onClick={() => {
                    p.commit({ kind: "remove", payload: { id: o.id } });
                    setSelected(null);
                  }}
                >
                  <X aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <canvas ref={canvasRef} className="board__ink" style={{ width: size.w, height: size.h }} aria-hidden="true" />
      {p.peers.map((peer) =>
        peer.cursor && size.w ? (
          <Cursor key={peer.tabId} name={peer.name} at={{ x: peer.cursor.x * view.scale + view.x, y: peer.cursor.y * view.scale + view.y }} agent={Boolean(peer.isAgent)} />
        ) : null
      )}
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

export { bounds, rectContains };
