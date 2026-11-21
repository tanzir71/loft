import type { ShapeFill, ShapeKind } from "@loft/board";

/** SVG path for each flowchart shape in local coordinates (0,0)–(w,h). Used by SVG and canvas (Path2D). */
export function shapePath(kind: ShapeKind, w: number, h: number): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  switch (kind) {
    case "process":
      return roundRect(w, h, 6);
    case "rounded":
      return roundRect(w, h, Math.min(16, h / 3));
    case "terminal":
      return roundRect(w, h, h / 2);
    case "decision":
      return `M${r(w / 2)},0 L${r(w)},${r(h / 2)} L${r(w / 2)},${r(h)} L0,${r(h / 2)} Z`;
    case "io": {
      const k = Math.min(20, w * 0.15);
      return `M${r(k)},0 L${r(w)},0 L${r(w - k)},${r(h)} L0,${r(h)} Z`;
    }
    case "database": {
      const e = Math.min(12, h * 0.18);
      return `M0,${r(e)} A${r(w / 2)},${r(e)} 0 0 1 ${r(w)},${r(e)} L${r(w)},${r(h - e)} A${r(w / 2)},${r(e)} 0 0 1 0,${r(h - e)} Z M0,${r(e)} A${r(w / 2)},${r(e)} 0 0 0 ${r(w)},${r(e)}`;
    }
    case "document": {
      const wv = Math.min(10, h * 0.15);
      return `M0,0 L${r(w)},0 L${r(w)},${r(h - wv)} C${r(w * 0.75)},${r(h - wv * 2.4)} ${r(w * 0.5)},${r(h + wv * 0.8)} 0,${r(h - wv)} Z`;
    }
    case "ellipse":
      return `M0,${r(h / 2)} A${r(w / 2)},${r(h / 2)} 0 1 0 ${r(w)},${r(h / 2)} A${r(w / 2)},${r(h / 2)} 0 1 0 0,${r(h / 2)} Z`;
  }
}

function roundRect(w: number, h: number, rad: number): string {
  const r = Math.max(0, Math.min(rad, w / 2, h / 2));
  const f = (n: number) => Math.round(n * 10) / 10;
  return `M${f(r)},0 H${f(w - r)} A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)} V${f(h - r)} A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)} H${f(r)} A${f(r)},${f(r)} 0 0 1 0,${f(h - r)} V${f(r)} A${f(r)},${f(r)} 0 0 1 ${f(r)},0 Z`;
}

export const SHAPES: { kind: ShapeKind; label: string; fill: ShapeFill }[] = [
  { kind: "process", label: "Process", fill: "primary-soft" },
  { kind: "rounded", label: "Rounded", fill: "card" },
  { kind: "terminal", label: "Start / end", fill: "mint" },
  { kind: "decision", label: "Decision", fill: "peach" },
  { kind: "io", label: "Input / output", fill: "card" },
  { kind: "database", label: "Database", fill: "lilac" },
  { kind: "document", label: "Document", fill: "sticky-yellow" },
  { kind: "ellipse", label: "Ellipse", fill: "card" }
];

/** Resolved colours for canvas export (CSS variables don't exist on a detached canvas). */
export const FILL_HEX: Record<ShapeFill, string> = {
  "primary-soft": "#d4ddf7",
  card: "#ffffff",
  mint: "#c8f9ef",
  peach: "#ffe5cc",
  "sticky-yellow": "#fff0b2",
  lilac: "#d4ddf7",
  muted: "#f3f3f7"
};
