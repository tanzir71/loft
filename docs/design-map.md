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
