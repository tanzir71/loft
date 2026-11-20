#!/usr/bin/env node
// Serves ./site under /loft/ like GitHub Pages does (used by the Playwright smoke test).
//   node scripts/serve-site.mjs [--port 4173] [--dir site]
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const port = Number(opt("port", process.env.PORT ?? 4173));
const dir = resolve(opt("dir", "site"));
const prefix = "/loft";
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".woff2": "font/woff2", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".ico": "image/x-icon",
  ".txt": "text/plain", ".md": "text/markdown", ".pdf": "application/pdf", ".mjs": "text/javascript"
};

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (!url.pathname.startsWith(prefix)) {
    res.writeHead(302, { Location: `${prefix}/` }).end();
    return;
  }
  let rel = normalize(decodeURIComponent(url.pathname.slice(prefix.length) || "/")).replace(/^(\.\.[/\\])+/, "");
  let file = join(dir, rel);
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!url.pathname.endsWith("/")) {
      res.writeHead(301, { Location: `${url.pathname}/` }).end();
      return;
    }
    file = join(file, "index.html");
  }
  if (!existsSync(file)) {
    const nf = join(dir, "404.html");
    res.writeHead(404, { "Content-Type": types[".html"] }).end(existsSync(nf) ? readFileSync(nf) : "Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
}).listen(port, () => console.log(`Serving ${dir} at http://localhost:${port}${prefix}/`));
