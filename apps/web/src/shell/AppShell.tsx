import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { IconRail, PreviewBanner, SidePanel, TabBar, type DmLink, type LiveRoomLink, type SpaceLink } from "@loft/ui";
import type { User } from "@loft/core";
import { useAdapter, useQuery } from "../lib/data";
import { useBreakpoint, useOnline } from "../lib/media";
import { CloudOff } from "lucide-react";
import { ADAPTER, IS_PREVIEW } from "../lib/env";
import { applyTheme, THEME_MODES, type ThemeMode } from "@loft/ui";
import { mainNav } from "./nav";
import { RouterLink } from "./RouterLink";
import { StartSheet } from "./StartSheet";
import { Loading } from "../components/bits";

export interface NavData {
  me: User;
  brand: { name: string; monogram: string; theme?: string };
  rooms: LiveRoomLink[];
  spaces: SpaceLink[];
  dms: DmLink[];
  counts: { review: number; chats: number; inbox: number };
}

export function AppShell({ children }: { children?: ReactNode }) {
  const bp = useBreakpoint();
  const online = useOnline();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const [start, setStart] = useState(false);
  const adapter = useAdapter();
  const { data, error } = useQuery<NavData>("nav");
  // Production: not signed in → sign-in page; first run → install wizard.
  useEffect(() => {
    if (ADAPTER !== "http" || !error) return;
    if (/not installed/i.test(error.message)) navigate("/install", { replace: true });
    else if (/not signed in|forbidden/i.test(error.message) || error.name === "ForbiddenError") navigate("/signin", { replace: true });
  }, [error, navigate]);
  // A published brand switches the theme mode (Figma brand-theme modes).
  const themeMode = data?.brand.theme;
  useEffect(() => {
    applyTheme((THEME_MODES as readonly string[]).includes(themeMode ?? "") ? (themeMode as ThemeMode) : "loft");
  }, [themeMode]);
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
      onKnock={async (dm) => {
        const r = await adapter.mutate<{ code: string }>(`dms/${dm.id}/room`, { knock: true });
        navigate(`/r/${r.code}`);
      }}
      onSettings={() => navigate("/more")}
      onNavigate={() => setDrawer(false)}
    />
  );

  return (
    <div className={`app app--${bp}`}>
      {IS_PREVIEW && <PreviewBanner />}
      {!online && <p className="state-banner state-banner--offline" role="status"><CloudOff aria-hidden="true" />You're offline. Changes are saved here and sync when you're back.</p>}
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
          <Suspense fallback={<Loading />}>{children ?? <Outlet />}</Suspense>
        </main>
      </div>
      {bp === "phone" && <TabBar current={pathname} Link={RouterLink} chats={counts.chats} inbox={counts.inbox} onNew={() => setStart(true)} />}
      <StartSheet open={start} onClose={() => setStart(false)} />
    </div>
  );
}
