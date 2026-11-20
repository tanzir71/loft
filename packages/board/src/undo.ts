import { applyOp, inverseOf } from "./reduce";
import type { BoardOp, BoardState } from "./types";

/** Per-user undo/redo of your own ops (others' edits are never undone). */
export class UndoStack {
  private undos: BoardOp[] = [];
  private redos: BoardOp[] = [];
  constructor(private limit = 200) {}

  /** Record an op you are about to apply to `before`. */
  record(before: BoardState, op: BoardOp): void {
    const inv = inverseOf(before, op);
    if (!inv) return;
    this.undos.push(inv);
    if (this.undos.length > this.limit) this.undos.shift();
    this.redos = [];
  }

  /** Returns the op to apply (and remembers how to redo it). */
  undo(current: BoardState): BoardOp | null {
    const op = this.undos.pop();
    if (!op) return null;
    const inv = inverseOf(current, op);
    if (inv) this.redos.push(inv);
    return op;
  }

  redo(current: BoardState): BoardOp | null {
    const op = this.redos.pop();
    if (!op) return null;
    const inv = inverseOf(current, op);
    if (inv) this.undos.push(inv);
    return op;
  }

  get canUndo() {
    return this.undos.length > 0;
  }
  get canRedo() {
    return this.redos.length > 0;
  }
}

export { applyOp };
