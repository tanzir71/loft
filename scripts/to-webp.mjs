#!/usr/bin/env node
// Convert PNG exports (e.g. Figma screenshots) to WebP using headless Chromium's encoder.
//   node scripts/to-webp.mjs <in-dir> <out-dir> [quality=0.86] [width] [suffix]
// With width, images are downscaled to that width and saved as <name><suffix>.webp (e.g. -656).
// Needs the Playwright Chromium shell (`npx playwright install chromium --only-shell`).
/* global document, Image */
import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const [inDir, outDir, q = "0.86", width = "", suffix = ""] = process.argv.slice(2);
if (!inDir || !outDir) {
  console.error("Usage: to-webp.mjs <in-dir> <out-dir> [quality]");
  process.exit(1);
}
mkdirSync(resolve(outDir), { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const f of readdirSync(resolve(inDir)).filter((n) => n.endsWith(".png"))) {
  const b64 = readFileSync(join(resolve(inDir), f)).toString("base64");
  const out = await page.evaluate(
    async ({ b64, q, width }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      const w = width ? Math.min(Number(width), img.naturalWidth) : img.naturalWidth;
      c.width = w;
      c.height = Math.round((img.naturalHeight * w) / img.naturalWidth);
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return { url: c.toDataURL("image/webp", Number(q)), w: c.width, h: c.height };
    },
    { b64, q, width }
  );
  const bytes = Buffer.from(out.url.split(",")[1], "base64");
  const name = basename(f, ".png") + suffix + ".webp";
  writeFileSync(join(resolve(outDir), name), bytes);
  console.log(`${name}\t${out.w}x${out.h}\t${(bytes.length / 1024).toFixed(1)} KB`);
}
await browser.close();
