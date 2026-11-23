import { Plus } from "lucide-react";
import { BrandIcon } from "./BrandMark";
import { AnchorLink, isCurrent, type LinkLike, type NavItem } from "./nav";

/** Tablet (768–1199): 56 px icon rail. Tapping the brand mark opens the side panel as a drawer. */
export function IconRail({ brand, nav, current, Link = AnchorLink, onOpenDrawer, onNewRoom }: {
  brand: { monogram: string; name: string };
  nav: NavItem[];
  current: string;
  Link?: LinkLike;
  onOpenDrawer: () => void;
  onNewRoom?: () => void;
}) {
  return (
    <nav className="lf-rail" aria-label="Main">
      <button type="button" className="lf-rail__item" onClick={onOpenDrawer} aria-label={`Open ${brand.name} menu`}>
        <BrandIcon monogram={brand.monogram} name={brand.name} />
      </button>
      <button type="button" className="lf-icon-btn lf-icon-btn--primary" onClick={onNewRoom} aria-label="Start a room">
        <Plus aria-hidden="true" />
      </button>
      <span className="lf-rail__sep" aria-hidden="true" />
      {nav.map((n) => (
        <Link key={n.key} to={n.to} className="lf-rail__item" aria-current={isCurrent(current, n.to) ? "page" : undefined} aria-label={n.label} title={n.label}>
          {n.icon}
          {n.count ? <span className="lf-count" aria-hidden="true">{n.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
