# Design map: Figma frame → route / component

Figma file `OvapmLmXJ0QmobXQA1mxNG` (Tutor). Node ids in brackets.

| Figma frame | Route | Component(s) | Milestone |
|---|---|---|---|
| Foundations · variables `Loft · Brand theme` (4 modes) + `TutorLoft · Size` | — | `packages/ui/tokens.json` → `src/tokens.css` | M0 |
| Foundations · text styles (Display/Heading/Body/Label/Caption/Meta/Mono/Number) | — | `.t-*` classes, `--text-*` vars in `tokens.css` | M0 |
| Foundations · Button [7:52] | — | `packages/ui` `Button`, `buttonClass` | M0 |
| Foundations · Badge [7:71] | — | `packages/ui` `Badge`, `Count` | M0 |
| Foundations · Avatar [7:78] | — | `packages/ui` `Avatar` (+ presence dot) | M0 |
| Foundations · App / Side panel [41:1621] (Active = Home/Calendar/…/Agents) | all app routes ≥1200 px | `packages/ui` `SidePanel`; `apps/web/src/shell/AppShell.tsx` | M0 |
| 07 · Responsive spec [108:6681] — tablet rail | all app routes 768–1199 px | `packages/ui` `IconRail` + drawer in `AppShell` | M0 |
| Foundations · App / Mobile tab bar [62:381] | all app routes <768 px | `packages/ui` `TabBar` | M0 |
| 07 · Home · first run (desktop) [111:60] | `/` (no spaces yet) | `apps/web/src/pages/Home.tsx` | M0 |
| (derived) Home · first run (phone) | `/` on phones | `Home.tsx` + `PageHeader` (header from 05 · Host · Home (phone) [63:55]) | M0 |
| 05 · Host · More (phone) [104:538] | `/more` | `apps/web/src/pages/More.tsx` | M0 (layout), M3 (content) |
| 06 · Landing pages · "Loft · landing v2 (tack pattern)" [57:370] | `/loft/` | `apps/landing/index.html` + `build/content.mjs` `renderLanding` | M1 |
| — hero visual [57:406] | — | `public/img/hero.webp` | M1 |
| — features 01–11 visuals [58:632, 99:2146, 58:836, 58:919, 58:1047, 58:1149, 60:1167, 60:1330, 60:1543, 60:1796, 60:1871] | — | `public/img/f01-rooms.webp` … `f11-phones.webp` | M1 |
| — agents · how it works [113:2177] | — | HTML (`agents()` in content.mjs) | M1 |
| — organisations band visual [61:2034] | — | `public/img/orgs-band.webp` | M1 |
| 06 · Landing pages · "Loft · for organisations v2" [65:1669] | `/loft/organisations/` | `apps/landing/organisations/index.html` + `renderOrganisations` | M1 |
| — hero [65:1703], identity [65:1936], your link [74:2008], documents [65:2165] | — | `public/img/orgs-*.webp` | M1 |
| 04 · "Host · Live Room — minimal" [40:343] | `/r/:code` | `apps/web/src/room/RoomPage.tsx`, `Board.tsx`, `Chat.tsx`, `room.css` | M2 |
| 05 · "Host · Room (phone)" [104:202] | `/r/:code` on phones | `RoomPage.tsx` (`.room--phone`) | M2 |
| 07 · "Join with code (phone)" [110:67] | `/join` | `room/screens.tsx` `JoinForm` | M2 |
| 05 · "Guest · Join with a link (approval on)" [50:239] | `/r/:code` (waiting) | `screens.tsx` `WaitingForHost` | M2 |
| 07 · "Room full (phone)" [110:107] | `/r/:code` (line) | `screens.tsx` `RoomFull` | M2 |
| 07 · "Session ended (phone)" [110:138] | `/r/:code` (ended) | `screens.tsx` `SessionEnded`, `exportPng.ts` | M2 |
| 04 · "Host · Home (hybrid)" [43:263] | `/` (with spaces) | `pages/Home.tsx` `Hybrid`, `shell/TopBar.tsx` | M3 |
| 05 · "Host · Home (phone)" [63:55] | `/` on phones | `Home.tsx` (`RoomLinkCard` phone, `space-rows`) | M3 |
| 07 · "New space · step 1 mode" [111:316] | `/spaces/new` | `pages/NewSpace.tsx` | M3 |
| 04 · "Host · Space — Stream (hybrid)" [44:405] | `/s/:slug/:tab?` | `pages/Space.tsx` | M3 |
| 05 · "Host · Space stream (phone)" [104:283] | `/s/:slug` on phones | `Space.tsx` (`.app--phone`) | M3 |
| 04 · "Host · Hallway — DM + start a room" [44:733] | `/dm/:userId` | `pages/Hallway.tsx` `DmPage` | M3 |
| 05 · "Host · Chats / Hallway (phone)" [63:210], "DM + start a room (phone)" [63:368] | `/chats`, `/dm/:userId` | `Hallway.tsx` `ChatsPage`, `DmPage` | M3 |
| 05 · "Host · Inbox (phone)" [104:398] | `/inbox`, `/review` | `pages/Inbox.tsx` `InboxPage` | M3 |
| 07 · "Notifications panel (desktop)" [111:472] | bell in top bars | `Inbox.tsx` `NotificationsBell` | M3 |
| 05 · "Host · More (phone)" [104:538] | `/more` | `pages/More.tsx` | M3 |
| 04 · "Board v2 · flowchart + connectors (desktop)" [77:2089] | `/r/:code` | `room/Board.tsx`, `room/BoardPanels.tsx` (`SelectionBar`), `packages/board` (`connectors`, `arrange`) | M4 |
| 04 · "Board v2 · tools spec" [79:2144] | `/r/:code` toolbar, flyouts | `RoomPage.tsx` toolbar, `ShapesFlyout`, `PenOptions`, `board/shapes.ts` | M4 |
| 04 · "Board v2 · phone (shapes sheet open)" [79:2456] | `/r/:code` on phones | `RoomPage.tsx` (`phoneTools`), `.room--phone .shapes-flyout` | M4 |
| 04 · "Board feature map" [81:4015] · diagram as code | `/r/:code` → More → Diagram as code | `BoardPanels.tsx` `DiagramPanel`, `packages/board/src/diagram.ts` | M4 |
| — PDF/slides import, PNG/PDF export | `/r/:code` → Upload / More | `room/board/pdfImport.ts`, `room/board/render.ts`, `packages/board/src/pdf.ts` | M4 |
| 06 · S1 "Calendar (desktop)" [95:4906], "S1 · phone · calendar agenda" [100:3771] | `/calendar` | `pages/Calendar.tsx` (`WeekGrid`, `MonthGrid`, `Agenda`, `Requests`) | M5 |
| 06 · S2 "New session / series (desktop)" [95:5263], phone [100:3891] | `/calendar` → New session | `Calendar.tsx` `NewSessionSheet` | M5 |
| 06 · S3 "Availability + booking types (desktop)" [97:3307], phone [100:3978] | `/calendar/availability` | `pages/Booking.tsx` `AvailabilityPage` | M5 |
| 06 · S4 "Public booking page (desktop)" [97:3704], phone [100:4066] | `/book/:handle` | `Booking.tsx` `BookingPage` | M5 |
| 06 · S5 "Reschedule + booking requests (desktop)" [98:3538], phone [100:4125] | `/calendar` rail, `/review`, `/manage/:token` | `Calendar.tsx` `Requests`, `Booking.tsx` `ManagePage` | M5 |
| 06 · P1 "Plans library (desktop)" [71:9], phone [90:2593] | `/s/:slug/plans` | `pages/Plans.tsx` `PlansTab` | M6 |
| 06 · P2 "New plan (desktop)" [71:578], phone [90:2727] | Plans tab → New plan | `Plans.tsx` `NewPlanSheet` | M6 |
| 06 · P3 "Edit blocks (desktop)" [82:650], phone [90:2818] | `/plans/:id` | `Plans.tsx` `PlanEditor` | M6 |
| 06 · P4 "Attach & prepare (desktop)" [82:1088], phone [90:2913] | `/plans/:id` → Attach | `Plans.tsx` `AttachSheet` | M6 |
| 06 · P5 "Run in the room (desktop)" [84:1117], phone [91:2712] | `/r/:code` (session room) | `room/PlanRail.tsx` | M6 |
| 06 · P6 "Wrap-up (desktop)" [84:1288], phone [91:2767] | `/wrapup/:sessionId` | `pages/WrapUp.tsx` | M6 |
| 06 · I1 "Billing setup (desktop)" [85:1216], phone [91:2868] | `/s/:slug/billing` (hosts) | `pages/money/Billing.tsx` `BillingSetup`, `PaymentLinkSheet` | M7 |
| 06 · I2 "Session log (desktop)" [85:1625], phone [91:2957] | `/money/log` | `pages/money/Money.tsx` `MoneyLog` | M7 |
| 06 · I3 "Invoice run (desktop)" [86:1648], phone [101:3856] | `/money/invoices` | `pages/money/Invoices.tsx` `MoneyInvoices`, `DraftPreview`, `AddPayerSheet` | M7 |
| 06 · I4 "Invoice detail (desktop)" [86:2043], phone [101:3927] | `/money/invoices/:id`, `/print/invoice/:id` | `Invoices.tsx` `InvoiceDetail`, `InvoiceDoc`, `LineEditor`, `PrintFrame` | M7 |
| 06 · I5 "Packages & credits (desktop)" [88:2053], phone [101:4001] | `/money/packages` | `Money.tsx` `MoneyPackages` | M7 |
| 06 · I6 "Confirm a payment (desktop)" [88:2419], phone [101:4082] | `/money/payments` | `Money.tsx` `MoneyPayments` | M7 |
| 06 · I7 "Reminders & overdue (desktop)" [88:2715], phone [101:4129] | `/money/reminders` | `Money.tsx` `MoneyReminders` | M7 |
| — (built from I4's invoice card) payer pay page | `/pay/:token`, `/pay/:token/print` | `pages/money/Pay.tsx` | M7 |
| — Money overview (KPIs + To do) | `/money` | `Money.tsx` `MoneyOverview` | M7 |
| 04 · "Host · Insights + nudges" [46:1044], 05 · "Host · Insights (phone)" [107:551] | `/insights` | `pages/insights/Insights.tsx` (`AutoNudges`, `CustomNudge`, `NudgeSheet`) | M8 |
| — quick checks (built from the Insights/Money visual language; no dedicated frame) | `/s/:slug/grades`, `/checks/:id`, `/checks/:id/take` | `pages/checks/Checks.tsx` (`GradesTab`, `Gradebook`, `CheckPage`, `Builder`, `Results`), `pages/checks/TakeCheck.tsx` | M8 |
| 07 · "States · offline, reconnecting, loading, errors" [111:550] | shell, room, every page | `shell/AppShell.tsx` (offline), `room/RoomPage.tsx` (reconnecting, room full · host), `components/bits.tsx` (`ErrorState`, `Loading`), `money/Invoices.tsx` (send failure) | M8 |
| 06 · A1 "Agents (desktop)" [115:13], phone [118:1189] | `/agents` | `pages/agents/Agents.tsx` `AgentsPage`, `lib/demoAgent.ts` | M9 |
| 06 · A2 "Prep queue in a space (desktop)" [116:287] | `/s/:slug/prep` | `pages/agents/Prep.tsx` `PrepTab` | M9 |
| 06 · A3 "New prep task (desktop)" [116:749] | Prep → New prep task | `Prep.tsx` `NewPrepSheet` | M9 |
| 06 · A4 "Agent drafting in the room (desktop)" [117:921] | `/r/:code` (host) | `room/RoomPage.tsx` (draft layer, activity, legend), `room/Board.tsx` (draft sections) | M9 |
| 06 · A5 "Ready for you · review (desktop)" [117:1097], phone [118:1322] | `/agents/review/:taskId` | `Agents.tsx` `ReviewPage`, `DraftPreview` | M9 |
| 06 · A6 "What agents read (next.md)" [115:442] | `/agents/read` | `Agents.tsx` `AgentsReadPage`, `packages/core/src/agents.ts` `nextMarkdown` | M9 |
| 06 · "Agents · build rules" [117:1392] | protocol | `packages/data/src/local/routes-agents.ts`, `docs/agent-link.md` | M9 |
| 07 · "Sign in (desktop)" [110:12] (the "Check email" frame [110:53] is retired: accounts no longer use email) | `/signin` | `pages/system/Auth.tsx` `SignInPage` (sign in, create an account, recover), `pages/system/RecoveryCode.tsx`; `api/src/auth.php` | M10 · v1.1.1 |
| 07 · "Install · first run (desktop)" [111:420] | `/install` | `pages/system/Auth.tsx` `InstallPage`; `api/src/routes/system.php` `install` | M10 |
| 04 · "Owner · Organisations + branding switch" [76:3660], "Owner · branding switch (phone)" [76:3883] | `/owner` | `pages/system/Owner.tsx` (organisations, branding toggle + paid-until, change log, requests, Backups) | M10 |
| 04 · "Org admin · Brand studio (Sunrise Academy theme)" [47:1295], "… · branding off (preview only)" [76:3951], 05 · "Org admin · Brand studio (phone)" [107:641] | `/brand` | `pages/system/Brand.tsx`, `shell/AppShell.tsx` (`applyTheme`) | M10 |
| — profile, password, sign out (built from the Settings rows in 04) | `/settings` | `pages/system/Settings.tsx` | M10 |
| 04 · "Org admin (self-serve) · Calls & budget" [47:1611] | `/admin` | `pages/system/Admin.tsx`; `api/src/routes/live.php` `admin/calls` | M11 |
| 04 · "Host · Live Room — minimal" [40:343] (call controls) | `/r/:code` | `room/calls/useCall.ts`, `room/calls/CallUI.tsx` (audio pill, hands, stage, follow chip, open-together prompt), `room/RoomPage.tsx` | M11 |
| 04 · "Room · screen share (desktop)" [103:2291], "… · phone viewer" [103:2417], "… · build rules" [103:2492] | `/r/:code` | `room/calls/CallUI.tsx` `ShareOverlay` (annotations, snapshot to board, stills fallback), `useCall.ts` | M11 |
| — video (built from the Live Room call pill and islands; no dedicated frame) | `/r/:code` | `room/calls/CallUI.tsx` (`VideoPill`, `VideoPanel`), `room/calls/useVideo.ts`, `room/calls/sfu.ts`; Admin → Calls & budget provider cards | v1.1.0 |
| 04 · "Host · Live Room — minimal" [40:343] (keyboard) | `/r/:code` | `room/Board.tsx` (Tab/Shift+Tab through objects, arrow-key pan, +/− zoom) | M12 |
| 04 · "Owner · Organisations + branding switch" [76:3660] (Backups tab) | `/owner` → Backups | `pages/system/Owner.tsx`; `api/src/routes/system.php` `owner/backup` | M12 |
