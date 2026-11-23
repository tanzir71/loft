#!/usr/bin/env node
// A public_html-only distribution for the paired tanziro-website release.
// The PHP payload installs versioned code outside the web root; data stays in loft-app/data.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = process.argv.indexOf("--out");
if (output < 0 || !process.argv[output + 1]) throw new Error("Pass --out <empty staging directory>.");
const destination = resolve(process.argv[output + 1]);
mkdirSync(destination, { recursive: true });
if (readdirSync(destination).length) throw new Error("Build into an empty staging directory.");
const vite = join(root, "node_modules/vite/bin/vite.js");
for (const [workspace, base, folder] of [["landing", "/loft/", "loft"], ["web", "/spaces/", "spaces"]]) {
  execFileSync(process.execPath, [vite, "build", "--outDir", join(destination, folder)], {
    cwd: join(root, "apps", workspace), stdio: "inherit", windowsHide: true,
    env: { ...process.env, BASE: base, APP_URL: "/spaces/", SITE_HOME: "/", MILESTONES_URL: "https://tanzir71.github.io/loft/milestones/",
      VITE_ADAPTER: "http", VITE_ROUTER: "hash", VITE_API_BASE: "/spaces/api/v1", VITE_MILESTONE: "prod" },
  });
}
const payload = {};
function collect(directory, prefix) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(directory, entry.name), name = `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error("Symlinks cannot enter a Loft runtime.");
    if (entry.isDirectory()) collect(file, name);
    else if (entry.isFile() && /\.(php|sql)$/.test(entry.name)) payload[name] = readFileSync(file).toString("base64");
    else throw new Error(`Unexpected Loft runtime file: ${name}`);
  }
}
collect(join(root, "api/src"), "api/src");
collect(join(root, "api/migrations"), "api/migrations");
const json = JSON.stringify(payload), hash = createHash("sha256").update(json).digest("hex");
const api = join(destination, "spaces/api");
cpSync(join(root, "api/public"), api, { recursive: true });
const installer = readFileSync(join(root, "scripts/website-runtime.php"), "utf8")
  .replace("__LOFT_RUNTIME_HASH__", hash).replace("__LOFT_RUNTIME_PAYLOAD__", Buffer.from(json).toString("base64"));
writeFileSync(join(api, "runtime.php"), installer);
writeFileSync(join(api, "index.php"), readFileSync(join(api, "index.php"), "utf8").replace(
  "$candidates = array_filter([", "$app = require __DIR__ . '/runtime.php';\n$candidates = array_filter(["));
writeFileSync(join(api, ".htaccess"), readFileSync(join(api, ".htaccess"), "utf8") + '\n<Files "runtime.php">\n  Require all denied\n</Files>\n');
writeFileSync(join(destination, "spaces/.htaccess"), `Options -Indexes
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^a/(.+)$ api/index.php?__agent=$1 [QSA,L]
  RewriteRule ^api(?:/|$) - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ index.html [L]
</IfModule>
<IfModule mod_headers.c>
  Header always set X-Robots-Tag "noindex, nofollow"
  <FilesMatch "index\\.html$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
`);
writeFileSync(join(destination, "loft/.htaccess"), "Options -Indexes\nDirectoryIndex index.html\n");
for (const [relative, canonical] of [["loft/index.html", "https://tanziro.com/loft"], ["loft/organisations/index.html", "https://tanziro.com/loft/organisations/"]]) {
  const file = join(destination, relative);
  let html = readFileSync(file, "utf8");
  const title = html.match(/<title>(.*?)<\/title>/s)[1];
  const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
  // The paired host provides the same per-image loading feedback as its Tack landing.
  // Keep these references in canonical output; the host versions the shared assets.
  html = html.replace("</head>", `<link rel="stylesheet" href="/media-loading.css" /><script src="/media-loading.js" defer></script><link rel="canonical" href="${canonical}" /><meta property="og:url" content="${canonical}" /><meta property="og:title" content="${title}" /><meta property="og:description" content="${description}" /><meta property="og:image" content="https://tanziro.com/loft/img/hero.webp" /><meta name="twitter:card" content="summary_large_image" /></head>`);
  writeFileSync(file, html);
}
const appIndex = join(destination, "spaces/index.html");
writeFileSync(appIndex, readFileSync(appIndex, "utf8").replace("</head>", '<meta name="robots" content="noindex, nofollow" /><link rel="canonical" href="https://tanziro.com/loft" /></head>'));
console.log(`Built paired Loft website runtime ${hash.slice(0, 12)} at ${destination}`);
