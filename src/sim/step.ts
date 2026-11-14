import { tickAi } from './ai';
import { orderAttack, tickCombat } from './combat';
import { VISION_INTERVAL, updateVision } from './vision';
import { orderHarvester, tickHarvesters } from './harvest';
import { haltUnit, isSettled, moveUnit, setDestination } from './movement';
import {
  cancelProduction,
  holdProduction,
  placeProduction,
  sellBuilding,
  toggleRepair,
  startProduction,
  tickBuildings,
  tickProduction,
} from './production';
import { setRally, spreadDestinations, tickTraining, trainUnit, untrainUnit } from './training';
import { addBuilding, removeUnit } from './world';
import {
  BUILDING_DEFS,
  MAP_W,
  cellIndex,
  inBounds,
  type Command,
  type SimEvent,
  type Unit,
  type World,
} from './types';

/** Advances the world by exactly one tick. */
export function stepWorld(world: World, commands: readonly Command[], events: SimEvent[]): void {
  for (const cmd of commands) applyCommand(world, cmd, events);
  tickAi(world, events);

  for (const unit of world.units) {
    unit.prevX = unit.x;
    unit.prevY = unit.y;
    moveUnit(world, unit);
  }

  tickHarvesters(world);
  tickCombat(world, events);

  // Deploying removes units, so it runs on a copy of the list.
  for (const unit of world.units.slice()) {
    if (unit.pendingDeploy && isSettled(unit)) tryDeploy(world, unit, events);
  }

  tickProduction(world, events);
  tickTraining(world, events);
  tickBuildings(world, events);

  if (world.tick % VISION_INTERVAL === 0) updateVision(world);
  world.tick++;
}

function applyCommand(world: World, cmd: Command, events: SimEvent[]): void {
  // Commands arrive from other machines in multiplayer, so each one is
  // checked against the player who sent it.
  if (!world.players[cmd.player]) return;
  switch (cmd.type) {
    case 'move':
      if (!inBounds(cmd.cx, cmd.cy)) break;
      moveGroup(world, cmd.player, cmd.unitIds, cmd.cx, cmd.cy);
      break;
    case 'deploy': {
      const unit = world.units.find((u) => u.id === cmd.unitId);
      if (!unit || unit.owner !== cmd.player || unit.type !== 'pioneer') break;
      // Finish the step in progress so it settles on a cell centre first.
      haltUnit(unit);
      unit.pendingDeploy = true;
      break;
    }
    case 'build':
      startProduction(world, cmd.player, cmd.building);
      break;
    case 'hold':
      holdProduction(world, cmd.player);
      break;
    case 'cancel':
      cancelProduction(world, cmd.player);
      break;
    case 'place':
      placeProduction(world, cmd.player, cmd.cx, cmd.cy, events);
      break;
    case 'sell':
      sellBuilding(world, cmd.player, cmd.buildingId);
      break;
    case 'train':
      trainUnit(world, cmd.player, cmd.unit);
      break;
    case 'untrain':
      untrainUnit(world, cmd.player, cmd.unit);
      break;
    case 'rally':
      setRally(world, cmd.player, cmd.buildingId, cmd.cx, cmd.cy);
      break;
    case 'attack':
      orderAttack(world, cmd.player, cmd.unitIds, cmd.targetId);
      break;
    case 'repair':
      toggleRepair(world, cmd.player, cmd.buildingId);
      break;
  }
}

function moveGroup(world: World, player: number, unitIds: number[], cx: number, cy: number): void {
  const units: Unit[] = [];
  for (const id of unitIds) {
    const unit = world.units.find((u) => u.id === id);
    if (unit && unit.owner === player && !units.includes(unit)) units.push(unit);
  }
  // Harvesters read the order as dig here or unload there. The rest form up
  // around the target, each with a cell of its own.
  const squad = units.filter((u) => u.type !== 'harvester');
  const spots = spreadDestinations(world, cx, cy, squad.length);
  for (const unit of units) {
    unit.pendingDeploy = false;
    // A move order always overrides an attack.
    unit.attack = 0;
    unit.chase = false;
    if (unit.type === 'harvester') {
      orderHarvester(world, unit, cx, cy);
    } else {
      const spot = spots[squad.indexOf(unit)];
      const sx = spot % MAP_W;
      setDestination(world, unit, sx, (spot - sx) / MAP_W);
    }
  }
}

/** The cells a deploying Pioneer would occupy, as a top-left cell. */
export function deployFootprint(unit: Unit): { cx: number; cy: number; w: number; h: number } {
  const def = BUILDING_DEFS.conyard;
  const x = unit.cell % MAP_W;
  const y = (unit.cell - x) / MAP_W;
  return { cx: x - (def.w >> 1), cy: y - (def.h >> 1), w: def.w, h: def.h };
}

export function canDeploy(world: World, unit: Unit): boolean {
  const f = deployFootprint(unit);
  for (let y = f.cy; y < f.cy + f.h; y++) {
    for (let x = f.cx; x < f.cx + f.w; x++) {
      if (!inBounds(x, y)) return false;
      const i = cellIndex(x, y);
      if (world.blocked[i] || world.ore[i] > 0) return false;
      if (world.occupied[i] !== 0 && world.occupied[i] !== unit.id) return false;
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
  removeUnit(world, unit);
  const building = addBuilding(world, 'conyard', unit.owner, f.cx, f.cy);
  events.push({ type: 'deployed', unitId: unit.id, buildingId: building.id });
}
