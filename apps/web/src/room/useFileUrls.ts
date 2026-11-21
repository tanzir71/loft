import { useCallback, useEffect, useRef, useState } from "react";
import type { BoardState } from "@loft/board";
import { useAdapter } from "../lib/data";

/** Resolve page background file ids to URLs (object URLs from IndexedDB locally, API URLs in production). */
export function useFileUrls(state: BoardState) {
  const adapter = useAdapter();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());
  useEffect(() => {
    const ids = Object.values(state.pages).map((p) => p.bg).filter((x): x is string => !!x && !urls[x] && !pending.current.has(x));
    for (const id of ids) {
      pending.current.add(id);
      const files = adapter.files as typeof adapter.files & { load?: (id: string) => Promise<string> };
      void (files.load ? files.load(id) : Promise.resolve(files.url(id))).then((u) => {
        pending.current.delete(id);
        if (u) setUrls((m) => ({ ...m, [id]: u }));
      });
    }
  }, [adapter, state.pages, urls]);
  const url = useCallback((id: string) => urls[id], [urls]);
  const image = useCallback(
    async (id: string) => {
      const files = adapter.files as typeof adapter.files & { load?: (id: string) => Promise<string> };
      const u = urls[id] ?? (files.load ? await files.load(id) : files.url(id));
      if (!u) return null;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = u;
      try {
        await img.decode();
        return img;
      } catch {
        return null;
      }
    },
    [adapter, urls]
  );
  return { url, image };
}
