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

export default defineConfig({
  base: process.env.BASE ?? "/",
  plugins: [landingContent()],
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
