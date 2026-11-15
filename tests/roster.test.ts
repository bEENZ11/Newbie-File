import { describe, expect, it } from 'vitest';
import { canProduce, checkPlacement, hasRadar } from '../src/sim/production';
import { Sim } from '../src/sim/sim';
import { canTrain } from '../src/sim/training';
import {
  BUILDING_DEFS,
  MAP_W,
  UNIT_DEFS,
  cellIndex,
  type Building,
  type BuildingType,
  type Unit,
  type UnitType,
} from '../src/sim/types';
import { addBuilding, spawnUnit } from '../src/sim/world';

const run = (sim: Sim, n: number, each?: () => void): void => {
  for (let i = 0; i < n; i++) {
    sim.step();
    each?.();
  }
};

function arena(): Sim {
  const sim = new Sim(1);
  sim.world.ore.fill(0);
  sim.world.players[1].active = true;
  return sim;
}

function building(sim: Sim, type: BuildingType, owner: number, x: number, y: number): Building {
  const b = addBuilding(sim.world, type, owner, x, y);
  b.progress = b.total;
  return b;
}

const unit = (sim: Sim, type: UnitType, owner: number, x: number, y: number): Unit => {
  const u = spawnUnit(sim.world, type, owner, x, y);
  if (type === 'harvester') u.job = 'manual';
  return u;
};
const xy = (cell: number): [number, number] => [cell % MAP_W, Math.floor(cell / MAP_W)];

/** Damage one shot from an attacker does to a victim standing two cells away. */
function hit(attacker: UnitType, victim: UnitType): number {
  const sim = arena();
  unit(sim, attacker, 0, 30, 30);
  const v = unit(sim, victim, 1, 32, 30);
  sim.step();
  return UNIT_DEFS[victim].hp - v.hp;
}

describe('the tech tree', () => {
  it('unlocks the new buildings in order', () => {
    const sim = arena();
    building(sim, 'conyard', 0, 10, 10);
    building(sim, 'power', 0, 14, 10);
    expect(canProduce(sim.world, 0, 'radar')).toBe(false);
    expect(canProduce(sim.world, 0, 'wall')).toBe(false);
    building(sim, 'refinery', 0, 10, 14);
    building(sim, 'barracks', 0, 17, 10);
    expect(canProduce(sim.world, 0, 'radar')).toBe(true);
    expect(canProduce(sim.world, 0, 'wall')).toBe(true);
    expect(canProduce(sim.world, 0, 'tech')).toBe(false);
    expect(canProduce(sim.world, 0, 'depot')).toBe(false);
    building(sim, 'factory', 0, 20, 10);
    building(sim, 'radar', 0, 14, 13);
    expect(canProduce(sim.world, 0, 'tech')).toBe(true);
    expect(canProduce(sim.world, 0, 'depot')).toBe(true);
  });

  it('gates the advanced units behind the right buildings', () => {
    const sim = arena();
    building(sim, 'conyard', 0, 10, 10);
    building(sim, 'barracks', 0, 17, 10);
    building(sim, 'factory', 0, 20, 10);
    for (const u of ['rifleman', 'rocket', 'grenadier', 'tank', 'scout'] as const) {
      expect(canTrain(sim.world, 0, u)).toBe(true);
    }
    for (const u of ['engineer', 'artillery', 'heavy'] as const) expect(canTrain(sim.world, 0, u)).toBe(false);
    building(sim, 'radar', 0, 14, 13);
    expect(canTrain(sim.world, 0, 'engineer')).toBe(true);
    expect(canTrain(sim.world, 0, 'artillery')).toBe(true);
    expect(canTrain(sim.world, 0, 'heavy')).toBe(false);
    building(sim, 'tech', 0, 17, 13);
    expect(canTrain(sim.world, 0, 'heavy')).toBe(true);
  });
});

describe('the new weapons', () => {
  it('give each unit a job it is clearly best at', () => {
    // Rockets against armour, rifles and scout guns against infantry.
    expect(hit('rocket', 'tank')).toBe(40);
    expect(hit('rocket', 'rifleman')).toBe(10);
    expect(hit('rifleman', 'tank')).toBe(2);
    expect(hit('scout', 'rifleman')).toBe(10);
    expect(hit('scout', 'tank')).toBe(3);
    expect(hit('heavy', 'tank')).toBe(60);
    expect(hit('grenadier', 'rifleman')).toBe(22);
  });

  it('make grenadiers the foot soldier for knocking down buildings', () => {
    const damage = (type: UnitType): number => {
      const sim = arena();
      const target = building(sim, 'power', 1, 32, 30);
      unit(sim, type, 0, 30, 30);
      sim.step();
      return BUILDING_DEFS.power.hp - target.hp;
    };
    expect(damage('grenadier')).toBeGreaterThan(damage('rocket'));
    expect(damage('rocket')).toBeGreaterThan(damage('rifleman'));
  });

  it('let artillery shell a turret from beyond its reach', () => {
    const sim = arena();
    building(sim, 'power', 1, 40, 26);
    const turret = building(sim, 'turret', 1, 40, 30);
    const gun = unit(sim, 'artillery', 0, 32, 30);
    run(sim, 400);
    expect(turret.hp).toBeLessThan(BUILDING_DEFS.turret.hp);
    expect(gun.hp).toBe(UNIT_DEFS.artillery.hp);
    expect(xy(gun.cell)).toEqual([32, 30]);
  });

  it('leave artillery helpless once something gets close', () => {
    const sim = arena();
    const gun = unit(sim, 'artillery', 0, 30, 30);
    unit(sim, 'tank', 1, 33, 30);
    unit(sim, 'tank', 1, 33, 31);
    run(sim, 200);
    expect(sim.world.units.includes(gun)).toBe(false);
  });

  it('make a scout car much the fastest thing on the map', () => {
    const sim = arena();
    const scout = unit(sim, 'scout', 0, 10, 40);
    const tank = unit(sim, 'tank', 0, 10, 42);
    sim.issue({ type: 'move', player: 0, unitIds: [scout.id], cx: 50, cy: 40 });
    sim.issue({ type: 'move', player: 0, unitIds: [tank.id], cx: 50, cy: 42 });
    run(sim, 100);
    expect(xy(scout.cell)[0] - 10).toBeGreaterThan((xy(tank.cell)[0] - 10) * 1.5);
  });
});

describe('engineers', () => {
  it('capture an enemy building and are used up doing it', () => {
    const sim = arena();
    building(sim, 'conyard', 1, 50, 50);
    const target = building(sim, 'barracks', 1, 40, 30);
    const engineer = unit(sim, 'engineer', 0, 30, 30);
    sim.issue({ type: 'capture', player: 0, unitIds: [engineer.id], buildingId: target.id });
    let captured = false;
    run(sim, 300, () => {
      if (sim.events.some((e) => e.type === 'captured' && e.player === 0 && e.from === 1)) captured = true;
    });
    expect(captured).toBe(true);
    expect(target.owner).toBe(0);
    expect(sim.world.units.includes(engineer)).toBe(false);
    expect(sim.world.occupied[engineer.cell]).toBe(0);
  });

  it('let the new owner use what they have taken', () => {
    const sim = arena();
    building(sim, 'conyard', 1, 50, 50);
    const target = building(sim, 'barracks', 1, 40, 30);
    const engineer = unit(sim, 'engineer', 0, 37, 30);
    sim.issue({ type: 'capture', player: 0, unitIds: [engineer.id], buildingId: target.id });
    run(sim, 100);
    expect(canTrain(sim.world, 0, 'rifleman')).toBe(true);
    expect(canTrain(sim.world, 1, 'rifleman')).toBe(false);
    sim.issue({ type: 'train', player: 0, unit: 'rifleman' });
    // The captured barracks has no power behind it, so training runs at a quarter speed.
    run(sim, UNIT_DEFS.rifleman.produceTicks * 4 + 4);
    expect(sim.world.units.some((u) => u.owner === 0 && u.type === 'rifleman')).toBe(true);
  });

  it('can end the game by taking the last enemy building', () => {
    const sim = arena();
    building(sim, 'conyard', 0, 10, 10);
    const last = building(sim, 'power', 1, 40, 30);
    const engineer = unit(sim, 'engineer', 0, 37, 30);
    sim.issue({ type: 'capture', player: 0, unitIds: [engineer.id], buildingId: last.id });
    run(sim, 100);
    expect(sim.world.winner).toBe(0);
  });

  it('fully mend one of their own buildings', () => {
    const sim = arena();
    const plant = building(sim, 'power', 0, 40, 30);
    plant.hp = 50;
    const engineer = unit(sim, 'engineer', 0, 37, 30);
    sim.issue({ type: 'capture', player: 0, unitIds: [engineer.id], buildingId: plant.id });
    run(sim, 100);
    expect(plant.hp).toBe(BUILDING_DEFS.power.hp);
    expect(plant.owner).toBe(0);
    expect(sim.world.units.includes(engineer)).toBe(false);
  });

  it('give up the job when ordered to move instead', () => {
    const sim = arena();
    building(sim, 'conyard', 1, 50, 50);
    const target = building(sim, 'barracks', 1, 40, 30);
    const engineer = unit(sim, 'engineer', 0, 20, 30);
    sim.issue({ type: 'capture', player: 0, unitIds: [engineer.id], buildingId: target.id });
    run(sim, 20);
    sim.issue({ type: 'move', player: 0, unitIds: [engineer.id], cx: 10, cy: 30 });
    run(sim, 600);
    expect(target.owner).toBe(1);
    expect(xy(engineer.cell)).toEqual([10, 30]);
  });

  it('cannot be ordered by anyone but their owner, or capture a wall', () => {
    const sim = arena();
    building(sim, 'conyard', 1, 50, 50);
    const target = building(sim, 'barracks', 1, 40, 30);
    const wall = building(sim, 'wall', 1, 36, 32);
    const engineer = unit(sim, 'engineer', 0, 34, 30);
    sim.issue({ type: 'capture', player: 1, unitIds: [engineer.id], buildingId: target.id });
    sim.issue({ type: 'capture', player: 0, unitIds: [engineer.id], buildingId: wall.id });
    run(sim, 200);
    expect(engineer.capture).toBe(0);
    expect([target.owner, wall.owner]).toEqual([1, 1]);
  });
});

describe('service depots', () => {
  it('repair vehicles parked beside them, for a fee', () => {
    const sim = arena();
    building(sim, 'depot', 0, 30, 30);
    const tank = unit(sim, 'tank', 0, 33, 30);
    tank.hp = 100;
    const before = sim.world.players[0].credits;
    run(sim, 200);
    expect(tank.hp).toBe(UNIT_DEFS.tank.hp);
    const spent = before - sim.world.players[0].credits;
    // Two thirds of a 600 credit tank, at 30% of its price.
    expect(spent).toBeGreaterThanOrEqual(110);
    expect(spent).toBeLessThanOrEqual(130);
  });

  it('ignore infantry, enemies and anything too far away', () => {
    const sim = arena();
    building(sim, 'depot', 0, 30, 30);
    const soldier = unit(sim, 'rifleman', 0, 32, 30);
    const far = unit(sim, 'tank', 0, 36, 30);
    const theirs = unit(sim, 'harvester', 1, 32, 32);
    soldier.hp = 10;
    far.hp = 100;
    theirs.hp = 100;
    run(sim, 20);
    expect([soldier.hp, far.hp]).toEqual([10, 100]);
    expect(theirs.hp).toBeLessThanOrEqual(100);
  });
});

describe('walls', () => {
  it('block the way, so units go round', () => {
    const sim = arena();
    for (let y = 26; y <= 34; y++) building(sim, 'wall', 0, 35, y);
    const tank = unit(sim, 'tank', 0, 30, 30);
    sim.issue({ type: 'move', player: 0, unitIds: [tank.id], cx: 40, cy: 30 });
    run(sim, 400, () => {
      expect(sim.world.blocked[tank.cell]).toBe(0);
    });
    expect(xy(tank.cell)).toEqual([40, 30]);
  });

  it('can be laid further out than other buildings, but do not extend the base', () => {
    const sim = arena();
    building(sim, 'conyard', 0, 10, 10);
    expect(checkPlacement(sim.world, 0, 'wall', 17, 11).ok).toBe(true);
    expect(checkPlacement(sim.world, 0, 'power', 17, 11).ok).toBe(false);
    expect(checkPlacement(sim.world, 0, 'wall', 19, 11).ok).toBe(false);
    building(sim, 'wall', 0, 17, 11);
    // A wall out there does not let anything else be built beside it.
    expect(checkPlacement(sim.world, 0, 'power', 18, 11).ok).toBe(false);
    expect(checkPlacement(sim.world, 0, 'wall', 19, 11).ok).toBe(false);
  });

  it('are left alone by troops unless they are told to attack one', () => {
    const sim = arena();
    const wall = building(sim, 'wall', 1, 32, 30);
    const tank = unit(sim, 'tank', 0, 30, 30);
    run(sim, 100);
    expect(wall.hp).toBe(BUILDING_DEFS.wall.hp);
    sim.issue({ type: 'attack', player: 0, unitIds: [tank.id], targetId: wall.id });
    run(sim, 100);
    expect(wall.hp).toBeLessThan(BUILDING_DEFS.wall.hp);
  });

  it('do not keep a beaten side in the game', () => {
    const sim = arena();
    building(sim, 'conyard', 0, 10, 10);
    building(sim, 'wall', 1, 50, 50);
    const last = building(sim, 'power', 1, 33, 30);
    last.hp = 10;
    unit(sim, 'tank', 0, 30, 30);
    run(sim, 100);
    expect(sim.world.winner).toBe(0);
  });
});

describe('radar', () => {
  it('needs a working Radar Station and enough power', () => {
    const sim = arena();
    expect(hasRadar(sim.world, 0)).toBe(false);
    building(sim, 'power', 0, 28, 28);
    const radar = building(sim, 'radar', 0, 30, 30);
    expect(hasRadar(sim.world, 0)).toBe(true);
    for (let i = 0; i < 4; i++) building(sim, 'barracks', 0, 10 + i * 3, 50);
    expect(hasRadar(sim.world, 0)).toBe(false);
    building(sim, 'power', 0, 34, 28);
    expect(hasRadar(sim.world, 0)).toBe(true);
    radar.hp = 0;
    sim.step();
    expect(hasRadar(sim.world, 0)).toBe(false);
  });
});

describe('the roster in a real game', () => {
  it('is used by the computer once it has the buildings', () => {
    const sim = new Sim(4, { ai: [1] });
    const seen = new Set<string>();
    for (let i = 0; i < 16000; i++) {
      sim.step();
      if (i % 50 === 0) for (const u of sim.world.units) if (u.owner === 1) seen.add(u.type);
    }
    const built = sim.world.buildings.filter((b) => b.owner === 1).map((b) => b.type);
    expect(built).toContain('radar');
    for (const type of ['rifleman', 'rocket', 'grenadier', 'tank']) expect(seen.has(type)).toBe(true);
    expect(sim.world.units.every((u) => sim.world.blocked[cellIndex(u.cell % MAP_W, Math.floor(u.cell / MAP_W))] === 0)).toBe(true);
  });
});
