import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { canTrain } from '../src/sim/training';
import {
  BUILDING_DEFS,
  MAP_W,
  MAX_QUEUE,
  UNIT_DEFS,
  cellIndex,
  exitCell,
  type BuildingType,
  type Unit,
  type UnitType,
} from '../src/sim/types';
import { START_CX, START_CY, addBuilding } from '../src/sim/world';

const YARD_X = START_CX - 1;
const YARD_Y = START_CY - 1;

const run = (sim: Sim, ticks: number, each?: () => void): void => {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    each?.();
  }
};

function grant(sim: Sim, type: BuildingType, cx: number, cy: number) {
  const b = addBuilding(sim.world, type, 0, cx, cy);
  b.progress = b.total;
  return b;
}

/** A powered base with a Barracks and War Factory, and no ore to distract harvesters. */
function withBase(): Sim {
  const sim = new Sim(1);
  sim.issue({ type: 'deploy', player: 0, unitId: sim.world.units[0].id });
  run(sim, BUILDING_DEFS.conyard.buildTicks + 2);
  sim.world.ore.fill(0);
  grant(sim, 'power', YARD_X + 3, YARD_Y);
  grant(sim, 'barracks', YARD_X + 6, YARD_Y);
  grant(sim, 'factory', YARD_X + 9, YARD_Y);
  return sim;
}

const train = (sim: Sim, unit: UnitType): void => sim.issue({ type: 'train', player: 0, unit });
const untrain = (sim: Sim, unit: UnitType): void => sim.issue({ type: 'untrain', player: 0, unit });
const ofType = (sim: Sim, type: UnitType): Unit[] => sim.world.units.filter((u) => u.type === type);
const xy = (cell: number): [number, number] => [cell % MAP_W, Math.floor(cell / MAP_W)];

describe('training', () => {
  it('needs the right building for each unit', () => {
    const sim = new Sim(1);
    sim.issue({ type: 'deploy', player: 0, unitId: 1 });
    run(sim, 45);
    expect(canTrain(sim.world, 0, 'rifleman')).toBe(false);
    grant(sim, 'barracks', YARD_X + 6, YARD_Y);
    expect(canTrain(sim.world, 0, 'rifleman')).toBe(true);
    expect(canTrain(sim.world, 0, 'tank')).toBe(false);
    grant(sim, 'factory', YARD_X + 9, YARD_Y);
    expect(canTrain(sim.world, 0, 'tank')).toBe(true);
    expect(canTrain(sim.world, 0, 'harvester')).toBe(false);
    grant(sim, 'refinery', YARD_X, YARD_Y + 4);
    expect(canTrain(sim.world, 0, 'harvester')).toBe(true);
    expect(canTrain(sim.world, 0, 'pioneer')).toBe(false);
  });

  it('turns out a rifleman at the barracks door for exactly its cost', () => {
    const sim = withBase();
    const p = sim.world.players[0];
    const before = p.credits;
    train(sim, 'rifleman');
    run(sim, UNIT_DEFS.rifleman.produceTicks);
    const [soldier] = ofType(sim, 'rifleman');
    expect(soldier).toBeDefined();
    expect(p.credits).toBe(before - UNIT_DEFS.rifleman.cost);
    const exit = exitCell(sim.world.buildings.find((b) => b.type === 'barracks')!);
    expect(soldier.cell).toBe(cellIndex(exit.x, exit.y));
    expect(sim.events).toContainEqual({ type: 'unitReady', player: 0, unitId: soldier.id, unit: 'rifleman' });
  });

  it('sends new units to gather just clear of the door by default', () => {
    const sim = withBase();
    train(sim, 'tank');
    run(sim, UNIT_DEFS.tank.produceTicks + 80);
    const exit = exitCell(sim.world.buildings.find((b) => b.type === 'factory')!);
    expect(ofType(sim, 'tank')[0].cell).toBe(cellIndex(exit.x, exit.y + 2));
  });

  it('runs the infantry and vehicle lines side by side', () => {
    const sim = withBase();
    train(sim, 'rifleman');
    train(sim, 'tank');
    run(sim, 40);
    const q = sim.world.players[0].queues;
    expect(q.infantry.progress).toBe(40);
    expect(q.vehicle.progress).toBe(40);
  });

  it('works through a queue one unit at a time', () => {
    const sim = withBase();
    for (let i = 0; i < 3; i++) train(sim, 'rifleman');
    run(sim, UNIT_DEFS.rifleman.produceTicks + 5);
    expect(ofType(sim, 'rifleman')).toHaveLength(1);
    expect(sim.world.players[0].queues.infantry.items).toHaveLength(2);
    run(sim, UNIT_DEFS.rifleman.produceTicks * 2);
    expect(ofType(sim, 'rifleman')).toHaveLength(3);
    expect(sim.world.players[0].queues.infantry.items).toHaveLength(0);
  });

  it('caps the length of a queue', () => {
    const sim = withBase();
    for (let i = 0; i < MAX_QUEUE + 5; i++) train(sim, 'rifleman');
    sim.step();
    expect(sim.world.players[0].queues.infantry.items).toHaveLength(MAX_QUEUE);
  });

  it('holds on the first right-click and refunds on the second', () => {
    const sim = withBase();
    const p = sim.world.players[0];
    const before = p.credits;
    train(sim, 'tank');
    run(sim, 100);
    untrain(sim, 'tank');
    sim.step();
    const held = p.queues.vehicle.progress;
    run(sim, 50);
    expect(p.queues.vehicle.progress).toBe(held);
    expect(p.credits).toBeLessThan(before);
    train(sim, 'tank');
    run(sim, 10);
    expect(p.queues.vehicle.progress).toBeGreaterThan(held);
    expect(p.queues.vehicle.items).toHaveLength(1);
    untrain(sim, 'tank');
    untrain(sim, 'tank');
    sim.step();
    expect(p.queues.vehicle.items).toHaveLength(0);
    expect(p.credits).toBe(before);
  });

  it('drops a waiting unit without touching the one in progress', () => {
    const sim = withBase();
    train(sim, 'tank');
    train(sim, 'tank');
    run(sim, 30);
    untrain(sim, 'tank');
    sim.step();
    const q = sim.world.players[0].queues.vehicle;
    expect(q.items).toEqual(['tank']);
    expect(q.held).toBe(false);
    expect(q.progress).toBeGreaterThan(30);
  });

  it('waits if the building is sold, and picks up again when one is rebuilt', () => {
    const sim = withBase();
    train(sim, 'rifleman');
    run(sim, 20);
    sim.issue({ type: 'sell', player: 0, buildingId: sim.world.buildings.find((b) => b.type === 'barracks')!.id });
    run(sim, 200);
    expect(ofType(sim, 'rifleman')).toHaveLength(0);
    grant(sim, 'barracks', YARD_X + 6, YARD_Y);
    run(sim, UNIT_DEFS.rifleman.produceTicks);
    expect(ofType(sim, 'rifleman')).toHaveLength(1);
  });

  it('slows with low power like buildings do', () => {
    const sim = withBase();
    for (let i = 0; i < 9; i++) grant(sim, 'barracks', 30 + i * 2, 40);
    // Demand is now 230 against a supply of 100, so about 43% speed.
    train(sim, 'tank');
    run(sim, 230);
    expect(sim.world.players[0].queues.vehicle.progress).toBe(99);
  });

  it('builds a harvester that goes straight to work', () => {
    const sim = withBase();
    grant(sim, 'refinery', YARD_X, YARD_Y + 4);
    const ore = cellIndex(YARD_X + 10, YARD_Y + 8);
    sim.world.ore[ore] = 600;
    const before = sim.world.players[0].credits;
    train(sim, 'harvester');
    run(sim, UNIT_DEFS.harvester.produceTicks + 700);
    expect(ofType(sim, 'harvester')).toHaveLength(1);
    expect(sim.world.ore[ore]).toBeLessThan(600);
    expect(sim.world.players[0].credits).toBeGreaterThan(before - UNIT_DEFS.harvester.cost);
  });
});

describe('rally points', () => {
  it('send new units wherever the player chooses', () => {
    const sim = withBase();
    const barracks = sim.world.buildings.find((b) => b.type === 'barracks')!;
    sim.issue({ type: 'rally', player: 0, buildingId: barracks.id, cx: 30, cy: 20 });
    train(sim, 'rifleman');
    run(sim, UNIT_DEFS.rifleman.produceTicks + 400);
    expect(xy(ofType(sim, 'rifleman')[0].cell)).toEqual([30, 20]);
  });

  it('gather a whole squad around the point without stacking', () => {
    const sim = withBase();
    for (let i = 0; i < 6; i++) train(sim, 'rifleman');
    run(sim, UNIT_DEFS.rifleman.produceTicks * 6 + 300);
    const squad = ofType(sim, 'rifleman');
    expect(squad).toHaveLength(6);
    expect(new Set(squad.map((u) => u.cell)).size).toBe(6);
    expect(squad.every((u) => u.path.length === 0 && u.stepTo === -1)).toBe(true);
  });

  it('cannot be set on a building that trains nothing', () => {
    const sim = withBase();
    const plant = sim.world.buildings.find((b) => b.type === 'power')!;
    sim.issue({ type: 'rally', player: 0, buildingId: plant.id, cx: 30, cy: 20 });
    sim.step();
    expect(plant.rally).toBe(-1);
  });
});

describe('group movement', () => {
  it('gives each unit its own cell around the target', () => {
    const sim = withBase();
    for (let i = 0; i < 4; i++) train(sim, 'tank');
    for (let i = 0; i < 5; i++) train(sim, 'rifleman');
    run(sim, UNIT_DEFS.tank.produceTicks * 4 + 200);
    const squad = sim.world.units.filter((u) => u.type === 'tank' || u.type === 'rifleman');
    expect(squad).toHaveLength(9);
    sim.issue({ type: 'move', player: 0, unitIds: squad.map((u) => u.id), cx: 40, cy: 30 });
    run(sim, 900, () => {
      const held = new Set<number>();
      for (const u of sim.world.units) {
        for (const c of u.stepTo === -1 ? [u.cell] : [u.cell, u.stepTo]) {
          expect(held.has(c)).toBe(false);
          held.add(c);
        }
      }
    });
    // Nine units form up on the target and the cells around it.
    for (const u of squad) {
      const [x, y] = xy(u.cell);
      expect(Math.max(Math.abs(x - 40), Math.abs(y - 30))).toBeLessThanOrEqual(2);
      expect(u.path).toHaveLength(0);
    }
  });

  it('ignores units that belong to someone else', () => {
    const sim = withBase();
    train(sim, 'tank');
    run(sim, UNIT_DEFS.tank.produceTicks + 100);
    const tank = ofType(sim, 'tank')[0];
    const cell = tank.cell;
    sim.issue({ type: 'move', player: 1, unitIds: [tank.id], cx: 40, cy: 30 });
    run(sim, 50);
    expect(tank.cell).toBe(cell);
  });
});

describe('training determinism', () => {
  it('replays an army build identically from its command log', () => {
    const sim = withBase();
    // withBase edits the world directly, so compare two identical runs.
    const play = (): Sim => {
      const s = withBase();
      for (let i = 0; i < 4; i++) train(s, 'rifleman');
      train(s, 'tank');
      run(s, 300);
      untrain(s, 'rifleman');
      train(s, 'tank');
      run(s, 700);
      const ids = s.world.units.map((u) => u.id);
      s.issue({ type: 'move', player: 0, unitIds: ids, cx: 35, cy: 28 });
      run(s, 600);
      return s;
    };
    expect(sim.world.units).toHaveLength(0);
    const a = play();
    expect(a.world.units.length).toBeGreaterThanOrEqual(5);
    expect(play().hash()).toBe(a.hash());
  });
});
