/**
 * @loft/board: board engine (op-log model, geometry, smoothing). Framework-free; the React view lives in apps/web.
 * v1 (M2) ported from legacy/tutorapp.quest/src/components/whiteboard; v2 (M4) adds shapes, connectors and diagrams.
 */
export * from "./types";
export * from "./reduce";
export * from "./geometry";
export * from "./smooth";
export { UndoStack } from "./undo";
export * from "./connectors";
export * from "./recognize";
export * from "./arrange";
export * from "./diagram";
export * from "./freehand";
export * from "./pdf";
