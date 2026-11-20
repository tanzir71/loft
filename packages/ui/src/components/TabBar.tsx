import { Ellipsis, House, Inbox, MessageCircle, Plus } from "lucide-react";
import { AnchorLink, isCurrent, type LinkLike } from "./nav";

export interface TabBarProps {
  current: string;
  Link?: LinkLike;
  chats?: number;
  inbox?: number;
  onNew: () => void;
  paths?: { home: string; chats: string; inbox: string; more: string };
}

const DEFAULT_PATHS = { home: "/", chats: "/chats", inbox: "/inbox", more: "/more" };

/** Figma Foundations · App / Mobile tab bar: Home · Chats · + · Inbox · More (phone < 768). */
export function TabBar({ current, Link = AnchorLink, chats = 0, inbox = 0, onNew, paths = DEFAULT_PATHS }: TabBarProps) {
  const cur = (to: string) => (isCurrent(current, to) ? "page" : undefined);
  return (
    <nav className="lf-tabbar" aria-label="Main">
      <Link to={paths.home} className="lf-tab" aria-current={cur(paths.home)}>
        <span className="lf-tab__icon"><House aria-hidden="true" /></span>
        Home
      </Link>
      <Link to={paths.chats} className="lf-tab" aria-current={cur(paths.chats)}>
        <span className="lf-tab__icon">
          <MessageCircle aria-hidden="true" />
          {chats > 0 && <span className="lf-tab__badge" aria-label={`${chats} unread`}>{chats}</span>}
        </span>
        Chats
      </Link>
      <button type="button" className="lf-tab lf-tab--new" onClick={onNew} aria-label="Start or join a room">
        <span className="lf-tab__icon"><Plus aria-hidden="true" /></span>
      </button>
      <Link to={paths.inbox} className="lf-tab" aria-current={cur(paths.inbox)}>
        <span className="lf-tab__icon">
          <Inbox aria-hidden="true" />
          {inbox > 0 && <span className="lf-tab__badge lf-tab__badge--danger" aria-label={`${inbox} to review`}>{inbox}</span>}
        </span>
        Inbox
      </Link>
      <Link to={paths.more} className="lf-tab" aria-current={cur(paths.more)}>
        <span className="lf-tab__icon"><Ellipsis aria-hidden="true" /></span>
        More
      </Link>
    </nav>
  );
}
