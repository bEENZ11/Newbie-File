// Training units at the Barracks and War Factory, and rally points.

import { setDestination } from './movement';
import { advance, productionRate } from './production';
import { freeCellNear, spawnUnit } from './world';
import {
  FACTION_DEFS,
  MAP_W,
  MAX_QUEUE,
  QUEUE_BUILDING,
  QUEUE_KINDS,
  UNIT_DEFS,
  cellIndex,
  exitCell,
  inBounds,
  isActive,
  type Building,
  type BuildingType,
  type QueueKind,
  type SimEvent,
  type UnitType,
  type World,
} from './types';

function owns(world: World, player: number, type: BuildingType): boolean {
  return world.buildings.some((b) => b.owner === player && b.type === type && isActive(b));
}

/** The building new units come out of: the oldest working one of its kind. */
export function primaryBuilding(world: World, player: number, kind: QueueKind): Building | null {
  const type = QUEUE_BUILDING[kind];
  return world.buildings.find((b) => b.owner === player && b.type === type && isActive(b)) ?? null;
}

/** What the player still needs before a unit can be trained. */
export function missingForUnit(world: World, player: number, unit: UnitType): BuildingType[] {
  const def = UNIT_DEFS[unit];
  if (!def.queue) return [];
  const needs: BuildingType[] = [QUEUE_BUILDING[def.queue], ...def.requires];
  return needs.filter((r) => !owns(world, player, r));
}

export function canTrain(world: World, player: number, unit: UnitType): boolean {
  const def = UNIT_DEFS[unit];
  if (FACTION_DEFS[world.players[player].faction].withoutUnits.includes(unit)) return false;
  return def.queue !== null && missingForUnit(world, player, unit).length === 0;
}

/** Adds a unit to its line, or resumes the line if this unit is on hold at the front. */
export function trainUnit(world: World, player: number, unit: UnitType): void {
  const p = world.players[player];
  const kind = UNIT_DEFS[unit].queue;
  if (!p || !kind) return;
  const q = p.queues[kind];
  if (q.held && q.items[0] === unit) {
    q.held = false;
    return;
  }
  if (!canTrain(world, player, unit) || q.items.length >= MAX_QUEUE) return;
  q.items.push(unit);
}

/**
 * Backs a unit out of its line. If it is the one in progress, the first call
 * puts it on hold and the second cancels it with a full refund. Otherwise the
 * most recently queued one of that type is dropped.
 */
export function untrainUnit(world: World, player: number, unit: UnitType): void {
  const p = world.players[player];
  const kind = UNIT_DEFS[unit].queue;
  if (!p || !kind) return;
  const q = p.queues[kind];
  const last = q.items.lastIndexOf(unit);
  if (last === -1) return;
  if (last > 0) {
    q.items.splice(last, 1);
  } else if (!q.held) {
    q.held = true;
  } else {
    p.credits += q.paid;
    q.items.shift();
    q.progress = 0;
    q.paid = 0;
    q.speedAcc = 0;
    q.held = false;
  }
}

export function setRally(world: World, player: number, buildingId: number, cx: number, cy: number): void {
  const b = world.buildings.find((x) => x.id === buildingId);
  if (!b || b.owner !== player || !inBounds(cx, cy)) return;
  if (b.type !== 'barracks' && b.type !== 'factory') return;
  b.rally = cellIndex(cx, cy);
}

/** Where a building sends its new units: the rally point, or just clear of the door. */
export function rallyPoint(b: Building): { x: number; y: number } {
  if (b.rally !== -1) {
    const x = b.rally % MAP_W;
    return { x, y: (b.rally - x) / MAP_W };
  }
  const exit = exitCell(b);
  return { x: exit.x, y: exit.y + 2 };
}

export function tickTraining(world: World, events: SimEvent[]): void {
  world.players.forEach((p, player) => {
    for (const kind of QUEUE_KINDS) {
      const q = p.queues[kind];
      const type = q.items[0];
      if (!type || q.held) continue;
      // With nowhere to build it, the line simply waits.
      const building = primaryBuilding(world, player, kind);
      if (!building) continue;

      const def = UNIT_DEFS[type];
      advance(p, q, def.cost, def.produceTicks, productionRate(world, player, QUEUE_BUILDING[kind]));
      if (q.progress < def.produceTicks) continue;

      const exit = exitCell(building);
      const unit = spawnUnit(world, type, player, exit.x, exit.y);
      q.items.shift();
      q.progress = 0;
      q.paid = 0;
      q.speedAcc = 0;
      // Harvesters head straight for ore. Everything else gathers at the rally point.
      if (type !== 'harvester') {
        const rally = rallyPoint(building);
        setDestination(world, unit, rally.x, rally.y);
      }
      events.push({ type: 'unitReady', player, unitId: unit.id, unit: type });
    }
  });
}

/**
 * Picks a separate cell for each unit in a group order, filling outwards
 * from the target, so a squad forms up instead of fighting over one spot.
 */
export function spreadDestinations(world: World, cx: number, cy: number, count: number): number[] {
  const cells: number[] = [];
  for (let r = 0; cells.length < count && r < 12; r++) {
    const ring: { i: number; d: number }[] = [];
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || !inBounds(x, y)) continue;
        const i = cellIndex(x, y);
        if (world.blocked[i]) continue;
        ring.push({ i, d: (x - cx) * (x - cx) + (y - cy) * (y - cy) });
      }
    }
    ring.sort((a, b) => a.d - b.d || a.i - b.i);
    for (const c of ring) if (cells.length < count) cells.push(c.i);
  }
  // Anything left over shares the target and sorts itself out on arrival.
  const fallback = freeCellNear(world, cx, cy);
  while (cells.length < count) cells.push(fallback);
  return cells;
}
