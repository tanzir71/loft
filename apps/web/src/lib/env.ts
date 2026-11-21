export const ADAPTER = import.meta.env.VITE_ADAPTER === "http" ? "http" : "local";
export const IS_PREVIEW = ADAPTER === "local";
export const ROUTER = import.meta.env.VITE_ROUTER === "hash" ? "hash" : "browser";
export const MILESTONE = import.meta.env.VITE_MILESTONE ?? "dev";

/** Absolute link to an app path (e.g. a payer's /pay/<token>), for copy buttons and wa.me messages. */
export function appUrl(path: string): string {
  if (typeof location === "undefined") return path;
  if (ROUTER === "hash") return `${location.origin}${location.pathname}#${path}`;
  return `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;
}
