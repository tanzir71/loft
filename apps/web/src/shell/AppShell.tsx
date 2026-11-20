import { useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { IconRail, PreviewBanner, SidePanel, TabBar, type DmLink, type LiveRoomLink, type SpaceLink } from "@loft/ui";
import type { User } from "@loft/core";
import { useQuery } from "../lib/data";
import { useBreakpoint } from "../lib/media";
import { IS_PREVIEW } from "../lib/env";
import { mainNav } from "./nav";
import { RouterLink } from "./RouterLink";
import { StartSheet } from "./StartSheet";

export interface NavData {
  me: User;
  brand: { name: string; monogram: string };
  rooms: LiveRoomLink[];
  spaces: SpaceLink[];
  dms: DmLink[];
  counts: { review: number; chats: number; inbox: number };
}

export function AppShell({ children }: { children?: ReactNode }) {
  const bp = useBreakpoint();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const [start, setStart] = useState(false);
  const { data } = useQuery<NavData>("nav");
  const counts = data?.counts ?? { review: 0, chats: 0, inbox: 0 };
  const brand = data?.brand ?? { name: "Loft", monogram: "L" };
  const nav = mainNav(counts);

  const side = (
    <SidePanel
      brand={brand}
      nav={nav}
      current={pathname}
      rooms={data?.rooms ?? []}
      spaces={data?.spaces ?? []}
      dms={data?.dms ?? []}
      me={{ name: data?.me.name ?? "…", status: "Available" }}
      Link={RouterLink}
      onNewRoom={() => setStart(true)}
      onJoinCode={() => setStart(true)}
      onNewSpace={() => navigate("/spaces/new")}
      onNewDm={() => navigate("/chats")}
      onSettings={() => navigate("/more")}
      onNavigate={() => setDrawer(false)}
    />
  );

  return (
    <div className={`app app--${bp}`}>
      {IS_PREVIEW && <PreviewBanner />}
      <div className="app__body">
        {bp === "desktop" && side}
        {bp === "tablet" && (
          <>
            <IconRail brand={brand} nav={nav} current={pathname} Link={RouterLink} onOpenDrawer={() => setDrawer(true)} onNewRoom={() => setStart(true)} />
            {drawer && (
              <>
                <div className="lf-scrim" onClick={() => setDrawer(false)} />
                <div className="lf-drawer">{side}</div>
              </>
            )}
          </>
        )}
        <main className="app__main" id="main">
          {children ?? <Outlet />}
        </main>
      </div>
      {bp === "phone" && <TabBar current={pathname} Link={RouterLink} chats={counts.chats} inbox={counts.inbox} onNew={() => setStart(true)} />}
      <StartSheet open={start} onClose={() => setStart(false)} />
    </div>
  );
}
