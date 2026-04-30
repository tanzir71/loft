import { Eraser, Pen, Trash2, Download, Undo2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tool } from "./Whiteboard";

interface ToolbarProps {
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  size: number;
  setSize: (n: number) => void;
  onClear: () => void;
  onExport: () => void;
}

const COLORS = [
  { name: "Ink", value: "#1a1d2e" },
  { name: "Indigo", value: "#6d5cff" },
  { name: "Mint", value: "#1fc7a8" },
  { name: "Coral", value: "#ff6b6b" },
  { name: "Sun", value: "#ffb020" },
  { name: "Sky", value: "#3aa0ff" },
];

export const Toolbar = ({
  tool,
  setTool,
  color,
  setColor,
  size,
  setSize,
  onClear,
  onExport,
}: ToolbarProps) => {
  return (
    <div className="pointer-events-none absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2">
      {/* Tools */}
      <div className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-1.5 anim-rise">
        <ToolBtn
          active={tool === "pen"}
          onClick={() => setTool("pen")}
          label="Pen"
          shortcut="P"
        >
          <Pen className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn
          active={tool === "eraser"}
          onClick={() => setTool("eraser")}
          label="Eraser"
          shortcut="E"
        >
          <Eraser className="h-4 w-4" />
        </ToolBtn>
      </div>

      {/* Colors */}
      <div className="glass pointer-events-auto flex items-center gap-1.5 rounded-2xl p-2 anim-rise">
        {COLORS.map((c) => (
          <button
            key={c.value}
            onClick={() => {
              setColor(c.value);
              setTool("pen");
            }}
            aria-label={c.name}
            className={cn(
              "relative h-6 w-6 rounded-full ring-1 ring-black/10 transition-transform",
              "hover:scale-110",
              color === c.value && tool === "pen" &&
                "ring-2 ring-offset-2 ring-offset-white",
            )}
            style={{
              backgroundColor: c.value,
              boxShadow:
                color === c.value && tool === "pen"
                  ? `0 0 0 2px ${c.value}`
                  : undefined,
            }}
          />
        ))}
      </div>

      {/* Stroke size */}
      <div className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-1.5 anim-rise">
        <button
          onClick={() => setSize(Math.max(1, size - 1))}
          className="grid h-8 w-8 place-items-center rounded-xl text-surface-muted hover:bg-secondary"
          aria-label="Decrease size"
        >
          <Minus className="h-4 w-4" />
        </button>
        <div className="grid h-8 w-10 place-items-center">
          <span
            className="rounded-full bg-foreground"
            style={{ width: size + 2, height: size + 2 }}
          />
        </div>
        <button
          onClick={() => setSize(Math.min(24, size + 1))}
          className="grid h-8 w-8 place-items-center rounded-xl text-surface-muted hover:bg-secondary"
          aria-label="Increase size"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Actions */}
      <div className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-1.5 anim-rise">
        <ToolBtn onClick={onClear} label="Clear">
          <Trash2 className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn onClick={onExport} label="Export PNG">
          <Download className="h-4 w-4" />
        </ToolBtn>
      </div>
    </div>
  );
};

const ToolBtn = ({
  children,
  active,
  onClick,
  label,
  shortcut,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  label: string;
  shortcut?: string;
}) => (
  <button
    onClick={onClick}
    aria-label={label}
    title={shortcut ? `${label} (${shortcut})` : label}
    className={cn(
      "group relative grid h-9 w-9 place-items-center rounded-xl transition-all",
      "text-surface-muted hover:text-foreground hover:bg-secondary",
      active &&
        "bg-foreground text-background hover:bg-foreground hover:text-background",
    )}
  >
    {children}
  </button>
);
