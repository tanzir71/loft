import { useEffect, useMemo, useRef, useState } from "react";
import { AlignCenterHorizontal, AlignEndHorizontal, AlignStartHorizontal, AlignStartVertical, AlignEndVertical, AlignCenterVertical, Copy, Download, Grid3x3, Search, Trash2, Unlink, X } from "lucide-react";
import {
  alignItems,
  bounds,
  diagramToObjects,
  distribute,
  layoutDiagram,
  nextZ,
  parseDiagram,
  tidyUp,
  toMermaid,
  type BoardObj,
  type BoardOp,
  type BoardState,
  type Cap,
  type ConnectorObj,
  type ShapeFill,
  type ShapeKind
} from "@loft/board";
import { newId } from "@loft/core";
import { Button } from "@loft/ui";
import { SHAPES, shapePath } from "./board/shapes";

const LINE_COLOURS = ["#434656", "#213a8c", "#ef4343", "#1dd7b2", "#f59f0a"];
const FILLS: ShapeFill[] = ["primary-soft", "card", "mint", "peach", "sticky-yellow", "muted"];

function positions(state: BoardState, ids: string[]) {
  return ids
    .map((id) => state.objects[id])
    .filter((o): o is BoardObj => !!o && o.kind !== "connector" && o.kind !== "diagram" && o.kind !== "stroke")
    .map((o) => ({ id: o.id, ...bounds(o) }));
}
const moveOps = (moves: Record<string, { x: number; y: number }>): BoardOp => ({ kind: "batch", payload: { ops: Object.entries(moves).map(([id, p]) => ({ kind: "update", payload: { id, patch: { x: Math.round(p.x), y: Math.round(p.y) } } }) as BoardOp) } });

/** Floating bar over the selection (Figma Board v2 · connector bar, align · distribute · tidy). */
export function SelectionBar({ state, ids, commit, onExportSection, onEditDiagram }: { state: BoardState; ids: string[]; commit: (op: BoardOp) => void; onExportSection: (id: string, kind: "png" | "pdf") => void; onEditDiagram: (id: string) => void }) {
  const objs = ids.map((id) => state.objects[id]).filter(Boolean) as BoardObj[];
  if (!objs.length) return null;
  const del = () => commit({ kind: "batch", payload: { ops: ids.map((id) => ({ kind: "remove", payload: { id } }) as BoardOp) } });
  if (objs.length > 1) {
    const pos = positions(state, ids);
    return (
      <div className="island sel-bar" role="toolbar" aria-label="Arrange selection">
        <button type="button" className="tool tool--sm" aria-label="Align left" onClick={() => commit(moveOps(alignItems(pos, "left")))}><AlignStartVertical aria-hidden="true" /></button>
        <button type="button" className="tool tool--sm" aria-label="Align centre" onClick={() => commit(moveOps(alignItems(pos, "centre")))}><AlignCenterVertical aria-hidden="true" /></button>
        <button type="button" className="tool tool--sm" aria-label="Align right" onClick={() => commit(moveOps(alignItems(pos, "right")))}><AlignEndVertical aria-hidden="true" /></button>
        <button type="button" className="tool tool--sm" aria-label="Align top" onClick={() => commit(moveOps(alignItems(pos, "top")))}><AlignStartHorizontal aria-hidden="true" /></button>
        <button type="button" className="tool tool--sm" aria-label="Align middle" onClick={() => commit(moveOps(alignItems(pos, "middle")))}><AlignCenterHorizontal aria-hidden="true" /></button>
        <button type="button" className="tool tool--sm" aria-label="Align bottom" onClick={() => commit(moveOps(alignItems(pos, "bottom")))}><AlignEndHorizontal aria-hidden="true" /></button>
        <span className="toolbar__sep" aria-hidden="true" />
        <button type="button" className="sel-bar__text" onClick={() => commit(moveOps(distribute(pos, "x")))}>Distribute</button>
        <button type="button" className="sel-bar__text" onClick={() => commit(moveOps(tidyUp(pos)))}><Grid3x3 aria-hidden="true" /> Tidy up</button>
        <span className="toolbar__sep" aria-hidden="true" />
        <button type="button" className="tool tool--sm" aria-label="Delete" onClick={del}><Trash2 aria-hidden="true" /></button>
      </div>
    );
  }
  const o = objs[0]!;
  const set = (patch: Record<string, unknown>) => commit({ kind: "update", payload: { id: o.id, patch } });
  if (o.kind === "connector") {
    const caps: Cap[] = ["none", "arrow", "dot"];
    return (
      <div className="island sel-bar" role="toolbar" aria-label="Connector">
        {(["straight", "elbow", "curved"] as ConnectorObj["route"][]).map((r) => (
          <button key={r} type="button" className={`tool tool--sm${o.route === r ? " is-soft" : ""}`} aria-pressed={o.route === r} aria-label={`${r} line`} onClick={() => set({ route: r })}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d={r === "straight" ? "M3 17 L17 3" : r === "elbow" ? "M3 15 H10 V5 H17" : "M3 16 C10 16 10 4 17 4"} fill="none" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
        ))}
        <span className="toolbar__sep" aria-hidden="true" />
        <button type="button" className="sel-bar__text" aria-label={`End: ${o.endCap}`} onClick={() => set({ endCap: caps[(caps.indexOf(o.endCap) + 1) % 3] })}>end · {o.endCap}</button>
        <button type="button" className="sel-bar__text" aria-label={`Start: ${o.startCap}`} onClick={() => set({ startCap: caps[(caps.indexOf(o.startCap) + 1) % 3] })}>start · {o.startCap}</button>
        <button type="button" className={`sel-bar__text${o.dash ? " is-soft" : ""}`} aria-pressed={o.dash} onClick={() => set({ dash: !o.dash })}>dashed</button>
        <span className="toolbar__sep" aria-hidden="true" />
        {LINE_COLOURS.map((c) => (
          <button key={c} type="button" className="swatch swatch--sm" style={{ background: c }} aria-label={`Colour ${c}`} aria-checked={o.colour === c} role="radio" onClick={() => set({ colour: c })} />
        ))}
        <span className="toolbar__sep" aria-hidden="true" />
        <button
          type="button"
          className="sel-bar__text"
          onClick={() => {
            const label = prompt("Label", o.label);
            if (label !== null) set({ label: label.slice(0, 80) });
          }}
        >
          Aa label
        </button>
        <button type="button" className="tool tool--sm" aria-label="Delete" onClick={del}><Trash2 aria-hidden="true" /></button>
      </div>
    );
  }
  if (o.kind === "shape") {
    return (
      <div className="island sel-bar" role="toolbar" aria-label="Shape">
        {FILLS.map((f) => (
          <button key={f} type="button" className={`swatch swatch--sm fill-swatch fill-${f}`} aria-label={`Fill ${f}`} role="radio" aria-checked={o.fill === f} onClick={() => set({ fill: f })} />
        ))}
        <span className="toolbar__sep" aria-hidden="true" />
        <select className="sel-bar__select" value={o.shape} onChange={(e) => set({ shape: e.target.value as ShapeKind })} aria-label="Shape type">
          {SHAPES.map((s) => (
            <option key={s.kind} value={s.kind}>{s.label}</option>
          ))}
        </select>
        <button type="button" className="tool tool--sm" aria-label="Delete" onClick={del}><Trash2 aria-hidden="true" /></button>
      </div>
    );
  }
  if (o.kind === "section") {
    return (
      <div className="island sel-bar" role="toolbar" aria-label="Section">
        <button type="button" className="sel-bar__text" onClick={() => onExportSection(o.id, "png")}><Download aria-hidden="true" /> PNG</button>
        <button type="button" className="sel-bar__text" onClick={() => onExportSection(o.id, "pdf")}><Download aria-hidden="true" /> PDF</button>
        <button type="button" className="tool tool--sm" aria-label="Delete section" onClick={del}><Trash2 aria-hidden="true" /></button>
      </div>
    );
  }
  if (o.kind === "diagram") {
    return (
      <div className="island sel-bar" role="toolbar" aria-label="Diagram">
        <button type="button" className="sel-bar__text" onClick={() => onEditDiagram(o.id)}>Edit code</button>
        <button
          type="button"
          className="sel-bar__text"
          onClick={() => {
            const objsOut = diagramToObjects(layoutDiagram(parseDiagram(o.code)), { x: o.x, y: o.y }, { z: nextZ(state), by: o.by ?? "", newId });
            commit({ kind: "batch", payload: { ops: [{ kind: "remove", payload: { id: o.id } }, ...objsOut.map((x) => ({ kind: "add", payload: { obj: x } }) as BoardOp)] } });
          }}
        >
          <Unlink aria-hidden="true" /> Detach to freeform
        </button>
        <button type="button" className="tool tool--sm" aria-label="Delete diagram" onClick={del}><Trash2 aria-hidden="true" /></button>
      </div>
    );
  }
  return (
    <div className="island sel-bar" role="toolbar" aria-label="Selection">
      <button type="button" className="tool tool--sm" aria-label="Delete" onClick={del}><Trash2 aria-hidden="true" /></button>
    </div>
  );
}

export function ShapesFlyout({ value, onPick }: { value: ShapeKind; onPick: (k: ShapeKind) => void }) {
  return (
    <div className="island shapes-flyout" role="radiogroup" aria-label="Shapes">
      {SHAPES.map((s) => (
        <button key={s.kind} type="button" role="radio" aria-checked={value === s.kind} className={`shape-opt${value === s.kind ? " is-on" : ""}`} onClick={() => onPick(s.kind)}>
          <svg viewBox="-2 -2 48 32" width="44" height="30" aria-hidden="true" className={`bshape fill-${s.fill}`}>
            <path d={shapePath(s.kind, 44, 28)} />
          </svg>
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PenOptions({ colour, colours, onColour, smoothing, onSmoothing, highlighter, onHighlighter, recognise, onRecognise }: { colour: string; colours: { name: string; value: string }[]; onColour: (c: string) => void; smoothing: number; onSmoothing: (v: number) => void; highlighter: boolean; onHighlighter: (v: boolean) => void; recognise: boolean; onRecognise: (v: boolean) => void }) {
  return (
    <div className="island pen-opts">
      <div className="pen-opts__row" role="radiogroup" aria-label="Pen colour">
        {colours.map((c) => (
          <button key={c.value} type="button" role="radio" aria-checked={colour === c.value} aria-label={c.name} className="swatch" style={{ background: c.value }} onClick={() => onColour(c.value)} />
        ))}
      </div>
      <label className="pen-opts__slider">
        <span>Smoothing</span>
        <input type="range" min={0} max={100} value={Math.round(smoothing * 100)} onChange={(e) => onSmoothing(Number(e.target.value) / 100)} aria-valuetext={`${Math.round(smoothing * 100)}%`} />
        <span className="mono">{Math.round(smoothing * 100)}%</span>
      </label>
      <label className="pen-opts__toggle"><span>Highlighter</span><input type="checkbox" role="switch" checked={highlighter} onChange={(e) => onHighlighter(e.target.checked)} /><span className="switch" aria-hidden="true" /></label>
      <label className="pen-opts__toggle"><span>Snap rough shapes to clean ones</span><input type="checkbox" role="switch" checked={recognise} onChange={(e) => onRecognise(e.target.checked)} /><span className="switch" aria-hidden="true" /></label>
    </div>
  );
}

const SAMPLE = `New lead > Qualified?
Qualified? > Book a call: yes
Qualified? > Nurture list: no
Book a call > Send proposal > Won
Nurture list > New lead: 30 days`;

/** Diagram as code (Eraser-style): the code is the source of truth until "Detach to freeform". */
export function DiagramPanel({ state, editingId, commit, centre, onClose, onAdded }: { state: BoardState; editingId: string | null; commit: (op: BoardOp) => void; centre: () => { x: number; y: number }; onClose: () => void; onAdded?: (id: string) => void }) {
  const existing = editingId ? state.objects[editingId] : null;
  const [code, setCode] = useState(existing?.kind === "diagram" ? existing.code : SAMPLE);
  const parsed = useMemo(() => parseDiagram(code), [code]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (existing?.kind === "diagram") setCode(existing.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);
  const update = (v: string) => {
    setCode(v);
    if (existing?.kind === "diagram") {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => commit({ kind: "update", payload: { id: existing.id, patch: { code: v } } }), 300);
    }
  };
  return (
    <aside className="island diagram-panel" data-board-ui="" aria-label="Diagram as code">
      <header>
        <b>Diagram as code</b>
        <button type="button" className="lf-icon-btn" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button>
      </header>
      <p className="diagram-panel__hint">One line per link: <code>A &gt; B: label</code>. Start with <code>sequence</code>, <code>erd</code> or <code>swimlane</code> for other types. Mermaid flowcharts work too.</p>
      <textarea className="diagram-panel__code" value={code} onChange={(e) => update(e.target.value)} spellCheck={false} aria-label="Diagram code" rows={12} />
      <p className="diagram-panel__meta">{parsed.type} · {parsed.nodes.length} boxes · {parsed.edges.length} links{parsed.errors.length ? ` · line ${parsed.errors[0]!.line}: ${parsed.errors[0]!.message}` : ""}</p>
      <div className="diagram-panel__actions">
        {existing?.kind === "diagram" ? (
          <span className="diagram-panel__live">Live: the board updates as you type</span>
        ) : (
          <Button
            size="sm"
            onClick={() => {
              const c = centre();
              const lay = layoutDiagram(parsed);
              const id = newId("dg");
              commit({ kind: "add", payload: { obj: { id, kind: "diagram", z: nextZ(state), x: Math.round(c.x - lay.width / 2), y: Math.round(c.y - lay.height / 2), code } } });
              onClose();
              onAdded?.(id);
            }}
            disabled={!parsed.nodes.length}
          >
            Add to board
          </Button>
        )}
        {parsed.type === "flowchart" && (
          <Button size="sm" variant="secondary" icon={<Copy aria-hidden="true" />} onClick={() => void navigator.clipboard?.writeText(toMermaid(parsed))}>
            Copy as Mermaid
          </Button>
        )}
      </div>
    </aside>
  );
}

/** Find on board (Ctrl+F): stickies, shapes, text, section titles, connector labels, diagram code. */
export function FindBar({ state, onFocus, onClose }: { state: BoardState; onFocus: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const term = q.trim().toLowerCase();
  const matches = term
    ? Object.values(state.objects).filter((o) => {
        const text = o.kind === "sticky" || o.kind === "text" || o.kind === "shape" ? o.text : o.kind === "section" ? o.title : o.kind === "connector" ? o.label : o.kind === "diagram" ? o.code : "";
        return text.toLowerCase().includes(term);
      })
    : [];
  const go = (n: number) => {
    if (!matches.length) return;
    const k = ((n % matches.length) + matches.length) % matches.length;
    setI(k);
    onFocus(matches[k]!.id);
  };
  return (
    <div className="island find-bar" data-board-ui="" role="search">
      <Search aria-hidden="true" />
      <input
        autoFocus
        placeholder="Find on board"
        aria-label="Find on board"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setI(0);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") go(e.shiftKey ? i - 1 : matches.length && term ? i + (matches[i] ? 1 : 0) : 0);
          if (e.key === "Escape") onClose();
        }}
      />
      <span className="mono find-bar__count">{term ? `${matches.length ? i + 1 : 0}/${matches.length}` : ""}</span>
      <button type="button" className="lf-icon-btn" onClick={onClose} aria-label="Close find"><X aria-hidden="true" /></button>
    </div>
  );
}
