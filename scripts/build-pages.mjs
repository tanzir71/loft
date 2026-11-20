#!/usr/bin/env node
// Builds the GitHub Pages site for a milestone and assembles it with the previous snapshots.
//
//   node scripts/build-pages.mjs --milestone 3 [--prev ./prev] [--out ./site] [--root /loft/]
//
// Result (served at https://tanzir71.github.io/loft/):
//   /            landing (latest)        /app/        SPA (latest)
//   /m<N>/       landing snapshot        /m<N>/app/   SPA snapshot
//   /milestones/ index generated from CHANGELOG.md
// Old /m*/ folders from --prev (the gh-pages branch) are kept untouched.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") ? "true" : (all[i + 1] ?? "true")]] : acc), [])
);
const milestone = args.milestone ?? process.env.MILESTONE;
if (milestone === undefined || !/^\d+$/.test(String(milestone))) {
  console.error("Usage: build-pages.mjs --milestone <N> [--prev dir] [--out dir] [--root /loft/]");
  process.exit(1);
}
const root = (args.root ?? "/loft/").replace(/\/?$/, "/");
const out = resolve(repo, args.out ?? "site");
const prev = args.prev ? resolve(repo, args.prev) : null;
const work = resolve(repo, ".pages-build");

function build(workspace, base, dest) {
  const env = { ...process.env, BASE: base, VITE_ADAPTER: "local", VITE_ROUTER: "hash", VITE_MILESTONE: `m${milestone}` };
  execFileSync("npx", ["vite", "build", "--outDir", dest, "--emptyOutDir"], { cwd: join(repo, workspace), env, stdio: "inherit" });
}

function buildVariant(prefix, name) {
  const dest = join(work, name);
  rmSync(dest, { recursive: true, force: true });
  build("apps/landing", prefix, dest);
  build("apps/web", `${prefix}app/`, join(dest, "app"));
  return dest;
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const latest = buildVariant(root, "latest");
const snapshot = buildVariant(`${root}m${milestone}/`, `m${milestone}`);

// Assemble: previous snapshots + new latest at root + new snapshot.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
if (prev && existsSync(prev)) {
  for (const entry of readdirSync(prev)) {
    if (/^m\d+$/.test(entry) && entry !== `m${milestone}`) cpSync(join(prev, entry), join(out, entry), { recursive: true });
  }
}
cpSync(latest, out, { recursive: true });
cpSync(snapshot, join(out, `m${milestone}`), { recursive: true });
writeFileSync(join(out, ".nojekyll"), "");

// Root 404: send stray paths back to the latest landing (the SPA uses hash routing on Pages).
writeFileSync(
  join(out, "404.html"),
  `<!doctype html><meta charset="utf-8"><title>Loft · not found</title><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<style>body{font:15px/1.5 Inter,system-ui,sans-serif;background:#faf8f5;color:#1a1c23;display:grid;place-items:center;min-height:100vh;margin:0}a{color:#213a8c}</style>` +
    `<main><p>That page isn't here. <a href="${root}">Go to Loft</a> or <a href="${root}milestones/">see every milestone</a>.</p></main>`
);

// /milestones/ index from CHANGELOG.md
const changelog = readFileSync(join(repo, "CHANGELOG.md"), "utf8");
const releases = [];
for (const block of changelog.split(/^## /m).slice(1)) {
  const [head = "", ...rest] = block.split("\n");
  const m = head.match(/^v(\d+)\.(\d+)\.(\d+)\s*[—-]\s*(M\d+)[: ]\s*(.*?)\s*\((\d{4}-\d{2}-\d{2})\)/);
  if (!m) continue;
  const n = Number(m[4].slice(1));
  const notes = rest.filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  releases.push({ version: `v${m[1]}.${m[2]}.${m[3]}`, n, title: m[5], date: m[6], notes });
}
const present = new Set(readdirSync(out).filter((e) => /^m\d+$/.test(e)));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const items = releases
  .map(
    (r) => `<li><div class="row"><h2>M${r.n} · ${esc(r.title)}</h2><span class="meta">${r.version} · ${r.date}</span></div>
<ul>${r.notes.map((x) => `<li>${esc(x).replace(/`([^`]+)`/g, "<code>$1</code>")}</li>`).join("")}</ul>
${present.has(`m${r.n}`) ? `<p class="links"><a href="${root}m${r.n}/">Landing</a><a href="${root}m${r.n}/app/">App</a></p>` : ""}</li>`
  )
  .join("\n");
mkdirSync(join(out, "milestones"), { recursive: true });
writeFileSync(
  join(out, "milestones/index.html"),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loft · milestones</title>
<style>body{margin:0;background:#faf8f5;color:#1a1c23;font:15px/1.55 Inter,system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:48px 20px}
h1{font:600 36px/1 "Barlow Condensed",system-ui,sans-serif;margin:0 0 24px}h2{font:600 18px/1.3 Inter,system-ui,sans-serif;margin:0}
ol{list-style:none;padding:0;margin:0;display:grid;gap:12px}ol>li{background:#fff;border:1px solid #e0e2eb;border-radius:12px;padding:16px 20px}
.row{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:baseline}.meta{font:12px/16px "JetBrains Mono",ui-monospace,monospace;color:#676b7e}
ul{margin:8px 0;padding-left:18px;color:#434656}code{font:13px "JetBrains Mono",ui-monospace,monospace}.links{display:flex;gap:16px;margin:8px 0 0}a{color:#213a8c}</style></head>
<body><main><h1>Loft milestones</h1><p><a href="${root}">Latest landing</a> · <a href="${root}app/">Latest app</a></p><ol>${items}</ol></main></body></html>`
);

rmSync(work, { recursive: true, force: true });
console.log(`Assembled ${out}: latest = m${milestone}, snapshots = ${[...present].sort().join(", ")}`);
