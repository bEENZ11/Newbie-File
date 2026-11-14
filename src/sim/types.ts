// Everything in this folder is the deterministic simulation.
// Rules: integers only in game state, no Math.random, no Date, no DOM.

export const MAP_W = 64;
export const MAP_H = 64;
/** Sub-cell resolution. A unit's position is measured in 1/SUB of a cell. */
export const SUB = 256;
export const TICK_RATE = 20;
export const STARTING_CREDITS = 5000;
/** A new building must sit within this many cells of one the player owns. */
export const BUILD_RANGE = 2;
/** Share of a building's cost returned when it is sold, as a percentage. */
export const SELL_REFUND_PERCENT = 50;
/** Production never drops below this share of full speed, out of 256. */
export const MIN_POWER_RATE = 64;

export type UnitType = 'pioneer';
export type BuildingType = 'conyard' | 'power' | 'refinery' | 'barracks' | 'factory';

/** Fixed order, used for the sidebar and for hashing. */
export const BUILDING_TYPES: readonly BuildingType[] = [
  'conyard',
  'power',
  'refinery',
  'barracks',
  'factory',
];

export interface UnitDef {
  name: string;
  /** Sub-cell units moved per tick. */
  speed: number;
}

export interface BuildingDef {
  name: string;
  w: number;
  h: number;
  cost: number;
  /** Ticks to produce in the sidebar at full power. Zero if it cannot be built there. */
  produceTicks: number;
  /** Ticks the build-up animation takes once placed. */
  buildTicks: number;
  /** Positive supplies power, negative uses it. */
  power: number;
  /** Buildings the player must own first, besides a Construction Yard. */
  requires: readonly BuildingType[];
}

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  pioneer: { name: 'Pioneer', speed: 32 },
};

// Placeholder numbers of our own, to be tuned once the whole loop is playable.
export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  conyard: {
    name: 'Construction Yard',
    w: 3,
    h: 3,
    cost: 2500,
    produceTicks: 0,
    buildTicks: 40,
    power: 0,
    requires: [],
  },
  power: {
    name: 'Power Plant',
    w: 2,
    h: 2,
    cost: 250,
    produceTicks: 160,
    buildTicks: 30,
    power: 100,
    requires: [],
  },
  refinery: {
    name: 'Ore Refinery',
    w: 3,
    h: 3,
    cost: 1500,
    produceTicks: 500,
    buildTicks: 30,
    power: -30,
    requires: ['power'],
  },
  barracks: {
    name: 'Barracks',
    w: 2,
    h: 2,
    cost: 400,
    produceTicks: 200,
    buildTicks: 30,
    power: -20,
    requires: ['power'],
  },
  factory: {
    name: 'War Factory',
    w: 3,
    h: 3,
    cost: 1800,
    produceTicks: 600,
    buildTicks: 30,
    power: -30,
    requires: ['refinery'],
  },
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
  /** Counts up to total while building up, and back down while being sold. */
  progress: number;
  total: number;
  selling: boolean;
}

/** The structure a player is producing in the sidebar. */
export interface Production {
  type: BuildingType;
  /** Production steps completed, out of total. */
  progress: number;
  total: number;
  /** Credits spent on it so far. */
  paid: number;
  /** 'ready' means finished and waiting to be placed on the map. */
  state: 'active' | 'held' | 'ready';
}

export interface Player {
  credits: number;
  production: Production | null;
  /** Carries fractional production speed between ticks when power is low. */
  speedAcc: number;
}

export interface World {
  tick: number;
  rng: number;
  nextId: number;
  players: Player[];
  units: Unit[];
  buildings: Building[];
  /** Ore amount per cell. */
  ore: Int32Array;
  /** 1 where a building stands. Derived from buildings. */
  blocked: Uint8Array;
}

// Every command names the player giving it, ready for multiplayer.
export type Command =
  | { type: 'move'; player: number; unitIds: number[]; cx: number; cy: number }
  | { type: 'deploy'; player: number; unitId: number }
  | { type: 'build'; player: number; building: BuildingType }
  | { type: 'hold'; player: number }
  | { type: 'cancel'; player: number }
  | { type: 'place'; player: number; cx: number; cy: number }
  | { type: 'sell'; player: number; buildingId: number };

/** One-off notifications for the UI. Never read back by the simulation. */
export type SimEvent =
  | { type: 'deployBlocked'; cx: number; cy: number; w: number; h: number }
  | { type: 'deployed'; unitId: number; buildingId: number }
  | { type: 'productionReady'; player: number; building: BuildingType }
  | { type: 'placed'; player: number; buildingId: number }
  | { type: 'placeRefused'; player: number; cx: number; cy: number; w: number; h: number }
  | { type: 'sold'; player: number; buildingId: number; refund: number };

export const cellIndex = (cx: number, cy: number): number => cy * MAP_W + cx;
export const inBounds = (cx: number, cy: number): boolean =>
  cx >= 0 && cy >= 0 && cx < MAP_W && cy < MAP_H;
export const cellCentre = (c: number): number => c * SUB + (SUB >> 1);
export const toCell = (sub: number): number => Math.floor(sub / SUB);
/** A building counts once its build-up has finished and it is not being sold. */
export const isActive = (b: Building): boolean => !b.selling && b.progress >= b.total;
