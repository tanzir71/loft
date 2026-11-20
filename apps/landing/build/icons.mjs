// Inline Lucide icons at build time (no React, no runtime JS). Reads the icon node data shipped in lucide-react.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const iconsDir = join(dirname(require.resolve("lucide-react/package.json")), "dist/esm/icons");
const cache = new Map();

export function icon(name, { size = 20, cls = "", strokeWidth = 2 } = {}) {
  if (!cache.has(name)) {
    const src = readFileSync(join(iconsDir, `${name}.mjs`), "utf8");
    const m = src.match(/const __iconData = (\{[\s\S]*?\n\});/);
    if (!m) throw new Error(`Cannot parse lucide icon ${name}`);
    const node = new Function(`return ${m[1]}`)().node;
    cache.set(
      name,
      node
        .map(([tag, attrs]) => {
          const a = Object.entries(attrs)
            .filter(([k]) => k !== "key")
            .map(([k, v]) => `${k}="${v}"`)
            .join(" ");
          return `<${tag} ${a}/>`;
        })
        .join("")
    );
  }
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cache.get(name)}</svg>`;
}
