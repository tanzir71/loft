import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, DoorOpen, Hand, Plus, Settings } from "lucide-react";
import { Avatar } from "./Avatar";
import { Count } from "./Badge";
import { AnchorLink, isCurrent, type DmLink, type LinkLike, type LiveRoomLink, type Me, type NavItem, type SpaceLink } from "./nav";

export interface SidePanelProps {
  brand: { name: string; monogram: string };
  nav: NavItem[];
  current: string;
  rooms: LiveRoomLink[];
  spaces: SpaceLink[];
  dms: DmLink[];
  me: Me;
  Link?: LinkLike;
  onNewRoom?: () => void;
  onJoinCode?: () => void;
  onNewSpace?: () => void;
  onNewDm?: () => void;
  onKnock?: (dm: DmLink) => void;
  onSettings?: () => void;
  onNavigate?: () => void;
}

function Section({ title, onAdd, addLabel, children }: { title: string; onAdd?: () => void; addLabel: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="lf-side__group">
      <div className="lf-side__head">
        <button type="button" className="lf-side__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          {title}
        </button>
        {onAdd && (
          <button type="button" className="lf-side__add" onClick={onAdd} aria-label={addLabel}>
            <Plus aria-hidden="true" />
          </button>
        )}
      </div>
      {open && children}
    </div>
  );
}

/** Figma Foundations · App / Side panel (264 px, desktop ≥ 1200). */
export function SidePanel(p: SidePanelProps) {
  const Link = p.Link ?? AnchorLink;
  const cur = (to: string) => (isCurrent(p.current, to) ? "page" : undefined);
  return (
    <nav className="lf-side" aria-label="Main">
      <div className="lf-side__brand">
        <span className="lf-mark" aria-hidden="true">{p.brand.monogram}</span>
        <span className="lf-wordmark">{p.brand.name}</span>
        <button type="button" className="lf-icon-btn lf-icon-btn--primary" onClick={p.onNewRoom} aria-label="Start a room" title="Start a room">
          <Plus aria-hidden="true" />
        </button>
      </div>

      <div className="lf-side__group">
        {p.nav.map((n) => (
          <Link key={n.key} to={n.to} className="lf-side__item" aria-current={cur(n.to)} onClick={p.onNavigate}>
            {n.icon}
            <span className="lf-side__label">{n.label}</span>
            {n.count ? <Count n={n.count} /> : null}
          </Link>
        ))}
      </div>

      <Section title="Live rooms" onAdd={p.onNewRoom} addLabel="Start a room">
        {p.rooms.map((r) => (
          <Link key={r.id} to={r.to} className="lf-side__item" aria-current={cur(r.to)} onClick={p.onNavigate}>
            <span className="lf-side__live-dot" aria-hidden="true" />
            <span className="lf-side__label">{r.name}</span>
            <span className="lf-side__num" aria-label={`${r.people} in the room`}>{r.people}</span>
          </Link>
        ))}
        <button type="button" className="lf-side__item lf-side__item--link" onClick={p.onJoinCode}>
          <DoorOpen aria-hidden="true" />
          <span className="lf-side__label">Join with a code</span>
        </button>
      </Section>

      <Section title="Spaces" onAdd={p.onNewSpace} addLabel="New space">
        {p.spaces.map((s) => (
          <Link
            key={s.id}
            to={s.to}
            className={`lf-side__item lf-side__item--space${s.unread ? " lf-side__item--unread" : ""}`}
            aria-current={cur(s.to)}
            onClick={p.onNavigate}
          >
            <span className="lf-side__hash" aria-hidden="true">#</span>
            <span className="lf-side__label">{s.slug}</span>
            {s.unread ? <Count n={s.unread} tone="primary" label={`${s.unread} unread`} /> : null}
          </Link>
        ))}
      </Section>

      <Section title="Direct messages" onAdd={p.onNewDm} addLabel="New message">
        {p.dms.map((d) => (
          <div key={d.id} className="lf-side__item lf-side__item--dm" aria-current={cur(d.to)} style={{ padding: 0 }}>
            <Link to={d.to} className="lf-side__item lf-side__item--dm" aria-current={cur(d.to)} onClick={p.onNavigate}>
              <Avatar name={d.name} size="sm" presence={d.presence} />
              <span className="lf-side__label">{d.name}</span>
              {d.note && <span className="lf-side__note">{d.note}</span>}
            </Link>
            {d.canKnock && (
              <button type="button" className="lf-knock" onClick={() => p.onKnock?.(d)} aria-label={`Knock on ${d.name}`}>
                <Hand aria-hidden="true" />
                Knock
              </button>
            )}
          </div>
        ))}
      </Section>

      <div className="lf-side__spacer" />
      <div className="lf-side__me">
        <Avatar name={p.me.name} tone="lilac" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="lf-side__me-name">{p.me.name}</div>
          <div className="lf-side__me-status">{p.me.status}</div>
        </div>
        <button type="button" className="lf-icon-btn" onClick={p.onSettings} aria-label="Settings">
          <Settings aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
