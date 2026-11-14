import { describe, expect, it } from 'vitest';
import { findPath } from '../src/sim/pathfinding';
import { Sim } from '../src/sim/sim';
import { MAP_H, MAP_W, cellCentre, cellIndex, toCell } from '../src/sim/types';
import { START_CX, START_CY, addBuilding } from '../src/sim/world';

const run = (sim: Sim, ticks: number): void => {
  for (let i = 0; i < ticks; i++) sim.step();
};

describe('determinism', () => {
  it('produces the same state from the same seed and commands', () => {
    const play = (seed: number): number => {
      const sim = new Sim(seed);
      const id = sim.world.units[0].id;
      sim.issue({ type: 'move', unitIds: [id], cx: 30, cy: 22 });
      run(sim, 90);
      sim.issue({ type: 'move', unitIds: [id], cx: 20, cy: 40 });
      run(sim, 400);
      sim.issue({ type: 'deploy', unitId: id });
      run(sim, 100);
      return sim.hash();
    };
    expect(play(7)).toBe(play(7));
    expect(play(7)).not.toBe(play(8));
  });

  it('rebuilds an identical game from the command log', () => {
    const sim = new Sim(42);
    const id = sim.world.units[0].id;
    run(sim, 13);
    sim.issue({ type: 'move', unitIds: [id], cx: 25, cy: 18 });
    run(sim, 57);
    sim.issue({ type: 'deploy', unitId: id });
    run(sim, 200);
    const copy = Sim.replay(42, sim.log, sim.world.tick);
    expect(copy.hash()).toBe(sim.hash());
  });

  it('keeps every position a whole number', () => {
    const sim = new Sim(3);
    const unit = sim.world.units[0];
    sim.issue({ type: 'move', unitIds: [unit.id], cx: 33, cy: 27 });
    for (let i = 0; i < 300; i++) {
      sim.step();
      expect(Number.isInteger(unit.x) && Number.isInteger(unit.y)).toBe(true);
    }
  });
});

describe('movement', () => {
  it('drives the Pioneer to the centre of the target cell and stops', () => {
    const sim = new Sim(1);
    const unit = sim.world.units[0];
    sim.issue({ type: 'move', unitIds: [unit.id], cx: 24, cy: 16 });
    run(sim, 400);
    expect(unit.x).toBe(cellCentre(24));
    expect(unit.y).toBe(cellCentre(16));
    expect(unit.path).toHaveLength(0);
  });

  it('never enters a building while moving', () => {
    const sim = new Sim(1);
    const unit = sim.world.units[0];
    addBuilding(sim.world, 'conyard', 0, START_CX + 4, START_CY - 1);
    sim.issue({ type: 'move', unitIds: [unit.id], cx: START_CX + 10, cy: START_CY });
    for (let i = 0; i < 400; i++) {
      sim.step();
      expect(sim.world.blocked[cellIndex(toCell(unit.x), toCell(unit.y))]).toBe(0);
    }
    expect(toCell(unit.x)).toBe(START_CX + 10);
  });

  it('heads for the nearest free cell when the target is blocked', () => {
    const sim = new Sim(1);
    const unit = sim.world.units[0];
    addBuilding(sim.world, 'conyard', 0, 30, 30);
    sim.issue({ type: 'move', unitIds: [unit.id], cx: 31, cy: 31 });
    run(sim, 600);
    expect(unit.path).toHaveLength(0);
    const dx = Math.abs(toCell(unit.x) - 31);
    const dy = Math.abs(toCell(unit.y) - 31);
    expect(Math.max(dx, dy)).toBe(2);
  });
});

describe('pathfinding', () => {
  it('does not cut diagonally past an obstacle corner', () => {
    const blocked = new Uint8Array(MAP_W * MAP_H);
    blocked[cellIndex(5, 5)] = 1;
    const path = findPath(blocked, MAP_W, MAP_H, cellIndex(4, 5), 5, 4);
    expect(path).toEqual([cellIndex(4, 4), cellIndex(5, 4)]);
  });

  it('returns nothing when the destination is walled off', () => {
    const blocked = new Uint8Array(MAP_W * MAP_H);
    for (let y = 0; y < MAP_H; y++) blocked[cellIndex(10, y)] = 1;
    expect(findPath(blocked, MAP_W, MAP_H, cellIndex(2, 2), 20, 2)).toEqual([]);
  });
});

describe('deploying', () => {
  it('turns the Pioneer into a Construction Yard centred on it', () => {
    const sim = new Sim(1);
    const unit = sim.world.units[0];
    sim.issue({ type: 'deploy', unitId: unit.id });
    sim.step();
    expect(sim.world.units).toHaveLength(0);
    expect(sim.events).toContainEqual({ type: 'deployed', unitId: unit.id, buildingId: 2 });
    const yard = sim.world.buildings[0];
    expect([yard.type, yard.cx, yard.cy]).toEqual(['conyard', START_CX - 1, START_CY - 1]);
    expect(yard.progress).toBeLessThan(yard.total);
    run(sim, yard.total);
    expect(yard.progress).toBe(yard.total);
  });

  it('refuses when the footprint would leave the map', () => {
    const sim = new Sim(1);
    const unit = sim.world.units[0];
    sim.issue({ type: 'move', unitIds: [unit.id], cx: 0, cy: 0 });
    run(sim, 400);
    sim.issue({ type: 'deploy', unitId: unit.id });
    sim.step();
    expect(sim.world.units).toHaveLength(1);
    expect(sim.world.buildings).toHaveLength(0);
    expect(sim.events[0]?.type).toBe('deployBlocked');
  });

  it('refuses on top of ore', () => {
    const sim = new Sim(1);
    const unit = sim.world.units[0];
    sim.world.ore[cellIndex(START_CX + 1, START_CY)] = 500;
    sim.issue({ type: 'deploy', unitId: unit.id });
    sim.step();
    expect(sim.world.buildings).toHaveLength(0);
  });

  it('finishes the current step before deploying while on the move', () => {
    const sim = new Sim(1);
    const unit = sim.world.units[0];
    sim.issue({ type: 'move', unitIds: [unit.id], cx: START_CX + 8, cy: START_CY });
    run(sim, 3);
    sim.issue({ type: 'deploy', unitId: unit.id });
    run(sim, 20);
    expect(sim.world.units).toHaveLength(0);
    expect(sim.world.buildings[0].cx).toBe(START_CX);
  });

  it('is cancelled by a fresh move order', () => {
    const sim = new Sim(1);
    const unit = sim.world.units[0];
    sim.issue({ type: 'move', unitIds: [unit.id], cx: START_CX + 8, cy: START_CY });
    run(sim, 3);
    sim.issue({ type: 'deploy', unitId: unit.id });
    sim.issue({ type: 'move', unitIds: [unit.id], cx: START_CX + 8, cy: START_CY });
    run(sim, 200);
    expect(sim.world.units).toHaveLength(1);
    expect(toCell(unit.x)).toBe(START_CX + 8);
  });
});
