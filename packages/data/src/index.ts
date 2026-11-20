export * from "./types";
export * from "./router";
export { LocalAdapter, type LocalAdapterOptions } from "./local/adapter";
export { HttpAdapter, type HttpAdapterOptions } from "./http";
export { DEMO_HOST_ID, SEED_VERSION } from "./local/seed";

import { HttpAdapter } from "./http";
import { LocalAdapter } from "./local/adapter";
import type { DataAdapter } from "./types";

/** Pick the adapter from VITE_ADAPTER ("local" on GitHub Pages, "http" in production). */
export function createAdapter(kind: string | undefined, opts: { apiBase?: string } = {}): DataAdapter {
  return kind === "http" ? new HttpAdapter(opts.apiBase ? { base: opts.apiBase } : {}) : new LocalAdapter();
}
