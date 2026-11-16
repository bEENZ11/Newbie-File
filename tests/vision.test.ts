import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { cellIndex } from '../src/sim/types';
import { START_CX, START_CY, spawnUnit } from '../src/sim/world';

const run = (sim: Sim, n: number): void => {
  for (let i = 0; i < n; i++) sim.step();
};

describe('vision', () => {
  it('starts with only the area around the Pioneer in view', () => {
    const v = new Sim(1).world.vision[0];
    expect(v.visible[cellIndex(START_CX, START_CY)]).toBe(1);
    expect(v.visible[cellIndex(START_CX + 4, START_CY)]).toBe(1);
    expect(v.visible[cellIndex(START_CX + 9, START_CY)]).toBe(0);
    expect(v.explored[cellIndex(50, 50)]).toBe(0);
  });

  it('follows units as they move, and remembers where they have been', () => {
    const sim = new Sim(1);
    const v = sim.world.vision[0];
    sim.issue({ type: 'move', player: 0, unitIds: [1], cx: START_CX + 20, cy: START_CY });
    run(sim, 300);
    expect(v.visible[cellIndex(START_CX + 20, START_CY)]).toBe(1);
    // Ground stays revealed after the unit that saw it has moved on.
    expect(v.visible[cellIndex(START_CX, START_CY)]).toBe(1);
    expect(v.explored[cellIndex(START_CX, START_CY)]).toBe(1);
    expect(v.explored[cellIndex(START_CX + 10, START_CY)]).toBe(1);
  });

  it('is kept separately for each player', () => {
    const sim = new Sim(1);
    spawnUnit(sim.world, 'tank', 1, 50, 50);
    run(sim, 5);
    expect(sim.world.vision[1].visible[cellIndex(50, 50)]).toBe(1);
    expect(sim.world.vision[0].visible[cellIndex(50, 50)]).toBe(0);
    expect(sim.world.vision[1].visible[cellIndex(START_CX, START_CY)]).toBe(0);
  });

  it('stays revealed even after the unit that saw it is destroyed', () => {
    const sim = new Sim(1);
    sim.world.ore.fill(0);
    const scout = spawnUnit(sim.world, 'rifleman', 0, 40, 40);
    run(sim, 5);
    expect(sim.world.vision[0].visible[cellIndex(42, 40)]).toBe(1);
    scout.hp = 0;
    run(sim, 5);
    expect(sim.world.vision[0].visible[cellIndex(42, 40)]).toBe(1);
    expect(sim.world.vision[0].explored[cellIndex(42, 40)]).toBe(1);
    // But ground nobody has been near is still hidden.
    expect(sim.world.vision[0].visible[cellIndex(70, 70)]).toBe(0);
  });
});
