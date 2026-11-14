import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { BUILDING_DEFS, MAP_W, UNIT_DEFS, cellIndex, type BuildingType, type Unit, type UnitType } from '../src/sim/types';
import { addBuilding, spawnUnit } from '../src/sim/world';

const run = (sim: Sim, ticks: number, each?: () => void): void => {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    each?.();
  }
};

/** An empty battlefield: no ore, and the starting Pioneer parked out of the way. */
function arena(): Sim {
  const sim = new Sim(1);
  sim.world.ore.fill(0);
  sim.world.players[1].active = true;
  return sim;
}

const unit = (sim: Sim, type: UnitType, owner: number, x: number, y: number): Unit =>
  spawnUnit(sim.world, type, owner, x, y);

function building(sim: Sim, type: BuildingType, owner: number, x: number, y: number) {
  const b = addBuilding(sim.world, type, owner, x, y);
  b.progress = b.total;
  return b;
}

const alive = (sim: Sim, u: Unit): boolean => sim.world.units.includes(u);
const xy = (cell: number): [number, number] => [cell % MAP_W, Math.floor(cell / MAP_W)];

describe('weapons', () => {
  it('fire on an enemy that comes into range, without being told', () => {
    const sim = arena();
    const a = unit(sim, 'rifleman', 0, 30, 30);
    const b = unit(sim, 'rifleman', 1, 33, 30);
    run(sim, 3);
    expect(a.attack).toBe(b.id);
    expect(b.hp).toBeLessThan(UNIT_DEFS.rifleman.hp);
    expect(sim.world.units.some((u) => u.hp < UNIT_DEFS.rifleman.hp)).toBe(true);
  });

  it('leave enemies alone when they are out of range', () => {
    const sim = arena();
    const a = unit(sim, 'rifleman', 0, 30, 30);
    const b = unit(sim, 'harvester', 1, 36, 30);
    b.job = 'manual';
    run(sim, 100);
    expect(a.attack).toBe(0);
    expect(b.hp).toBe(UNIT_DEFS.harvester.hp);
    expect(xy(a.cell)).toEqual([30, 30]);
  });

  it('never fire on their own side', () => {
    const sim = arena();
    const a = unit(sim, 'tank', 0, 30, 30);
    const b = unit(sim, 'rifleman', 0, 31, 30);
    run(sim, 200);
    expect([a.hp, b.hp]).toEqual([UNIT_DEFS.tank.hp, UNIT_DEFS.rifleman.hp]);
  });

  it('respect their rate of fire', () => {
    const sim = arena();
    unit(sim, 'tank', 0, 30, 30);
    const target = unit(sim, 'harvester', 1, 33, 30);
    target.job = 'manual';
    let shots = 0;
    run(sim, 121, () => {
      shots += sim.events.filter((e) => e.type === 'shot').length;
    });
    // One shot at once, then one every 40 ticks.
    expect(shots).toBe(4);
    expect(target.hp).toBe(UNIT_DEFS.harvester.hp - 4 * 30);
  });

  it('do far more to the targets they suit', () => {
    const damage = (attacker: UnitType, victim: UnitType): number => {
      const sim = arena();
      unit(sim, attacker, 0, 30, 30);
      const v = unit(sim, victim, 1, 32, 30);
      v.job = 'manual';
      sim.step();
      return UNIT_DEFS[victim].hp - v.hp;
    };
    expect(damage('rifleman', 'rifleman')).toBe(8);
    expect(damage('rifleman', 'harvester')).toBe(2);
    expect(damage('tank', 'harvester')).toBe(30);
    expect(damage('tank', 'rifleman')).toBe(12);
  });

  it('turn the shooter to face its target', () => {
    const sim = arena();
    const a = unit(sim, 'tank', 0, 30, 30);
    const v = unit(sim, 'harvester', 1, 30, 26);
    v.job = 'manual';
    sim.step();
    expect(a.facing).toBe(6);
  });
});

describe('attack orders', () => {
  it('send units after a distant target until it is destroyed', () => {
    const sim = arena();
    const tanks = [unit(sim, 'tank', 0, 20, 20), unit(sim, 'tank', 0, 20, 22)];
    const prey = unit(sim, 'harvester', 1, 40, 40);
    prey.job = 'manual';
    sim.issue({ type: 'attack', player: 0, unitIds: tanks.map((t) => t.id), targetId: prey.id });
    run(sim, 900);
    expect(alive(sim, prey)).toBe(false);
    expect(tanks.every((t) => t.attack === 0 && t.path.length === 0)).toBe(true);
  });

  it('stop at weapon range instead of driving into the target', () => {
    const sim = arena();
    const tank = unit(sim, 'tank', 0, 20, 30);
    const target = building(sim, 'conyard', 1, 40, 29);
    sim.issue({ type: 'attack', player: 0, unitIds: [tank.id], targetId: target.id });
    run(sim, 300);
    const [x] = xy(tank.cell);
    expect(40 - x).toBeGreaterThanOrEqual(4);
    expect(40 - x).toBeLessThanOrEqual(5);
    expect(target.hp).toBeLessThan(BUILDING_DEFS.conyard.hp);
  });

  it('follow a target that moves away', () => {
    const sim = arena();
    const tank = unit(sim, 'tank', 0, 20, 30);
    const runner = unit(sim, 'harvester', 1, 28, 30);
    runner.job = 'manual';
    sim.issue({ type: 'attack', player: 0, unitIds: [tank.id], targetId: runner.id });
    sim.issue({ type: 'move', player: 1, unitIds: [runner.id], cx: 50, cy: 30 });
    run(sim, 1500);
    expect(alive(sim, runner)).toBe(false);
  });

  it('are dropped by a fresh move order', () => {
    const sim = arena();
    const tank = unit(sim, 'tank', 0, 20, 30);
    const target = building(sim, 'conyard', 1, 40, 29);
    sim.issue({ type: 'attack', player: 0, unitIds: [tank.id], targetId: target.id });
    run(sim, 20);
    sim.issue({ type: 'move', player: 0, unitIds: [tank.id], cx: 10, cy: 30 });
    run(sim, 400);
    expect(xy(tank.cell)).toEqual([10, 30]);
    expect(target.hp).toBe(BUILDING_DEFS.conyard.hp);
  });

  it('cannot be given to unarmed units or aimed at friends', () => {
    const sim = arena();
    const harvester = unit(sim, 'harvester', 0, 20, 30);
    harvester.job = 'manual';
    const tank = unit(sim, 'tank', 0, 22, 30);
    const enemy = unit(sim, 'harvester', 1, 40, 30);
    enemy.job = 'manual';
    sim.issue({ type: 'attack', player: 0, unitIds: [harvester.id], targetId: enemy.id });
    sim.issue({ type: 'attack', player: 0, unitIds: [tank.id], targetId: harvester.id });
    run(sim, 100);
    expect(xy(harvester.cell)).toEqual([20, 30]);
    expect(harvester.hp).toBe(UNIT_DEFS.harvester.hp);
    expect(tank.attack).toBe(0);
  });
});

describe('fighting back', () => {
  it('sends an idle unit after whoever shot it from beyond its own reach', () => {
    const sim = arena();
    const tank = unit(sim, 'tank', 0, 30, 30);
    const rifle = unit(sim, 'rifleman', 1, 35, 30);
    // The tank out-ranges the rifleman, who has to close in to reply.
    run(sim, 60);
    expect(rifle.attack).toBe(tank.id);
    expect(xy(rifle.cell)[0]).toBeLessThan(35);
  });

  it('brings nearby guards to help defend a building', () => {
    const sim = arena();
    const hq = building(sim, 'conyard', 1, 40, 29);
    const guard = unit(sim, 'rifleman', 1, 44, 31);
    const tank = unit(sim, 'tank', 0, 20, 30);
    sim.issue({ type: 'attack', player: 0, unitIds: [tank.id], targetId: hq.id });
    run(sim, 400);
    expect(guard.attack === tank.id || tank.hp < UNIT_DEFS.tank.hp).toBe(true);
    expect(tank.hp).toBeLessThan(UNIT_DEFS.tank.hp);
  });
});

describe('destruction', () => {
  it('removes a dead unit and frees the cells it held', () => {
    const sim = arena();
    unit(sim, 'tank', 0, 30, 30);
    const victim = unit(sim, 'rifleman', 1, 33, 30);
    const cell = victim.cell;
    run(sim, 400);
    expect(alive(sim, victim)).toBe(false);
    expect(sim.world.occupied[cell]).toBe(0);
  });

  it('removes a destroyed building and opens up its ground', () => {
    const sim = arena();
    const tank = unit(sim, 'tank', 0, 30, 30);
    const plant = building(sim, 'power', 1, 33, 30);
    building(sim, 'conyard', 1, 50, 50);
    let destroyed = false;
    run(sim, 1200, () => {
      if (sim.events.some((e) => e.type === 'buildingDestroyed' && e.buildingId === plant.id)) destroyed = true;
    });
    expect(destroyed).toBe(true);
    expect(sim.world.buildings.includes(plant)).toBe(false);
    expect(sim.world.blocked[cellIndex(33, 30)]).toBe(0);
    expect(tank.attack).toBe(0);
  });

  it('stops a line training when its building is destroyed', () => {
    const sim = arena();
    building(sim, 'conyard', 1, 50, 50);
    const barracks = building(sim, 'barracks', 1, 40, 30);
    sim.issue({ type: 'train', player: 1, unit: 'rifleman' });
    sim.step();
    barracks.hp = 1;
    unit(sim, 'tank', 0, 37, 30);
    run(sim, 300);
    expect(sim.world.buildings.includes(barracks)).toBe(false);
    expect(sim.world.units.filter((u) => u.owner === 1)).toHaveLength(0);
  });
});

describe('winning and losing', () => {
  it('is decided when a side loses its last building', () => {
    const sim = arena();
    building(sim, 'conyard', 0, 10, 10);
    const last = building(sim, 'power', 1, 33, 30);
    last.hp = 20;
    unit(sim, 'tank', 0, 30, 30);
    let over: number | null = null;
    run(sim, 200, () => {
      for (const e of sim.events) if (e.type === 'gameOver') over = e.winner;
    });
    expect(over).toBe(0);
    expect(sim.world.winner).toBe(0);
  });

  it('is not called while a side still has its Pioneer', () => {
    const sim = arena();
    building(sim, 'power', 1, 33, 30);
    run(sim, 50);
    // Player 0 has no buildings yet, only the Pioneer it started with.
    expect(sim.world.winner).toBe(-1);
  });

  it('never happens in a game with one side', () => {
    const sim = new Sim(1);
    run(sim, 50);
    expect(sim.world.winner).toBe(-1);
  });
});

describe('the outpost scenario', () => {
  it('starts with a guarded enemy base that minds its own business', () => {
    const sim = new Sim(5, { outpost: true });
    const world = sim.world;
    expect(world.buildings.filter((b) => b.owner === 1).length).toBeGreaterThanOrEqual(3);
    expect(world.units.filter((u) => u.owner === 1).length).toBeGreaterThanOrEqual(5);
    expect(world.units[0].type).toBe('pioneer');
    const before = world.units.filter((u) => u.owner === 1).map((u) => u.cell);
    run(sim, 600);
    expect(world.units.filter((u) => u.owner === 1).map((u) => u.cell)).toEqual(before);
    expect(world.winner).toBe(-1);
  });

  it('can be beaten by a big enough force', () => {
    const sim = new Sim(5, { outpost: true });
    const world = sim.world;
    const army: Unit[] = [];
    for (let i = 0; i < 12; i++) army.push(spawnUnit(world, 'tank', 0, 30 + (i % 4), 30 + Math.floor(i / 4)));
    for (let guard = 0; guard < 40 && world.winner === -1; guard++) {
      const target = world.units.find((u) => u.owner === 1) ?? world.buildings.find((b) => b.owner === 1);
      if (!target) break;
      sim.issue({ type: 'attack', player: 0, unitIds: army.map((u) => u.id), targetId: target.id });
      run(sim, 400);
    }
    expect(world.winner).toBe(0);
    expect(world.buildings.some((b) => b.owner === 1)).toBe(false);
  });

  it('replays a battle identically from its command log', () => {
    const play = (): Sim => {
      const sim = new Sim(9, { outpost: true });
      sim.issue({ type: 'deploy', player: 0, unitId: 1 });
      run(sim, 50);
      sim.issue({ type: 'move', player: 0, unitIds: [1], cx: 40, cy: 40 });
      run(sim, 100);
      return sim;
    };
    const a = play();
    expect(play().hash()).toBe(a.hash());
    expect(Sim.replay(9, a.log, a.world.tick, { outpost: true }).hash()).toBe(a.hash());
  });
});
