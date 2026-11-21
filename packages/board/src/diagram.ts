/**
 * Diagram as code (Figma "Board feature map · From Eraser"): type `A > B: label`, get shapes + connectors
 * laid out automatically. The code stays the source of truth until "Detach to freeform".
 *
 *   flowchart (default)   New lead > Qualified?          Qualified? > Book a call: yes
 *                         Mermaid subset: A[Text] --> B{Decision}   A -->|yes| B   A((x))   A[(db)]
 *   sequence              Client > Server: request
 *   erd                   users: id, name, email         users.id < orders.user_id   (one to many)
 *   swimlane              Sales: Lead > Qualify          Ops: Qualify > Ship
 */
import type { BoardObj, ConnectorObj, SectionObj, ShapeFill, ShapeKind, ShapeObj } from "./types";

export type DiagramType = "flowchart" | "sequence" | "erd" | "swimlane";

export interface DNode {
  id: string;
  label: string;
  shape?: ShapeKind;
  lane?: string;
}
export interface DEdge {
  from: string;
  to: string;
  label: string;
}
export interface ParsedDiagram {
  type: DiagramType;
  nodes: DNode[];
  edges: DEdge[];
  lanes: string[];
  errors: { line: number; message: string }[];
}

export interface LaidNode extends DNode {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: ShapeKind;
  fill: ShapeFill;
}
export interface LaidEdge extends DEdge {
  route: "straight" | "elbow" | "curved";
  /** For sequence messages / lifelines: absolute points instead of shape anchors. */
  points?: { x1: number; y1: number; x2: number; y2: number };
  dash?: boolean;
  endCap?: "arrow" | "none";
}
export interface Layout {
  type: DiagramType;
  nodes: LaidNode[];
  edges: LaidEdge[];
  lanes: { title: string; x: number; y: number; w: number; h: number }[];
  width: number;
  height: number;
  errors: ParsedDiagram["errors"];
}

const idOf = (label: string) => label.trim().toLowerCase().replace(/\s+/g, " ");

/** Mermaid node syntax: id[Text] id(Text) id{Text} id((Text)) id[(Text)] id>Text] → label + shape. */
function parseNodeToken(tok: string): { id: string; label: string; shape?: ShapeKind } {
  const t = tok.trim();
  const m = t.match(/^([A-Za-z0-9_-]+)\s*(\(\(|\[\(|\[|\(|\{|>)(.*?)(\)\)|\)\]|\]|\)|\})$/);
  if (!m) return { id: idOf(t), label: t };
  const [, id, open, text] = m;
  const shape: ShapeKind = open === "((" ? "ellipse" : open === "[(" ? "database" : open === "{" ? "decision" : open === "(" ? "rounded" : open === ">" ? "document" : "process";
  return { id: idOf(id!), label: (text ?? "").trim() || id!, shape };
}

export function parseDiagram(code: string): ParsedDiagram {
  const lines = code.split("\n");
  let type = "flowchart" as DiagramType;
  const nodes = new Map<string, DNode>();
  const edges: DEdge[] = [];
  const lanes: string[] = [];
  const errors: ParsedDiagram["errors"] = [];
  const tables = new Map<string, string[]>();
  const node = (label: string, extra: Partial<DNode> = {}) => {
    const parsed = type === "flowchart" ? parseNodeToken(label) : { id: idOf(label), label: label.trim() };
    const cur = nodes.get(parsed.id);
    const shape = extra.shape ?? ("shape" in parsed ? parsed.shape : undefined) ?? cur?.shape;
    // A bare reference ("B") reuses an earlier declaration ("B{Ok?}") instead of overwriting its label.
    const bare = !("shape" in parsed) || parsed.shape === undefined;
    const next: DNode = { id: parsed.id, label: cur && bare ? cur.label : parsed.label, ...(shape ? { shape } : {}), ...(extra.lane ?? cur?.lane ? { lane: extra.lane ?? cur?.lane } : {}) };
    nodes.set(parsed.id, next);
    return parsed.id;
  };

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$|^\s*%%.*$/, "").trim();
    if (!line) return;
    const head = line.toLowerCase();
    if (i === lines.findIndex((l) => l.trim()) && /^(flowchart|graph|sequence|sequencediagram|erd|erdiagram|swimlane)\b/.test(head)) {
      type = head.startsWith("seq") ? "sequence" : head.startsWith("erd") || head.startsWith("erdiagram") ? "erd" : head.startsWith("swim") ? "swimlane" : "flowchart";
      return;
    }
    if (type === "erd") {
      const rel = line.match(/^([\w]+)\.([\w]+)\s*([<>-])\s*([\w]+)\.([\w]+)$/);
      if (rel) {
        const [, t1, c1, op, t2, c2] = rel;
        const [one, many] = op === ">" ? [t2!, t1!] : [t1!, t2!];
        node(one);
        node(many);
        edges.push({ from: idOf(one), to: idOf(many), label: op === "-" ? `${c1} — ${c2}` : `1 → n (${op === ">" ? c2 : c1} → ${op === ">" ? c1 : c2})` });
        return;
      }
      const tab = line.match(/^([\w]+)\s*:\s*(.+)$/);
      if (tab) {
        const cols = tab[2]!.split(",").map((c) => c.trim()).filter(Boolean);
        tables.set(idOf(tab[1]!), cols);
        node(tab[1]!, { shape: "process" });
        return;
      }
      errors.push({ line: i + 1, message: "Use `table: col, col` or `a.col < b.col`" });
      return;
    }
    let lane: string | undefined;
    let body = line;
    if (type === "swimlane") {
      const lm = line.match(/^([^:>]+):\s*(.+)$/);
      if (lm && /(>|-->)/.test(lm[2]!)) {
        lane = lm[1]!.trim();
        body = lm[2]!;
        if (!lanes.includes(lane)) lanes.push(lane);
      }
    }
    // Edge label forms: "A > B: label", "A -->|label| B", "A -- label --> B".
    let label = "";
    const pipe = body.match(/-->\s*\|([^|]*)\|/);
    if (pipe) {
      label = pipe[1]!.trim();
      body = body.replace(pipe[0], "-->");
    }
    const mid = body.match(/--\s+([^-][^>]*?)\s+-->/);
    if (mid) {
      label = mid[1]!.trim();
      body = body.replace(mid[0], "-->");
    }
    const parts = body.split(/\s*(?:-->|->|>)\s*/);
    if (parts.length < 2) {
      if (type === "flowchart" && body.trim()) node(body);
      else errors.push({ line: i + 1, message: "Write `A > B` or `A > B: label`" });
      return;
    }
    const lastPart = parts[parts.length - 1]!;
    const lm2 = lastPart.match(/^(.*?):\s*(.*)$/);
    if (lm2 && !label) {
      parts[parts.length - 1] = lm2[1]!;
      label = lm2[2]!.trim();
    }
    const ids = parts.map((p) => node(p, lane ? { lane } : {}));
    for (let k = 1; k < ids.length; k++) edges.push({ from: ids[k - 1]!, to: ids[k]!, label: k === ids.length - 1 ? label : "" });
  });

  if (type === "erd") for (const [id, cols] of tables) {
    const n = nodes.get(id);
    if (n) n.label = `${n.label}\n${cols.join("\n")}`;
  }
  return { type, nodes: [...nodes.values()], edges, lanes, errors };
}

const FILL: Partial<Record<ShapeKind, ShapeFill>> = { terminal: "mint", decision: "peach", process: "primary-soft", rounded: "card", database: "lilac", document: "sticky-yellow", ellipse: "card", io: "muted" };

function sizeOf(label: string, shape: ShapeKind): { w: number; h: number } {
  const lines = label.split("\n");
  const longest = Math.max(...lines.map((l) => l.length));
  const w = Math.min(260, Math.max(shape === "decision" ? 160 : 140, longest * 7.5 + 40));
  const h = shape === "decision" ? 96 : Math.max(52, lines.length * 20 + 24);
  return { w: Math.round(w), h: Math.round(h) };
}

/** Longest-path layering with cycle breaking, then barycentre ordering (Sugiyama-lite). */
export function layers(nodeIds: string[], edges: DEdge[]): Map<string, number> {
  const out = new Map<string, string[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) out.get(e.from)?.push(e.to);
  // Break cycles: DFS, ignore back edges.
  const state = new Map<string, 0 | 1 | 2>();
  const keep = new Set<string>();
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u) ?? []) {
      if (state.get(v) === 1) continue; // back edge
      keep.add(`${u}>${v}`);
      if (!state.get(v)) visit(v);
    }
    state.set(u, 2);
  };
  for (const id of nodeIds) if (!state.get(id)) visit(id);
  const layer = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (let pass = 0; pass < nodeIds.length; pass++) {
    let changed = false;
    for (const e of edges) {
      if (!keep.has(`${e.from}>${e.to}`)) continue;
      const want = (layer.get(e.from) ?? 0) + 1;
      if ((layer.get(e.to) ?? 0) < want) {
        layer.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return layer;
}

export function layoutDiagram(p: ParsedDiagram): Layout {
  if (p.type === "sequence") return layoutSequence(p);
  const GAP_X = 56, GAP_Y = 64;
  const indeg = new Map(p.nodes.map((n) => [n.id, 0]));
  const outdeg = new Map(p.nodes.map((n) => [n.id, 0]));
  for (const e of p.edges) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    outdeg.set(e.from, (outdeg.get(e.from) ?? 0) + 1);
  }
  const shapeFor = (n: DNode): ShapeKind => {
    if (n.shape) return n.shape;
    if (p.type === "erd") return "process";
    if (n.label.trim().endsWith("?")) return "decision";
    if ((indeg.get(n.id) ?? 0) === 0 || (outdeg.get(n.id) ?? 0) === 0) return "terminal";
    return "process";
  };
  const layer = layers(p.nodes.map((n) => n.id), p.edges);
  const byLayer: string[][] = [];
  for (const n of p.nodes) (byLayer[layer.get(n.id)!] ??= []).push(n.id);
  // Barycentre ordering, a few sweeps.
  const pos = new Map<string, number>();
  byLayer.forEach((ids) => ids.forEach((id, i) => pos.set(id, i)));
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let l = 1; l < byLayer.length; l++) {
      const ids = byLayer[l] ?? [];
      const bary = (id: string) => {
        const preds = p.edges.filter((e) => e.to === id && layer.get(e.from) === l - 1).map((e) => pos.get(e.from) ?? 0);
        return preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : (pos.get(id) ?? 0);
      };
      ids.sort((a, b) => bary(a) - bary(b));
      ids.forEach((id, i) => pos.set(id, i));
    }
  }
  const sizes = new Map(p.nodes.map((n) => [n.id, sizeOf(n.label, shapeFor(n))]));
  const swim = p.type === "swimlane" && p.lanes.length > 0;
  const nodes: LaidNode[] = [];
  const lanes: Layout["lanes"] = [];
  if (swim) {
    // Lanes are rows; layers run left to right.
    const LANE_H = 150, LABEL_W = 120;
    const colX: number[] = [];
    let x = LABEL_W + 24;
    for (let l = 0; l < byLayer.length; l++) {
      colX[l] = x;
      x += Math.max(...(byLayer[l] ?? []).map((id) => sizes.get(id)!.w)) + GAP_X;
    }
    const laneOf = (n: DNode) => Math.max(0, p.lanes.indexOf(n.lane ?? p.lanes[0]!));
    for (const n of p.nodes) {
      const s = sizes.get(n.id)!;
      const shape = shapeFor(n);
      nodes.push({ ...n, shape, fill: FILL[shape] ?? "card", w: s.w, h: s.h, x: colX[layer.get(n.id)!]!, y: laneOf(n) * LANE_H + (LANE_H - s.h) / 2 });
    }
    p.lanes.forEach((title, i) => lanes.push({ title, x: 0, y: i * LANE_H, w: x, h: LANE_H }));
    return { type: p.type, nodes, edges: p.edges.map((e) => ({ ...e, route: "elbow" })), lanes, width: x, height: p.lanes.length * LANE_H, errors: p.errors };
  }
  // Top-down.
  let y = 0;
  let width = 0;
  const rowWidths = byLayer.map((ids) => ids.reduce((w, id) => w + sizes.get(id)!.w, 0) + GAP_X * Math.max(0, ids.length - 1));
  const maxW = Math.max(0, ...rowWidths);
  byLayer.forEach((ids, l) => {
    const rowH = Math.max(...ids.map((id) => sizes.get(id)!.h));
    let x = (maxW - rowWidths[l]!) / 2;
    for (const id of ids) {
      const n = p.nodes.find((q) => q.id === id)!;
      const s = sizes.get(id)!;
      const shape = shapeFor(n);
      nodes.push({ ...n, shape, fill: FILL[shape] ?? "card", w: s.w, h: s.h, x: Math.round(x), y: Math.round(y + (rowH - s.h) / 2) });
      x += s.w + GAP_X;
    }
    width = Math.max(width, x - GAP_X);
    y += rowH + GAP_Y;
  });
  const edges: LaidEdge[] = p.edges.map((e) => ({ ...e, route: (layer.get(e.to) ?? 0) <= (layer.get(e.from) ?? 0) ? "curved" : "elbow" }));
  return { type: p.type, nodes, edges, lanes, width: Math.max(width, maxW), height: Math.max(0, y - GAP_Y), errors: p.errors };
}

function layoutSequence(p: ParsedDiagram): Layout {
  const COL = 200, TOP = 56, STEP = 56;
  const nodes: LaidNode[] = p.nodes.map((n, i) => ({ ...n, shape: "process", fill: "primary-soft", x: i * COL, y: 0, w: 150, h: TOP }));
  const centre = new Map(nodes.map((n) => [n.id, n.x + n.w / 2]));
  const height = TOP + 32 + p.edges.length * STEP;
  const edges: LaidEdge[] = [];
  for (const n of nodes) edges.push({ from: n.id, to: n.id, label: "", route: "straight", dash: true, endCap: "none", points: { x1: centre.get(n.id)!, y1: TOP, x2: centre.get(n.id)!, y2: height } });
  p.edges.forEach((e, i) => {
    const yy = TOP + 32 + i * STEP;
    edges.push({ ...e, route: "straight", endCap: "arrow", points: { x1: centre.get(e.from)!, y1: yy, x2: centre.get(e.to)!, y2: yy } });
  });
  return { type: "sequence", nodes, edges, lanes: [], width: Math.max(0, (nodes.length - 1) * COL + 150), height, errors: p.errors };
}

/** "Detach to freeform": turn a laid-out diagram into ordinary board objects at an origin. */
export function diagramToObjects(layout: Layout, origin: { x: number; y: number }, opts: { z: number; by?: string; newId: (prefix: string) => string }): BoardObj[] {
  let z = opts.z;
  const out: BoardObj[] = [];
  const ids = new Map<string, string>();
  for (const lane of layout.lanes) {
    const s: SectionObj = { id: opts.newId("se"), kind: "section", z: z++, x: origin.x + lane.x, y: origin.y + lane.y, w: lane.w, h: lane.h, title: lane.title, ...(opts.by ? { by: opts.by } : {}) };
    out.push(s);
  }
  for (const n of layout.nodes) {
    const id = opts.newId("sh");
    ids.set(n.id, id);
    const s: ShapeObj = { id, kind: "shape", shape: n.shape, z: z++, x: origin.x + n.x, y: origin.y + n.y, w: n.w, h: n.h, text: n.label, fill: n.fill, ...(opts.by ? { by: opts.by } : {}) };
    out.push(s);
  }
  for (const e of layout.edges) {
    const base = { id: opts.newId("cn"), kind: "connector" as const, z: z++, route: e.route, startCap: "none" as const, endCap: e.endCap ?? ("arrow" as const), weight: 1.5, dash: Boolean(e.dash), colour: "#434656", label: e.label, ...(opts.by ? { by: opts.by } : {}) };
    let c: ConnectorObj;
    if (e.points) {
      c = { ...base, from: { x: origin.x + e.points.x1, y: origin.y + e.points.y1 }, to: { x: origin.x + e.points.x2, y: origin.y + e.points.y2 } };
    } else {
      const a = layout.nodes.find((n) => n.id === e.from)!, b = layout.nodes.find((n) => n.id === e.to)!;
      const down = b.y > a.y + a.h / 2;
      const right = b.x > a.x + a.w;
      const fromAnchor = layout.type === "swimlane" ? (Math.abs(b.y - a.y) < 1 ? "e" : down ? "s" : "n") : down ? "s" : right ? "e" : "w";
      const toAnchor = layout.type === "swimlane" ? (Math.abs(b.y - a.y) < 1 ? "w" : down ? "n" : "s") : down ? "n" : right ? "w" : "e";
      c = { ...base, from: { id: ids.get(e.from)!, anchor: fromAnchor }, to: { id: ids.get(e.to)!, anchor: toAnchor } };
    }
    out.push(c);
  }
  return out;
}

/** Copy as Mermaid (flowchart only). */
export function toMermaid(p: ParsedDiagram): string {
  const name = new Map(p.nodes.map((n, i) => [n.id, `n${i + 1}`]));
  const decl = p.nodes.map((n) => {
    const id = name.get(n.id)!;
    const t = n.label.replace(/"/g, "'");
    return n.shape === "decision" || n.label.endsWith("?") ? `  ${id}{"${t}"}` : `  ${id}["${t}"]`;
  });
  const links = p.edges.map((e) => `  ${name.get(e.from)} -->${e.label ? `|${e.label}|` : ""} ${name.get(e.to)}`);
  return ["flowchart TD", ...decl, ...links].join("\n");
}
