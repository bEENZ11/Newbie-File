import { randInt } from './rng';
import {
  BUILDING_DEFS,
  BUILDING_TYPES,
  HARVEST_JOBS,
  UNIT_TYPES,
  MAP_H,
  MAP_W,
  STARTING_CREDITS,
  cellCentre,
  cellIndex,
  inBounds,
  QUEUE_KINDS,
  UNIT_DEFS,
  type Building,
  type BuildingType,
  type Player,
  type Unit,
  type UnitQueue,
  type UnitType,
  type World,
} from './types';

export const START_CX = 14;
export const START_CY = 11;

export interface Scenario {
  /** Adds a guarded enemy outpost in the far corner, giving the player something to fight. */
  outpost?: boolean;
}

const OUTPOST_X = 46;
const OUTPOST_Y = 44;

export function createWorld(seed: number, scenario: Scenario = {}): World {
  const world: World = {
    tick: 0,
    winner: -1,
    rng: seed | 0,
    nextId: 1,
    players: [newPlayer(true), newPlayer(scenario.outpost === true)],
    units: [],
    buildings: [],
    ore: new Int32Array(MAP_W * MAP_H),
    blocked: new Uint8Array(MAP_W * MAP_H),
    occupied: new Int32Array(MAP_W * MAP_H),
  };
  scatterOre(world);
  spawnUnit(world, 'pioneer', 0, START_CX, START_CY);
  if (scenario.outpost) addOutpost(world);
  return world;
}

function newPlayer(active: boolean): Player {
  return {
    active,
    credits: STARTING_CREDITS,
    production: null,
    queues: { infantry: emptyQueue(), vehicle: emptyQueue() },
  };
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

/** A few ore patches, kept clear of the starting position. */
function scatterOre(world: World): void {
  let placed = 0;
  let attempts = 0;
  while (placed < 5 && attempts < 200) {
    attempts++;
    const px = 4 + randInt(world, MAP_W - 8);
    const py = 4 + randInt(world, MAP_H - 8);
    const radius = 3 + randInt(world, 3);
    if (Math.abs(px - START_CX) < 10 && Math.abs(py - START_CY) < 10) continue;
    for (let y = py - radius; y <= py + radius; y++) {
      for (let x = px - radius; x <= px + radius; x++) {
        if (!inBounds(x, y)) continue;
        const d2 = (x - px) * (x - px) + (y - py) * (y - py);
        // Ragged edges: cells near the rim only sometimes get ore.
        if (d2 > radius * radius) continue;
        if (d2 > (radius - 1) * (radius - 1) && randInt(world, 3) === 0) continue;
        world.ore[cellIndex(x, y)] = 600 + randInt(world, 5) * 100;
      }
    }
    placed++;
  }
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
    job: type === 'harvester' ? 'seek' : 'none',
    cargo: 0,
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
    for (let x = b.cx; x < b.cx + b.w; x++) world.blocked[cellIndex(x, y)] = value;
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
  mix(world.rng);
  mix(world.nextId);
  for (const p of world.players) {
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
    mix(HARVEST_JOBS.indexOf(u.job));
    mix(u.cargo);
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
    mix(b.selling ? 1 : 0);
    mix(b.rally);
  }
  for (let i = 0; i < world.ore.length; i++) mix(world.ore[i]);
  return h >>> 0;
}
