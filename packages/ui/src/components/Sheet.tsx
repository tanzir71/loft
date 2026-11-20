import { useEffect, useRef, type ReactNode } from "react";

/** Modal on desktop, bottom sheet on phone. The action row is sticky so it never scrolls away. */
export function Sheet({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: string; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="lf-scrim" onClick={onClose} />
      <div className="lf-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="lf-sheet__grab" aria-hidden="true" />
        <div className="lf-sheet__body">{children}</div>
        {actions && <div className="lf-sheet__actions">{actions}</div>}
      </div>
    </>
  );
}
