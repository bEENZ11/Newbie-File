// View-side state. Nothing in here affects the simulation.

import { BUILDING_DEFS, type BuildingType } from './sim/types';

/** The player sitting at this screen. */
export const LOCAL_PLAYER = 0;

export const ZOOM_MIN = 32;
export const ZOOM_MAX = 96;

export interface UiState {
  /** The ground point at the centre of the screen, in cells. */
  camX: number;
  camZ: number;
  /** Pixels per cell, measured across the screen. */
  zoom: number;
  viewW: number;
  viewH: number;
  selectedUnits: Set<number>;
  selectedBuilding: number | null;
  /** The finished building being positioned on the map, if any. */
  placing: BuildingType | null;
  /** True while the next click on a building sells it. */
  sellMode: boolean;
  /** The ground point under the mouse, in cells. */
  hoverX: number;
  hoverZ: number;
  /** Selection box being dragged, in screen pixels. */
  dragBox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Move order markers, in cells. */
  markers: { x: number; z: number; t: number }[];
  /** Red flashes where a deployment was refused, in cells. */
  flashes: { cx: number; cy: number; w: number; h: number; t: number }[];
  mouseX: number;
  mouseY: number;
  mouseInside: boolean;
}

export function createUi(): UiState {
  return {
    camX: 0,
    camZ: 0,
    zoom: 60,
    viewW: 0,
    viewH: 0,
    selectedUnits: new Set(),
    selectedBuilding: null,
    placing: null,
    sellMode: false,
    hoverX: 0,
    hoverZ: 0,
    dragBox: null,
    markers: [],
    flashes: [],
    mouseX: 0,
    mouseY: 0,
    mouseInside: false,
  };
}

/** The top-left cell of a building being placed, centred on the mouse. */
export function placementOrigin(ui: UiState, type: BuildingType): { cx: number; cy: number } {
  const def = BUILDING_DEFS[type];
  return {
    cx: Math.floor(ui.hoverX - def.w / 2 + 0.5),
    cy: Math.floor(ui.hoverZ - def.h / 2 + 0.5),
  };
}
