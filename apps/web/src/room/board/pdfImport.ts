/**
 * PDF import: pdf.js renders each page in the browser to a WebP image, which becomes a board page.
 * pdf.js is loaded on demand (pinned) so it never weighs on the app bundle or node_modules.
 * Production can self-host the two files at <base>vendor/pdfjs/ (tried first).
 */
const VERSION = "4.10.38";
const CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VERSION}/build`;

interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: ArrayBuffer }): { promise: Promise<PdfDoc> };
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<{ getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> } }>;
}

let lib: Promise<PdfJs> | null = null;

async function loadPdfJs(): Promise<PdfJs> {
  if (!lib) {
    lib = (async () => {
      const local = `${import.meta.env.BASE_URL}vendor/pdfjs`;
      for (const base of [local, CDN]) {
        try {
          const mod = (await import(/* @vite-ignore */ `${base}/pdf.min.mjs`)) as PdfJs;
          mod.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.min.mjs`;
          return mod;
        } catch {
          /* try the next source */
        }
      }
      throw new Error("Couldn't load the PDF reader. Check your connection and try again.");
    })();
    lib.catch(() => (lib = null));
  }
  return lib;
}

export interface RenderedPage {
  blob: Blob;
  width: number;
  height: number;
}

/** Render every page (max 40) to WebP at a width that keeps phones light. */
export async function renderPdf(file: Blob, onProgress?: (done: number, total: number) => void, targetWidth = 1400): Promise<RenderedPage[]> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const total = Math.min(doc.numPages, 40);
  const out: RenderedPage[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: targetWidth / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.82));
    if (blob) out.push({ blob, width: canvas.width, height: canvas.height });
    onProgress?.(i, total);
  }
  return out;
}

/** Images become a page too (downscaled to WebP). */
export async function renderImage(file: Blob, maxWidth = 1600): Promise<RenderedPage> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, maxWidth / bmp.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * s);
  canvas.height = Math.round(bmp.height * s);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
  if (!blob) throw new Error("Couldn't read that image");
  return { blob, width: canvas.width, height: canvas.height };
}

/** Google Slides / Docs share link → its /export/pdf URL. */
export function googleExportUrl(link: string): string | null {
  const m = link.match(/docs\.google\.com\/(presentation|document)\/d\/([\w-]+)/);
  return m ? `https://docs.google.com/${m[1]}/d/${m[2]}/export/pdf` : null;
}
