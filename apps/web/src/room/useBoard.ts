import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { applyOp, applyOps, emptyBoard, UndoStack, type BoardOp, type BoardState } from "@loft/board";
import { newId } from "@loft/core";
import { useAdapter } from "../lib/data";

/**
 * Board state for a room: the confirmed op-log (from adapter.sync) plus this tab's
 * optimistic ops, which are dropped once their echo (matched by `_cid`) comes back.
 */
export function useBoard(roomId: string | null, actor: string) {
  const adapter = useAdapter();
  const [confirmed, setConfirmed] = useState<BoardState>(emptyBoard);
  const [pending, setPending] = useState<{ cid: string; op: BoardOp }[]>([]);
  const [synced, setSynced] = useState(false);
  const undo = useRef(new UndoStack());

  useEffect(() => {
    if (!roomId) return;
    const ctrl = new AbortController();
    setConfirmed(emptyBoard());
    setSynced(false);
    void (async () => {
      try {
        setSynced(true);
        for await (const ops of adapter.sync(roomId, 0, ctrl.signal)) {
          setConfirmed((s) => applyOps(s, ops));
          const echoed = new Set(ops.map((o) => (o.payload as { _cid?: string } | null)?._cid).filter(Boolean));
          if (echoed.size) setPending((p) => p.filter((x) => !echoed.has(x.cid)));
        }
      } catch {
        /* aborted or offline; the room shows a reconnecting state */
      }
    })();
    return () => ctrl.abort();
  }, [adapter, roomId]);

  const state = useMemo(() => pending.reduce((s, p) => applyOp(s, p.op), confirmed), [confirmed, pending]);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  const send = useCallback(
    (op: BoardOp) => {
      if (!roomId) return;
      const cid = newId();
      setPending((p) => [...p, { cid, op }]);
      void adapter.append(roomId, [{ actor, kind: op.kind, payload: { ...op.payload, _cid: cid } }]).catch(() => {
        setPending((p) => p.filter((x) => x.cid !== cid));
      });
    },
    [adapter, roomId, actor]
  );

  /** Apply an op you made (recorded for undo). */
  const commit = useCallback(
    (op: BoardOp) => {
      undo.current.record(stateRef.current, op);
      send(op);
    },
    [send]
  );

  const doUndo = useCallback(() => {
    const op = undo.current.undo(stateRef.current);
    if (op) send(op);
  }, [send]);
  const doRedo = useCallback(() => {
    const op = undo.current.redo(stateRef.current);
    if (op) send(op);
  }, [send]);

  return { state, commit, undo: doUndo, redo: doRedo, synced };
}
