/** Brand monogram + wordmark. Text comes from the org's theme (brand/monogram, brand/name). */
export function BrandMark({ monogram = "L", name, onClick, label }: { monogram?: string; name?: string; onClick?: () => void; label?: string }) {
  const mark = <span className="lf-mark" aria-hidden={name ? "true" : undefined}>{monogram}</span>;
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
