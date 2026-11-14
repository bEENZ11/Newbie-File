// Harvesters: find ore, fill up, carry it to a refinery, unload, repeat.

import { isSettled, setDestination } from './movement';
import {
  GATHER_RATE,
  HARVEST_CAPACITY,
  MAP_W,
  UNLOAD_RATE,
  cellIndex,
  dockCell,
  isActive,
  type Building,
  type Unit,
  type World,
} from './types';

const RETRY_TICKS = 20;

const cellX = (c: number): number => c % MAP_W;
const cellY = (c: number): number => (c - (c % MAP_W)) / MAP_W;

/** The nearest ore cell to a point that no other unit is sitting on. */
function nearestOre(world: World, unit: Unit, from: number): number {
  const fx = cellX(from);
  const fy = cellY(from);
  let best = -1;
  let bestD = 0;
  for (let i = 0; i < world.ore.length; i++) {
    if (world.ore[i] <= 0) continue;
    const holder = world.occupied[i];
    if (holder !== 0 && holder !== unit.id) continue;
    const dx = cellX(i) - fx;
    const dy = cellY(i) - fy;
    const d = dx * dx + dy * dy;
    if (best === -1 || d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best;
}

function nearestRefinery(world: World, unit: Unit): Building | null {
  const ux = cellX(unit.cell);
  const uy = cellY(unit.cell);
  let best: Building | null = null;
  let bestD = 0;
  for (const b of world.buildings) {
    if (b.type !== 'refinery' || b.owner !== unit.owner || !isActive(b)) continue;
    const dock = dockCell(b);
    const d = (dock.x - ux) * (dock.x - ux) + (dock.y - uy) * (dock.y - uy);
    if (!best || d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

function refineryOf(world: World, unit: Unit): Building | null {
  const b = world.buildings.find((x) => x.id === unit.refinery);
  return b && b.owner === unit.owner && isActive(b) ? b : null;
}

function goToOre(world: World, unit: Unit, cell: number): void {
  unit.job = 'toOre';
  unit.target = cell;
  setDestination(world, unit, cellX(cell), cellY(cell));
}

function goToRefinery(world: World, unit: Unit, refinery: Building): void {
  const dock = dockCell(refinery);
  unit.job = 'toRefinery';
  unit.refinery = refinery.id;
  setDestination(world, unit, dock.x, dock.y);
}

function rest(unit: Unit): void {
  unit.job = 'idle';
  unit.timer = RETRY_TICKS;
}

/**
 * A move order from the player. Clicking ore sends the harvester to dig
 * there, clicking a refinery sends it to unload, and anything else is a plain
 * move after which it waits for further orders.
 */
export function orderHarvester(world: World, unit: Unit, cx: number, cy: number): void {
  const cell = cellIndex(cx, cy);
  if (world.ore[cell] > 0) {
    unit.home = cell;
    goToOre(world, unit, cell);
    return;
  }
  const refinery = world.buildings.find((b) => {
    if (b.type !== 'refinery' || b.owner !== unit.owner || !isActive(b)) return false;
    const dock = dockCell(b);
    const inside = cx >= b.cx && cy >= b.cy && cx < b.cx + b.w && cy < b.cy + b.h;
    return inside || (dock.x === cx && dock.y === cy);
  });
  if (refinery && unit.cargo > 0) {
    goToRefinery(world, unit, refinery);
    return;
  }
  unit.job = 'manual';
  setDestination(world, unit, cx, cy);
}

export function tickHarvester(world: World, unit: Unit): void {
  switch (unit.job) {
    case 'idle':
      if (--unit.timer <= 0) unit.job = unit.cargo >= HARVEST_CAPACITY ? 'return' : 'seek';
      break;

    case 'seek': {
      if (unit.cargo >= HARVEST_CAPACITY) {
        unit.job = 'return';
        break;
      }
      // Look near the last field worked, so it goes back to the same patch.
      const cell = nearestOre(world, unit, unit.home !== -1 ? unit.home : unit.cell);
      if (cell === -1) {
        // No ore left anywhere. Bring home whatever is on board.
        if (unit.cargo > 0) unit.job = 'return';
        else rest(unit);
      } else {
        goToOre(world, unit, cell);
      }
      break;
    }

    case 'toOre':
      if (world.ore[unit.target] <= 0) {
        unit.job = 'seek';
      } else if (isSettled(unit)) {
        if (unit.cell === unit.target) {
          unit.job = 'harvest';
          unit.home = unit.cell;
        } else {
          // Could not get onto that cell, so pick another after a short pause.
          rest(unit);
        }
      }
      break;

    case 'harvest': {
      const take = Math.min(GATHER_RATE, world.ore[unit.cell], HARVEST_CAPACITY - unit.cargo);
      world.ore[unit.cell] -= take;
      unit.cargo += take;
      if (unit.cargo >= HARVEST_CAPACITY) unit.job = 'return';
      else if (world.ore[unit.cell] <= 0) unit.job = 'seek';
      break;
    }

    case 'return': {
      const refinery = nearestRefinery(world, unit);
      if (refinery) goToRefinery(world, unit, refinery);
      else rest(unit);
      break;
    }

    case 'toRefinery': {
      const refinery = refineryOf(world, unit);
      if (!refinery) {
        unit.job = 'return';
        break;
      }
      if (!isSettled(unit)) break;
      const dock = dockCell(refinery);
      const dockIndex = cellIndex(dock.x, dock.y);
      if (unit.cell === dockIndex) {
        unit.job = 'unload';
        // Back up to the dock, facing away, ready to drive off.
        unit.facing = 2;
      } else if (world.occupied[dockIndex] === 0) {
        // The dock has come free, so move up. Until then, wait in the queue.
        setDestination(world, unit, dock.x, dock.y);
      }
      break;
    }

    case 'unload': {
      if (!refineryOf(world, unit)) {
        unit.job = 'return';
        break;
      }
      const amount = Math.min(UNLOAD_RATE, unit.cargo);
      unit.cargo -= amount;
      world.players[unit.owner].credits += amount;
      if (unit.cargo <= 0) unit.job = 'seek';
      break;
    }

    case 'manual':
    case 'none':
      break;
  }
}

export function tickHarvesters(world: World): void {
  for (const unit of world.units) {
    if (unit.type === 'harvester') tickHarvester(world, unit);
  }
}
