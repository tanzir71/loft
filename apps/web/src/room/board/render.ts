import {
  arrowHead,
  bounds,
  buildPdf,
  diagramToObjects,
  layoutDiagram,
  parseDiagram,
  routeConnector,
  sortedObjects,
  sortedPages,
  strokeOutline,
  type BoardObj,
  type BoardState,
  type ConnectorObj,
  type Rect
} from "@loft/board";
import { FILL_HEX, shapePath } from "./shapes";

const STICKY: Record<string, string> = { yellow: "#fff0b2", pink: "#fccfde", blue: "#c5e5fc", green: "#c6f1db" };
export type ImageResolver = (fileId: string) => Promise<HTMLImageElement | null>;

/** Expand diagram objects into their laid-out shapes/connectors (for drawing). */
export function expandDiagrams(state: BoardState): BoardState {
  const extra: Record<string, BoardObj> = {};
  for (const o of Object.values(state.objects)) {
    if (o.kind !== "diagram") continue;
    let k = 0;
    for (const x of diagramToObjects(layoutDiagram(parseDiagram(o.code)), { x: o.x, y: o.y }, { z: o.z, newId: (p) => `${o.id}:${p}${++k}` })) extra[x.id] = x;
  }
  if (!Object.keys(extra).length) return state;
  return { ...state, objects: { ...state.objects, ...extra } };
}

export function contentBounds(state: BoardState): Rect {
  const s = expandDiagrams(state);
  const rects = [...sortedPages(s), ...sortedObjects(s).filter((o) => o.kind !== "connector" && o.kind !== "diagram").map(bounds)];
  const minX = Math.min(...rects.map((r) => r.x)), minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w)), maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX - 40, y: minY - 40, w: maxX - minX + 80, h: maxY - minY + 80 };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number, lh: number, align: "center" | "left" = "left") {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let cur = "";
    for (const word of para.split(" ")) {
      const test = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = word;
      } else cur = test;
    }
    lines.push(cur);
  }
  ctx.textAlign = align;
  lines.forEach((l, i) => ctx.fillText(l, cx, y + i * lh));
  return lines.length;
}

/** Draw a region of the board to a canvas. */
export async function renderRegion(state0: BoardState, rect: Rect, scale: number, resolve: ImageResolver): Promise<HTMLCanvasElement> {
  const state = expandDiagrams(state0);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(rect.w * scale));
  c.height = Math.max(1, Math.ceil(rect.h * scale));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#faf8f5";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(scale, 0, 0, scale, -rect.x * scale, -rect.y * scale);
  for (const p of sortedPages(state)) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(p.x, p.y, p.w, p.h);
    if (p.bg) {
      const img = await resolve(p.bg);
      if (img) ctx.drawImage(img, p.x, p.y, p.w, p.h);
    }
  }
  const objs = sortedObjects(state);
  ctx.textBaseline = "top";
  // Highlighter under everything else.
  for (const o of objs) if (o.kind === "stroke" && o.highlighter) drawStroke(ctx, o);
  for (const o of objs) {
    if (o.kind === "section") {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.strokeStyle = "#e0e2eb";
      ctx.fill(new Path2D(shapeAt(o.x, o.y, o.w, o.h, 16)));
      ctx.stroke(new Path2D(shapeAt(o.x, o.y, o.w, o.h, 16)));
      ctx.fillStyle = "#434656";
      ctx.font = "500 14px Inter, sans-serif";
      ctx.fillText(o.title, o.x + 16, o.y + 14);
    }
  }
  for (const o of objs) {
    if (o.kind === "shape") {
      ctx.save();
      ctx.translate(o.x, o.y);
      const path = new Path2D(shapePath(o.shape, o.w, o.h));
      ctx.fillStyle = FILL_HEX[o.fill];
      ctx.fill(path);
      ctx.strokeStyle = "#434656";
      ctx.lineWidth = 1.3;
      ctx.stroke(path);
      ctx.fillStyle = "#1a1c23";
      ctx.font = "500 14px Inter, sans-serif";
      const lines = o.text.split("\n").length;
      wrap(ctx, o.text, o.w / 2, o.h / 2 - (lines * 18) / 2, o.w - 20, 18, "center");
      ctx.restore();
    } else if (o.kind === "connector") {
      drawConnector(ctx, state, o);
    } else if (o.kind === "sticky") {
      ctx.fillStyle = STICKY[o.colour] ?? STICKY.yellow!;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = "#1a1c23";
      ctx.font = "500 16px Inter, sans-serif";
      wrap(ctx, o.text, o.x + 14, o.y + 14, o.w - 28, 22);
    } else if (o.kind === "text") {
      ctx.fillStyle = o.colour;
      ctx.font = `500 ${o.size}px Inter, sans-serif`;
      wrap(ctx, o.text, o.x, o.y, o.w, o.size * 1.4);
    }
  }
  for (const o of objs) if (o.kind === "stroke" && !o.highlighter) drawStroke(ctx, o);
  return c;
}

function shapeAt(x: number, y: number, w: number, h: number, r: number) {
  return `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
}

function drawStroke(ctx: CanvasRenderingContext2D, o: Extract<BoardObj, { kind: "stroke" }>) {
  ctx.save();
  ctx.globalAlpha = o.highlighter ? 0.4 : 1;
  ctx.fillStyle = o.colour;
  const d = strokeOutline(o.highlighter ? { ...o, size: o.size * 4 } : o);
  if (d) ctx.fill(new Path2D(d));
  ctx.restore();
}

function drawConnector(ctx: CanvasRenderingContext2D, state: BoardState, o: ConnectorObj) {
  const r = routeConnector(state, o);
  if (!r) return;
  ctx.save();
  ctx.strokeStyle = o.colour;
  ctx.fillStyle = o.colour;
  ctx.lineWidth = o.weight;
  ctx.setLineDash(o.dash ? [6, 5] : []);
  ctx.stroke(new Path2D(r.d));
  ctx.setLineDash([]);
  const cap = (kind: string, at: { x: number; y: number }, dir: { x: number; y: number }) => {
    if (kind === "arrow") {
      ctx.beginPath();
      const pts = arrowHead(at, dir, 9).split(" ").map((p) => p.split(",").map(Number));
      ctx.moveTo(pts[0]![0]!, pts[0]![1]!);
      ctx.lineTo(pts[1]![0]!, pts[1]![1]!);
      ctx.lineTo(pts[2]![0]!, pts[2]![1]!);
      ctx.fill();
    } else if (kind === "dot") {
      ctx.beginPath();
      ctx.arc(at.x, at.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  cap(o.endCap, r.end, r.endDir);
  cap(o.startCap, r.start, { x: -r.startDir.x, y: -r.startDir.y });
  if (o.label) {
    ctx.font = "400 12px Inter, sans-serif";
    const w = ctx.measureText(o.label).width + 14;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#e0e2eb";
    ctx.lineWidth = 1;
    ctx.fillRect(r.label.x - w / 2, r.label.y - 11, w, 22);
    ctx.strokeRect(r.label.x - w / 2, r.label.y - 11, w, 22);
    ctx.fillStyle = "#434656";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(o.label, r.label.x, r.label.y);
    ctx.textBaseline = "top";
  }
  ctx.restore();
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

const safe = (s: string) => s.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "") || "board";

export async function exportPng(state: BoardState, rect: Rect, name: string, resolve: ImageResolver) {
  const scale = Math.min(2, 4000 / Math.max(rect.w, rect.h));
  const c = await renderRegion(state, rect, scale, resolve);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (blob) download(blob, `${safe(name)}.png`);
}

/** PDF: one page per region (board pages or a section), JPEG inside, A4 or Letter. */
export async function exportPdf(state: BoardState, regions: Rect[], name: string, resolve: ImageResolver, paper: "a4" | "letter" = "a4") {
  const pages = [];
  for (const rect of regions) {
    const scale = Math.min(2, 2400 / Math.max(rect.w, rect.h));
    const c = await renderRegion(state, rect, scale, resolve);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.9));
    if (blob) pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height });
  }
  const bytes = buildPdf(pages, paper);
  download(new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }), `${safe(name)}.pdf`);
}
