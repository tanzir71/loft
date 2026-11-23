import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { createAdapter } from "@loft/data";
import "@loft/ui/fonts.css";
import "@loft/ui/tokens.css";
import "@loft/ui/base.css";
import "./app.css";
import "@loft/ui/focus-visibility.css";
import { initializeFocusVisibility } from "@loft/ui/focus-visibility";
import { App } from "./App";
import { DataProvider } from "./lib/data";
import { ADAPTER, ROUTER } from "./lib/env";
import { directRoomStart } from "./lib/auth";

const adapter = createAdapter(ADAPTER, { apiBase: import.meta.env.VITE_API_BASE });
const disposeFocusVisibility = initializeFocusVisibility();
if (import.meta.hot) import.meta.hot.dispose(disposeFocusVisibility);
// GitHub Pages serves one root 404.html for the whole site, so snapshots use hash routing.
const Router = ROUTER === "hash" ? HashRouter : BrowserRouter;
if (ROUTER === "hash" && directRoomStart(location.pathname, import.meta.env.BASE_URL)) history.replaceState(null, "", `${import.meta.env.BASE_URL}#/r/new${location.search}`);
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
