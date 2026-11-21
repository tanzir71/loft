/**
 * Minimal PDF writer for board export: one JPEG image per page (DCTDecode), no dependencies.
 * Pages are sized in points from the image's pixel size scaled to fit A4 or Letter landscape/portrait.
 */
export interface PdfPage {
  jpeg: Uint8Array;
  width: number;
  height: number;
}

const enc = new TextEncoder();

export function buildPdf(pages: PdfPage[], paper: "a4" | "letter" = "a4"): Uint8Array {
  const [pw, ph] = paper === "a4" ? [595.28, 841.89] : [612, 792];
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array) => {
    chunks.push(b);
    size += b.length;
  };
  const str = (s: string) => push(enc.encode(s));
  const obj = (n: number, body: () => void) => {
    offsets[n] = size;
    str(`${n} 0 obj\n`);
    body();
    str("\nendobj\n");
  };
  str("%PDF-1.4\n%âãÏÓ\n");
  const n = pages.length;
  // 1 catalog, 2 pages, then per page: page, content, image.
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  obj(1, () => str("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => str(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));
  pages.forEach((p, i) => {
    const landscape = p.width > p.height;
    const W = landscape ? ph : pw, H = landscape ? pw : ph;
    const margin = 24;
    const s = Math.min((W - margin * 2) / p.width, (H - margin * 2) / p.height);
    const w = p.width * s, h = p.height * s;
    const x = (W - w) / 2, y = (H - h) / 2;
    const pageN = 3 + i * 3, contentN = pageN + 1, imgN = pageN + 2;
    const content = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${i} Do Q`;
    obj(pageN, () => str(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im${i} ${imgN} 0 R >> >> /Contents ${contentN} 0 R >>`));
    obj(contentN, () => str(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(imgN, () => {
      str(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      str("\nendstream");
    });
  });
  const xref = size;
  const total = 3 + n * 3;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += `${String(offsets[i] ?? 0).padStart(10, "0")} 00000 n \n`;
  str(x);
  str(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
