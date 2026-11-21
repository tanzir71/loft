import type { Anchor, BoardState, ConnectorEnd, ConnectorObj, ShapeObj, StickyObj } from "./types";
import type { Pt, Rect } from "./geometry";

export const ANCHORS: Anchor[] = ["n", "e", "s", "w"];
const NORMAL: Record<Anchor, Pt> = { n: { x: 0, y: -1 }, e: { x: 1, y: 0 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 } };

type Attachable = ShapeObj | StickyObj;
export function isAttachable(o: unknown): o is Attachable {
  return !!o && typeof o === "object" && ((o as { kind?: string }).kind === "shape" || (o as { kind?: string }).kind === "sticky");
}

/** Anchors sit at the edge midpoints (n|e|s|w). */
export function anchorPoint(r: Rect, a: Anchor): Pt {
  switch (a) {
    case "n": return { x: r.x + r.w / 2, y: r.y };
    case "e": return { x: r.x + r.w, y: r.y + r.h / 2 };
    case "s": return { x: r.x + r.w / 2, y: r.y + r.h };
    case "w": return { x: r.x, y: r.y + r.h / 2 };
  }
}

export function nearestAnchor(r: Rect, p: Pt): Anchor {
  let best: Anchor = "n";
  let d = Infinity;
  for (const a of ANCHORS) {
    const q = anchorPoint(r, a);
    const dd = Math.hypot(q.x - p.x, q.y - p.y);
    if (dd < d) {
      d = dd;
      best = a;
    }
  }
  return best;
}

/** The anchor on `r` that faces point `p` (used when a connector is dropped on a shape). */
export function facingAnchor(r: Rect, p: Pt): Anchor {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = (p.x - cx) / (r.w || 1), dy = (p.y - cy) / (r.h || 1);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : dy > 0 ? "s" : "n";
}

export interface ResolvedEnd {
  p: Pt;
  normal: Pt | null;
}

export function resolveEnd(state: BoardState, e: ConnectorEnd): ResolvedEnd | null {
  if ("x" in e) return { p: { x: e.x, y: e.y }, normal: null };
  const o = state.objects[e.id];
  if (!isAttachable(o)) return null;
  return { p: anchorPoint(o, e.anchor), normal: NORMAL[e.anchor] };
}

export interface RoutedPath {
  d: string;
  /** Polyline approximation (for hit testing and label placement). */
  pts: Pt[];
  label: Pt;
  start: Pt;
  end: Pt;
  /** Direction arriving at the end / leaving the start (for caps). */
  endDir: Pt;
  startDir: Pt;
}

const fmt = (n: number) => Math.round(n * 10) / 10;

function cubic(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y
  };
}

const unit = (v: Pt): Pt => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** Orthogonal path with at most two bends, leaving and arriving along the anchor normals. */
export function elbowPoints(a: Pt, an: Pt | null, b: Pt, bn: Pt | null): Pt[] {
  const STUB = 0;
  const horizontalStart = an ? an.x !== 0 : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const horizontalEnd = bn ? bn.x !== 0 : horizontalStart;
  const a1 = an ? { x: a.x + an.x * STUB, y: a.y + an.y * STUB } : a;
  if (horizontalStart && horizontalEnd) {
    const mx = (a1.x + b.x) / 2;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  if (!horizontalStart && !horizontalEnd) {
    const my = (a1.y + b.y) / 2;
    return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
  }
  // One bend.
  return horizontalStart ? [a, { x: b.x, y: a.y }, b] : [a, { x: a.x, y: b.y }, b];
}

export function routeConnector(state: BoardState, c: ConnectorObj): RoutedPath | null {
  const s = resolveEnd(state, c.from);
  const e = resolveEnd(state, c.to);
  if (!s || !e) return null;
  const a = s.p, b = e.p;
  if (c.route === "curved") {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const k = 0.4 * dist;
    const n1 = s.normal ?? unit({ x: b.x - a.x, y: b.y - a.y });
    const n2 = e.normal ?? unit({ x: a.x - b.x, y: a.y - b.y });
    const c1 = { x: a.x + n1.x * k, y: a.y + n1.y * k };
    const c2 = { x: b.x + n2.x * k, y: b.y + n2.y * k };
    const pts = Array.from({ length: 17 }, (_, i) => cubic(a, c1, c2, b, i / 16));
    return {
      d: `M${fmt(a.x)},${fmt(a.y)} C${fmt(c1.x)},${fmt(c1.y)} ${fmt(c2.x)},${fmt(c2.y)} ${fmt(b.x)},${fmt(b.y)}`,
      pts,
      label: cubic(a, c1, c2, b, 0.5),
      start: a,
      end: b,
      startDir: unit({ x: c1.x - a.x, y: c1.y - a.y }),
      endDir: unit({ x: b.x - c2.x, y: b.y - c2.y })
    };
  }
  const pts = c.route === "elbow" ? elbowPoints(a, s.normal, b, e.normal) : [a, b];
  const last = pts[pts.length - 1]!, prev = pts[pts.length - 2]!;
  return {
    d: pts.map((p, i) => `${i ? "L" : "M"}${fmt(p.x)},${fmt(p.y)}`).join(" "),
    pts,
    label: midpointAlong(pts),
    start: a,
    end: b,
    startDir: unit({ x: pts[1]!.x - a.x, y: pts[1]!.y - a.y }),
    endDir: unit({ x: last.x - prev.x, y: last.y - prev.y })
  };
}

/** Point halfway along a polyline. */
export function midpointAlong(pts: Pt[]): Pt {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (half <= l) return { x: a.x + ((b.x - a.x) * half) / (l || 1), y: a.y + ((b.y - a.y) * half) / (l || 1) };
    half -= l;
  }
  return pts[0] ?? { x: 0, y: 0 };
}

/** Arrowhead polygon at `tip` pointing along `dir`. */
export function arrowHead(tip: Pt, dir: Pt, size: number): string {
  const back = { x: tip.x - dir.x * size, y: tip.y - dir.y * size };
  const perp = { x: -dir.y * size * 0.5, y: dir.x * size * 0.5 };
  return `${fmt(tip.x)},${fmt(tip.y)} ${fmt(back.x + perp.x)},${fmt(back.y + perp.y)} ${fmt(back.x - perp.x)},${fmt(back.y - perp.y)}`;
}

/** Connectors attached to any of these object ids (they re-route when the objects move). */
export function connectorsTouching(state: BoardState, ids: Set<string>): ConnectorObj[] {
  return Object.values(state.objects).filter((o): o is ConnectorObj => o.kind === "connector" && (("id" in o.from && ids.has(o.from.id)) || ("id" in o.to && ids.has(o.to.id))));
}
