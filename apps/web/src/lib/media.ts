import { useSyncExternalStore } from "react";

export type Breakpoint = "phone" | "tablet" | "desktop";

/** ≥1200 desktop (264 px side panel) · 768–1199 tablet (56 px rail + drawer) · <768 phone (tab bar). */
export function breakpointFor(width: number): Breakpoint {
  if (width >= 1200) return "desktop";
  if (width >= 768) return "tablet";
  return "phone";
}

function subscribe(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, () => breakpointFor(window.innerWidth), () => "desktop");
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** navigator.onLine as state (Figma 07 · "Offline" / "Reconnecting call"). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}
