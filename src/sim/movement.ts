// Moving units around the grid. Each unit holds the cell it stands on, plus
// the cell it is stepping into, so no two units ever share a cell.

import { findPath } from './pathfinding';
import {
  BLOCKED_PATIENCE,
  MAP_H,
  MAP_W,
  UNIT_DEFS,
  cellCentre,
  cellIndex,
  type Unit,
  type World,
} from './types';

// Facing lookup indexed by [sign(dy) + 1][sign(dx) + 1].
const FACING = [
  [5, 6, 7],
  [4, 0, 0],
  [3, 2, 1],
];

/** True when the unit is standing still on a cell with nowhere left to go. */
export const isSettled = (unit: Unit): boolean => unit.stepTo === -1 && unit.path.length === 0;

/**
 * Plans a route to a cell. Normally other units are ignored, since they will
 * usually have moved on by the time this one gets there. With avoidUnits set,
 * they are treated as obstacles, which is how a blocked unit finds a way round.
 */
export function setDestination(
  world: World,
  unit: Unit,
  cx: number,
  cy: number,
  avoidUnits = false,
): void {
  // A unit between cells finishes that step first and plans from there.
  // This keeps it on the grid so it never clips the corner of a building.
  const midStep = unit.stepTo;
  const start = midStep !== -1 ? midStep : unit.cell;
  let blocked = world.blocked;
  if (avoidUnits) {
    blocked = world.blocked.slice();
    for (let i = 0; i < blocked.length; i++) {
      if (world.occupied[i] !== 0 && world.occupied[i] !== unit.id) blocked[i] = 1;
    }
  }
  const gx = Math.min(MAP_W - 1, Math.max(0, cx));
  const gy = Math.min(MAP_H - 1, Math.max(0, cy));
  const route = findPath(blocked, MAP_W, MAP_H, start, gx, gy);
  unit.path = midStep !== -1 ? [midStep, ...route] : route;
  unit.dest = cellIndex(gx, gy);
  unit.wait = 0;
}

/** Stops the unit as soon as it finishes the step it is on. */
export function haltUnit(unit: Unit): void {
  unit.path = unit.stepTo !== -1 ? [unit.stepTo] : [];
  unit.dest = -1;
}

function replan(world: World, unit: Unit, avoidUnits: boolean): void {
  if (unit.dest === -1) {
    unit.path = [];
    return;
  }
  const dx = unit.dest % MAP_W;
  setDestination(world, unit, dx, (unit.dest - dx) / MAP_W, avoidUnits);
}

export function moveUnit(world: World, unit: Unit): void {
  if (unit.stepTo === -1) {
    if (unit.path.length === 0) return;
    const next = unit.path[0];
    if (world.blocked[next]) {
      // A building has gone up across the route.
      replan(world, unit, false);
      return;
    }
    const holder = world.occupied[next];
    if (holder !== 0 && holder !== unit.id) {
      // Someone is in the way. Give them a moment, then go round.
      if (++unit.wait >= BLOCKED_PATIENCE) replan(world, unit, true);
      return;
    }
    world.occupied[next] = unit.id;
    unit.stepTo = next;
    unit.wait = 0;
  }

  const nx = unit.stepTo % MAP_W;
  const tx = cellCentre(nx);
  const ty = cellCentre((unit.stepTo - nx) / MAP_W);
  const dx = tx - unit.x;
  const dy = ty - unit.y;
  const speed = UNIT_DEFS[unit.type].speed;
  // Diagonal steps are scaled by roughly 1/sqrt(2), in whole numbers.
  const step = dx !== 0 && dy !== 0 ? (speed * 181) >> 8 : speed;
  if (dx !== 0 || dy !== 0) unit.facing = FACING[Math.sign(dy) + 1][Math.sign(dx) + 1];
  unit.x += Math.sign(dx) * Math.min(Math.abs(dx), step);
  unit.y += Math.sign(dy) * Math.min(Math.abs(dy), step);

  if (unit.x === tx && unit.y === ty) {
    world.occupied[unit.cell] = 0;
    unit.cell = unit.stepTo;
    unit.stepTo = -1;
    unit.path.shift();
    if (unit.path.length === 0) unit.dest = -1;
  }
}
