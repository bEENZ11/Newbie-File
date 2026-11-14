import { findPath } from './pathfinding';
import { addBuilding } from './world';
import {
  BUILDING_DEFS,
  MAP_H,
  MAP_W,
  UNIT_DEFS,
  cellCentre,
  cellIndex,
  inBounds,
  toCell,
  type Command,
  type SimEvent,
  type Unit,
  type World,
} from './types';

// Facing lookup indexed by [sign(dy) + 1][sign(dx) + 1].
const FACING = [
  [5, 6, 7],
  [4, 0, 0],
  [3, 2, 1],
];

/** Advances the world by exactly one tick. */
export function stepWorld(world: World, commands: readonly Command[], events: SimEvent[]): void {
  for (const cmd of commands) applyCommand(world, cmd);

  for (const unit of world.units) {
    unit.prevX = unit.x;
    unit.prevY = unit.y;
    moveUnit(unit);
  }

  // Deploying removes units, so it runs after movement on a copy of the list.
  for (const unit of world.units.slice()) {
    if (unit.pendingDeploy && unit.path.length === 0) tryDeploy(world, unit, events);
  }

  for (const b of world.buildings) {
    if (b.progress < b.total) b.progress++;
  }

  world.tick++;
}

function applyCommand(world: World, cmd: Command): void {
  switch (cmd.type) {
    case 'move':
      for (const id of cmd.unitIds) {
        const unit = world.units.find((u) => u.id === id);
        if (!unit) continue;
        unit.pendingDeploy = false;
        setDestination(world, unit, cmd.cx, cmd.cy);
      }
      break;
    case 'deploy': {
      const unit = world.units.find((u) => u.id === cmd.unitId);
      if (!unit || unit.type !== 'pioneer') break;
      // Finish the step in progress so it settles on a cell centre first.
      unit.path.length = Math.min(unit.path.length, 1);
      unit.pendingDeploy = true;
      break;
    }
  }
}

function setDestination(world: World, unit: Unit, cx: number, cy: number): void {
  // If the unit is between cells, let it finish that step and plan from there.
  // This keeps it on the grid so it never clips the corner of a building.
  const midStep = unit.path.length > 0 ? unit.path[0] : -1;
  const start = midStep !== -1 ? midStep : cellIndex(toCell(unit.x), toCell(unit.y));
  const route = findPath(world.blocked, MAP_W, MAP_H, start, cx, cy);
  unit.path = midStep !== -1 ? [midStep, ...route] : route;
}

function moveUnit(unit: Unit): void {
  if (unit.path.length === 0) return;
  const next = unit.path[0];
  const nx = next % MAP_W;
  const tx = cellCentre(nx);
  const ty = cellCentre((next - nx) / MAP_W);
  const dx = tx - unit.x;
  const dy = ty - unit.y;
  const speed = UNIT_DEFS[unit.type].speed;
  // Diagonal steps are scaled by roughly 1/sqrt(2), in whole numbers.
  const step = dx !== 0 && dy !== 0 ? (speed * 181) >> 8 : speed;
  if (dx !== 0 || dy !== 0) unit.facing = FACING[Math.sign(dy) + 1][Math.sign(dx) + 1];
  unit.x += Math.sign(dx) * Math.min(Math.abs(dx), step);
  unit.y += Math.sign(dy) * Math.min(Math.abs(dy), step);
  if (unit.x === tx && unit.y === ty) unit.path.shift();
}

/** The cells a deploying Pioneer would occupy, as a top-left cell. */
export function deployFootprint(unit: Unit): { cx: number; cy: number; w: number; h: number } {
  const def = BUILDING_DEFS.conyard;
  return {
    cx: toCell(unit.x) - (def.w >> 1),
    cy: toCell(unit.y) - (def.h >> 1),
    w: def.w,
    h: def.h,
  };
}

export function canDeploy(world: World, unit: Unit): boolean {
  const f = deployFootprint(unit);
  for (let y = f.cy; y < f.cy + f.h; y++) {
    for (let x = f.cx; x < f.cx + f.w; x++) {
      if (!inBounds(x, y)) return false;
      const i = cellIndex(x, y);
      if (world.blocked[i] || world.ore[i] > 0) return false;
      for (const other of world.units) {
        if (other !== unit && toCell(other.x) === x && toCell(other.y) === y) return false;
      }
    }
  }
  return true;
}

function tryDeploy(world: World, unit: Unit, events: SimEvent[]): void {
  unit.pendingDeploy = false;
  const f = deployFootprint(unit);
  if (!canDeploy(world, unit)) {
    events.push({ type: 'deployBlocked', ...f });
    return;
  }
  world.units.splice(world.units.indexOf(unit), 1);
  const building = addBuilding(world, 'conyard', unit.owner, f.cx, f.cy);
  events.push({ type: 'deployed', unitId: unit.id, buildingId: building.id });
}
