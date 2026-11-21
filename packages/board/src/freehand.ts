import { getStroke } from "perfect-freehand";
import type { StrokeObj } from "./types";

/** Outline polygon for a stroke (perfect-freehand), as an SVG/Path2D path string. Raw points stay untouched. */
export function strokeOutline(s: Pick<StrokeObj, "points" | "size" | "smoothing" | "pressure">): string {
  const pts: [number, number, number][] = [];
  for (let i = 0; i + 1 < s.points.length; i += 2) pts.push([s.points[i]!, s.points[i + 1]!, s.pressure?.[i / 2] ?? 0.5]);
  const sm = s.smoothing ?? 0.6;
  const outline = getStroke(pts, {
    size: s.size * 1.6,
    thinning: s.pressure ? 0.6 : 0.2,
    smoothing: sm,
    streamline: Math.min(0.85, sm * 0.8),
    simulatePressure: !s.pressure,
    last: true
  });
  if (outline.length < 2) return "";
  const f = (n: number) => Math.round(n * 10) / 10;
  const [first, ...rest] = outline;
  let d = `M${f(first![0])},${f(first![1])}`;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!, b = rest[(i + 1) % rest.length]!;
    d += ` Q${f(a[0])},${f(a[1])} ${f((a[0] + b[0]) / 2)},${f((a[1] + b[1]) / 2)}`;
  }
  return d + " Z";
}
