/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_ADAPTER?: "local" | "http";
  readonly VITE_ROUTER?: "hash" | "browser";
  readonly VITE_API_BASE?: string;
  readonly VITE_MILESTONE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
