/** Resume only an app route, never an external URL or auth loop. */
export function afterAuth(value: string | null): string {
  return value && /^\/(?!\/)[^\\\r\n]*$/.test(value) && !/^\/(?:signin|install)(?:[/?]|$)/.test(value) ? value : "/";
}
export function directRoomStart(pathname: string, base: string): boolean {
  return pathname.replace(/\/$/, "") === base.replace(/\/$/, "") + "/new";
}
