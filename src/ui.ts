// View-side state. Nothing in here affects the simulation.

export interface UiState {
  camX: number;
  camY: number;
  viewW: number;
  viewH: number;
  selectedUnits: Set<number>;
  selectedBuilding: number | null;
  /** Selection box being dragged, in screen pixels. */
  dragBox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Move order markers, in world pixels. */
  markers: { x: number; y: number; t: number }[];
  /** Red flashes where a deployment was refused, in cells. */
  flashes: { cx: number; cy: number; w: number; h: number; t: number }[];
  mouseX: number;
  mouseY: number;
  mouseInside: boolean;
}

export function createUi(): UiState {
  return {
    camX: 0,
    camY: 0,
    viewW: 0,
    viewH: 0,
    selectedUnits: new Set(),
    selectedBuilding: null,
    dragBox: null,
    markers: [],
    flashes: [],
    mouseX: 0,
    mouseY: 0,
    mouseInside: false,
  };
}
