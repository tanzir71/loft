import "@loft/ui/tokens.css";
import "./landing.css";

const PREVIEW = import.meta.env.VITE_ADAPTER !== "http";

// GitHub Pages builds run with the local adapter and show the preview banner.
if (PREVIEW) {
  const b = document.createElement("div");
  b.className = "preview-banner";
  b.setAttribute("role", "note");
  b.innerHTML = "<b>Preview</b> Preview build: data stays in this browser.";
  document.body.prepend(b);
}

// Hero quick start: start a room (optional name, guest toggle) or join with a code/link.
const quick = document.querySelector<HTMLElement>(".quick");
if (quick) {
  const go = (base: string, params: Record<string, string>) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "")).toString();
    location.href = qs ? `${base}${base.includes("?") ? "&" : "?"}${qs}` : base;
  };
  document.querySelector<HTMLFormElement>("#q-start")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    go(quick.dataset.start ?? "", { name: String(f.get("name") ?? "").trim(), guests: f.get("guests") ? "1" : "0" });
  });
  document.querySelector<HTMLFormElement>("#q-join")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const raw = String(f.get("code") ?? "").trim();
    // Accept a full room link (…/r/<code>) or a bare code.
    const code = (raw.match(/\/r\/([a-z0-9-]+)/i)?.[1] ?? raw).toLowerCase();
    const you = String(f.get("you") ?? "").trim();
    try {
      if (you) localStorage.setItem("loft.guestName", you);
    } catch {
      /* private mode */
    }
    go(quick.dataset.join ?? "", { code, name: you });
  });
}

// Organisations contact form: POST to the API in production; open a filled-in email on Pages.
const contact = document.querySelector<HTMLFormElement>("#contact");
if (contact) {
  const status = contact.querySelector<HTMLElement>(".contact__status");
  contact.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(contact).entries()) as Record<string, string>;
    const org = data.organisation?.trim() || "<organisation>";
    const body = [
      `Organisation · website · country: ${data.organisation} · ${data.website || "-"} · ${data.country || "-"}`,
      `People using loft (rough): ${data.people || "-"}`,
      `Monthly or yearly: ${data.period}`,
      `Email of your loft admin: ${data.admin_email}`
    ].join("\n");
    const mailto = `mailto:${contact.dataset.mail}?subject=${encodeURIComponent(`Branded loft for ${org}`)}&body=${encodeURIComponent(body)}`;
    if (PREVIEW) {
      location.href = mailto;
      if (status) status.textContent = "Opening your mail app…";
      return;
    }
    try {
      const res = await fetch(contact.dataset.endpoint ?? "/spaces/api/v1/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error(String(res.status));
      contact.reset();
      if (status) status.textContent = "Thanks. We'll reply by email with an invoice.";
    } catch {
      if (status) status.textContent = "That didn't send. Opening your mail app instead.";
      location.href = mailto;
    }
  });
}
