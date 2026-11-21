#!/usr/bin/env node
// Production build for Namecheap shared hosting (handoff §10 · M10):
//   loft-prod.zip
//   ├─ public_html/loft/            landing (tanziro.com/loft)
//   ├─ public_html/spaces/          the app, HTTP adapter (tanziro.com/spaces)
//   │  ├─ .htaccess                 agent links + branded org paths
//   │  └─ api/index.php, .htaccess  front controller (tanziro.com/spaces/api/v1/…)
//   └─ loft-app/                    outside the web root
//      ├─ api/src, api/migrations
//      └─ data/                     created by the install wizard (SQLite, uploads, config.php)
// Usage: node scripts/build-prod.mjs [--out loft-prod.zip]
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const out = resolve(repo, args.includes("--out") ? args[args.indexOf("--out") + 1] : "loft-prod.zip");
const stage = join(repo, ".prod-build");
const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version ?? "0.0.0";

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const web = join(stage, "public_html");

function build(workspace, base, dest, extra = {}) {
  const env = { ...process.env, BASE: base, VITE_MILESTONE: "prod", ...extra };
  execFileSync("npx", ["vite", "build", "--outDir", dest, "--emptyOutDir"], { cwd: join(repo, workspace), env, stdio: "inherit" });
}

build("apps/landing", "/loft/", join(web, "loft"), { VITE_ADAPTER: "http" });
build("apps/web", "/spaces/", join(web, "spaces"), { VITE_ADAPTER: "http", VITE_ROUTER: "hash", VITE_API_BASE: "/spaces/api/v1" });

// The app's .htaccess: agent links (/spaces/a/<token>) go to the API; branded org paths
// (/spaces/<org-slug>) and anything else that isn't a file serve the app.
writeFileSync(
  join(web, "spaces", ".htaccess"),
  `Options -Indexes
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^a/(.+)$ api/index.php?__agent=$1 [QSA,L]
  RewriteCond %{REQUEST_URI} !/api/
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^ index.html [L]
</IfModule>
<IfModule mod_headers.c>
  <FilesMatch "\\.(js|css|woff2|webp|svg)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "index\\.html$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
</IfModule>
`
);

// API: the public front controller + the code outside the web root.
cpSync(join(repo, "api", "public"), join(web, "spaces", "api"), { recursive: true });
cpSync(join(repo, "api", "src"), join(stage, "loft-app", "api", "src"), { recursive: true });
cpSync(join(repo, "api", "migrations"), join(stage, "loft-app", "api", "migrations"), { recursive: true });
mkdirSync(join(stage, "loft-app", "data"), { recursive: true });
writeFileSync(join(stage, "loft-app", "data", ".htaccess"), "Require all denied\n");
writeFileSync(join(stage, "loft-app", "VERSION"), `${version}\n`);
writeFileSync(
  join(stage, "README-DEPLOY.txt"),
  `Loft ${version} · production build

1. In cPanel → File Manager, upload loft-prod.zip to your home folder and extract it.
   It creates public_html/loft, public_html/spaces and loft-app (outside the web root).
2. Pick PHP 8.2 in cPanel → Select PHP Version and enable: pdo_sqlite, sqlite3, openssl, sodium, curl, mbstring.
3. Open https://<your-domain>/spaces/ — the install wizard checks the server and creates the owner account.
4. Back up loft-app/data/ (it holds the database, uploads and config.php).

Full guide: docs/deploy-namecheap.md in the repository.
`
);

if (existsSync(out)) rmSync(out);
execFileSync("zip", ["-qr", out, "public_html", "loft-app", "README-DEPLOY.txt"], { cwd: stage, stdio: "inherit" });
rmSync(stage, { recursive: true, force: true });
console.log(`Built ${out}`);
