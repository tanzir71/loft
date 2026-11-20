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
