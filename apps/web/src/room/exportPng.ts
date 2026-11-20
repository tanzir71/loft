import { bounds, sortedObjects, sortedPages, tracePath, type BoardState } from "@loft/board";

const STICKY: Record<string, string> = { yellow: "#fff0b2", pink: "#fccfde", blue: "#c5e5fc", green: "#c6f1db" };

/** Render the whole board (pages, ink, notes, text) to a PNG and download it. PDF export arrives in M4. */
export async function downloadBoardPng(state: BoardState, filename: string): Promise<void> {
  const pages = sortedPages(state);
  const objs = sortedObjects(state);
  const rects = [...pages, ...objs.map(bounds)];
  const minX = Math.min(...rects.map((r) => r.x)) - 40;
  const minY = Math.min(...rects.map((r) => r.y)) - 40;
  const maxX = Math.max(...rects.map((r) => r.x + r.w)) + 40;
  const maxY = Math.max(...rects.map((r) => r.y + r.h)) + 40;
  const scale = Math.min(2, 4000 / Math.max(maxX - minX, maxY - minY));
  const c = document.createElement("canvas");
  c.width = Math.ceil((maxX - minX) * scale);
  c.height = Math.ceil((maxY - minY) * scale);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#faf8f5";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
  for (const p of pages) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = "#e0e2eb";
    ctx.strokeRect(p.x, p.y, p.w, p.h);
  }
  ctx.textBaseline = "top";
  for (const o of objs) {
    if (o.kind === "sticky") {
      ctx.fillStyle = STICKY[o.colour] ?? STICKY.yellow!;
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.fillStyle = "#1a1c23";
      ctx.font = "500 16px Inter, sans-serif";
      wrap(ctx, o.text, o.x + 14, o.y + 14, o.w - 28, 22);
    } else if (o.kind === "text") {
      ctx.fillStyle = o.colour;
      ctx.font = `500 ${o.size}px Inter, sans-serif`;
      wrap(ctx, o.text, o.x, o.y, o.w, o.size * 1.4);
    }
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const o of objs) {
    if (o.kind !== "stroke") continue;
    ctx.beginPath();
    ctx.strokeStyle = o.colour;
    ctx.lineWidth = o.size;
    tracePath(ctx, o.points);
    ctx.stroke();
  }
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (!blob) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  let line = 0;
  for (const para of text.split("\n")) {
    let cur = "";
    for (const word of para.split(" ")) {
      const test = cur ? `${cur} ${word}` : word;
      if (ctx.measureText(test).width > maxW && cur) {
        ctx.fillText(cur, x, y + line++ * lh);
        cur = word;
      } else cur = test;
    }
    ctx.fillText(cur, x, y + line++ * lh);
  }
}
