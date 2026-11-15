// Everything in this folder is the deterministic simulation.
// Rules: integers only in game state, no Math.random, no Date, no DOM.

export const MAP_W = 128;
export const MAP_H = 128;
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
/** How long a Tech Centre takes to bring its satellite uplink online: two and a half minutes. */
export const UPLINK_TICKS = 3000;
/** Credits each unit of gems is worth. Ordinary ore is worth one, so a load of gems pays double. */
export const GEM_VALUE = 2;
/** Ore gathered per tick while harvesting. */
export const GATHER_RATE = 5;
/** Ore turned into credits per tick while unloading. */
export const UNLOAD_RATE = 10;
/** Ticks a unit waits behind another before trying a way round. */
export const BLOCKED_PATIENCE = 8;
/** How far a building can see beyond its own walls, in cells. */
export const BUILDING_SIGHT = 5;
/** Health restored by each repair step, and the ticks between steps. */
export const REPAIR_HP = 10;
export const REPAIR_INTERVAL = 5;
/** A full repair from nothing costs this share of the building's price, as a percentage. */
export const REPAIR_COST_PERCENT = 30;

/** Ground types. Anything other than grass cannot be crossed or built on. */
export const GRASS = 0;
export const ROCK = 1;
export const WATER = 2;
export const TREES = 3;

export type UnitType =
  | 'pioneer'
  | 'harvester'
  | 'rifleman'
  | 'tank'
  | 'rocket'
  | 'grenadier'
  | 'engineer'
  | 'scout'
  | 'artillery'
  | 'heavy'
  | 'guardian'
  | 'sniper'
  | 'flamer'
  | 'saboteur'
  | 'flametank';
/** Fixed order, used for the sidebar and for hashing. New types go on the end. */
export const UNIT_TYPES: readonly UnitType[] = [
  'pioneer',
  'harvester',
  'rifleman',
  'tank',
  'rocket',
  'grenadier',
  'engineer',
  'scout',
  'artillery',
  'heavy',
  'guardian',
  'sniper',
  'flamer',
  'saboteur',
  'flametank',
];

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
export type BuildingType =
  | 'conyard'
  | 'power'
  | 'refinery'
  | 'barracks'
  | 'factory'
  | 'turret'
  | 'radar'
  | 'tech'
  | 'depot'
  | 'wall';

/** Fixed order, used for the sidebar and for hashing. */
export const BUILDING_TYPES: readonly BuildingType[] = [
  'conyard',
  'power',
  'refinery',
  'barracks',
  'factory',
  'turret',
  'radar',
  'tech',
  'depot',
  'wall',
];

/** The two sides a player can command. */
export type Faction = 'aegis' | 'dominion';
export const FACTIONS: readonly Faction[] = ['aegis', 'dominion'];

export interface FactionDef {
  name: string;
  motto: string;
  /** A sentence or two of flavour, shown when choosing a side. */
  about: string;
  /**
   * Units and buildings this faction cannot make. Everything not listed is
   * shared by both sides.
   */
  withoutUnits: readonly UnitType[];
  withoutBuildings: readonly BuildingType[];
}

export const FACTION_DEFS: Record<Faction, FactionDef> = {
  aegis: {
    name: 'Aegis',
    motto: 'Hold the line',
    about: 'A defensive alliance of disciplined, well-equipped forces, formed to protect what remains.',
    // Aegis's own units are the Sniper, Engineer, Guardian Tank and Artillery: range and precision.
    withoutUnits: ['flamer', 'saboteur', 'heavy', 'flametank'],
    withoutBuildings: [],
  },
  dominion: {
    name: 'Dominion',
    motto: 'Take what is owed',
    about: 'An expansionist power that believes order comes from strength, and strength from conquest.',
    // Dominion's own units are the Flame Trooper, Saboteur, Heavy Tank and Flame Tank: armour and fire.
    withoutUnits: ['sniper', 'engineer', 'guardian', 'artillery'],
    withoutBuildings: [],
  },
};

/** How hard the computer opponent pushes. */
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** What a target is made of, which decides how much each weapon hurts it. */
export type ArmourClass = 'infantry' | 'vehicle' | 'building';

export interface WeaponDef {
  /** Reach in cells. */
  range: number;
  damage: number;
  /** Ticks between shots. */
  cooldown: number;
  /** Only affects how the shot is drawn. */
  kind: 'bullet' | 'shell' | 'rocket' | 'flame';
  /** Percentage of damage dealt to each armour class. */
  versus: Record<ArmourClass, number>;
}

export interface UnitDef {
  name: string;
  /** How far it can see, in cells. */
  sight: number;
  hp: number;
  armour: ArmourClass;
  weapon: WeaponDef | null;
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
  hp: number;
  /** Defensive buildings carry a weapon, which needs full power to fire. */
  weapon?: WeaponDef;
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
  /** How far from the base it may be placed, in cells, if not the usual distance. */
  placeRange?: number;
  /**
   * True for walls of any kind. They block movement but are not part of the
   * base: they cannot extend it, are not attacked without an order, cannot be
   * captured, and do not keep a beaten side in the game.
   */
  wall?: boolean;
}

export const UNIT_DEFS: Record<UnitType, UnitDef> = {
  pioneer: {
    name: 'Pioneer',
    sight: 5,
    hp: 600,
    armour: 'vehicle',
    weapon: null,
    speed: 32,
    cost: 2500,
    produceTicks: 0,
    queue: null,
    requires: [],
  },
  harvester: {
    name: 'Harvester',
    sight: 4,
    hp: 450,
    armour: 'vehicle',
    weapon: null,
    speed: 40,
    cost: 1100,
    produceTicks: 360,
    queue: 'vehicle',
    requires: ['refinery'],
  },
  // Rifles cut down infantry but barely scratch armour. Cannons are the reverse.
  rifleman: {
    name: 'Rifleman',
    sight: 5,
    hp: 50,
    armour: 'infantry',
    weapon: {
      range: 4,
      damage: 8,
      cooldown: 12,
      kind: 'bullet',
      versus: { infantry: 100, vehicle: 12, building: 20 },
    },
    speed: 22,
    cost: 80,
    produceTicks: 80,
    queue: 'infantry',
    requires: [],
  },
  tank: {
    name: 'Light Tank',
    sight: 6,
    hp: 300,
    armour: 'vehicle',
    weapon: {
      range: 5,
      damage: 30,
      cooldown: 40,
      kind: 'shell',
      versus: { infantry: 70, vehicle: 100, building: 80 },
    },
    speed: 44,
    cost: 600,
    produceTicks: 240,
    queue: 'vehicle',
    requires: [],
  },
  // Rockets wreck vehicles but are wasted on infantry.
  rocket: {
    name: 'Rocket Soldier',
    sight: 5,
    hp: 55,
    armour: 'infantry',
    weapon: {
      range: 5,
      damage: 40,
      cooldown: 50,
      kind: 'rocket',
      versus: { infantry: 25, vehicle: 100, building: 60 },
    },
    speed: 20,
    cost: 200,
    produceTicks: 120,
    queue: 'infantry',
    requires: [],
  },
  // Grenades are short-ranged, but nothing on foot does more to a building.
  grenadier: {
    name: 'Grenadier',
    sight: 5,
    hp: 55,
    armour: 'infantry',
    weapon: {
      range: 3,
      damage: 28,
      cooldown: 30,
      kind: 'shell',
      versus: { infantry: 80, vehicle: 25, building: 110 },
    },
    speed: 22,
    cost: 140,
    produceTicks: 100,
    queue: 'infantry',
    requires: [],
  },
  // Unarmed. Walks into an enemy building to capture it, or one of ours to mend it.
  engineer: {
    name: 'Engineer',
    sight: 4,
    hp: 40,
    armour: 'infantry',
    weapon: null,
    speed: 22,
    cost: 400,
    produceTicks: 160,
    queue: 'infantry',
    requires: ['radar'],
  },
  // Fast and far-sighted, with a machine gun that only really troubles infantry.
  scout: {
    name: 'Scout Car',
    sight: 9,
    hp: 120,
    armour: 'vehicle',
    weapon: {
      range: 4,
      damage: 8,
      cooldown: 8,
      kind: 'bullet',
      versus: { infantry: 100, vehicle: 35, building: 20 },
    },
    speed: 72,
    cost: 350,
    produceTicks: 140,
    queue: 'vehicle',
    requires: [],
  },
  // Out-ranges everything, turrets included, but folds quickly if anything reaches it.
  artillery: {
    name: 'Artillery',
    sight: 6,
    hp: 150,
    armour: 'vehicle',
    weapon: {
      range: 9,
      damage: 70,
      cooldown: 100,
      kind: 'shell',
      versus: { infantry: 90, vehicle: 50, building: 115 },
    },
    speed: 28,
    cost: 900,
    produceTicks: 300,
    queue: 'vehicle',
    requires: ['radar'],
  },
  heavy: {
    name: 'Heavy Tank',
    sight: 6,
    hp: 780,
    armour: 'vehicle',
    weapon: {
      range: 5,
      damage: 66,
      cooldown: 50,
      kind: 'shell',
      versus: { infantry: 70, vehicle: 100, building: 110 },
    },
    speed: 30,
    cost: 1100,
    produceTicks: 360,
    queue: 'vehicle',
    requires: ['tech'],
  },
  // Aegis's heavy armour: lighter than Dominion's, but faster and it out-ranges every other tank.
  guardian: {
    name: 'Guardian Tank',
    sight: 7,
    hp: 520,
    armour: 'vehicle',
    weapon: {
      range: 6,
      damage: 50,
      cooldown: 40,
      kind: 'shell',
      versus: { infantry: 70, vehicle: 100, building: 80 },
    },
    speed: 40,
    cost: 1000,
    produceTicks: 330,
    queue: 'vehicle',
    requires: ['tech'],
  },
  // Picks off infantry from far away. Useless against anything with armour or walls.
  sniper: {
    name: 'Sniper',
    sight: 8,
    hp: 40,
    armour: 'infantry',
    weapon: {
      range: 8,
      damage: 60,
      cooldown: 85,
      kind: 'bullet',
      versus: { infantry: 100, vehicle: 5, building: 2 },
    },
    speed: 20,
    cost: 340,
    produceTicks: 160,
    queue: 'infantry',
    requires: ['radar'],
  },
  // Has to get close, but burns through infantry and buildings alike.
  flamer: {
    name: 'Flame Trooper',
    sight: 4,
    hp: 150,
    armour: 'infantry',
    weapon: {
      range: 3,
      damage: 10,
      cooldown: 5,
      kind: 'flame',
      versus: { infantry: 120, vehicle: 15, building: 120 },
    },
    speed: 30,
    cost: 180,
    produceTicks: 120,
    queue: 'infantry',
    requires: ['radar'],
  },
  // Unarmed and quick. Slips into an enemy building and blows it up from inside.
  saboteur: {
    name: 'Saboteur',
    sight: 5,
    hp: 45,
    armour: 'infantry',
    weapon: null,
    speed: 28,
    cost: 350,
    produceTicks: 160,
    queue: 'infantry',
    requires: ['radar'],
  },
  // Dominion's support vehicle: well armoured, and ruinous to infantry and buildings up close.
  flametank: {
    name: 'Flame Tank',
    sight: 5,
    hp: 700,
    armour: 'vehicle',
    weapon: {
      range: 3,
      damage: 16,
      cooldown: 6,
      kind: 'flame',
      versus: { infantry: 120, vehicle: 45, building: 150 },
    },
    speed: 46,
    cost: 800,
    produceTicks: 300,
    queue: 'vehicle',
    requires: ['radar'],
  },
};

// Placeholder numbers of our own, to be tuned once the whole loop is playable.
export const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  conyard: {
    name: 'Construction Yard',
    hp: 1500,
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
    hp: 500,
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
    hp: 900,
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
    hp: 600,
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
    hp: 1000,
    w: 3,
    h: 3,
    cost: 1800,
    produceTicks: 600,
    buildTicks: 30,
    power: -30,
    requires: ['refinery'],
  },
  turret: {
    name: 'Gun Turret',
    hp: 400,
    weapon: {
      range: 6,
      damage: 35,
      cooldown: 30,
      kind: 'shell',
      versus: { infantry: 60, vehicle: 100, building: 100 },
    },
    w: 1,
    h: 1,
    cost: 600,
    produceTicks: 240,
    buildTicks: 20,
    power: -20,
    requires: ['barracks'],
  },
  radar: {
    name: 'Radar Station',
    hp: 600,
    w: 2,
    h: 2,
    cost: 1000,
    produceTicks: 400,
    buildTicks: 30,
    power: -40,
    requires: ['refinery'],
  },
  tech: {
    name: 'Tech Centre',
    hp: 500,
    w: 2,
    h: 2,
    cost: 1500,
    produceTicks: 500,
    buildTicks: 30,
    power: -50,
    requires: ['radar', 'factory'],
  },
  // Vehicles parked beside it are repaired for credits.
  depot: {
    name: 'Service Depot',
    hp: 700,
    w: 2,
    h: 2,
    cost: 1200,
    produceTicks: 400,
    buildTicks: 30,
    power: -30,
    requires: ['factory'],
  },
  // Cheap and quick. Blocks movement, and can be laid further out than other buildings.
  wall: {
    name: 'Wall',
    hp: 300,
    w: 1,
    h: 1,
    cost: 50,
    produceTicks: 30,
    buildTicks: 6,
    power: 0,
    requires: ['barracks'],
    placeRange: 5,
    wall: true,
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
  hp: number;
  /** The id of the unit or building it is attacking, or 0. */
  attack: number;
  /** True when it should follow its target. False when it only fires from where it stands. */
  chase: boolean;
  /** Ticks until it can fire again. */
  cooldown: number;
  /** Ticks until it next re-plans its route to a moving target. */
  chaseTimer: number;
  /** Engineers and saboteurs only: the building they are on their way into, or 0. */
  capture: number;
  // Harvesters only.
  job: HarvestJob;
  /** What the load is worth, in credits. */
  cargo: number;
  /** How full the hopper is, out of the harvester's capacity. */
  load: number;
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
  hp: number;
  /** Turrets only: ticks until the next shot, and the way the gun points. */
  cooldown: number;
  aim: number;
  /** True while credits are being spent to restore its health. */
  repairing: boolean;
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
  /** True if this player started the game with anything on the map. */
  active: boolean;
  faction: Faction;
  /** Players on the same team are allies. They share what they see and never fight each other. */
  team: number;
  credits: number;
  production: Production | null;
  queues: Record<QueueKind, UnitQueue>;
  /**
   * Progress towards the satellite uplink, in ticks. It charges while the
   * player has a powered Tech Centre, and once full it shows them the whole map.
   */
  uplink: number;
}

export interface World {
  tick: number;
  /** The last team standing once the game is decided, or -1. */
  winner: number;
  rng: number;
  nextId: number;
  players: Player[];
  units: Unit[];
  buildings: Building[];
  /** Ground type per cell. */
  terrain: Uint8Array;
  /** Ore per cell, measured in the credits it is worth. */
  ore: Int32Array;
  /** 1 where the ore is gems, which are worth more for the room they take up. */
  rich: Uint8Array;
  /** 1 where a building stands. Derived from buildings. */
  blocked: Uint8Array;
  /** The id of the unit holding each cell, or 0. Derived from units. */
  occupied: Int32Array;
  /** Per player: the computer opponent's memory, or null for a person. */
  ai: ({ wave: number; lastWave: number; trained: number; built: number; level: Difficulty } | null)[];
  /** Per player: cells in view right now, and cells seen at any time. */
  vision: { visible: Uint8Array; explored: Uint8Array }[];
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
  | { type: 'rally'; player: number; buildingId: number; cx: number; cy: number }
  | { type: 'attack'; player: number; unitIds: number[]; targetId: number }
  | { type: 'repair'; player: number; buildingId: number }
  | { type: 'capture'; player: number; unitIds: number[]; buildingId: number };

/** One-off notifications for the UI. Never read back by the simulation. */
export type SimEvent =
  | { type: 'deployBlocked'; cx: number; cy: number; w: number; h: number }
  | { type: 'deployed'; unitId: number; buildingId: number }
  | { type: 'productionReady'; player: number; building: BuildingType }
  | { type: 'placed'; player: number; buildingId: number }
  | { type: 'placeRefused'; player: number; cx: number; cy: number; w: number; h: number }
  | { type: 'sold'; player: number; buildingId: number; refund: number }
  | { type: 'unitReady'; player: number; unitId: number; unit: UnitType }
  // Positions here are in sub-cell units, for drawing the shot.
  | { type: 'shot'; kind: WeaponDef['kind']; fromX: number; fromY: number; toX: number; toY: number }
  | { type: 'unitDied'; unitId: number; unit: UnitType; owner: number; facing: number; x: number; y: number }
  | { type: 'buildingDestroyed'; buildingId: number; cx: number; cy: number; w: number; h: number }
  | { type: 'gameOver'; winner: number }
  | { type: 'captured'; buildingId: number; player: number; from: number }
  | { type: 'mended'; buildingId: number; player: number }
  | { type: 'sabotaged'; buildingId: number; player: number; from: number }
  | { type: 'uplinkOnline'; player: number };

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

/** True for walls of any kind. */
export const isWall = (type: BuildingType): boolean => BUILDING_DEFS[type].wall === true;
/** True for the units that do their work by walking into a building. */
export const entersBuildings = (type: UnitType): boolean => type === 'engineer' || type === 'saboteur';
/** Damage a saboteur's charges do. Enough to level most buildings outright. */
export const SABOTAGE_DAMAGE = 650;

/** True if two players are on opposing teams. */
export const hostile = (world: World, a: number, b: number): boolean =>
  world.players[a].team !== world.players[b].team;
