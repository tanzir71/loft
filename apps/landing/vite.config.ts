import { defineConfig } from "vite";
import { resolve } from "node:path";

// Multi-page static site: / (landing) and /organisations/. BASE: "/loft/" or "/loft/m<N>/" on Pages, "/loft/" in production.
export default defineConfig({
  base: process.env.BASE ?? "/",
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
