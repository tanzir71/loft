import loftLogo from "../assets/loft-logo.png";

/** The product icon is fixed artwork; custom organisations retain their own monogram. */
export function BrandIcon({ monogram = "L", name = "Loft", className = "", decorative = true }: {
  monogram?: string; name?: string; className?: string; decorative?: boolean;
}) {
  if (monogram === "L" && name.trim().toLowerCase() === "loft") {
    return <img className={`lf-mark lf-mark--logo ${className}`.trim()} src={loftLogo} width={32} height={32} alt={decorative ? "" : "Loft"} aria-hidden={decorative ? "true" : undefined} />;
  }
  return <span className={`lf-mark ${className}`.trim()} aria-hidden={decorative ? "true" : undefined}>{monogram}</span>;
}

/** Product icon or custom brand monogram, plus an optional wordmark. */
export function BrandMark({ monogram = "L", name, onClick, label }: { monogram?: string; name?: string; onClick?: () => void; label?: string }) {
  const mark = <BrandIcon monogram={monogram} name={name} decorative={Boolean(name || onClick)} />;
  return (
    <>
      {onClick ? (
        <button type="button" className="lf-mark-btn" onClick={onClick} aria-label={label ?? "Open menu"}>
          {mark}
        </button>
      ) : (
        mark
      )}
      {name && <span className="lf-wordmark">{name}</span>}
    </>
  );
}
