/** v1 stroke helpers. M4 swaps rendering to perfect-freehand. */

/** Ramer–Douglas–Peucker simplification on a flat point list. */
export function simplify(points: number[], tolerance = 0.75): number[] {
  if (points.length <= 4) return points.slice();
  const keep = new Uint8Array(points.length / 2);
  keep[0] = 1;
  keep[keep.length - 1] = 1;
  const stack: [number, number][] = [[0, keep.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = points[a * 2]!, ay = points[a * 2 + 1]!, bx = points[b * 2]!, by = points[b * 2 + 1]!;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = points[i * 2]!, py = points[i * 2 + 1]!;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < keep.length; i++) if (keep[i]) out.push(points[i * 2]!, points[i * 2 + 1]!);
  return out;
}

/** Round to 0.1 world units to keep op payloads small. */
export function quantise(points: number[]): number[] {
  return points.map((v) => Math.round(v * 10) / 10);
}

/** Trace a smooth path through the points (quadratic curves via midpoints) on a 2D context. */
export function tracePath(ctx: Pick<CanvasRenderingContext2D, "moveTo" | "lineTo" | "quadraticCurveTo">, p: number[]): void {
  if (p.length < 2) return;
  ctx.moveTo(p[0]!, p[1]!);
  if (p.length === 2) {
    ctx.lineTo(p[0]! + 0.01, p[1]!);
    return;
  }
  if (p.length === 4) {
    ctx.lineTo(p[2]!, p[3]!);
    return;
  }
  for (let i = 2; i + 3 < p.length; i += 2) {
    const mx = (p[i]! + p[i + 2]!) / 2;
    const my = (p[i + 1]! + p[i + 3]!) / 2;
    ctx.quadraticCurveTo(p[i]!, p[i + 1]!, mx, my);
  }
  ctx.lineTo(p[p.length - 2]!, p[p.length - 1]!);
}
