/** Cross-tab bus: BroadcastChannel for other tabs + an in-tab EventTarget (BroadcastChannel skips the sender). */
export type BusMsg =
  | { type: "changed"; tables: string[] }
  | { type: "ops"; roomId: string }
  | { type: "presence"; roomId: string; peer: Record<string, unknown> & { tabId: string } }
  | { type: "presence-leave"; roomId: string; tabId: string }
  | { type: "presence-hello"; roomId: string; tabId: string }
  | { type: "signal"; roomId: string; msg: { from: string; to?: string; type: string; data?: unknown } };

export class Bus {
  private bc: BroadcastChannel | null;
  private local = new EventTarget();

  constructor(name: string) {
    this.bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(name) : null;
    this.bc?.addEventListener("message", (e: MessageEvent) => this.dispatch(e.data as BusMsg, false));
  }

  post(msg: BusMsg, { self = true }: { self?: boolean } = {}) {
    this.bc?.postMessage(msg);
    if (self) this.dispatch(msg, true);
  }

  on(handler: (msg: BusMsg, fromSelf: boolean) => void): () => void {
    const fn = (e: Event) => {
      const d = (e as CustomEvent).detail as { msg: BusMsg; self: boolean };
      handler(d.msg, d.self);
    };
    this.local.addEventListener("msg", fn);
    return () => this.local.removeEventListener("msg", fn);
  }

  close() {
    this.bc?.close();
  }

  private dispatch(msg: BusMsg, self: boolean) {
    this.local.dispatchEvent(new CustomEvent("msg", { detail: { msg, self } }));
  }
}
