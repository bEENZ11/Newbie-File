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
/** Credits' worth of ore a harvester carries when full. */
export const HARVEST_CAPACITY = 500;
/** Ore gathered per tick while harvesting. */
export const GATHER_RATE = 5;
/** Ore turned into credits per tick while unloading. */
export const UNLOAD_RATE = 10;
/** Ticks a unit waits behind another before trying a way round. */
export const BLOCKED_PATIENCE = 8;

export type UnitType = 'pioneer' | 'harvester' | 'rifleman' | 'tank';
export const UNIT_TYPES: readonly UnitType[] = ['pioneer', 'harvester', 'rifleman', 'tank'];

/** Units are trained in two lines that run side by side. */
export type QueueKind = 'infantry' | 'vehicle';
export const QUEUE_KINDS: readonly QueueKind[] = ['infantry', 'vehicle'];
/** Most units that can wait in one line at a time. */
export const MAX_QUEUE = 12;

/**
 * What a harvester is doing. 'manual' means the player moved it by hand, so
 * it waits for orders. 'idle' means it has nothing to do and will look again.
 */
export type HarvestJob =
  | 'none'
  | 'seek'
  | 'toOre'
  | 'harvest'
  | 'return'
  | 'toRefinery'
  | 'unload'
  | 'idle'
  | 'manual';
export const HARVEST_JOBS: readonly HarvestJob[] = [
  'none',
  'seek',
  'toOre',
  'harvest',
  'return',
  'toRefinery',
  'unload',
  'idle',
  'manual',
];
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
  cost: number;
  /** Ticks to train at full power. */
  produceTicks: number;
  /** Which line trains it, or null if it cannot be trained. */
  queue: QueueKind | null;
  /** Buildings needed besides the one that trains it. */
  requires: readonly BuildingType[];
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
  pioneer: { name: 'Pioneer', speed: 32, cost: 2500, produceTicks: 0, queue: null, requires: [] },
  harvester: {
    name: 'Harvester',
    speed: 40,
    cost: 1100,
    produceTicks: 360,
    queue: 'vehicle',
    requires: ['refinery'],
  },
  rifleman: { name: 'Rifleman', speed: 22, cost: 80, produceTicks: 80, queue: 'infantry', requires: [] },
  tank: { name: 'Light Tank', speed: 44, cost: 600, produceTicks: 240, queue: 'vehicle', requires: [] },
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
  /** The cell this unit stands on and holds. No two units share a cell. */
  cell: number;
  /** The cell it is part-way into, also held, or -1 when standing still. */
  stepTo: number;
  /** Cell indices still to visit, nearest first. */
  path: number[];
  /** Where it is ultimately heading, or -1. Used when it has to find a new route. */
  dest: number;
  /** Ticks spent waiting for another unit to move out of the way. */
  wait: number;
  pendingDeploy: boolean;
  // Harvesters only.
  job: HarvestJob;
  cargo: number;
  /** The ore cell it is working, or -1. */
  target: number;
  /** The ore cell it last worked, so it returns to the same field. */
  home: number;
  /** The refinery it is delivering to, or 0. */
  refinery: number;
  timer: number;
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
  /** Where new units gather, as a cell index, or -1 for just outside the door. */
  rally: number;
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
  /** Carries fractional production speed between ticks when power is low. */
  speedAcc: number;
}

/** A line of units being trained. The first item is the one in progress. */
export interface UnitQueue {
  items: UnitType[];
  progress: number;
  paid: number;
  held: boolean;
  speedAcc: number;
}

export interface Player {
  credits: number;
  production: Production | null;
  queues: Record<QueueKind, UnitQueue>;
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
  /** The id of the unit holding each cell, or 0. Derived from units. */
  occupied: Int32Array;
}

// Every command names the player giving it, ready for multiplayer.
export type Command =
  | { type: 'move'; player: number; unitIds: number[]; cx: number; cy: number }
  | { type: 'deploy'; player: number; unitId: number }
  | { type: 'build'; player: number; building: BuildingType }
  | { type: 'hold'; player: number }
  | { type: 'cancel'; player: number }
  | { type: 'place'; player: number; cx: number; cy: number }
  | { type: 'sell'; player: number; buildingId: number }
  | { type: 'train'; player: number; unit: UnitType }
  | { type: 'untrain'; player: number; unit: UnitType }
  | { type: 'rally'; player: number; buildingId: number; cx: number; cy: number };

/** One-off notifications for the UI. Never read back by the simulation. */
export type SimEvent =
  | { type: 'deployBlocked'; cx: number; cy: number; w: number; h: number }
  | { type: 'deployed'; unitId: number; buildingId: number }
  | { type: 'productionReady'; player: number; building: BuildingType }
  | { type: 'placed'; player: number; buildingId: number }
  | { type: 'placeRefused'; player: number; cx: number; cy: number; w: number; h: number }
  | { type: 'sold'; player: number; buildingId: number; refund: number }
  | { type: 'unitReady'; player: number; unitId: number; unit: UnitType };

export const cellIndex = (cx: number, cy: number): number => cy * MAP_W + cx;
export const inBounds = (cx: number, cy: number): boolean =>
  cx >= 0 && cy >= 0 && cx < MAP_W && cy < MAP_H;
export const cellCentre = (c: number): number => c * SUB + (SUB >> 1);
export const toCell = (sub: number): number => Math.floor(sub / SUB);
/** A building counts once its build-up has finished and it is not being sold. */
export const isActive = (b: Building): boolean => !b.selling && b.progress >= b.total;

/** The cell in front of a refinery where a harvester pulls up to unload. */
export const dockCell = (b: Building): { x: number; y: number } => ({ x: b.cx + 2, y: b.cy + b.h });

/** The building each line needs in order to train anything. */
export const QUEUE_BUILDING: Record<QueueKind, BuildingType> = {
  infantry: 'barracks',
  vehicle: 'factory',
};

/** The cell just outside a production building's door, where new units appear. */
export const exitCell = (b: Building): { x: number; y: number } => ({
  x: b.cx + (b.type === 'factory' ? 1 : 0),
  y: b.cy + b.h,
});
