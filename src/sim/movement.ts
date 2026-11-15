// Moving units around the grid. Each unit holds the cell it stands on, plus
// the cell it is stepping into, so no two units ever share a cell.

import { findPath, nearestFree } from './pathfinding';
import { freeCellNear } from './world';
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
export const FACING = [
  [5, 6, 7],
  [4, 0, 0],
  [3, 2, 1],
];

/** True when the unit is standing still on a cell with nowhere left to go. */
export const isSettled = (unit: Unit): boolean => unit.stepTo === -1 && unit.path.length === 0;

/**
 * Plans a route to a cell. Other units are ignored here, since they will
 * usually have moved on by the time this one gets there.
 */
export function setDestination(world: World, unit: Unit, cx: number, cy: number): void {
  // A unit between cells finishes that step first and plans from there.
  // This keeps it on the grid so it never clips the corner of a building.
  const midStep = unit.stepTo;
  const start = midStep !== -1 ? midStep : unit.cell;
  const gx = Math.min(MAP_W - 1, Math.max(0, cx));
  const gy = Math.min(MAP_H - 1, Math.max(0, cy));
  const route = findPath(world.blocked, MAP_W, MAP_H, start, gx, gy);
  unit.path = midStep !== -1 ? [midStep, ...route] : route;
  unit.dest = cellIndex(gx, gy);
  unit.wait = 0;
}

/** Stops the unit as soon as it finishes the step it is on. */
export function haltUnit(unit: Unit): void {
  unit.path = unit.stepTo !== -1 ? [unit.stepTo] : [];
  unit.dest = -1;
}

/** Plans afresh after a building has appeared across the route. */
function replan(world: World, unit: Unit): void {
  if (unit.dest === -1) {
    unit.path = [];
    return;
  }
  const dx = unit.dest % MAP_W;
  setDestination(world, unit, dx, (unit.dest - dx) / MAP_W);
}

/**
 * Called when another unit has been in the way for a while. Treats every
 * other unit as an obstacle and looks for a way round.
 */
function goRound(world: World, unit: Unit): void {
  unit.wait = 0;
  if (unit.dest === -1) {
    unit.path = [];
    return;
  }
  const blocked = world.blocked.slice();
  for (let i = 0; i < blocked.length; i++) {
    if (world.occupied[i] !== 0 && world.occupied[i] !== unit.id) blocked[i] = 1;
  }
  const dx = unit.dest % MAP_W;
  const goal = nearestFree(blocked, MAP_W, MAP_H, dx, (unit.dest - dx) / MAP_W);
  if (goal === unit.cell || goal === -1) {
    // Someone is parked on the destination and this is as close as it gets.
    unit.path = [];
    unit.dest = -1;
    return;
  }
  const gx = goal % MAP_W;
  const route = findPath(blocked, MAP_W, MAP_H, unit.cell, gx, (goal - gx) / MAP_W);
  if (route.length > 0) {
    unit.path = route;
    return;
  }
  // No way round means it is boxed in. If the unit in the way is one of ours
  // and is just standing there, ask it to shuffle aside. It will do the same
  // to whoever is blocking it in turn, so a packed crowd opens up from the
  // outside in.
  const holder = world.units.find((u) => u.id === world.occupied[unit.path[0]]);
  if (!holder || holder.owner !== unit.owner || !isSettled(holder) || holder.attack !== 0) return;
  if (holder.type === 'harvester' && holder.job !== 'manual' && holder.job !== 'idle') return;
  const hx = holder.cell % MAP_W;
  const spot = freeCellNear(world, hx, (holder.cell - hx) / MAP_W);
  const sx = spot % MAP_W;
  setDestination(world, holder, sx, (spot - sx) / MAP_W);
}

export function moveUnit(world: World, unit: Unit): void {
  if (unit.stepTo === -1) {
    if (unit.path.length === 0) return;
    const next = unit.path[0];
    if (world.blocked[next]) {
      // A building has gone up across the route.
      replan(world, unit);
      return;
    }
    const holder = world.occupied[next];
    if (holder !== 0 && holder !== unit.id) {
      // Someone is in the way. Give them a moment, then go round.
      if (++unit.wait >= BLOCKED_PATIENCE) goRound(world, unit);
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
