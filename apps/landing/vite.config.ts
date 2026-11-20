import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
// @ts-expect-error plain ESM build helpers without types
import { makeLinks, renderLanding, renderOrganisations } from "./build/content.mjs";

// Multi-page static site: / (landing) and /organisations/.
// BASE: "/loft/" or "/loft/m<N>/" on Pages, "/loft/" in production.
// APP_URL: where the SPA lives ("<base>app/" on Pages, "/spaces/" in production).
function landingContent(): Plugin {
  let base = "/";
  return {
    name: "loft-landing-content",
    configResolved(c) {
      base = c.base;
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const L = makeLinks({ base, appUrl: process.env.APP_URL, router: process.env.VITE_ROUTER ?? "hash" });
        const body = ctx.path.includes("organisations") ? renderOrganisations(L) : renderLanding(L);
        return html.replace("<!--@content-->", body);
      }
    }
  };
}

// Inline the (small) stylesheet into each page so nothing blocks first paint.
function inlineCss(): Plugin {
  return {
    name: "loft-inline-css",
    apply: "build",
    enforce: "post",
    generateBundle(_opts, bundle) {
      const css = Object.values(bundle).filter((f) => f.type === "asset" && f.fileName.endsWith(".css"));
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".html")) continue;
        let html = String(file.source);
        for (const c of css) {
          if (c.type !== "asset") continue;
          const re = new RegExp(`<link rel="stylesheet"[^>]*href="[^"]*${c.fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`);
          html = html.replace(re, `<style>${String(c.source)}</style>`);
        }
        file.source = html;
      }
      for (const c of css) delete bundle[c.fileName];
    }
  };
}

export default defineConfig({
  base: process.env.BASE ?? "/",
  plugins: [landingContent(), inlineCss()],
  build: {
    outDir: "dist",
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        organisations: resolve(import.meta.dirname, "organisations/index.html")
      }
    }
  },
  server: { port: 5174 }
});
