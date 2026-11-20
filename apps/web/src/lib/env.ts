export const ADAPTER = import.meta.env.VITE_ADAPTER === "http" ? "http" : "local";
export const IS_PREVIEW = ADAPTER === "local";
export const ROUTER = import.meta.env.VITE_ROUTER === "hash" ? "hash" : "browser";
export const MILESTONE = import.meta.env.VITE_MILESTONE ?? "dev";
