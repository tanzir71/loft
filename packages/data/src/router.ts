/** Tiny "resource" router shared by the local adapter (and mirrored by the PHP API). */
export type Params = Record<string, string>;
export type Handler<Ctx> = (ctx: Ctx, params: Params, input: Record<string, unknown>) => Promise<unknown> | unknown;

export class ResourceRouter<Ctx> {
  private routes: { method: "GET" | "POST"; parts: string[]; handler: Handler<Ctx> }[] = [];

  get(pattern: string, handler: Handler<Ctx>) {
    this.routes.push({ method: "GET", parts: pattern.split("/"), handler });
    return this;
  }
  post(pattern: string, handler: Handler<Ctx>) {
    this.routes.push({ method: "POST", parts: pattern.split("/"), handler });
    return this;
  }

  match(method: "GET" | "POST", resource: string): { handler: Handler<Ctx>; params: Params } | null {
    const parts = resource.replace(/^\/+|\/+$/g, "").split("/");
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== parts.length) continue;
      const params: Params = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const want = r.parts[i] as string;
        const got = parts[i] as string;
        if (want.startsWith(":")) params[want.slice(1)] = decodeURIComponent(got);
        else if (want !== got) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: r.handler, params };
    }
    return null;
  }
}
