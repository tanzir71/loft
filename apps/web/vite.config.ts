import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// BASE: "/loft/app/" (latest on Pages), "/loft/m<N>/app/" (snapshot), "/spaces/" (production).
export default defineConfig({
  base: process.env.BASE ?? "/",
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
  server: { port: 5173 }
});
