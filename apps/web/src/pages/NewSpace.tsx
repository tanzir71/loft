import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, GraduationCap, LayoutDashboard, Users, Wallet, X } from "lucide-react";
import { Button } from "@loft/ui";
import { MODE_ORDER, SPACE_COLOURS, SPACE_MODES, spaceCode, tabLabel, type SpaceMode } from "@loft/core";
import { useAdapter } from "../lib/data";
import { Home } from "./Home";

const ICONS = { users: Users, wallet: Wallet, "layout-dashboard": LayoutDashboard, "graduation-cap": GraduationCap, "book-open": BookOpen };

/** Figma 07 · "New space · step 1 mode" (+ step 2 details). Shown as a modal over Home. */
export function NewSpace() {
  const nav = useNavigate();
  const adapter = useAdapter();
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<SpaceMode>("client");
  const [name, setName] = useState("");
  const [sub, setSub] = useState("");
  const [colour, setColour] = useState<string>("blue");
  const [busy, setBusy] = useState(false);
  const close = () => nav("/");

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const s = await adapter.mutate<{ slug: string }>("spaces", { name, mode, sub, colour });
      nav(`/s/${s.slug}`, { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Home />
      <div className="lf-scrim" onClick={close} />
      <div className="lf-sheet wizard" role="dialog" aria-modal="true" aria-labelledby="ns-title">
        <div className="lf-sheet__grab" aria-hidden="true" />
        <header className="wizard__head">
          <div>
            <h2 id="ns-title">New space</h2>
            <p>Step {step} of 2 · {step === 1 ? "what is it for?" : "details"}</p>
          </div>
          <button type="button" className="lf-icon-btn" onClick={close} aria-label="Close"><X aria-hidden="true" /></button>
        </header>
        <div className="lf-sheet__body">
          {step === 1 ? (
            <>
              <div className="mode-list" role="radiogroup" aria-label="Mode">
                {MODE_ORDER.map((m) => {
                  const cfg = SPACE_MODES[m];
                  const Icon = ICONS[cfg.icon];
                  return (
                    <button key={m} type="button" role="radio" aria-checked={mode === m} className={`mode-opt${mode === m ? " is-on" : ""}`} onClick={() => setMode(m)}>
                      <span className="mode-opt__ic" aria-hidden="true"><Icon /></span>
                      <span className="mode-opt__text">
                        <b>{cfg.label}</b>
                        <span>{cfg.blurb}</span>
                      </span>
                      <span className="mode-opt__tabs">{cfg.tabs.filter((t) => t !== "chat").slice(0, 4).map((t) => tabLabel(m, t)).join(" · ")}</span>
                    </button>
                  );
                })}
              </div>
              <p className="field-help">The mode only changes labels, tabs and templates. You can switch later.</p>
            </>
          ) : (
            <form
              className="ns-form"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <label className="field-label" htmlFor="ns-name">Name</label>
              <input id="ns-name" className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === "client" ? "Acme pricing" : mode === "course" ? "HSC Physics" : "Product team"} maxLength={60} autoFocus required />
              <label className="field-label" htmlFor="ns-sub">{mode === "client" ? "Client" : "Subtitle"} (optional)</label>
              <input id="ns-sub" className="field" value={sub} onChange={(e) => setSub(e.target.value)} placeholder={mode === "client" ? "Acme Foods · Consulting" : SPACE_MODES[mode].label} maxLength={80} />
              <span className="field-label">Colour</span>
              <div className="colour-pick" role="radiogroup" aria-label="Colour">
                {SPACE_COLOURS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={colour === c} aria-label={c} className={`colour-pick__dot sc-${c}`} onClick={() => setColour(c)} />
                ))}
              </div>
              <div className={`space-card__head sc-${colour} ns-preview`} aria-hidden="true">
                <b>{name || "Your space"}</b>
                <span>{sub || SPACE_MODES[mode].label}</span>
                <i>{spaceCode(name || "Loft")}</i>
              </div>
            </form>
          )}
        </div>
        <footer className="lf-sheet__actions wizard__foot">
          {step === 1 ? (
            <>
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button icon={<ArrowRight aria-hidden="true" />} onClick={() => setStep(2)}>Next: details</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" icon={<ArrowLeft aria-hidden="true" />} onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => void create()} disabled={!name.trim() || busy}>Create space</Button>
            </>
          )}
        </footer>
      </div>
    </>
  );
}
