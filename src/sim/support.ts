// Engineers, who capture and mend buildings, and Service Depots, which repair vehicles.

import { isSettled, setDestination } from './movement';
import { removeUnit } from './world';
import {
  BUILDING_DEFS,
  MAP_W,
  REPAIR_COST_PERCENT,
  REPAIR_HP,
  REPAIR_INTERVAL,
  UNIT_DEFS,
  isActive,
  type Building,
  type SimEvent,
  type Unit,
  type World,
} from './types';

/** How often an engineer who cannot reach its building tries a new route, in ticks. */
const RETRY = 20;
/** How close a vehicle must park to a depot to be repaired, in cells. */
const DEPOT_REACH = 2;

const cellX = (c: number): number => c % MAP_W;
const cellY = (c: number): number => (c - (c % MAP_W)) / MAP_W;

/** How many cells a unit is from the nearest edge of a building. Zero would be inside it. */
function gap(unit: Unit, b: Building): number {
  const x = cellX(unit.cell);
  const y = cellY(unit.cell);
  const dx = Math.max(b.cx - x, 0, x - (b.cx + b.w - 1));
  const dy = Math.max(b.cy - y, 0, y - (b.cy + b.h - 1));
  return Math.max(dx, dy);
}

/** Sends engineers into a building: to take it if it is the enemy's, or mend it if it is ours. */
export function orderCapture(world: World, player: number, unitIds: number[], buildingId: number): void {
  const b = world.buildings.find((x) => x.id === buildingId);
  if (!b || b.type === 'wall') return;
  for (const id of unitIds) {
    const unit = world.units.find((u) => u.id === id);
    if (!unit || unit.owner !== player || unit.type !== 'engineer') continue;
    unit.capture = buildingId;
    unit.timer = 0;
  }
}

export function tickEngineers(world: World, events: SimEvent[]): void {
  for (const unit of world.units.slice()) {
    if (unit.type !== 'engineer' || unit.capture === 0) continue;
    const b = world.buildings.find((x) => x.id === unit.capture);
    if (!b || b.selling || b.hp <= 0) {
      unit.capture = 0;
      continue;
    }

    if (gap(unit, b) <= 1 && unit.stepTo === -1) {
      if (b.owner !== unit.owner) {
        const from = b.owner;
        b.owner = unit.owner;
        b.rally = -1;
        b.repairing = false;
        events.push({ type: 'captured', buildingId: b.id, player: unit.owner, from });
      } else {
        b.hp = BUILDING_DEFS[b.type].hp;
        events.push({ type: 'mended', buildingId: b.id, player: unit.owner });
      }
      // The engineer goes inside and is not seen again.
      removeUnit(world, unit);
      continue;
    }

    if (isSettled(unit) && --unit.timer <= 0) {
      const x = Math.min(b.cx + b.w - 1, Math.max(b.cx, cellX(unit.cell)));
      const y = Math.min(b.cy + b.h - 1, Math.max(b.cy, cellY(unit.cell)));
      setDestination(world, unit, x, y);
      unit.timer = RETRY;
    }
  }
}

/** Service Depots patch up any of their owner's vehicles parked alongside, for a fee. */
export function tickDepots(world: World): void {
  if (world.tick % REPAIR_INTERVAL !== 0) return;
  for (const b of world.buildings) {
    if (b.type !== 'depot' || !isActive(b)) continue;
    const p = world.players[b.owner];
    for (const u of world.units) {
      const def = UNIT_DEFS[u.type];
      if (u.owner !== b.owner || def.armour !== 'vehicle' || u.hp >= def.hp) continue;
      if (!isSettled(u) || gap(u, b) > DEPOT_REACH) continue;
      const price = Math.max(1, Math.ceil((def.cost * REPAIR_COST_PERCENT * REPAIR_HP) / (def.hp * 100)));
      if (p.credits < price) break;
      p.credits -= price;
      u.hp = Math.min(def.hp, u.hp + REPAIR_HP);
    }
  }
}
