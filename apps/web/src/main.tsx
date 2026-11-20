import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { createAdapter } from "@loft/data";
import "@loft/ui/fonts.css";
import "@loft/ui/tokens.css";
import "@loft/ui/base.css";
import "./app.css";
import { App } from "./App";
import { DataProvider } from "./lib/data";
import { ADAPTER, ROUTER } from "./lib/env";

const adapter = createAdapter(ADAPTER, { apiBase: import.meta.env.VITE_API_BASE });
// GitHub Pages serves one root 404.html for the whole site, so snapshots use hash routing.
const Router = ROUTER === "hash" ? HashRouter : BrowserRouter;
const basename = ROUTER === "hash" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DataProvider adapter={adapter}>
      <Router basename={basename}>
        <App />
      </Router>
    </DataProvider>
  </StrictMode>
);
