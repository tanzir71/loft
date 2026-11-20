import "@loft/ui/fonts.css";
import "@loft/ui/tokens.css";
import "./landing.css";

// GitHub Pages builds run with VITE_ADAPTER=local and show the preview banner.
if (import.meta.env.VITE_ADAPTER !== "http") {
  const b = document.createElement("div");
  b.className = "preview-banner";
  b.setAttribute("role", "note");
  b.innerHTML = "<b>Preview</b> Preview build: data stays in this browser.";
  document.body.prepend(b);
}
