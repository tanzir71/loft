import type { Rect } from "./geometry";

export const GRID = 8;
export const snapToGrid = (v: number, grid = GRID) => Math.round(v / grid) * grid;

export interface Guide {
  axis: "x" | "y";
  at: number;
}

/** Snap a moving rect to the edges and centres of others; returns the offset and the guide lines to draw. */
export function smartSnap(moving: Rect, others: Rect[], threshold = 6): { dx: number; dy: number; guides: Guide[] } {
  const xs = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w];
  const ys = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h];
  let bestX: { d: number; at: number; delta: number } | null = null;
  let bestY: { d: number; at: number; delta: number } | null = null;
  for (const o of others) {
    for (const a of xs(moving)) for (const b of xs(o)) {
      const d = Math.abs(a - b);
      if (d <= threshold && (!bestX || d < bestX.d)) bestX = { d, at: b, delta: b - a };
    }
    for (const a of ys(moving)) for (const b of ys(o)) {
      const d = Math.abs(a - b);
      if (d <= threshold && (!bestY || d < bestY.d)) bestY = { d, at: b, delta: b - a };
    }
  }
  const guides: Guide[] = [];
  if (bestX) guides.push({ axis: "x", at: bestX.at });
  if (bestY) guides.push({ axis: "y", at: bestY.at });
  return { dx: bestX?.delta ?? 0, dy: bestY?.delta ?? 0, guides };
}

export type Positioned = Rect & { id: string };

/** Tidy up: lay the selection on a grid (rows by vertical position) with even gaps. */
export function tidyUp(items: Positioned[], gap = 40): Record<string, { x: number; y: number }> {
  if (!items.length) return {};
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Positioned[][] = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r[0]!.y + r[0]!.h / 2 - (it.y + it.h / 2)) < Math.max(r[0]!.h, it.h) / 2);
    if (row) row.push(it);
    else rows.push([it]);
  }
  const cols = Math.max(...rows.map((r) => r.length));
  const colW = Array.from({ length: cols }, (_, c) => Math.max(...rows.map((r) => r[c]?.w ?? 0)));
  const originX = Math.min(...items.map((i) => i.x));
  let y = Math.min(...items.map((i) => i.y));
  const out: Record<string, { x: number; y: number }> = {};
  for (const r of rows) {
    r.sort((a, b) => a.x - b.x);
    const rowH = Math.max(...r.map((i) => i.h));
    let x = originX;
    r.forEach((it, c) => {
      out[it.id] = { x: Math.round(x + (colW[c]! - it.w) / 2), y: Math.round(y + (rowH - it.h) / 2) };
      x += colW[c]! + gap;
    });
    y += rowH + gap;
  }
  return out;
}

export function alignItems(items: Positioned[], how: "left" | "centre" | "right" | "top" | "middle" | "bottom"): Record<string, { x: number; y: number }> {
  const minX = Math.min(...items.map((i) => i.x)), maxX = Math.max(...items.map((i) => i.x + i.w));
  const minY = Math.min(...items.map((i) => i.y)), maxY = Math.max(...items.map((i) => i.y + i.h));
  const out: Record<string, { x: number; y: number }> = {};
  for (const i of items) {
    out[i.id] = {
      x: how === "left" ? minX : how === "right" ? maxX - i.w : how === "centre" ? (minX + maxX) / 2 - i.w / 2 : i.x,
      y: how === "top" ? minY : how === "bottom" ? maxY - i.h : how === "middle" ? (minY + maxY) / 2 - i.h / 2 : i.y
    };
  }
  return out;
}

export function distribute(items: Positioned[], axis: "x" | "y"): Record<string, { x: number; y: number }> {
  if (items.length < 3) return Object.fromEntries(items.map((i) => [i.id, { x: i.x, y: i.y }]));
  const s = [...items].sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
  const first = s[0]!, last = s[s.length - 1]!;
  const span = axis === "x" ? last.x + last.w - first.x : last.y + last.h - first.y;
  const sizes = s.reduce((n, i) => n + (axis === "x" ? i.w : i.h), 0);
  const gap = (span - sizes) / (s.length - 1);
  let pos = axis === "x" ? first.x : first.y;
  const out: Record<string, { x: number; y: number }> = {};
  for (const i of s) {
    out[i.id] = axis === "x" ? { x: Math.round(pos), y: i.y } : { x: i.x, y: Math.round(pos) };
    pos += (axis === "x" ? i.w : i.h) + gap;
  }
  return out;
}
