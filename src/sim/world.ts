import { randInt } from './rng';
import {
  BUILDING_DEFS,
  MAP_H,
  MAP_W,
  STARTING_CREDITS,
  cellCentre,
  cellIndex,
  inBounds,
  type Building,
  type BuildingType,
  type Unit,
  type UnitType,
  type World,
} from './types';

export const START_CX = 14;
export const START_CY = 11;

export function createWorld(seed: number): World {
  const world: World = {
    tick: 0,
    rng: seed | 0,
    credits: STARTING_CREDITS,
    nextId: 1,
    units: [],
    buildings: [],
    ore: new Int32Array(MAP_W * MAP_H),
    blocked: new Uint8Array(MAP_W * MAP_H),
  };
  scatterOre(world);
  spawnUnit(world, 'pioneer', 0, START_CX, START_CY);
  return world;
}

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
  const unit: Unit = {
    id: world.nextId++,
    type,
    owner,
    x: cellCentre(cx),
    y: cellCentre(cy),
    prevX: cellCentre(cx),
    prevY: cellCentre(cy),
    facing: 0,
    path: [],
    pendingDeploy: false,
  };
  world.units.push(unit);
  return unit;
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
  };
  world.buildings.push(building);
  for (let y = cy; y < cy + def.h; y++) {
    for (let x = cx; x < cx + def.w; x++) world.blocked[cellIndex(x, y)] = 1;
  }
  return building;
}

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
  mix(world.rng);
  mix(world.credits);
  mix(world.nextId);
  for (const u of world.units) {
    mix(u.id);
    mix(u.owner);
    mix(u.x);
    mix(u.y);
    mix(u.facing);
    mix(u.pendingDeploy ? 1 : 0);
    mix(u.path.length);
    for (const c of u.path) mix(c);
  }
  for (const b of world.buildings) {
    mix(b.id);
    mix(b.owner);
    mix(b.cx);
    mix(b.cy);
    mix(b.progress);
  }
  for (let i = 0; i < world.ore.length; i++) mix(world.ore[i]);
  return h >>> 0;
}
