import type { BoardObj, Page, StrokeObj, Viewport } from "./types";

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function screenToWorld(v: Viewport, p: Pt): Pt {
  return { x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale };
}

export function worldToScreen(v: Viewport, p: Pt): Pt {
  return { x: p.x * v.scale + v.x, y: p.y * v.scale + v.y };
}

/** Zoom by `factor` keeping the screen point `at` fixed. */
export function zoomAt(v: Viewport, at: Pt, factor: number): Viewport {
  const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
  const k = scale / v.scale;
  return { scale, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k };
}

/** Fit a world rect inside a screen box with padding. */
export function fitRect(r: Rect, screen: { w: number; h: number }, pad = 48): Viewport {
  const scale = clamp(Math.min((screen.w - pad * 2) / r.w, (screen.h - pad * 2) / r.h), MIN_SCALE, MAX_SCALE);
  return { scale, x: (screen.w - r.w * scale) / 2 - r.x * scale, y: (screen.h - r.h * scale) / 2 - r.y * scale };
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function strokeHit(s: StrokeObj, p: Pt, radius: number): boolean {
  const r = radius + s.size / 2;
  const pts = s.points;
  if (pts.length === 2) return Math.hypot(p.x - pts[0]!, p.y - pts[1]!) <= r;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    if (distToSegment(p, { x: pts[i]!, y: pts[i + 1]! }, { x: pts[i + 2]!, y: pts[i + 3]! }) <= r) return true;
  }
  return false;
}

export function bounds(o: BoardObj): Rect {
  if (o.kind === "stroke") {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i + 1 < o.points.length; i += 2) {
      minX = Math.min(minX, o.points[i]!);
      maxX = Math.max(maxX, o.points[i]!);
      minY = Math.min(minY, o.points[i + 1]!);
      maxY = Math.max(maxY, o.points[i + 1]!);
    }
    const h = o.size / 2;
    return { x: minX - h, y: minY - h, w: maxX - minX + o.size, h: maxY - minY + o.size };
  }
  if (o.kind === "sticky") return { x: o.x, y: o.y, w: o.w, h: o.h };
  return { x: o.x, y: o.y, w: o.w, h: Math.max(o.size * 1.4, o.size * 1.4 * o.text.split("\n").length) };
}

export function rectContains(r: Rect, p: Pt): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Which page (sheet) a world point falls on, if any. */
export function pageAtPoint(pages: Page[], p: Pt): Page | undefined {
  return pages.find((pg) => rectContains(pg, p));
}
