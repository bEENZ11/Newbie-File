// View-side state. Nothing in here affects the simulation.

import { BUILDING_DEFS, type BuildingType, type World } from './sim/types';

/** The player sitting at this screen. */
export let LOCAL_PLAYER = 0;

/** Says which seat the person at this screen is playing. Call before the game is set up. */
export function setLocalPlayer(seat: number): void {
  LOCAL_PLAYER = seat;
}

export const ZOOM_MIN = 32;
export const ZOOM_MAX = 96;
/** The diamond view: the camera sits to the south-east, so two sides of every building show. */
export const DIAMOND_YAW = Math.PI / 4;

export interface UiState {
  /** The ground point at the centre of the screen, in cells. */
  camX: number;
  camZ: number;
  /** Pixels per cell, measured across the screen. */
  zoom: number;
  /**
   * Which way the camera is turned, in radians. Zero looks straight north.
   * A quarter turn less than that gives the diamond view, looking north-west.
   */
  yaw: number;
  viewW: number;
  viewH: number;
  selectedUnits: Set<number>;
  selectedBuilding: number | null;
  /** The finished building being positioned on the map, if any. */
  placing: BuildingType | null;
  /** True while the next click on a building sells it. */
  sellMode: boolean;
  /** True while the next click on a building starts or stops its repair. */
  repairMode: boolean;
  /** The ground point under the mouse, in cells. */
  hoverX: number;
  hoverZ: number;
  /** Selection box being dragged, in screen pixels. */
  dragBox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Saved control groups, by number key. */
  groups: Map<number, number[]>;
  /** Move order markers, in cells. */
  markers: { x: number; z: number; t: number; hostile?: boolean }[];
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
    yaw: DIAMOND_YAW,
    viewW: 0,
    viewH: 0,
    selectedUnits: new Set(),
    selectedBuilding: null,
    placing: null,
    sellMode: false,
    repairMode: false,
    hoverX: 0,
    hoverZ: 0,
    dragBox: null,
    groups: new Map(),
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

/** True if a player is on the other side from the one at this screen. */
export function isHostile(world: World, owner: number): boolean {
  return world.players[owner].team !== world.players[LOCAL_PLAYER].team;
}
