/** Slim banner shown on every GitHub Pages (local adapter) build. */
export function PreviewBanner({ text = "Preview build: data stays in this browser." }: { text?: string }) {
  return (
    <div className="lf-preview-banner" role="note">
      <b>Preview</b>
      <span>{text.replace(/^Preview build:\s*/i, "Preview build: ")}</span>
    </div>
  );
}
