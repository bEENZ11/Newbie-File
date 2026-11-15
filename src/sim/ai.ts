// The computer opponent. It plays by the same rules as a person: the same
// costs, the same build times, the same commands. It runs inside the
// simulation so that every machine in a multiplayer game sees it make
// identical decisions.

import { orderAttack } from './combat';
import { isSettled } from './movement';
import {
  canProduce,
  cancelProduction,
  checkPlacement,
  placeProduction,
  powerOf,
  startProduction,
  toggleRepair,
} from './production';
import { canTrain, trainUnit } from './training';
import {
  BUILDING_DEFS,
  GRASS,
  MAP_W,
  UNIT_DEFS,
  cellIndex,
  hostile,
  inBounds,
  isActive,
  isWall,
  type Building,
  type BuildingType,
  type Difficulty,
  type Faction,
  type SimEvent,
  type Unit,
  type UnitType,
  type World,
} from './types';

/** Ticks between decisions. A second is quick enough, and keeps it cheap. */
const THINK_INTERVAL = 20;
/** Armed units kept at home as a garrison. */
const GARRISON = 3;
const MAX_ARMY = 22;
/**
 * How each difficulty paces the computer, in ticks at twenty a second.
 * firstAttack: nothing comes before this, giving the player time to set up.
 * waveGap: the shortest wait between one wave and the next.
 * armyGrowth: the army may have one more unit for every this many ticks played.
 */
const PACE: Record<Difficulty, { firstAttack: number; waveGap: number; armyGrowth: number }> = {
  easy: { firstAttack: 7200, waveGap: 2700, armyGrowth: 1400 },
  normal: { firstAttack: 4800, waveGap: 1800, armyGrowth: 900 },
  hard: { firstAttack: 3000, waveGap: 1200, armyGrowth: 550 },
};
/** Idle troops this far from home are sent back into the fight, in cells. */
const STRAGGLER_RANGE = 14;

/** The order in which it asks for units, so its army is a mixture and not all one thing. */
const INFANTRY_MIX: Record<Faction, UnitType[]> = {
  aegis: ['rifleman', 'rifleman', 'rocket', 'sniper', 'rifleman', 'grenadier'],
  dominion: ['rifleman', 'flamer', 'rocket', 'rifleman', 'grenadier'],
};
const VEHICLE_MIX: Record<Faction, UnitType[]> = {
  aegis: ['tank', 'scout', 'tank', 'guardian', 'artillery'],
  dominion: ['tank', 'scout', 'tank', 'heavy', 'flametank'],
};

const cellX = (c: number): number => c % MAP_W;
const cellY = (c: number): number => (c - (c % MAP_W)) / MAP_W;

function count(world: World, player: number, type: BuildingType): number {
  return world.buildings.filter((b) => b.owner === player && b.type === type && !b.selling).length;
}

/** How many of each building the AI wants, which grows as the game goes on. */
function wanted(world: World, player: number, wave: number): [BuildingType, number][] {
  const power = powerOf(world, player);
  const plants = count(world, player, 'power');
  // Keep a margin of spare power, so the next building does not brown the base out.
  const needPower = plants === 0 || power.supply - power.demand < 35;
  return [
    ['power', needPower ? plants + 1 : plants],
    ['refinery', wave >= 3 ? 2 : 1],
    ['barracks', 1],
    ['factory', 1],
    ['turret', Math.min(5, 2 + (wave >> 1))],
    // Later on, the buildings that unlock each side's own units.
    ['radar', wave >= 1 ? 1 : 0],
    ['tech', wave >= 2 ? 1 : 0],
  ];
}

/** True if a footprint, plus a one-cell border, touches no other building. */
function hasLane(world: World, type: BuildingType, cx: number, cy: number): boolean {
  const def = BUILDING_DEFS[type];
  for (let y = cy - 1; y <= cy + def.h; y++) {
    for (let x = cx - 1; x <= cx + def.w; x++) {
      if (!inBounds(x, y)) continue;
      const i = cellIndex(x, y);
      if (world.blocked[i] && world.terrain[i] === GRASS) return false;
    }
  }
  return true;
}

/**
 * Finds somewhere to put a building: near the base, with a lane left clear
 * around it so units can always get through.
 */
function findSite(
  world: World,
  player: number,
  type: BuildingType,
  home: Building,
  prefer: { x: number; y: number } | null,
): { cx: number; cy: number } | null {
  const hx = home.cx + 1;
  const hy = home.cy + 1;
  let best: { cx: number; cy: number } | null = null;
  let bestScore = 0;
  for (let r = 2; r <= 11; r++) {
    for (let y = hy - r; y <= hy + r; y++) {
      for (let x = hx - r; x <= hx + r; x++) {
        if (Math.max(Math.abs(x - hx), Math.abs(y - hy)) !== r) continue;
        if (!hasLane(world, type, x, y) || !checkPlacement(world, player, type, x, y).ok) continue;
        const score = prefer
          ? (x - prefer.x) * (x - prefer.x) + (y - prefer.y) * (y - prefer.y)
          : r * 10000 + (y - hy + 20) * 100 + (x - hx + 20);
        if (!best || score < bestScore) {
          best = { cx: x, cy: y };
          bestScore = score;
        }
      }
    }
    // Without a preference, the closest ring that has room will do.
    if (best && !prefer) return best;
  }
  return best;
}

function nearestOreTo(world: World, x: number, y: number): { x: number; y: number } | null {
  let best = -1;
  let bestD = 0;
  for (let i = 0; i < world.ore.length; i++) {
    if (world.ore[i] <= 0) continue;
    const d = (cellX(i) - x) * (cellX(i) - x) + (cellY(i) - y) * (cellY(i) - y);
    if (best === -1 || d < bestD) {
      best = i;
      bestD = d;
    }
  }
  return best === -1 ? null : { x: cellX(best), y: cellY(best) };
}

/** The enemy thing closest to a point: a building if there is one, otherwise a unit. */
function nearestEnemy(world: World, player: number, x: number, y: number): number {
  let best = 0;
  let bestD = 0;
  for (const b of world.buildings) {
    if (!hostile(world, b.owner, player) || isWall(b.type)) continue;
    const d = (b.cx - x) * (b.cx - x) + (b.cy - y) * (b.cy - y);
    if (best === 0 || d < bestD) {
      best = b.id;
      bestD = d;
    }
  }
  if (best !== 0) return best;
  for (const u of world.units) {
    if (!hostile(world, u.owner, player)) continue;
    const d = (cellX(u.cell) - x) * (cellX(u.cell) - x) + (cellY(u.cell) - y) * (cellY(u.cell) - y);
    if (best === 0 || d < bestD) {
      best = u.id;
      bestD = d;
    }
  }
  return best;
}

function think(world: World, player: number, events: SimEvent[]): void {
  const ai = world.ai[player];
  const p = world.players[player];
  if (!ai || !p) return;

  // A fresh start: put the Pioneer down where it stands.
  const pioneer = world.units.find((u) => u.owner === player && u.type === 'pioneer');
  const yard = world.buildings.find((b) => b.owner === player && b.type === 'conyard');
  if (!yard) {
    if (pioneer && isSettled(pioneer)) pioneer.pendingDeploy = true;
    return;
  }
  const home = { x: yard.cx + 1, y: yard.cy + 1 };
  const foe = nearestEnemy(world, player, home.x, home.y);
  const foeAt = ((): { x: number; y: number } | null => {
    const b = world.buildings.find((x) => x.id === foe);
    if (b) return { x: b.cx, y: b.cy };
    const u = world.units.find((x) => x.id === foe);
    return u ? { x: cellX(u.cell), y: cellY(u.cell) } : null;
  })();

  // Construction: place whatever is finished, then start the next thing.
  const prod = p.production;
  if (prod?.state === 'ready') {
    const prefer =
      prod.type === 'refinery' ? nearestOreTo(world, home.x, home.y) : prod.type === 'turret' ? foeAt : null;
    const site = findSite(world, player, prod.type, yard, prefer);
    if (site) placeProduction(world, player, site.cx, site.cy, events);
    else cancelProduction(world, player);
  } else if (!prod && isActive(yard)) {
    for (const [type, target] of wanted(world, player, ai.wave)) {
      if (count(world, player, type) >= target || !canProduce(world, player, type)) continue;
      if (p.credits < BUILDING_DEFS[type].cost / 3) break;
      startProduction(world, player, type);
      break;
    }
  }

  // Patch up anything badly damaged, if there is money to spare.
  if (p.credits > 400) {
    for (const b of world.buildings) {
      if (b.owner === player && !b.repairing && b.hp * 10 < BUILDING_DEFS[b.type].hp * 6) {
        toggleRepair(world, player, b.id);
      }
    }
  }

  // Training: harvesters first, since they pay for everything else.
  const mine = world.units.filter((u) => u.owner === player);
  const harvesters = mine.filter((u) => u.type === 'harvester').length;
  const army = mine.filter((u) => UNIT_DEFS[u.type].weapon);
  // The army builds up gradually instead of all at once.
  const pace = PACE[ai.level];
  const armyCap = Math.min(MAX_ARMY, 4 + Math.floor(world.tick / pace.armyGrowth));
  const vehicles = p.queues.vehicle;
  const infantry = p.queues.infantry;
  if (vehicles.items.length === 0) {
    const queued = harvesters < count(world, player, 'refinery') * 2;
    if (queued && canTrain(world, player, 'harvester')) {
      trainUnit(world, player, 'harvester');
    } else if (army.length < armyCap) {
      // Mostly light tanks, with heavier and longer-ranged vehicles mixed in once it can build them.
      const mix = VEHICLE_MIX[p.faction];
      const wish = mix[ai.built % mix.length];
      const pick = canTrain(world, player, wish) ? wish : 'tank';
      if (canTrain(world, player, pick) && p.credits > UNIT_DEFS[pick].cost + 100) {
        trainUnit(world, player, pick);
        ai.built++;
      }
    }
  }
  if (infantry.items.length === 0 && army.length < armyCap) {
    const squad = INFANTRY_MIX[p.faction];
    const wanted = squad[ai.trained % squad.length];
    const pick = canTrain(world, player, wanted) ? wanted : 'rifleman';
    if (canTrain(world, player, pick) && p.credits > UNIT_DEFS[pick].cost + 150) {
      trainUnit(world, player, pick);
      ai.trained++;
    }
  }

  // Attack: once enough troops are standing idle at home, send them all.
  if (foe === 0) return;
  const idle = army.filter((u) => u.attack === 0 && isSettled(u));
  const near = (u: Unit): boolean => {
    const dx = cellX(u.cell) - home.x;
    const dy = cellY(u.cell) - home.y;
    return dx * dx + dy * dy <= STRAGGLER_RANGE * STRAGGLER_RANGE;
  };
  const atHome = idle.filter(near);
  const waveSize = Math.min(14, 4 + ai.wave * 2);
  const rested = world.tick >= pace.firstAttack && world.tick - ai.lastWave >= pace.waveGap;
  if (rested && atHome.length >= waveSize + GARRISON) {
    // The newest units go, leaving the longest-serving ones as the garrison.
    const strike = atHome.slice(GARRISON).map((u) => u.id);
    orderAttack(world, player, strike, foe);
    ai.wave++;
    ai.lastWave = world.tick;
  }
  // Anyone left idle out in the field after a fight presses on.
  const strays = idle.filter((u) => !near(u)).map((u) => u.id);
  if (strays.length > 0) orderAttack(world, player, strays, foe);
}

export function tickAi(world: World, events: SimEvent[]): void {
  if (world.winner !== -1) return;
  for (let player = 0; player < world.ai.length; player++) {
    // Stagger the players so they do not all think on the same tick.
    if (world.ai[player] && (world.tick + player * 7) % THINK_INTERVAL === 0) think(world, player, events);
  }
}
