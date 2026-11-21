import { describe, expect, it } from "vitest";
import { applyOp, emptyBoard } from "./reduce";
import { anchorPoint, facingAnchor, nearestAnchor, routeConnector, elbowPoints, connectorsTouching } from "./connectors";
import { recogniseShape } from "./recognize";
import { alignItems, distribute, smartSnap, snapToGrid, tidyUp } from "./arrange";
import { diagramToObjects, layers, layoutDiagram, parseDiagram, toMermaid } from "./diagram";
import { strokeOutline } from "./freehand";
import { buildPdf } from "./pdf";
import type { ConnectorObj, ShapeObj } from "./types";

const shape = (id: string, x: number, y: number, w = 100, h = 50): ShapeObj => ({ id, kind: "shape", shape: "process", z: 1, x, y, w, h, text: id, fill: "primary-soft" });
const conn = (from: ConnectorObj["from"], to: ConnectorObj["to"], route: ConnectorObj["route"] = "straight"): ConnectorObj => ({ id: "c", kind: "connector", z: 2, from, to, route, startCap: "none", endCap: "arrow", weight: 1.5, dash: false, colour: "#434656", label: "" });

function board(...objs: (ShapeObj | ConnectorObj)[]) {
  return objs.reduce((s, o) => applyOp(s, { kind: "add", payload: { obj: o } }), emptyBoard());
}

describe("anchors", () => {
  const r = { x: 0, y: 0, w: 100, h: 50 };
  it("sit at edge midpoints", () => {
    expect(anchorPoint(r, "n")).toEqual({ x: 50, y: 0 });
    expect(anchorPoint(r, "e")).toEqual({ x: 100, y: 25 });
    expect(anchorPoint(r, "s")).toEqual({ x: 50, y: 50 });
    expect(anchorPoint(r, "w")).toEqual({ x: 0, y: 25 });
  });
  it("pick the nearest and the facing anchor", () => {
    expect(nearestAnchor(r, { x: 95, y: 30 })).toBe("e");
    expect(facingAnchor(r, { x: 50, y: 300 })).toBe("s");
    expect(facingAnchor(r, { x: -300, y: 20 })).toBe("w");
  });
});

describe("connector routing", () => {
  it("draws straight lines between anchors and re-routes when a shape moves", () => {
    let s = board(shape("a", 0, 0), shape("b", 300, 0), conn({ id: "a", anchor: "e" }, { id: "b", anchor: "w" }));
    const r1 = routeConnector(s, s.objects.c as ConnectorObj)!;
    expect(r1.start).toEqual({ x: 100, y: 25 });
    expect(r1.end).toEqual({ x: 300, y: 25 });
    s = applyOp(s, { kind: "update", payload: { id: "b", patch: { y: 200 } } });
    const r2 = routeConnector(s, s.objects.c as ConnectorObj)!;
    expect(r2.end).toEqual({ x: 300, y: 225 });
    expect(connectorsTouching(s, new Set(["b"])).map((c) => c.id)).toEqual(["c"]);
  });
  it("routes elbows with at most two bends, leaving along the normals", () => {
    const pts = elbowPoints({ x: 100, y: 25 }, { x: 1, y: 0 }, { x: 300, y: 225 }, { x: -1, y: 0 });
    expect(pts.length).toBeLessThanOrEqual(4);
    expect(pts[1]!.y).toBe(25); // leaves horizontally
    expect(pts[2]!.y).toBe(225);
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.x === pts[i - 1]!.x || pts[i]!.y === pts[i - 1]!.y).toBe(true);
    const one = elbowPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 100, y: 100 }, { x: 0, y: -1 });
    expect(one.length).toBe(3);
  });
  it("routes curves as cubic Béziers with 0.4 × distance controls", () => {
    const s = board(shape("a", 0, 0), shape("b", 300, 0), conn({ id: "a", anchor: "e" }, { id: "b", anchor: "w" }, "curved"));
    const r = routeConnector(s, s.objects.c as ConnectorObj)!;
    expect(r.d).toBe("M100,25 C180,25 220,25 300,25");
  });
  it("supports floating ends and ignores missing shapes", () => {
    const s = board(conn({ x: 0, y: 0 }, { x: 10, y: 10 }));
    expect(routeConnector(s, s.objects.c as ConnectorObj)?.end).toEqual({ x: 10, y: 10 });
    const gone = board(conn({ id: "nope", anchor: "n" }, { x: 1, y: 1 }));
    expect(routeConnector(gone, gone.objects.c as ConnectorObj)).toBeNull();
  });
});

describe("shape recognition", () => {
  const trace = (fn: (t: number) => [number, number], n = 60) => Array.from({ length: n + 1 }, (_, i) => fn(i / n)).flat();
  it("recognises a rough rectangle", () => {
    const pts = trace((t) => {
      const p = t * 4;
      const jitter = Math.sin(t * 50) * 2;
      if (p < 1) return [p * 200, jitter];
      if (p < 2) return [200 + jitter, (p - 1) * 100];
      if (p < 3) return [200 - (p - 2) * 200, 100 + jitter];
      return [jitter, 100 - (p - 3) * 100];
    });
    expect(recogniseShape(pts)?.kind).toBe("process");
  });
  it("recognises an ellipse and a diamond", () => {
    expect(recogniseShape(trace((t) => [100 + 90 * Math.cos(t * 2 * Math.PI), 60 + 50 * Math.sin(t * 2 * Math.PI)]))?.kind).toBe("ellipse");
    const diamond = trace((t) => {
      const p = t * 4;
      const k = p % 1;
      const corners = [[100, 0], [200, 60], [100, 120], [0, 60], [100, 0]];
      const a = corners[Math.floor(p)] ?? corners[3]!, b = corners[Math.floor(p) + 1] ?? corners[4]!;
      return [a[0]! + (b[0]! - a[0]!) * k, a[1]! + (b[1]! - a[1]!) * k];
    });
    expect(recogniseShape(diamond)?.kind).toBe("decision");
  });
  it("leaves open scribbles alone", () => {
    expect(recogniseShape(trace((t) => [t * 300, Math.sin(t * 10) * 40]))).toBeNull();
  });
});

describe("arrange", () => {
  it("snaps to grid and to other objects' edges", () => {
    expect(snapToGrid(13)).toBe(16);
    const r = smartSnap({ x: 103, y: 50, w: 50, h: 50 }, [{ x: 100, y: 300, w: 80, h: 40 }]);
    expect(r.dx).toBe(-3);
    expect(r.guides).toContainEqual({ axis: "x", at: 100 });
  });
  it("tidies a messy selection into a grid with even gaps", () => {
    const out = tidyUp([
      { id: "a", x: 0, y: 0, w: 100, h: 50 },
      { id: "b", x: 230, y: 12, w: 100, h: 50 },
      { id: "c", x: 10, y: 140, w: 100, h: 50 }
    ], 40);
    expect(out.a).toEqual({ x: 0, y: 0 });
    expect(out.b).toEqual({ x: 140, y: 0 });
    expect(out.c).toEqual({ x: 0, y: 90 });
  });
  it("aligns and distributes", () => {
    const items = [{ id: "a", x: 0, y: 0, w: 10, h: 10 }, { id: "b", x: 50, y: 30, w: 10, h: 10 }, { id: "c", x: 200, y: 5, w: 10, h: 10 }];
    expect(alignItems(items, "top").b).toEqual({ x: 50, y: 0 });
    expect(distribute(items, "x").b!.x).toBe(100);
  });
});

describe("diagram as code", () => {
  const code = `New lead > Qualified?
Qualified? > Book a call: yes
Qualified? > Nurture list: no
Book a call > Send proposal > Won
Nurture list > New lead: 30 days`;
  it("parses nodes, edges and labels", () => {
    const p = parseDiagram(code);
    expect(p.type).toBe("flowchart");
    expect(p.nodes.map((n) => n.label)).toEqual(["New lead", "Qualified?", "Book a call", "Nurture list", "Send proposal", "Won"]);
    expect(p.edges.find((e) => e.to === "book a call")?.label).toBe("yes");
    expect(p.edges.filter((e) => e.from === "book a call" || e.from === "send proposal").length).toBe(2);
    expect(p.errors).toEqual([]);
  });
  it("layers top-down and breaks cycles", () => {
    const p = parseDiagram(code);
    const l = layers(p.nodes.map((n) => n.id), p.edges);
    expect(l.get("new lead")).toBe(0);
    expect(l.get("qualified?")).toBe(1);
    expect(l.get("won")).toBe(4);
    const lay = layoutDiagram(p);
    const q = lay.nodes.find((n) => n.id === "qualified?")!;
    expect(q.shape).toBe("decision");
    expect(lay.nodes.find((n) => n.id === "won")!.shape).toBe("terminal");
    expect(lay.edges.find((e) => e.to === "new lead")!.route).toBe("curved"); // the loop back
  });
  it("reads a Mermaid subset", () => {
    const p = parseDiagram("graph TD\nA[Start] --> B{Ok?}\nB -->|yes| C((Done))\nB -- no --> D[(Store)]");
    expect(p.nodes.map((n) => [n.label, n.shape])).toEqual([["Start", "process"], ["Ok?", "decision"], ["Done", "ellipse"], ["Store", "database"]]);
    expect(p.edges.map((e) => e.label)).toEqual(["", "yes", "no"]);
    expect(toMermaid(p)).toContain("-->|yes|");
  });
  it("lays out sequence, ERD and swimlane diagrams", () => {
    const seq = layoutDiagram(parseDiagram("sequence\nClient > Server: request\nServer > DB: query\nDB > Server: rows"));
    expect(seq.nodes.length).toBe(3);
    expect(seq.edges.filter((e) => e.dash).length).toBe(3); // lifelines
    const erd = parseDiagram("erd\nusers: id, name\norders: id, user_id, total\nusers.id < orders.user_id");
    expect(erd.nodes.find((n) => n.id === "orders")!.label).toBe("orders\nid\nuser_id\ntotal");
    expect(erd.edges[0]).toMatchObject({ from: "users", to: "orders" });
    const swim = layoutDiagram(parseDiagram("swimlane\nSales: Lead > Qualify\nOps: Qualify > Ship"));
    expect(swim.lanes.map((l) => l.title)).toEqual(["Sales", "Ops"]);
    expect(swim.nodes.find((n) => n.id === "ship")!.y).toBeGreaterThan(swim.nodes.find((n) => n.id === "lead")!.y);
  });
  it("detaches to freeform board objects", () => {
    const lay = layoutDiagram(parseDiagram("A > B: go"));
    let k = 0;
    const objs = diagramToObjects(lay, { x: 1000, y: 0 }, { z: 10, newId: (p) => `${p}${++k}` });
    expect(objs.filter((o) => o.kind === "shape").length).toBe(2);
    const c = objs.find((o) => o.kind === "connector") as ConnectorObj;
    expect(c.label).toBe("go");
    expect("id" in c.from && "id" in c.to).toBe(true);
  });
  it("reports lines it can't read", () => {
    expect(parseDiagram("erd\nthis is not a table").errors.length).toBe(1);
  });
});

describe("freehand + pdf", () => {
  it("outlines a stroke with perfect-freehand", () => {
    const d = strokeOutline({ points: [0, 0, 10, 5, 20, 0, 30, 10], size: 4, smoothing: 0.6 });
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
  });
  it("writes a valid-looking PDF with one page per image", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = new TextDecoder("latin1").decode(buildPdf([{ jpeg, width: 1200, height: 750 }, { jpeg, width: 600, height: 900 }]));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf).toContain("/Count 2");
    expect(pdf).toContain("/Filter /DCTDecode");
    expect(pdf.trim().endsWith("%%EOF")).toBe(true);
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
  });
});
