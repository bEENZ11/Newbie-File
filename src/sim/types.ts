// Everything in this folder is the deterministic simulation.
// Rules: integers only in game state, no Math.random, no Date, no DOM.

export const MAP_W = 64;
export const MAP_H = 64;
/** Sub-cell resolution. A unit's position is measured in 1/SUB of a cell. */
export const SUB = 256;
export const TICK_RATE = 20;
export const STARTING_CREDITS = 5000;

export type UnitType = 'pioneer';
export type BuildingType = 'conyard';

export interface UnitDef {
  name: string;
  /** Sub-cell units moved per tick. */
  speed: number;
}

export interface BuildingDef {
  name: string;
  w: number;
  h: number;
  /** Ticks the build-up animation takes before the building is active. */
  buildTicks: number;
}

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  pioneer: { name: 'Pioneer', speed: 32 },
};

export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  conyard: { name: 'Construction Yard', w: 3, h: 3, buildTicks: 40 },
};

export interface Unit {
  id: number;
  type: UnitType;
  owner: number;
  x: number;
  y: number;
  /** Position at the previous tick, so the renderer can smooth movement. */
  prevX: number;
  prevY: number;
  /** 0 is east, then clockwise in 45 degree steps. */
  facing: number;
  /** Cell indices still to visit, nearest first. */
  path: number[];
  pendingDeploy: boolean;
}

export interface Building {
  id: number;
  type: BuildingType;
  owner: number;
  /** Top-left cell. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  progress: number;
  total: number;
}

export interface World {
  tick: number;
  rng: number;
  credits: number;
  nextId: number;
  units: Unit[];
  buildings: Building[];
  /** Ore amount per cell. */
  ore: Int32Array;
  /** 1 where a building stands. Derived from buildings. */
  blocked: Uint8Array;
}

export type Command =
  | { type: 'move'; unitIds: number[]; cx: number; cy: number }
  | { type: 'deploy'; unitId: number };

/** One-off notifications for the UI. Never read back by the simulation. */
export type SimEvent =
  | { type: 'deployBlocked'; cx: number; cy: number; w: number; h: number }
  | { type: 'deployed'; unitId: number; buildingId: number };

export const cellIndex = (cx: number, cy: number): number => cy * MAP_W + cx;
export const inBounds = (cx: number, cy: number): boolean =>
  cx >= 0 && cy >= 0 && cx < MAP_W && cy < MAP_H;
export const cellCentre = (c: number): number => c * SUB + (SUB >> 1);
export const toCell = (sub: number): number => Math.floor(sub / SUB);
