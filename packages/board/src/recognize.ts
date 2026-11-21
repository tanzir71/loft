/** Shape recognition on pointer-up: a closed rough stroke becomes a clean rectangle, ellipse or diamond. */
export type Recognised = { kind: "process" | "ellipse" | "decision"; x: number; y: number; w: number; h: number };

export function recogniseShape(points: number[]): Recognised | null {
  const n = points.length / 2;
  if (n < 8) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, len = 0;
  for (let i = 0; i < n; i++) {
    const x = points[i * 2]!, y = points[i * 2 + 1]!;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    if (i) len += Math.hypot(x - points[i * 2 - 2]!, y - points[i * 2 - 1]!);
  }
  const w = maxX - minX, h = maxY - minY;
  if (w < 24 || h < 24) return null;
  // Closed: the ends meet within 20% of the size.
  const gap = Math.hypot(points[0]! - points[(n - 1) * 2]!, points[1]! - points[(n - 1) * 2 + 1]!);
  if (gap > 0.25 * Math.max(w, h)) return null;
  const cx = minX + w / 2, cy = minY + h / 2;
  // Mean normalised distance from the centre in the L1, L2 and L∞ senses: diamond ≈ 1 (L1), ellipse ≈ 1 (L2), box ≈ 1 (L∞).
  let e1 = 0, e2 = 0, eInf = 0;
  for (let i = 0; i < n; i++) {
    const u = (points[i * 2]! - cx) / (w / 2), v = (points[i * 2 + 1]! - cy) / (h / 2);
    e1 += Math.abs(Math.abs(u) + Math.abs(v) - 1);
    e2 += Math.abs(Math.hypot(u, v) - 1);
    eInf += Math.abs(Math.max(Math.abs(u), Math.abs(v)) - 1);
  }
  e1 /= n; e2 /= n; eInf /= n;
  const best = Math.min(e1, e2, eInf);
  if (best > 0.16 || len < 2 * (w + h) * 0.6) return null;
  const kind = best === eInf ? "process" : best === e2 ? "ellipse" : "decision";
  return { kind, x: minX, y: minY, w, h };
}
