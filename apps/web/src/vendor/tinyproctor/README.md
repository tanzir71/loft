# tinyproctor.js (vendored)

`tinyproctor.js` 1.1.0 and its type definitions, copied unchanged from
https://github.com/tanzir71/tinyproctorjs (MIT, see `LICENSE`).

Loft imports it lazily on the check page only (`pages/checks/TakeCheck.tsx`), never sets an `endpoint`
(so it sends nothing over the network), and keeps it `silent`. It reads tab/focus/fullscreen/clipboard
signals in the page; it never touches the camera, microphone or screen. The snapshot it produces is
stored with the attempt and summarised by `integrityReview()` in `packages/core/src/checks.ts`.
