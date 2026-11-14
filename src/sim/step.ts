import { orderHarvester, tickHarvesters } from './harvest';
import { haltUnit, isSettled, moveUnit, setDestination } from './movement';
import {
  cancelProduction,
  holdProduction,
  placeProduction,
  sellBuilding,
  startProduction,
  tickBuildings,
  tickProduction,
} from './production';
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

  for (const unit of world.units) {
    unit.prevX = unit.x;
    unit.prevY = unit.y;
    moveUnit(world, unit);
  }

  tickHarvesters(world);

  // Deploying removes units, so it runs on a copy of the list.
  for (const unit of world.units.slice()) {
    if (unit.pendingDeploy && isSettled(unit)) tryDeploy(world, unit, events);
  }

  tickProduction(world, events);
  tickBuildings(world, events);

  world.tick++;
}

function applyCommand(world: World, cmd: Command, events: SimEvent[]): void {
  // Commands arrive from other machines in multiplayer, so each one is
  // checked against the player who sent it.
  if (!world.players[cmd.player]) return;
  switch (cmd.type) {
    case 'move':
      if (!inBounds(cmd.cx, cmd.cy)) break;
      for (const id of cmd.unitIds) {
        const unit = world.units.find((u) => u.id === id);
        if (!unit || unit.owner !== cmd.player) continue;
        unit.pendingDeploy = false;
        if (unit.type === 'harvester') orderHarvester(world, unit, cmd.cx, cmd.cy);
        else setDestination(world, unit, cmd.cx, cmd.cy);
      }
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
