/** Match the portfolio's modality policy without removing focus or text selection. */
export function initializeFocusVisibility() {
  const root = document.documentElement;
  const pointer = () => { root.dataset.pointerFocus = ""; };
  const keyboard = (event: KeyboardEvent) => {
    const editing = event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable="true"]');
    if (/^(Tab|Arrow.*|Home|End|PageUp|PageDown|Escape|Enter)$/.test(event.key) || !editing) delete root.dataset.pointerFocus;
  };
  pointer();
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboard, true);
  return () => {
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
    delete root.dataset.pointerFocus;
  };
}
