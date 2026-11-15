// Combat: targeting, firing, damage and destruction.

import { FACING, haltUnit, isSettled, setDestination } from './movement';
import { powerOf } from './production';
import { removeBuilding, removeUnit } from './world';
import {
  BUILDING_DEFS,
  MAP_W,
  UNIT_DEFS,
  cellCentre,
  isActive,
  isWall,
  type ArmourClass,
  type Building,
  type SimEvent,
  type Unit,
  type World,
} from './types';

/** How often a chasing unit re-plans its route to a moving target, in ticks. */
const CHASE_REPLAN = 10;
/** Idle allies this close to something under attack join the fight, in cells. */
const HELP_RANGE = 6;

type Target = { unit: Unit; building?: undefined } | { building: Building; unit?: undefined };

const cellX = (c: number): number => c % MAP_W;
const cellY = (c: number): number => (c - (c % MAP_W)) / MAP_W;

function findTarget(world: World, id: number): Target | null {
  if (id === 0) return null;
  const unit = world.units.find((u) => u.id === id);
  if (unit) return unit.hp > 0 ? { unit } : null;
  const building = world.buildings.find((b) => b.id === id);
  return building && building.hp > 0 ? { building } : null;
}

const ownerOf = (t: Target): number => (t.unit ? t.unit.owner : t.building.owner);

/** The cell of the target nearest to a point. For a building, its closest edge. */
function nearestCellOf(t: Target, x: number, y: number): { x: number; y: number } {
  if (t.unit) return { x: cellX(t.unit.cell), y: cellY(t.unit.cell) };
  const b = t.building;
  return {
    x: Math.min(b.cx + b.w - 1, Math.max(b.cx, x)),
    y: Math.min(b.cy + b.h - 1, Math.max(b.cy, y)),
  };
}

function distance2(unit: Unit, t: Target): number {
  const ux = cellX(unit.cell);
  const uy = cellY(unit.cell);
  const c = nearestCellOf(t, ux, uy);
  return (c.x - ux) * (c.x - ux) + (c.y - uy) * (c.y - uy);
}

/** The closest enemy in weapon range: units first, then buildings. */
function acquire(world: World, unit: Unit, range2: number): number {
  let best = 0;
  let bestD = range2 + 1;
  for (const other of world.units) {
    if (other.owner === unit.owner || other.hp <= 0) continue;
    const d = distance2(unit, { unit: other });
    if (d < bestD) {
      best = other.id;
      bestD = d;
    }
  }
  if (best !== 0) return best;
  for (const b of world.buildings) {
    // Walls are only shot at on a direct order. Otherwise troops would stop to chip at every one.
    if (b.owner === unit.owner || b.hp <= 0 || isWall(b.type)) continue;
    const d = distance2(unit, { building: b });
    if (d < bestD) {
      best = b.id;
      bestD = d;
    }
  }
  return best;
}

/** An attack order from the player: go after the target until it is destroyed. */
export function orderAttack(world: World, player: number, unitIds: number[], targetId: number): void {
  const target = findTarget(world, targetId);
  if (!target || ownerOf(target) === player) return;
  for (const id of unitIds) {
    const unit = world.units.find((u) => u.id === id);
    if (!unit || unit.owner !== player || !UNIT_DEFS[unit.type].weapon) continue;
    unit.pendingDeploy = false;
    unit.attack = targetId;
    unit.chase = true;
    unit.chaseTimer = 0;
  }
}

/** Sets idle armed units near a victim onto whoever attacked it. */
function raiseAlarm(world: World, owner: number, x: number, y: number, attackerId: number): void {
  for (const ally of world.units) {
    if (ally.owner !== owner || ally.attack !== 0 || ally.hp <= 0) continue;
    if (!UNIT_DEFS[ally.type].weapon || !isSettled(ally)) continue;
    const dx = cellX(ally.cell) - x;
    const dy = cellY(ally.cell) - y;
    if (dx * dx + dy * dy > HELP_RANGE * HELP_RANGE) continue;
    ally.attack = attackerId;
    ally.chase = true;
    ally.chaseTimer = 0;
  }
}

function fire(world: World, unit: Unit, t: Target, events: SimEvent[]): void {
  const weapon = UNIT_DEFS[unit.type].weapon!;
  const ux = cellX(unit.cell);
  const uy = cellY(unit.cell);
  const aim = nearestCellOf(t, ux, uy);
  const dx = aim.x - ux;
  const dy = aim.y - uy;
  // Turn to face the target, snapping to the nearest of eight directions.
  const sx = Math.abs(dx) * 2 >= Math.abs(dy) ? Math.sign(dx) : 0;
  const sy = Math.abs(dy) * 2 >= Math.abs(dx) ? Math.sign(dy) : 0;
  if (sx !== 0 || sy !== 0) unit.facing = FACING[sy + 1][sx + 1];
  unit.cooldown = weapon.cooldown;

  const armour: ArmourClass = t.unit ? UNIT_DEFS[t.unit.type].armour : 'building';
  const damage = Math.max(1, Math.floor((weapon.damage * weapon.versus[armour]) / 100));
  if (t.unit) {
    t.unit.hp -= damage;
    raiseAlarm(world, t.unit.owner, cellX(t.unit.cell), cellY(t.unit.cell), unit.id);
  } else {
    t.building.hp -= damage;
    raiseAlarm(world, t.building.owner, aim.x, aim.y, unit.id);
  }

  events.push({
    type: 'shot',
    kind: weapon.kind,
    fromX: unit.x,
    fromY: unit.y,
    toX: t.unit ? t.unit.x : cellCentre(aim.x),
    toY: t.unit ? t.unit.y : cellCentre(aim.y),
  });
}

export function tickCombat(world: World, events: SimEvent[]): void {
  // Everyone alive at the start of the tick gets to fire, even if they are hit
  // before their turn comes round. Otherwise whoever is first in the list would
  // have an edge, which in multiplayer would mean one player always shot first.
  const standing = new Set<number>();
  for (const unit of world.units) if (unit.hp > 0) standing.add(unit.id);

  for (const unit of world.units) {
    const weapon = UNIT_DEFS[unit.type].weapon;
    if (!weapon || !standing.has(unit.id)) continue;
    if (unit.cooldown > 0) unit.cooldown--;
    const range2 = weapon.range * weapon.range;

    let target = findTarget(world, unit.attack);
    if (unit.attack !== 0 && (!target || ownerOf(target) === unit.owner)) {
      // The target is gone. Stop where we are.
      if (unit.chase) haltUnit(unit);
      unit.attack = 0;
      unit.chase = false;
      target = null;
    }
    // With nothing to do, shoot at whatever comes into range.
    if (!target && isSettled(unit)) {
      unit.attack = acquire(world, unit, range2);
      unit.chase = false;
      target = findTarget(world, unit.attack);
    }
    if (!target) continue;

    if (distance2(unit, target) <= range2) {
      if (unit.chase && !isSettled(unit)) haltUnit(unit);
      if (unit.stepTo === -1 && unit.cooldown === 0) fire(world, unit, target, events);
    } else if (unit.chase) {
      if (--unit.chaseTimer <= 0 || isSettled(unit)) {
        const c = nearestCellOf(target, cellX(unit.cell), cellY(unit.cell));
        setDestination(world, unit, c.x, c.y);
        unit.chaseTimer = CHASE_REPLAN;
      }
    } else {
      // It wandered out of reach, and we were not told to follow.
      unit.attack = 0;
    }
  }

  tickTurrets(world, events);

  // Clear away everything destroyed this tick.
  for (const unit of world.units.slice()) {
    if (unit.hp > 0) continue;
    removeUnit(world, unit);
    events.push({
      type: 'unitDied',
      unitId: unit.id,
      unit: unit.type,
      owner: unit.owner,
      facing: unit.facing,
      x: unit.x,
      y: unit.y,
    });
  }
  for (const b of world.buildings.slice()) {
    if (b.hp > 0) continue;
    removeBuilding(world, b);
    events.push({ type: 'buildingDestroyed', buildingId: b.id, cx: b.cx, cy: b.cy, w: b.w, h: b.h });
  }

  checkVictory(world, events);
}

/** Defensive buildings fire on the nearest enemy unit in range, if they have the power. */
function tickTurrets(world: World, events: SimEvent[]): void {
  for (const b of world.buildings) {
    const weapon = BUILDING_DEFS[b.type].weapon;
    if (!weapon || !isActive(b) || b.hp <= 0) continue;
    if (b.cooldown > 0) b.cooldown--;
    if (b.cooldown > 0 || powerOf(world, b.owner).low) continue;

    let victim: Unit | null = null;
    let bestD = weapon.range * weapon.range + 1;
    for (const u of world.units) {
      if (u.owner === b.owner || u.hp <= 0) continue;
      const dx = cellX(u.cell) - b.cx;
      const dy = cellY(u.cell) - b.cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        victim = u;
        bestD = d;
      }
    }
    if (!victim) continue;

    const dx = cellX(victim.cell) - b.cx;
    const dy = cellY(victim.cell) - b.cy;
    const sx = Math.abs(dx) * 2 >= Math.abs(dy) ? Math.sign(dx) : 0;
    const sy = Math.abs(dy) * 2 >= Math.abs(dx) ? Math.sign(dy) : 0;
    if (sx !== 0 || sy !== 0) b.aim = FACING[sy + 1][sx + 1];
    b.cooldown = weapon.cooldown;
    const armour = UNIT_DEFS[victim.type].armour;
    victim.hp -= Math.max(1, Math.floor((weapon.damage * weapon.versus[armour]) / 100));
    raiseAlarm(world, victim.owner, cellX(victim.cell), cellY(victim.cell), b.id);
    events.push({
      type: 'shot',
      kind: weapon.kind,
      fromX: cellCentre(b.cx),
      fromY: cellCentre(b.cy),
      toX: victim.x,
      toY: victim.y,
    });
  }
}

/** A player is out once they have no buildings left and no Pioneer to start again. */
function isDefeated(world: World, player: number): boolean {
  if (world.buildings.some((b) => b.owner === player && !isWall(b.type))) return false;
  return !world.units.some((u) => u.owner === player && u.type === 'pioneer');
}

function checkVictory(world: World, events: SimEvent[]): void {
  if (world.winner !== -1) return;
  const contenders = world.players.map((p, i) => (p.active ? i : -1)).filter((i) => i !== -1);
  if (contenders.length < 2) return;
  const standing = contenders.filter((i) => !isDefeated(world, i));
  if (standing.length !== 1) return;
  world.winner = standing[0];
  events.push({ type: 'gameOver', winner: standing[0] });
}

/** Full health for whatever this is, used to draw health bars. */
export const maxHpOfBuilding = (b: Building): number => BUILDING_DEFS[b.type].hp;
export const maxHpOfUnit = (u: Unit): number => UNIT_DEFS[u.type].hp;
