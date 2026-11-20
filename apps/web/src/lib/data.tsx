import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { DataAdapter } from "@loft/data";

const Ctx = createContext<DataAdapter | null>(null);

export function DataProvider({ adapter, children }: { adapter: DataAdapter; children: ReactNode }) {
  return <Ctx.Provider value={adapter}>{children}</Ctx.Provider>;
}

export function useAdapter(): DataAdapter {
  const a = useContext(Ctx);
  if (!a) throw new Error("DataProvider missing");
  return a;
}

export interface QueryState<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/** Read a resource and re-read whenever any tab changes data. */
export function useQuery<T>(resource: string | null, params?: Record<string, unknown>): QueryState<T> {
  const adapter = useAdapter();
  const [state, setState] = useState<{ data: T | undefined; error: Error | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  const paramsJson = JSON.stringify(params ?? {});
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!resource) return;
    let alive = true;
    adapter
      .query<T>(resource, JSON.parse(paramsJson) as Record<string, unknown>)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error: Error) => alive && setState((s) => ({ data: s.data, error, loading: false })));
    return () => {
      alive = false;
    };
  }, [adapter, paramsJson, resource, tick]);

  useEffect(() => adapter.subscribe(() => reload()), [adapter, reload]);

  return { ...state, reload };
}
