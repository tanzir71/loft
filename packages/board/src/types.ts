/** Board object model (handoff §7.2). v1: stroke, sticky, text. v2 adds shape, connector, section, image, stamp. */

export type StickyColour = "yellow" | "pink" | "blue" | "green";

interface Base {
  id: string;
  /** Stacking order; higher draws on top. */
  z: number;
  /** Author user id. */
  by?: string;
  /** Agent drafts stay on a draft layer until the host accepts them (M9). */
  draft?: boolean;
}

export interface StrokeObj extends Base {
  kind: "stroke";
  /** Flat [x0, y0, x1, y1, …] in world units (raw points are kept so smoothing can change later). */
  points: number[];
  colour: string;
  size: number;
  /** 0–1. Rendered with perfect-freehand; 0 draws the raw polyline. */
  smoothing?: number;
  /** Per-point pressure from a pen or stylus (0–1). */
  pressure?: number[];
  /** Wide 40% stroke drawn under objects. */
  highlighter?: boolean;
}

export type ShapeKind = "process" | "rounded" | "terminal" | "decision" | "io" | "database" | "document" | "ellipse";
export type ShapeFill = "primary-soft" | "card" | "mint" | "peach" | "sticky-yellow" | "lilac" | "muted";

export interface ShapeObj extends Base {
  kind: "shape";
  shape: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  fill: ShapeFill;
}

export type Anchor = "n" | "e" | "s" | "w";
export type ConnectorEnd = { id: string; anchor: Anchor } | { x: number; y: number };
export type Cap = "none" | "arrow" | "dot";

export interface ConnectorObj extends Base {
  kind: "connector";
  from: ConnectorEnd;
  to: ConnectorEnd;
  route: "straight" | "elbow" | "curved";
  startCap: Cap;
  endCap: Cap;
  weight: number;
  dash: boolean;
  colour: string;
  label: string;
}

export interface SectionObj extends Base {
  kind: "section";
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
}

/** Diagram as code: the code is the source of truth until "Detach to freeform". */
export interface DiagramObj extends Base {
  kind: "diagram";
  x: number;
  y: number;
  code: string;
}

export interface StickyObj extends Base {
  kind: "sticky";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  colour: StickyColour;
}

export interface TextObj extends Base {
  kind: "text";
  x: number;
  y: number;
  w: number;
  text: string;
  colour: string;
  size: number;
}

export type BoardObj = StrokeObj | StickyObj | TextObj | ShapeObj | ConnectorObj | SectionObj | DiagramObj;
export type BoardObjKind = BoardObj["kind"];

/** A sheet on the board. Sheets sit side by side; objects can live anywhere. */
export interface Page {
  id: string;
  title: string;
  order: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Background image (PDF page / slide) when imported (M4). */
  bg?: string | null;
}

export interface BoardState {
  pages: Record<string, Page>;
  objects: Record<string, BoardObj>;
  /** Last applied op seq. */
  seq: number;
}

/** Op payloads stored in the room op-log. */
export type BoardOp =
  | { kind: "add"; payload: { obj: BoardObj } | { page: Page } }
  | { kind: "update"; payload: { id: string; target?: "obj" | "page"; patch: Record<string, unknown> } }
  | { kind: "remove"; payload: { id: string; target?: "obj" | "page" } }
  | { kind: "batch"; payload: { ops: BoardOp[] } };

export interface Viewport {
  /** Screen-space offset of the world origin, in CSS px. */
  x: number;
  y: number;
  scale: number;
}
