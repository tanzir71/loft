import { useEffect, useRef, useState } from "react";

export type Tool = "pen" | "eraser";

interface WhiteboardProps {
  tool: Tool;
  color: string;
  size: number;
  clearSignal: number;
  exportSignal: number;
}

interface Stroke {
  tool: Tool;
  color: string;
  size: number;
  points: { x: number; y: number }[];
}

export const Whiteboard = ({
  tool,
  color,
  size,
  clearSignal,
  exportSignal,
}: WhiteboardProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawing = useRef(false);
  const current = useRef<Stroke | null>(null);

  // Resize canvas to container with DPR
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = wrap.getBoundingClientRect();
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) drawStroke(ctx, s);
    if (current.current) drawStroke(ctx, current.current);
  };

  const drawStroke = (ctx: CanvasRenderingContext2D, s: Stroke) => {
    if (s.points.length < 1) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = s.size;
    if (s.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = s.color;
    }
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (let i = 1; i < s.points.length; i++) {
      const p = s.points[i];
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  };

  const getPos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = true;
    current.current = {
      tool,
      color,
      size: tool === "eraser" ? size * 2.5 : size,
      points: [getPos(e)],
    };
    redraw();
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drawing.current || !current.current) return;
    current.current.points.push(getPos(e));
    redraw();
  };

  const onUp = () => {
    if (!drawing.current || !current.current) return;
    drawing.current = false;
    setStrokes((prev) => [...prev, current.current!]);
    current.current = null;
  };

  // Clear
  useEffect(() => {
    if (clearSignal === 0) return;
    setStrokes([]);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [clearSignal]);

  // Export PNG
  useEffect(() => {
    if (exportSignal === 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Compose with white bg for export
    const out = document.createElement("canvas");
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext("2d")!;
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(canvas, 0, 0);
    const url = out.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `whiteboard-${Date.now()}.png`;
    a.click();
  }, [exportSignal]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="absolute inset-0 touch-none"
        style={{ cursor: tool === "eraser" ? "cell" : "crosshair" }}
      />
    </div>
  );
};
