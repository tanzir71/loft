import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Avatar, BrandIcon } from "@loft/ui";
import { useBreakpoint } from "../lib/media";
import { useQuery } from "../lib/data";
import type { NavData } from "./AppShell";
import { NotificationsBell } from "../pages/Inbox";

/** Phone header (Figma 05 · Host · Home (phone)): mark + title + search + avatar. Desktop: 68 px top bar. */
export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }) {
  const bp = useBreakpoint();
  const { data } = useQuery<NavData>("nav");
  if (bp === "phone") {
    return (
      <header className="phone-header">
        <BrandIcon monogram={data?.brand.monogram} name={data?.brand.name} />
        <h1 className="phone-header__title">{title}</h1>
        {actions}
        <button type="button" className="lf-icon-btn" aria-label="Search">
          <Search aria-hidden="true" />
        </button>
        <Avatar name={data?.me.name ?? "?"} tone="lilac" />
      </header>
    );
  }
  return (
    <header className="top-bar">
      <h1 className="top-bar__title">{title}</h1>
      <div className="top-bar__actions">{actions}<NotificationsBell /></div>
    </header>
  );
}
