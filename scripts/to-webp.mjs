#!/usr/bin/env node
// Convert PNG exports (e.g. Figma screenshots) to WebP using headless Chromium's encoder.
//   node scripts/to-webp.mjs <in-dir> <out-dir> [quality=0.86]
// Needs the Playwright Chromium shell (`npx playwright install chromium --only-shell`).
/* global document, Image */
import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const [inDir, outDir, q = "0.86"] = process.argv.slice(2);
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
    async ({ b64, q }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      return { url: c.toDataURL("image/webp", Number(q)), w: c.width, h: c.height };
    },
    { b64, q }
  );
  const bytes = Buffer.from(out.url.split(",")[1], "base64");
  const name = basename(f, ".png") + ".webp";
  writeFileSync(join(resolve(outDir), name), bytes);
  console.log(`${name}\t${out.w}x${out.h}\t${(bytes.length / 1024).toFixed(1)} KB`);
}
await browser.close();
