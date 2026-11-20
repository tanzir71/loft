import { describe, expect, it } from "vitest";
import { applyOp, applyOps, emptyBoard, inverseOf, nextZ, pageAt, sortedObjects } from "./reduce";
import { bounds, fitRect, screenToWorld, strokeHit, worldToScreen, zoomAt } from "./geometry";
import { quantise, simplify, tracePath } from "./smooth";
import { UndoStack } from "./undo";
import type { BoardOp, StickyObj, StrokeObj } from "./types";

const sticky = (id: string, z = 1): StickyObj => ({ id, kind: "sticky", z, x: 10, y: 10, w: 160, h: 120, text: "hi", colour: "yellow" });
const stroke = (id: string, points: number[], size = 4): StrokeObj => ({ id, kind: "stroke", z: 1, points, colour: "#213a8c", size });

describe("op-log reducer", () => {
  it("starts with one page", () => {
    const s = emptyBoard();
    expect(Object.keys(s.pages)).toEqual(["p1"]);
    expect(s.seq).toBe(0);
  });

  it("adds, updates (LWW per field) and removes objects", () => {
    let s = emptyBoard();
    s = applyOp(s, { kind: "add", payload: { obj: sticky("a") } });
    s = applyOp(s, { kind: "update", payload: { id: "a", patch: { text: "one" } } });
    s = applyOp(s, { kind: "update", payload: { id: "a", patch: { x: 50 } } });
    s = applyOp(s, { kind: "update", payload: { id: "a", patch: { text: "two" } } });
    expect(s.objects.a).toMatchObject({ text: "two", x: 50, kind: "sticky" });
    s = applyOp(s, { kind: "remove", payload: { id: "a" } });
    expect(s.objects.a).toBeUndefined();
  });

  it("ignores updates to objects someone else removed", () => {
    const s = applyOp(emptyBoard(), { kind: "update", payload: { id: "ghost", patch: { x: 1 } } });
    expect(s.objects).toEqual({});
  });

  it("never lets an update change an object's kind", () => {
    let s = applyOp(emptyBoard(), { kind: "add", payload: { obj: sticky("a") } });
    s = applyOp(s, { kind: "update", payload: { id: "a", patch: { kind: "text" } } });
    expect(s.objects.a?.kind).toBe("sticky");
  });

  it("applies op-log entries once, in seq order", () => {
    const log = [
      { seq: 1, kind: "add", payload: { obj: sticky("a") } },
      { seq: 2, kind: "update", payload: { id: "a", patch: { text: "x" } } }
    ];
    const s1 = applyOps(emptyBoard(), log);
    const s2 = applyOps(s1, log); // replayed: ignored
    expect(s2.seq).toBe(2);
    expect(s2.objects.a).toMatchObject({ text: "x" });
  });

  it("handles pages and keeps at least one", () => {
    let s = applyOp(emptyBoard(), { kind: "add", payload: { page: pageAt(1) } });
    expect(Object.keys(s.pages).sort()).toEqual(["p1", "p2"]);
    s = applyOp(s, { kind: "remove", payload: { id: "p2", target: "page" } });
    s = applyOp(s, { kind: "remove", payload: { id: "p1", target: "page" } });
    expect(Object.keys(s.pages)).toEqual(["p1"]);
  });

  it("orders objects by z", () => {
    let s = emptyBoard();
    s = applyOp(s, { kind: "add", payload: { obj: sticky("b", 2) } });
    s = applyOp(s, { kind: "add", payload: { obj: sticky("a", 1) } });
    expect(sortedObjects(s).map((o) => o.id)).toEqual(["a", "b"]);
    expect(nextZ(s)).toBe(3);
  });

  it("computes inverses for undo, including batches", () => {
    let s = applyOp(emptyBoard(), { kind: "add", payload: { obj: sticky("a") } });
    const op: BoardOp = { kind: "batch", payload: { ops: [{ kind: "update", payload: { id: "a", patch: { text: "new" } } }, { kind: "add", payload: { obj: sticky("b") } }] } };
    const inv = inverseOf(s, op)!;
    const after = applyOp(s, op);
    const back = applyOp(after, inv);
    expect(back.objects).toEqual(s.objects);
    s = after;
    expect(s.objects.b).toBeDefined();
  });
});

describe("undo stack", () => {
  it("undoes and redoes only your own ops", () => {
    const u = new UndoStack();
    let s = emptyBoard();
    const add: BoardOp = { kind: "add", payload: { obj: sticky("a") } };
    u.record(s, add);
    s = applyOp(s, add);
    const undo = u.undo(s)!;
    s = applyOp(s, undo);
    expect(s.objects.a).toBeUndefined();
    const redo = u.redo(s)!;
    s = applyOp(s, redo);
    expect(s.objects.a).toBeDefined();
    expect(u.canRedo).toBe(false);
  });
});

describe("geometry", () => {
  it("round-trips screen and world coordinates", () => {
    const v = { x: 100, y: 50, scale: 2 };
    const w = screenToWorld(v, { x: 300, y: 250 });
    expect(w).toEqual({ x: 100, y: 100 });
    expect(worldToScreen(v, w)).toEqual({ x: 300, y: 250 });
  });

  it("zooms around the pointer and clamps", () => {
    const v = { x: 0, y: 0, scale: 1 };
    const z = zoomAt(v, { x: 200, y: 100 }, 2);
    expect(z.scale).toBe(2);
    expect(screenToWorld(z, { x: 200, y: 100 })).toEqual(screenToWorld(v, { x: 200, y: 100 }));
    expect(zoomAt(v, { x: 0, y: 0 }, 1000).scale).toBe(8);
    expect(zoomAt(v, { x: 0, y: 0 }, 0.0001).scale).toBe(0.1);
  });

  it("fits a page on screen", () => {
    const v = fitRect({ x: 0, y: 0, w: 1200, h: 750 }, { w: 1440, h: 900 }, 48);
    expect(v.scale).toBeCloseTo(Math.min(1344 / 1200, 804 / 750));
  });

  it("hit-tests strokes for the eraser", () => {
    const s = stroke("s", [0, 0, 100, 0], 4);
    expect(strokeHit(s, { x: 50, y: 3 }, 2)).toBe(true);
    expect(strokeHit(s, { x: 50, y: 20 }, 2)).toBe(false);
    expect(strokeHit(stroke("dot", [10, 10]), { x: 11, y: 11 }, 2)).toBe(true);
  });

  it("measures bounds", () => {
    expect(bounds(stroke("s", [0, 0, 10, 20], 4))).toEqual({ x: -2, y: -2, w: 14, h: 24 });
    expect(bounds(sticky("a"))).toEqual({ x: 10, y: 10, w: 160, h: 120 });
  });
});

describe("stroke smoothing", () => {
  it("simplifies collinear points away", () => {
    const pts = [0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 4, 4];
    expect(simplify(pts, 0.5)).toEqual([0, 0, 4, 0, 4, 4]);
  });
  it("quantises to 0.1", () => {
    expect(quantise([1.234, 5.678])).toEqual([1.2, 5.7]);
  });
  it("traces a smooth path", () => {
    const calls: string[] = [];
    const ctx = { moveTo: () => calls.push("M"), lineTo: () => calls.push("L"), quadraticCurveTo: () => calls.push("Q") };
    tracePath(ctx, [0, 0, 10, 10, 20, 0, 30, 10]);
    expect(calls[0]).toBe("M");
    expect(calls).toContain("Q");
    expect(calls[calls.length - 1]).toBe("L");
  });
});
