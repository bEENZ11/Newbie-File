// Base building: the sidebar production slot, power, placement and selling.

import { addBuilding, removeBuilding, spawnUnit } from './world';
import {
  BUILDING_DEFS,
  BUILD_RANGE,
  FACTION_DEFS,
  MIN_POWER_RATE,
  REPAIR_COST_PERCENT,
  REPAIR_HP,
  REPAIR_INTERVAL,
  SELL_REFUND_PERCENT,
  cellIndex,
  dockCell,
  inBounds,
  isActive,
  type Building,
  type BuildingType,
  type Player,
  type SimEvent,
  type World,
} from './types';

export interface PowerState {
  supply: number;
  demand: number;
  low: boolean;
}

export function powerOf(world: World, player: number): PowerState {
  let supply = 0;
  let demand = 0;
  for (const b of world.buildings) {
    if (b.owner !== player || !isActive(b)) continue;
    const p = BUILDING_DEFS[b.type].power;
    if (p > 0) supply += p;
    else demand -= p;
  }
  return { supply, demand, low: demand > supply };
}

function owns(world: World, player: number, type: BuildingType): boolean {
  return world.buildings.some((b) => b.owner === player && b.type === type && isActive(b));
}

/** Whether the player has the Construction Yard and prerequisites for a building. */
export function canProduce(world: World, player: number, type: BuildingType): boolean {
  const def = BUILDING_DEFS[type];
  if (def.produceTicks <= 0) return false;
  if (FACTION_DEFS[world.players[player].faction].withoutBuildings.includes(type)) return false;
  if (!owns(world, player, 'conyard')) return false;
  return def.requires.every((r) => owns(world, player, r));
}

/** What the player still needs before a building unlocks. */
export function missingFor(world: World, player: number, type: BuildingType): BuildingType[] {
  const needs: BuildingType[] = ['conyard', ...BUILDING_DEFS[type].requires];
  return needs.filter((r) => !owns(world, player, r));
}

export function startProduction(world: World, player: number, type: BuildingType): void {
  const p = world.players[player];
  if (!p) return;
  if (p.production) {
    // Clicking the item that is on hold resumes it.
    if (p.production.type === type && p.production.state === 'held') p.production.state = 'active';
    return;
  }
  if (!canProduce(world, player, type)) return;
  p.production = {
    type,
    progress: 0,
    total: BUILDING_DEFS[type].produceTicks,
    paid: 0,
    state: 'active',
    speedAcc: 0,
  };
}

export function holdProduction(world: World, player: number): void {
  const prod = world.players[player]?.production;
  if (prod && prod.state === 'active') prod.state = 'held';
}

/** Abandons the current item and returns everything spent on it. */
export function cancelProduction(world: World, player: number): void {
  const p = world.players[player];
  if (!p?.production) return;
  p.credits += p.production.paid;
  p.production = null;
}

/** Production speed out of 256. Low power slows it in proportion to the shortfall. */
export function productionRate(world: World, player: number): number {
  const power = powerOf(world, player);
  return power.low
    ? Math.max(MIN_POWER_RATE, Math.floor((power.supply * 256) / power.demand))
    : 256;
}

/**
 * Moves one item of work forward by a tick, paying for it as it goes.
 * Shared by buildings and units.
 */
export function advance(
  p: Player,
  job: { progress: number; paid: number; speedAcc: number },
  cost: number,
  total: number,
  rate: number,
): void {
  job.speedAcc += rate;
  while (job.speedAcc >= 256 && job.progress < total) {
    job.speedAcc -= 256;
    // Working from the running total keeps the final price exact, with no
    // rounding drift.
    const due = Math.floor((cost * (job.progress + 1)) / total) - job.paid;
    if (due > p.credits) {
      // Out of money: wait here until more arrives.
      job.speedAcc = 0;
      break;
    }
    p.credits -= due;
    job.paid += due;
    job.progress++;
  }
}

export function tickProduction(world: World, events: SimEvent[]): void {
  world.players.forEach((p, player) => {
    const prod = p.production;
    if (!prod || prod.state !== 'active') return;

    advance(p, prod, BUILDING_DEFS[prod.type].cost, prod.total, productionRate(world, player));

    if (prod.progress >= prod.total) {
      prod.state = 'ready';
      events.push({ type: 'productionReady', player, building: prod.type });
    }
  });
}

/** The radar map needs a working Radar Station and enough power to run it. */
export function hasRadar(world: World, player: number): boolean {
  return owns(world, player, 'radar') && !powerOf(world, player).low;
}

export interface PlacementCheck {
  ok: boolean;
  /** False when every cell is clear but the spot is too far from the base. */
  inRange: boolean;
  cells: { x: number; y: number; ok: boolean }[];
}

/** Checks whether a building could go with its top-left corner at this cell. */
export function checkPlacement(
  world: World,
  player: number,
  type: BuildingType,
  cx: number,
  cy: number,
): PlacementCheck {
  const def = BUILDING_DEFS[type];

  // Refinery docks must stay open, so nothing may be built on one.
  const docks = new Set<number>();
  for (const b of world.buildings) {
    if (b.type !== 'refinery') continue;
    const d = dockCell(b);
    if (inBounds(d.x, d.y)) docks.add(cellIndex(d.x, d.y));
  }

  const cells: PlacementCheck['cells'] = [];
  let clear = true;
  for (let y = cy; y < cy + def.h; y++) {
    for (let x = cx; x < cx + def.w; x++) {
      const i = cellIndex(x, y);
      const ok =
        inBounds(x, y) &&
        !world.blocked[i] &&
        world.ore[i] === 0 &&
        world.occupied[i] === 0 &&
        !docks.has(i);
      if (!ok) clear = false;
      cells.push({ x, y, ok });
    }
  }

  // A refinery also needs its own dock cell to be on the map and unobstructed.
  if (type === 'refinery') {
    const d = dockCell({ cx, cy, w: def.w, h: def.h } as Building);
    const ok = inBounds(d.x, d.y) && !world.blocked[cellIndex(d.x, d.y)];
    if (!ok) clear = false;
    cells.push({ x: d.x, y: d.y, ok });
  }

  // Must be near an existing building of the player's, leaving at most a
  // one-cell gap. This is what keeps a base in one piece.
  // Walls do not count as part of the base, or a line of them could be used to
  // creep building across the map.
  const range = def.placeRange ?? BUILD_RANGE;
  const inRange = world.buildings.some(
    (b) =>
      b.owner === player &&
      !b.selling &&
      b.type !== 'wall' &&
      cx < b.cx + b.w + range &&
      cx + def.w + range > b.cx &&
      cy < b.cy + b.h + range &&
      cy + def.h + range > b.cy,
  );

  return { ok: clear && inRange, inRange, cells };
}

/** Puts the finished building on the map. Returns it, or null if refused. */
export function placeProduction(
  world: World,
  player: number,
  cx: number,
  cy: number,
  events: SimEvent[],
): Building | null {
  const p = world.players[player];
  const prod = p?.production;
  if (!p || !prod || prod.state !== 'ready') return null;
  const def = BUILDING_DEFS[prod.type];
  if (!checkPlacement(world, player, prod.type, cx, cy).ok) {
    events.push({ type: 'placeRefused', player, cx, cy, w: def.w, h: def.h });
    return null;
  }
  const building = addBuilding(world, prod.type, player, cx, cy);
  p.production = null;
  events.push({ type: 'placed', player, buildingId: building.id });
  return building;
}

/** Starts or stops repairing a damaged building. */
export function toggleRepair(world: World, player: number, buildingId: number): void {
  const b = world.buildings.find((x) => x.id === buildingId);
  if (!b || b.owner !== player || b.selling || !isActive(b)) return;
  b.repairing = !b.repairing && b.hp < BUILDING_DEFS[b.type].hp;
}

export function sellBuilding(world: World, player: number, buildingId: number): void {
  const b = world.buildings.find((x) => x.id === buildingId);
  if (!b || b.owner !== player || b.selling) return;
  b.selling = true;
  b.repairing = false;
}

/** Restores a little health in exchange for credits. Pauses when the money runs out. */
function repairStep(world: World, b: Building): void {
  const def = BUILDING_DEFS[b.type];
  if (b.selling || b.hp >= def.hp) {
    b.repairing = false;
    return;
  }
  if (world.tick % REPAIR_INTERVAL !== 0) return;
  const price = Math.max(1, Math.ceil((def.cost * REPAIR_COST_PERCENT * REPAIR_HP) / (def.hp * 100)));
  const p = world.players[b.owner];
  if (p.credits < price) return;
  p.credits -= price;
  b.hp = Math.min(def.hp, b.hp + REPAIR_HP);
  if (b.hp >= def.hp) b.repairing = false;
}

/** Advances build-up animations, and packs away buildings that are being sold. */
export function tickBuildings(world: World, events: SimEvent[]): void {
  for (const b of world.buildings.slice()) {
    if (b.repairing) repairStep(world, b);
    if (!b.selling) {
      if (b.progress < b.total && ++b.progress === b.total && b.type === 'refinery') {
        // Every refinery comes with a harvester, which sets off on its own.
        const dock = dockCell(b);
        spawnUnit(world, 'harvester', b.owner, dock.x, dock.y);
      }
      continue;
    }
    b.progress -= 2;
    if (b.progress > 0) continue;
    const refund = Math.floor((BUILDING_DEFS[b.type].cost * SELL_REFUND_PERCENT) / 100);
    world.players[b.owner].credits += refund;
    removeBuilding(world, b);
    events.push({ type: 'sold', player: b.owner, buildingId: b.id, refund });
  }
}
