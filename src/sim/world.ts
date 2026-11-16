import { findPath } from './pathfinding';
import { randInt } from './rng';
import { updateVision } from './vision';
import {
  BUILDING_DEFS,
  BUILDING_TYPES,
  DIFFICULTIES,
  FACTIONS,
  MAP_KINDS,
  HARVEST_JOBS,
  UNIT_TYPES,
  MAP_H,
  MAP_W,
  STARTING_CREDITS,
  cellCentre,
  cellIndex,
  inBounds,
  GRASS,
  QUEUE_KINDS,
  ROCK,
  TREES,
  WATER,
  UNIT_DEFS,
  type Building,
  type BuildingType,
  type Difficulty,
  type Faction,
  type MapKind,
  type Player,
  type Unit,
  type UnitQueue,
  type UnitType,
  type World,
} from './types';

export const START_CX = 14;
export const START_CY = 11;

/** One player's place at the table. */
export interface Seat {
  faction: Faction;
  /** Seats with the same team number are allies. */
  team: number;
  /** True if the computer plays this seat. */
  ai: boolean;
}

export interface Scenario {
  /** Adds a guarded enemy outpost in the far corner, giving the player something to fight. */
  outpost?: boolean;
  /** Scatters rocks, lakes and woods across the map. Without it the map is open grass. */
  terrain?: boolean;
  /** Which map to generate, when terrain is on. Lakes if not given. */
  map?: MapKind;
  /**
   * Up to four players. Seat 0 starts with a Pioneer in the north-west and
   * every other seat with a Construction Yard in its own corner. If this is
   * given, the three settings below it are ignored.
   */
  seats?: Seat[];
  /**
   * For a simple two-player game: which players the computer runs. Player 1
   * starts with a Construction Yard in the far corner.
   */
  ai?: number[];
  /** For a simple two-player game: which side each player commands. */
  factions?: [Faction, Faction];
  /** How hard the computer plays. Normal if not given. */
  difficulty?: Difficulty;
  /** Credits each player starts with, if not the usual amount. */
  credits?: number;
  /**
   * Starts every seat with a Pioneer in its corner and nothing else, so that
   * all players begin on equal terms. Used for games between people.
   */
  pioneers?: boolean;
}

/**
 * Where each seat starts. The first two are opposite corners, so a two-player
 * game begins as far apart as the map allows.
 */
export const BASES: readonly { x: number; y: number }[] = [
  { x: START_CX, y: START_CY },
  { x: MAP_W - 15, y: MAP_H - 12 },
  { x: MAP_W - 15, y: START_CY },
  { x: START_CX, y: MAP_H - 12 },
];

const OUTPOST_X = BASES[1].x - 3;
const OUTPOST_Y = BASES[1].y - 3;
/** The most ore, and the most gems, one cell can hold, in the credits it is worth. */
export const ORE_CELL = 460;
export const GEM_CELL = 760;
/** No rocks, water, trees or stray ore are generated this close to a starting position. */
const BASE_CLEARANCE = 11;

function nearBase(x: number, y: number, distance: number): boolean {
  return BASES.some((b) => Math.abs(x - b.x) < distance && Math.abs(y - b.y) < distance);
}

export function createWorld(seed: number, scenario: Scenario = {}): World {
  const aiPlayers = scenario.ai ?? [];
  const factions = scenario.factions ?? ['aegis', 'dominion'];
  const credits = scenario.credits ?? STARTING_CREDITS;
  const level = scenario.difficulty ?? 'normal';
  const seats: Seat[] =
    scenario.seats ??
    [0, 1].map((i) => ({ faction: factions[i], team: i, ai: aiPlayers.includes(i) }));
  // In the simple two-player form, the second player only exists if something puts them on the map.
  const present = (i: number): boolean =>
    i === 0 || scenario.seats !== undefined || seats[i].ai || scenario.outpost === true;

  const world: World = {
    tick: 0,
    winner: -1,
    map: scenario.terrain ? (scenario.map ?? 'lakes') : 'lakes',
    rng: seed | 0,
    nextId: 1,
    players: seats.map((s, i) => newPlayer(present(i), s.faction, s.team, credits)),
    ai: seats.map((s) => (s.ai ? { wave: 0, lastWave: 0, trained: 0, built: 0, level } : null)),
    units: [],
    buildings: [],
    terrain: new Uint8Array(MAP_W * MAP_H),
    ore: new Int32Array(MAP_W * MAP_H),
    rich: new Uint8Array(MAP_W * MAP_H),
    blocked: new Uint8Array(MAP_W * MAP_H),
    occupied: new Int32Array(MAP_W * MAP_H),
    vision: seats.map(() => ({
      visible: new Uint8Array(MAP_W * MAP_H),
      explored: new Uint8Array(MAP_W * MAP_H),
    })),
  };
  if (scenario.terrain) generateTerrain(world, seats.length);
  scatterOre(world);
  spawnUnit(world, 'pioneer', 0, START_CX, START_CY);
  if (scenario.pioneers) {
    for (let i = 1; i < seats.length; i++) spawnUnit(world, 'pioneer', i, BASES[i].x, BASES[i].y);
    for (let i = 0; i < seats.length; i++) homeOre(world, BASES[i]);
    updateVision(world);
    return world;
  }
  if (scenario.outpost) addOutpost(world);
  const rivals = seats.map((_, i) => i).filter((i) => i > 0 && (scenario.seats !== undefined || seats[i].ai));
  for (const i of rivals) addRivalBase(world, i);
  // Seat 0 gets the same ore on its doorstep as everyone else.
  if (rivals.length > 0) homeOre(world, BASES[0]);
  updateVision(world);
  return world;
}

function newPlayer(active: boolean, faction: Faction, team: number, credits: number): Player {
  return {
    active,
    faction,
    team,
    credits,
    production: null,
    queues: { infantry: emptyQueue(), vehicle: emptyQueue() },
    uplink: 0,
  };
}

/** Lays down an ore field. Gems are worth more, so a field of them is a prize worth fighting over. */
function orePatch(world: World, px: number, py: number, radius: number, gems = false): void {
  for (let y = py - radius; y <= py + radius; y++) {
    for (let x = px - radius; x <= px + radius; x++) {
      if (!inBounds(x, y) || (x - px) * (x - px) + (y - py) * (y - py) > radius * radius) continue;
      const i = cellIndex(x, y);
      if (world.terrain[i] !== GRASS || world.blocked[i]) continue;
      world.ore[i] = gems ? GEM_CELL : ORE_CELL;
      world.rich[i] = gems ? 1 : 0;
    }
  }
}

/** A good ore field a short drive from a base, towards the middle of the map. */
function homeOre(world: World, base: { x: number; y: number }): void {
  const sx = base.x < MAP_W / 2 ? 1 : -1;
  const sy = base.y < MAP_H / 2 ? 1 : -1;
  orePatch(world, base.x + sx * 8, base.y + sy * 7, 4);
}

/** A rival's starting position: a Construction Yard, a couple of guards and an ore field. */
function addRivalBase(world: World, player: number): void {
  const base = BASES[player];
  for (let y = base.y - 4; y <= base.y + 5; y++) {
    for (let x = base.x - 4; x <= base.x + 5; x++) {
      if (inBounds(x, y)) world.ore[cellIndex(x, y)] = 0;
    }
  }
  const yard = addBuilding(world, 'conyard', player, base.x - 1, base.y - 1);
  yard.progress = yard.total;
  spawnUnit(world, 'rifleman', player, base.x - 3, base.y);
  spawnUnit(world, 'rifleman', player, base.x, base.y - 3);
  homeOre(world, base);
}

/** A small finished enemy base with a few guards. It defends itself but builds nothing. */
function addOutpost(world: World): void {
  // Clear any ore from the site first.
  for (let y = OUTPOST_Y - 4; y < OUTPOST_Y + 10; y++) {
    for (let x = OUTPOST_X - 4; x < OUTPOST_X + 10; x++) {
      if (inBounds(x, y)) world.ore[cellIndex(x, y)] = 0;
    }
  }
  const layout: [BuildingType, number, number][] = [
    ['conyard', 0, 0],
    ['power', 4, 0],
    ['barracks', 4, 3],
    ['power', 0, 4],
  ];
  for (const [type, dx, dy] of layout) {
    const b = addBuilding(world, type, 1, OUTPOST_X + dx, OUTPOST_Y + dy);
    b.progress = b.total;
  }
  const guards: [UnitType, number, number][] = [
    ['rifleman', -2, 1],
    ['rifleman', -2, 3],
    ['rifleman', 1, -2],
    ['rifleman', 3, -2],
    ['rifleman', 2, 6],
    ['tank', -2, -2],
    ['tank', 7, 5],
  ];
  for (const [type, dx, dy] of guards) spawnUnit(world, type, 1, OUTPOST_X + dx, OUTPOST_Y + dy);
}

const emptyQueue = (): UnitQueue => ({ items: [], progress: 0, paid: 0, held: false, speedAcc: 0 });

/** Fills a rough blob of cells with a ground type, leaving every starting position clear. */
function blob(world: World, type: number, px: number, py: number, rx: number, ry: number, only = -1): void {
  for (let y = py - ry; y <= py + ry; y++) {
    for (let x = px - rx; x <= px + rx; x++) {
      if (!inBounds(x, y) || nearBase(x, y, BASE_CLEARANCE)) continue;
      // Scaled so the edge of the oval sits at 100.
      const d = Math.floor((100 * (x - px) * (x - px)) / (rx * rx) + (100 * (y - py) * (y - py)) / (ry * ry));
      if (d > 100) continue;
      // A ragged edge, so shores and treelines are not perfect ovals.
      if (d > 70 && randInt(world, 2) === 0) continue;
      const i = cellIndex(x, y);
      // When asked, only replace one kind of ground, such as dry land but not water.
      if (only !== -1 && world.terrain[i] !== only) continue;
      world.terrain[i] = type;
    }
  }
}

const at = (world: World): [number, number] => [6 + randInt(world, MAP_W - 12), 6 + randInt(world, MAP_H - 12)];

/** Big lakes, rocky outcrops and woods. Each lake is several overlapping ovals, which gives it bays and headlands. */
function lakeland(world: World): void {
  for (let lake = 0; lake < 6; lake++) {
    const [lx, ly] = at(world);
    for (let part = 0; part < 3; part++) {
      blob(world, WATER, lx + randInt(world, 15) - 7, ly + randInt(world, 15) - 7, 6 + randInt(world, 7), 5 + randInt(world, 6));
    }
  }
  for (let i = 0; i < 18; i++) blob(world, ROCK, ...at(world), 1 + randInt(world, 3), 1 + randInt(world, 3));
  for (let i = 0; i < 46; i++) blob(world, TREES, ...at(world), 1 + randInt(world, 3), 1 + randInt(world, 3));
}

/** Open sand broken up by a great many rocks and patches of scrub, with a few small pools. */
function desert(world: World): void {
  for (let i = 0; i < 12; i++) blob(world, WATER, ...at(world), 2 + randInt(world, 2), 2 + randInt(world, 2));
  for (let i = 0; i < 46; i++) blob(world, ROCK, ...at(world), 1 + randInt(world, 3), 1 + randInt(world, 3));
  for (let i = 0; i < 70; i++) blob(world, TREES, ...at(world), 1 + randInt(world, 2), 1 + randInt(world, 2));
}

/**
 * Sea, with an island in each corner for a base and a fifth in the middle.
 * Narrow causeways join each corner island to its two neighbours and to the
 * centre, so every route off an island is a chokepoint.
 */
function islands(world: World): void {
  world.terrain.fill(WATER);
  const cx = MAP_W >> 1;
  const cy = MAP_H >> 1;
  const land = (px: number, py: number, radius: number): void => {
    for (let y = py - radius; y <= py + radius; y++) {
      for (let x = px - radius; x <= px + radius; x++) {
        if (!inBounds(x, y)) continue;
        const d2 = (x - px) * (x - px) + (y - py) * (y - py);
        if (d2 > radius * radius) continue;
        // A ragged shoreline.
        if (d2 > (radius - 2) * (radius - 2) && randInt(world, 3) === 0) continue;
        world.terrain[cellIndex(x, y)] = GRASS;
      }
    }
  };
  /** A straight strip of land between two points, a few cells wide. */
  const causeway = (ax: number, ay: number, bx: number, by: number): void => {
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
    for (let s = 0; s <= steps; s++) {
      const x = ax + Math.round(((bx - ax) * s) / steps);
      const y = ay + Math.round(((by - ay) * s) / steps);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if (inBounds(x + dx, y + dy)) world.terrain[cellIndex(x + dx, y + dy)] = GRASS;
      }
    }
  };
  for (const b of BASES) land(b.x, b.y, 21);
  land(cx, cy, 14);
  for (const b of BASES) causeway(b.x, b.y, cx, cy);
  // Round the outside: north-west to north-east to south-east to south-west and back.
  const ring = [BASES[0], BASES[2], BASES[1], BASES[3]];
  ring.forEach((b, i) => causeway(b.x, b.y, ring[(i + 1) % 4].x, ring[(i + 1) % 4].y));

  // A little cover on the islands themselves. The causeways are too narrow to hold any,
  // so nothing placed here can cut one.
  const onIsland = (): [number, number] => {
    const home = randInt(world, 5);
    const centre = home === 4 ? { x: cx, y: cy } : BASES[home];
    return [centre.x + randInt(world, 31) - 15, centre.y + randInt(world, 31) - 15];
  };
  for (let i = 0; i < 26; i++) blob(world, TREES, ...onIsland(), 1 + randInt(world, 2), 1 + randInt(world, 2), GRASS);
  for (let i = 0; i < 10; i++) blob(world, ROCK, ...onIsland(), 1, 1, GRASS);
  for (const b of BASES) causeway(b.x, b.y, cx, cy);
  ring.forEach((b, i) => causeway(b.x, b.y, ring[(i + 1) % 4].x, ring[(i + 1) % 4].y));
}

/** Builds the ground for the chosen map. Retries until every starting position in use can be reached. */
function generateTerrain(world: World, seats: number): void {
  for (let attempt = 0; attempt < 30; attempt++) {
    world.terrain.fill(GRASS);
    if (world.map === 'islands') islands(world);
    else if (world.map === 'desert') desert(world);
    else lakeland(world);
    for (let i = 0; i < world.terrain.length; i++) world.blocked[i] = world.terrain[i] !== GRASS ? 1 : 0;

    const home = cellIndex(BASES[0].x, BASES[0].y);
    const connected = BASES.slice(1, Math.max(2, seats)).every((b) => {
      const route = findPath(world.blocked, MAP_W, MAP_H, home, b.x, b.y);
      return route.length > 0 && route[route.length - 1] === cellIndex(b.x, b.y);
    });
    if (connected) return;
  }
  // Could not find a layout with a way through, so fall back to open ground.
  world.terrain.fill(GRASS);
  world.blocked.fill(0);
}

/**
 * Ore across the map, and gems around the middle, where every side has to
 * come out and compete for them. A cell holds less than a harvester's load,
 * so a field visibly shrinks as it is worked.
 */
function scatterOre(world: World): void {
  if (world.map === 'islands') {
    // Each island has its own ore, close in and further out, and the prize is on the fifth.
    for (const b of BASES) {
      const sx = b.x < MAP_W / 2 ? 1 : -1;
      const sy = b.y < MAP_H / 2 ? 1 : -1;
      homeOre(world, b);
      orePatch(world, b.x + sx * 15, b.y + sy * 2, 3);
      orePatch(world, b.x + sx * 2, b.y + sy * 15, 3);
    }
    orePatch(world, MAP_W >> 1, MAP_H >> 1, 7, true);
    return;
  }
  const field = (gems: boolean, low: number, span: number, radiusBase: number, radiusSpan: number): void => {
    const px = low + randInt(world, span);
    const py = low + randInt(world, span);
    const radius = radiusBase + randInt(world, radiusSpan);
    if (nearBase(px, py, BASE_CLEARANCE + radius)) return;
    for (let y = py - radius; y <= py + radius; y++) {
      for (let x = px - radius; x <= px + radius; x++) {
        if (!inBounds(x, y)) continue;
        const d2 = (x - px) * (x - px) + (y - py) * (y - py);
        // Ragged edges: cells near the rim only sometimes get ore.
        if (d2 > radius * radius) continue;
        if (d2 > (radius - 1) * (radius - 1) && randInt(world, 3) === 0) continue;
        const i = cellIndex(x, y);
        if (world.terrain[i] !== GRASS) continue;
        world.ore[i] = (gems ? GEM_CELL : ORE_CELL) - randInt(world, 5) * 40;
        world.rich[i] = gems ? 1 : 0;
      }
    }
  };
  for (let i = 0; i < 26; i++) field(false, 5, MAP_W - 10, 3, 4);
  // Gems only turn up in the middle half of the map.
  for (let i = 0; i < 7; i++) field(true, MAP_W >> 2, MAP_W >> 1, 2, 2);
}

export function spawnUnit(world: World, type: UnitType, owner: number, cx: number, cy: number): Unit {
  // If the spot is taken, use the nearest free cell instead.
  const cell = freeCellNear(world, cx, cy);
  const x = cell % MAP_W;
  const y = (cell - x) / MAP_W;
  const unit: Unit = {
    id: world.nextId++,
    type,
    owner,
    x: cellCentre(x),
    y: cellCentre(y),
    prevX: cellCentre(x),
    prevY: cellCentre(y),
    facing: 2,
    cell,
    stepTo: -1,
    path: [],
    dest: -1,
    wait: 0,
    pendingDeploy: false,
    hp: UNIT_DEFS[type].hp,
    attack: 0,
    chase: false,
    cooldown: 0,
    chaseTimer: 0,
    capture: 0,
    job: type === 'harvester' ? 'seek' : 'none',
    cargo: 0,
    load: 0,
    target: -1,
    home: -1,
    refinery: 0,
    timer: 0,
  };
  world.units.push(unit);
  world.occupied[cell] = unit.id;
  return unit;
}

export function removeUnit(world: World, unit: Unit): void {
  const i = world.units.indexOf(unit);
  if (i === -1) return;
  world.units.splice(i, 1);
  world.occupied[unit.cell] = 0;
  if (unit.stepTo !== -1) world.occupied[unit.stepTo] = 0;
}

/** The closest cell to a point with no building and no unit on it. */
export function freeCellNear(world: World, cx: number, cy: number): number {
  for (let r = 0; r < Math.max(MAP_W, MAP_H); r++) {
    let best = -1;
    let bestD = 0;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || !inBounds(x, y)) continue;
        const i = cellIndex(x, y);
        if (world.blocked[i] || world.occupied[i]) continue;
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (best === -1 || d < bestD) {
          best = i;
          bestD = d;
        }
      }
    }
    if (best !== -1) return best;
  }
  return cellIndex(Math.min(MAP_W - 1, Math.max(0, cx)), Math.min(MAP_H - 1, Math.max(0, cy)));
}

export function addBuilding(
  world: World,
  type: BuildingType,
  owner: number,
  cx: number,
  cy: number,
): Building {
  const def = BUILDING_DEFS[type];
  const building: Building = {
    id: world.nextId++,
    type,
    owner,
    cx,
    cy,
    w: def.w,
    h: def.h,
    progress: 0,
    total: def.buildTicks,
    hp: def.hp,
    cooldown: 0,
    aim: 2,
    repairing: false,
    selling: false,
    rally: -1,
  };
  world.buildings.push(building);
  setBlocked(world, building, 1);
  return building;
}

export function removeBuilding(world: World, building: Building): void {
  const i = world.buildings.indexOf(building);
  if (i === -1) return;
  world.buildings.splice(i, 1);
  setBlocked(world, building, 0);
}

function setBlocked(world: World, b: Building, value: number): void {
  for (let y = b.cy; y < b.cy + b.h; y++) {
    for (let x = b.cx; x < b.cx + b.w; x++) {
      const i = cellIndex(x, y);
      // Clearing a building never opens up rock or water underneath.
      world.blocked[i] = value || (world.terrain[i] !== GRASS ? 1 : 0);
    }
  }
}

const PRODUCTION_STATES = ['active', 'held', 'ready'];

/** FNV-1a over the whole game state. Two games in sync share the same hash. */
export function hashWorld(world: World): number {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h = Math.imul(h ^ (n & 0xff), 0x01000193);
    h = Math.imul(h ^ ((n >>> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((n >>> 16) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((n >>> 24) & 0xff), 0x01000193);
  };
  mix(world.tick);
  mix(world.winner);
  mix(MAP_KINDS.indexOf(world.map));
  for (const ai of world.ai) {
    mix(ai ? ai.wave + 1 : 0);
    mix(ai ? ai.lastWave : 0);
    mix(ai ? ai.trained : 0);
    mix(ai ? ai.built : 0);
    mix(ai ? DIFFICULTIES.indexOf(ai.level) : 0);
  }
  mix(world.rng);
  mix(world.nextId);
  for (const p of world.players) {
    mix(FACTIONS.indexOf(p.faction));
    mix(p.team);
    mix(p.uplink);
    mix(p.credits);
    const prod = p.production;
    mix(prod ? 1 : 0);
    if (prod) {
      mix(BUILDING_TYPES.indexOf(prod.type));
      mix(prod.progress);
      mix(prod.paid);
      mix(prod.speedAcc);
      mix(PRODUCTION_STATES.indexOf(prod.state));
    }
    for (const kind of QUEUE_KINDS) {
      const q = p.queues[kind];
      mix(q.items.length);
      for (const item of q.items) mix(UNIT_TYPES.indexOf(item));
      mix(q.progress);
      mix(q.paid);
      mix(q.speedAcc);
      mix(q.held ? 1 : 0);
    }
  }
  for (const u of world.units) {
    mix(u.id);
    mix(UNIT_TYPES.indexOf(u.type));
    mix(u.owner);
    mix(u.x);
    mix(u.y);
    mix(u.facing);
    mix(u.cell);
    mix(u.stepTo);
    mix(u.dest);
    mix(u.wait);
    mix(u.pendingDeploy ? 1 : 0);
    mix(u.hp);
    mix(u.attack);
    mix(u.chase ? 1 : 0);
    mix(u.cooldown);
    mix(u.chaseTimer);
    mix(u.capture);
    mix(HARVEST_JOBS.indexOf(u.job));
    mix(u.cargo);
    mix(u.load);
    mix(u.target);
    mix(u.home);
    mix(u.refinery);
    mix(u.timer);
    mix(u.path.length);
    for (const c of u.path) mix(c);
  }
  for (const b of world.buildings) {
    mix(b.id);
    mix(BUILDING_TYPES.indexOf(b.type));
    mix(b.owner);
    mix(b.cx);
    mix(b.cy);
    mix(b.progress);
    mix(b.hp);
    mix(b.cooldown);
    mix(b.aim);
    mix(b.repairing ? 1 : 0);
    mix(b.selling ? 1 : 0);
    mix(b.rally);
  }
  for (let i = 0; i < world.ore.length; i++) mix(world.ore[i]);
  return h >>> 0;
}
