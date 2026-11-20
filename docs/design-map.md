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
