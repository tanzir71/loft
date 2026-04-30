import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tool = "pen" | "eraser" | "text" | "sticky" | "move";

interface WhiteboardProps {
  tool: Tool;
  color: string;
  size: number;
  clearSignal: number;
  exportSignal: number;
  strokes: Stroke[];
  setStrokes: (updater: (prev: Stroke[]) => Stroke[]) => void;
  items: TextItem[];
  setItems: (updater: (prev: TextItem[]) => TextItem[]) => void;
}

export interface Stroke {
  tool: "pen" | "eraser";
  color: string;
  size: number;
  points: { x: number; y: number }[];
}

export interface TextItem {
  id: string;
  type: "text" | "sticky";
  x: number;
  y: number;
  w?: number;
  h?: number;
  text: string;
  color: string;
}

const DEFAULT_STICKY_COLOR = "#fff59d";
const STICKY_PALETTE = ["#fff59d", "#ffcc80", "#ce93d8", "#90caf9", "#a5d6a7"];

const makeId = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

export const Whiteboard = ({
  tool,
  color,
  size,
  clearSignal,
  exportSignal,
  strokes,
  setStrokes,
  items,
  setItems,
}: WhiteboardProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedStickyId, setSelectedStickyId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const editingRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingFocusIdRef = useRef<string | null>(null);
  const drawing = useRef(false);
  const current = useRef<Stroke | null>(null);
  const strokesRef = useRef(strokes);
  const itemsRef = useRef(items);
  const transformRef = useRef({ scale: 1, panX: 0, panY: 0 });
  const overlaysRef = useRef<HTMLDivElement>(null);
  const panningRef = useRef<{
    startClientX: number;
    startClientY: number;
    originPanX: number;
    originPanY: number;
  } | null>(null);
  const dragRef = useRef<{
    id: string;
    kind: "sticky" | "text";
    mode:
      | "move"
      | "resize"
      | "resize-tl"
      | "resize-tr"
      | "resize-bl"
      | "resize-br";
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    originW?: number;
    originH?: number;
  } | null>(null);

  const syncOverlayTransform = () => {
    const t = transformRef.current;
    if (!overlaysRef.current) return;
    overlaysRef.current.style.transform = `translate(${t.panX}px, ${t.panY}px) scale(${t.scale})`;
  };

  // Resize canvas to container with DPR
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = wrap.getBoundingClientRect();
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      redraw();
      syncOverlayTransform();
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      const t = transformRef.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const zoomSensitivity = 0.005;
        const delta = -e.deltaY * zoomSensitivity;
        const newScale = Math.min(Math.max(0.1, t.scale * Math.exp(delta)), 10);
        
        const rect = wrap.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const originX = (mouseX - t.panX) / t.scale;
        const originY = (mouseY - t.panY) / t.scale;

        t.panX = mouseX - originX * newScale;
        t.panY = mouseY - originY * newScale;
        t.scale = newScale;
      } else {
        t.panX -= e.deltaX;
        t.panY -= e.deltaY;
      }
      
      redraw();
      syncOverlayTransform();
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    strokesRef.current = strokes;
    itemsRef.current = items;
    redraw();
    syncOverlayTransform();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, items]);

  useEffect(() => {
    const id = pendingFocusIdRef.current;
    if (id) {
      pendingFocusIdRef.current = null;
      window.setTimeout(() => {
        const el = document.querySelector(
          `[data-text-id="${CSS.escape(id)}"]`,
        ) as HTMLTextAreaElement | null;
        el?.focus();
      }, 0);
      return;
    }
    if (!editingId) return;
    window.setTimeout(() => editingRef.current?.focus(), 0);
  }, [editingId]);

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const t = transformRef.current;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * t.scale, 0, 0, dpr * t.scale, t.panX * dpr, t.panY * dpr);
    for (const s of strokesRef.current) drawStroke(ctx, s);
    if (current.current) drawStroke(ctx, current.current);
  };

  const drawStroke = (ctx: CanvasRenderingContext2D, s: Stroke | null) => {
    if (!s || !s.points || s.points.length < 1) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = s.size;
    if (s.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = s.color;
    }
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i];
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  };

  const getPos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const t = transformRef.current;
    const x = (e.clientX - rect.left - t.panX) / t.scale;
    const y = (e.clientY - rect.top - t.panY) / t.scale;
    return { x, y };
  };

  const onDown = (e: React.PointerEvent) => {
    if (tool === "move" || e.button === 2) return;
    if (tool === "text" || tool === "sticky") {
      const pos = getPos(e);
      const id = makeId();
      const newItem: TextItem = {
        id,
        type: tool,
        x: pos.x,
        y: pos.y,
        w: tool === "text" ? 220 : undefined,
        h: tool === "text" ? 44 : undefined,
        text: "",
        color: tool === "sticky" ? DEFAULT_STICKY_COLOR : color,
      };
      itemsRef.current = [...itemsRef.current, newItem];
      setItems(() => itemsRef.current);
      setEditingId(id);
      if (tool === "sticky") setSelectedStickyId(id);
      if (tool === "text") setSelectedTextId(id);
      if (tool === "text") pendingFocusIdRef.current = id;
      
      // Prevent further propagation so it doesn't trigger canvas blur immediately
      e.stopPropagation();
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = true;
    current.current = {
      tool: tool === "eraser" ? "eraser" : "pen",
      color,
      size: tool === "eraser" ? size * 2.5 : size,
      points: [getPos(e)],
    };
    redraw();
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current || !current.current) return;
    current.current.points.push(getPos(e));
    redraw();
  };

  const onUp = () => {
    if (!drawing.current || !current.current) return;
    drawing.current = false;
    strokesRef.current = [...strokesRef.current, current.current];
    setStrokes(() => strokesRef.current);
    current.current = null;
    redraw();
  };

  // Clear
  useEffect(() => {
    if (clearSignal === 0) return;
    strokesRef.current = [];
    itemsRef.current = [];
    setStrokes(() => strokesRef.current);
    setItems(() => itemsRef.current);
    setEditingId(null);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [clearSignal]);

  // Export PNG
  useEffect(() => {
    if (exportSignal === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Compose with white bg for export
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext("2d")!;
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(canvas, 0, 0);
    const url = out.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `whiteboard-${Date.now()}.png`;
    a.click();
  }, [exportSignal]);

  const cursorFor = (t: Tool) => {
    if (t === "move") return "grab";
    if (t === "eraser") return "cell";
    if (t === "text") return "text";
    if (t === "sticky") return "copy";
    return "crosshair";
  };

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDownCapture={(e) => {
        if (tool === "move" || e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          const t = transformRef.current;
          panningRef.current = {
            startClientX: e.clientX,
            startClientY: e.clientY,
            originPanX: t.panX,
            originPanY: t.panY,
          };
          return;
        }
        const el = e.target as HTMLElement | null;
        if (el?.tagName === "CANVAS") {
          setSelectedStickyId(null);
          setSelectedTextId(null);
        }
      }}
      onPointerMove={(e) => {
        const p = panningRef.current;
        if (!p) return;
        e.preventDefault();
        e.stopPropagation();
        const dx = e.clientX - p.startClientX;
        const dy = e.clientY - p.startClientY;
        transformRef.current.panX = p.originPanX + dx;
        transformRef.current.panY = p.originPanY + dy;
        redraw();
        syncOverlayTransform();
      }}
      onPointerUp={() => {
        panningRef.current = null;
      }}
      onPointerCancel={() => {
        panningRef.current = null;
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="absolute inset-0 touch-none"
        style={{ cursor: panningRef.current ? "grabbing" : cursorFor(tool) }}
      />

      {/* Text + sticky overlays */}
      <div
        ref={overlaysRef}
        className="absolute left-0 top-0"
        style={{
          width: 0,
          height: 0,
          transformOrigin: "0 0",
          transform: "translate(0px, 0px) scale(1)",
        }}
      >
        {items.map((it) => {
          const isSticky = it.type === "sticky";
        const editing = editingId === it.id || (it.type === "text" && it.text.trim().length === 0);
        const commonStyle: React.CSSProperties = {
          left: it.x,
          top: it.y,
          transform: isSticky ? "translate(-8px, -8px)" : "translate(0, -8px)",
        };
        if (isSticky) {
          return (
            <div
              key={it.id}
              className="absolute shadow-md pointer-events-auto"
              style={{
                ...commonStyle,
                width: 190,
                height: 190,
                background: it.color,
                border: "1px solid rgba(0,0,0,0.12)",
              }}
              onPointerDown={() => setSelectedStickyId(it.id)}
            >
              {selectedStickyId === it.id && (
                <div className="absolute -top-12 left-0 flex items-center gap-1.5 rounded-xl bg-white/95 p-1.5 shadow-lg ring-1 ring-black/5 backdrop-blur-md">
                  <button
                    className="grid h-8 w-8 place-items-center rounded-lg text-surface-muted transition-colors hover:bg-rose-50 hover:text-rose-500"
                    onClick={() => {
                      itemsRef.current = itemsRef.current.filter((p) => p.id !== it.id);
                      setItems(() => itemsRef.current);
                      setSelectedStickyId(null);
                      if (editingId === it.id) setEditingId(null);
                    }}
                    type="button"
                    aria-label="Delete sticky"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <div className="mx-1 h-6 w-px bg-black/10" />
                  {STICKY_PALETTE.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={cn(
                        "relative h-7 w-7 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110",
                        c === it.color && "ring-2 ring-offset-2 ring-offset-white"
                      )}
                      style={{
                        backgroundColor: c,
                        boxShadow: c === it.color ? `0 0 0 2px ${c}` : undefined,
                      }}
                      aria-label={`Sticky color ${c}`}
                      onClick={() => {
                        itemsRef.current = itemsRef.current.map((p) =>
                          p.id === it.id ? { ...p, color: c } : p,
                        );
                        setItems(() => itemsRef.current);
                      }}
                    />
                  ))}
                </div>
              )}

              <div
                className="h-6 w-full cursor-move bg-black/[0.06]"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  (e.currentTarget as Element).setPointerCapture(e.pointerId);
                  dragRef.current = {
                    id: it.id,
                    kind: "sticky",
                    mode: "move",
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    originX: it.x,
                    originY: it.y,
                  };
                  setSelectedStickyId(it.id);
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  if (!d || d.id !== it.id || d.kind !== "sticky" || d.mode !== "move") return;
                  const dx = (e.clientX - d.startClientX) / transformRef.current.scale;
                  const dy = (e.clientY - d.startClientY) / transformRef.current.scale;
                  itemsRef.current = itemsRef.current.map((p) =>
                    p.id === it.id ? { ...p, x: d.originX + dx, y: d.originY + dy } : p,
                  );
                  setItems(() => itemsRef.current);
                }}
                onPointerUp={() => {
                  dragRef.current = null;
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
              />

              <textarea
                value={it.text}
                onFocus={() => {
                  setEditingId(it.id);
                  setSelectedStickyId(it.id);
                }}
                onChange={(e) => {
                  const nextText = e.target.value;
                  itemsRef.current = itemsRef.current.map((p) =>
                    p.id === it.id ? { ...p, text: nextText } : p,
                  );
                  setItems(() => itemsRef.current);
                }}
                placeholder="Sticky note…"
                className="h-[calc(100%-24px)] w-full resize-none bg-transparent p-2 text-sm font-medium leading-snug text-[#1a1d2e] outline-none"
              />
            </div>
          );
        }

        if (it.type === "text") {
          const w = Math.max(120, it.w ?? 220);
          const h = Math.max(36, it.h ?? 44);
          const selected = selectedTextId === it.id;

          return (
            <div
              key={it.id}
              className={cn(
                "absolute pointer-events-auto",
                selected && "ring-2 ring-blue-500"
              )}
              style={{
                ...commonStyle,
                width: w,
                height: h,
              }}
              onPointerDown={(e) => {
                if (editingId === it.id) return;
                setSelectedTextId(it.id);
                e.preventDefault();
                e.stopPropagation();
                (e.currentTarget as Element).setPointerCapture(e.pointerId);
                dragRef.current = {
                  id: it.id,
                  kind: "text",
                  mode: "move",
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  originX: it.x,
                  originY: it.y,
                };
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d || d.id !== it.id || d.kind !== "text" || d.mode !== "move") return;
                const dx = (e.clientX - d.startClientX) / transformRef.current.scale;
                const dy = (e.clientY - d.startClientY) / transformRef.current.scale;
                itemsRef.current = itemsRef.current.map((p) =>
                  p.id === it.id ? { ...p, x: d.originX + dx, y: d.originY + dy } : p,
                );
                setItems(() => itemsRef.current);
              }}
              onPointerUp={() => {
                dragRef.current = null;
              }}
              onPointerCancel={() => {
                dragRef.current = null;
              }}
            >
              {selected && (
                <div className="absolute -top-12 left-0 flex items-center gap-1.5 rounded-xl bg-white/95 p-1.5 shadow-lg ring-1 ring-black/5 backdrop-blur-md">
                  <button
                    className="grid h-8 w-8 place-items-center rounded-lg text-surface-muted transition-colors hover:bg-rose-50 hover:text-rose-500"
                    onClick={() => {
                      itemsRef.current = itemsRef.current.filter((p) => p.id !== it.id);
                      setItems(() => itemsRef.current);
                      setSelectedTextId(null);
                      if (editingId === it.id) setEditingId(null);
                    }}
                    type="button"
                    aria-label="Delete text"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div className="relative h-full w-full">
                {editing ? (
                  <textarea
                    data-text-id={it.id}
                    value={it.text}
                    onPointerDown={(e) => e.stopPropagation()}
                    onFocus={() => {
                      setEditingId(it.id);
                      setSelectedTextId(it.id);
                    }}
                    onChange={(e) => {
                      const nextText = e.target.value;
                      itemsRef.current = itemsRef.current.map((p) =>
                        p.id === it.id ? { ...p, text: nextText } : p,
                      );
                      setItems(() => itemsRef.current);
                    }}
                    onBlur={() => {
                      setEditingId(null);
                      itemsRef.current = itemsRef.current.filter((p) => {
                        if (p.id !== it.id) return true;
                        return p.text.trim().length > 0;
                      });
                      setItems(() => itemsRef.current);
                    }}
                    placeholder="Type…"
                    className="h-full w-full resize-none bg-transparent p-2 text-sm leading-snug text-foreground outline-none"
                    style={{ color: it.color }}
                  />
                ) : (
                  <div
                    className="h-full w-full whitespace-pre-wrap bg-transparent p-2 text-sm leading-snug"
                    style={{ color: it.color }}
                    onDoubleClick={() => {
                      setEditingId(it.id);
                      setSelectedTextId(it.id);
                      pendingFocusIdRef.current = it.id;
                    }}
                  >
                    {it.text}
                  </div>
                )}

                {selected && (
                  <>
                    <div
                      className="absolute -right-1.5 -top-1.5 h-3 w-3 cursor-ne-resize rounded-full border border-blue-500 bg-white"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        (e.currentTarget as Element).setPointerCapture(e.pointerId);
                        dragRef.current = {
                          id: it.id,
                          kind: "text",
                          mode: "resize-tr",
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                          originX: it.x,
                          originY: it.y,
                          originW: w,
                          originH: h,
                        };
                      }}
                      onPointerMove={(e) => {
                        const d = dragRef.current;
                        if (!d || d.id !== it.id || d.kind !== "text" || d.mode !== "resize-tr") return;
                        const dx = (e.clientX - d.startClientX) / transformRef.current.scale;
                        const dy = (e.clientY - d.startClientY) / transformRef.current.scale;
                        const nextW = Math.max(120, (d.originW ?? w) + dx);
                        const nextH = Math.max(36, (d.originH ?? h) - dy);
                        itemsRef.current = itemsRef.current.map((p) =>
                          p.id === it.id ? { ...p, w: nextW, h: nextH, y: d.originY + dy } : p,
                        );
                        setItems(() => itemsRef.current);
                      }}
                      onPointerUp={() => { dragRef.current = null; }}
                      onPointerCancel={() => { dragRef.current = null; }}
                    />
                    <div
                      className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-full border border-blue-500 bg-white"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        (e.currentTarget as Element).setPointerCapture(e.pointerId);
                        dragRef.current = {
                          id: it.id,
                          kind: "text",
                          mode: "resize-br",
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                          originX: it.x,
                          originY: it.y,
                          originW: w,
                          originH: h,
                        };
                      }}
                      onPointerMove={(e) => {
                        const d = dragRef.current;
                        if (!d || d.id !== it.id || d.kind !== "text" || d.mode !== "resize-br") return;
                        const dx = (e.clientX - d.startClientX) / transformRef.current.scale;
                        const dy = (e.clientY - d.startClientY) / transformRef.current.scale;
                        const nextW = Math.max(120, (d.originW ?? w) + dx);
                        const nextH = Math.max(36, (d.originH ?? h) + dy);
                        itemsRef.current = itemsRef.current.map((p) =>
                          p.id === it.id ? { ...p, w: nextW, h: nextH } : p,
                        );
                        setItems(() => itemsRef.current);
                      }}
                      onPointerUp={() => { dragRef.current = null; }}
                      onPointerCancel={() => { dragRef.current = null; }}
                    />
                    <div
                      className="absolute -bottom-1.5 -left-1.5 h-3 w-3 cursor-sw-resize rounded-full border border-blue-500 bg-white"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        (e.currentTarget as Element).setPointerCapture(e.pointerId);
                        dragRef.current = {
                          id: it.id,
                          kind: "text",
                          mode: "resize-bl",
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                          originX: it.x,
                          originY: it.y,
                          originW: w,
                          originH: h,
                        };
                      }}
                      onPointerMove={(e) => {
                        const d = dragRef.current;
                        if (!d || d.id !== it.id || d.kind !== "text" || d.mode !== "resize-bl") return;
                        const dx = (e.clientX - d.startClientX) / transformRef.current.scale;
                        const dy = (e.clientY - d.startClientY) / transformRef.current.scale;
                        const nextW = Math.max(120, (d.originW ?? w) - dx);
                        const nextH = Math.max(36, (d.originH ?? h) + dy);
                        itemsRef.current = itemsRef.current.map((p) =>
                          p.id === it.id ? { ...p, w: nextW, h: nextH, x: d.originX + dx } : p,
                        );
                        setItems(() => itemsRef.current);
                      }}
                      onPointerUp={() => { dragRef.current = null; }}
                      onPointerCancel={() => { dragRef.current = null; }}
                    />
                    <div
                      className="absolute -left-1.5 -top-1.5 h-3 w-3 cursor-nw-resize rounded-full border border-blue-500 bg-white"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        (e.currentTarget as Element).setPointerCapture(e.pointerId);
                        dragRef.current = {
                          id: it.id,
                          kind: "text",
                          mode: "resize-tl",
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                          originX: it.x,
                          originY: it.y,
                          originW: w,
                          originH: h,
                        };
                      }}
                      onPointerMove={(e) => {
                        const d = dragRef.current;
                        if (!d || d.id !== it.id || d.kind !== "text" || d.mode !== "resize-tl") return;
                        const dx = (e.clientX - d.startClientX) / transformRef.current.scale;
                        const dy = (e.clientY - d.startClientY) / transformRef.current.scale;
                        const nextW = Math.max(120, (d.originW ?? w) - dx);
                        const nextH = Math.max(36, (d.originH ?? h) - dy);
                        itemsRef.current = itemsRef.current.map((p) =>
                          p.id === it.id ? { ...p, w: nextW, h: nextH, x: d.originX + dx, y: d.originY + dy } : p,
                        );
                        setItems(() => itemsRef.current);
                      }}
                      onPointerUp={() => { dragRef.current = null; }}
                      onPointerCancel={() => { dragRef.current = null; }}
                    />
                  </>
                )}
              </div>
            </div>
          );
        }

        if (editing) {
          return (
            <textarea
              key={it.id}
              data-text-id={it.id}
              ref={(el) => {
                if (el && editingId === it.id) {
                  editingRef.current = el;
                }
              }}
              value={it.text}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const nextText = e.target.value;
                itemsRef.current = itemsRef.current.map((p) =>
                  p.id === it.id ? { ...p, text: nextText } : p,
                );
                setItems(() => itemsRef.current);
              }}
              onBlur={() => {
                setEditingId(null);
                itemsRef.current = itemsRef.current.filter((p) => {
                  if (p.id !== it.id) return true;
                  return p.text.trim().length > 0;
                });
                setItems(() => itemsRef.current);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
              }}
              placeholder="Type…"
              className="absolute resize-none p-2 text-sm leading-snug shadow-md outline-none focus:ring-2 focus:ring-primary pointer-events-auto"
              style={{
                ...commonStyle,
                minWidth: 140,
                minHeight: 36,
                background: "rgba(255,255,255,0.95)",
                color: it.color,
                border: "1px dashed hsl(var(--border))",
                fontWeight: 400,
                zIndex: 10,
              }}
            />
          );
        }
        return (
          <div
            key={it.id}
            onClick={() => setEditingId(it.id)}
            className="absolute cursor-text whitespace-pre-wrap p-2 text-sm leading-snug pointer-events-auto"
            style={{
              ...commonStyle,
              background: "transparent",
              color: it.color,
              fontWeight: 400,
            }}
          >
            {it.text}
          </div>
        );
      })}
      </div>
    </div>
  );
};
