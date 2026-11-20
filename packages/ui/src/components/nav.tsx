import type { ComponentType, ReactNode } from "react";
import type { Presence } from "./Avatar";

export interface LinkLikeProps {
  to: string;
  className?: string;
  children?: ReactNode;
  "aria-current"?: "page" | undefined;
  "aria-label"?: string;
  title?: string;
  onClick?: () => void;
}
export type LinkLike = ComponentType<LinkLikeProps>;

export const AnchorLink: LinkLike = ({ to, children, ...rest }) => (
  <a href={to} {...rest}>
    {children}
  </a>
);

export interface NavItem {
  key: string;
  label: string;
  to: string;
  icon: ReactNode;
  count?: number;
}
export interface LiveRoomLink {
  id: string;
  name: string;
  to: string;
  people: number;
}
export interface SpaceLink {
  id: string;
  slug: string;
  to: string;
  unread?: number;
}
export interface DmLink {
  id: string;
  name: string;
  to: string;
  presence: Presence;
  note?: string;
  canKnock?: boolean;
}
export interface Me {
  name: string;
  status: string;
}

/** `current` matches when the path equals `to`, or starts with it for non-root links. */
export function isCurrent(current: string, to: string): boolean {
  if (to === "/") return current === "/";
  return current === to || current.startsWith(to + "/");
}
