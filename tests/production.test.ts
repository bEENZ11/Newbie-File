import { describe, expect, it } from 'vitest';
import { canProduce, checkPlacement, powerOf } from '../src/sim/production';
import { Sim } from '../src/sim/sim';
import { BUILDING_DEFS, STARTING_CREDITS, cellIndex, type BuildingType } from '../src/sim/types';
import { START_CX, START_CY, addBuilding } from '../src/sim/world';

const run = (sim: Sim, ticks: number): void => {
  for (let i = 0; i < ticks; i++) sim.step();
};

const YARD_X = START_CX - 1;
const YARD_Y = START_CY - 1;

/** A game with the Construction Yard already deployed and finished. */
function withYard(seed = 1): Sim {
  const sim = new Sim(seed);
  sim.issue({ type: 'deploy', player: 0, unitId: sim.world.units[0].id });
  run(sim, BUILDING_DEFS.conyard.buildTicks + 2);
  return sim;
}

/** Drops a finished building straight onto the map, skipping production. */
function grant(sim: Sim, type: BuildingType, cx: number, cy: number): void {
  const b = addBuilding(sim.world, type, 0, cx, cy);
  b.progress = b.total;
}

/** Produces a building through the sidebar and places it. */
function buildAt(sim: Sim, type: BuildingType, cx: number, cy: number): void {
  sim.issue({ type: 'build', player: 0, building: type });
  run(sim, BUILDING_DEFS[type].produceTicks * 5);
  // A passing harvester can briefly be in the way, so keep trying.
  for (let i = 0; i < 400 && sim.world.players[0].production; i++) {
    sim.issue({ type: 'place', player: 0, cx, cy });
    sim.step();
  }
  run(sim, BUILDING_DEFS[type].buildTicks + 2);
}

describe('production', () => {
  it('needs a Construction Yard before anything can be built', () => {
    const sim = new Sim(1);
    expect(canProduce(sim.world, 0, 'power')).toBe(false);
    sim.issue({ type: 'build', player: 0, building: 'power' });
    sim.step();
    expect(sim.world.players[0].production).toBeNull();
  });

  it('unlocks buildings as their prerequisites are finished', () => {
    const sim = withYard();
    expect(canProduce(sim.world, 0, 'power')).toBe(true);
    expect(canProduce(sim.world, 0, 'refinery')).toBe(false);
    expect(canProduce(sim.world, 0, 'factory')).toBe(false);
    grant(sim, 'power', YARD_X + 3, YARD_Y);
    expect(canProduce(sim.world, 0, 'refinery')).toBe(true);
    expect(canProduce(sim.world, 0, 'barracks')).toBe(true);
    expect(canProduce(sim.world, 0, 'factory')).toBe(false);
    grant(sim, 'refinery', YARD_X, YARD_Y + 3);
    expect(canProduce(sim.world, 0, 'factory')).toBe(true);
  });

  it('charges exactly the listed cost, spread over the build', () => {
    const sim = withYard();
    const p = sim.world.players[0];
    sim.issue({ type: 'build', player: 0, building: 'power' });
    run(sim, 80);
    expect(p.production?.state).toBe('active');
    expect(p.credits).toBe(STARTING_CREDITS - 125);
    run(sim, 80);
    expect(p.production?.state).toBe('ready');
    expect(p.credits).toBe(STARTING_CREDITS - BUILDING_DEFS.power.cost);
  });

  it('waits when credits run out and carries on when more arrive', () => {
    const sim = withYard();
    const p = sim.world.players[0];
    p.credits = 100;
    sim.issue({ type: 'build', player: 0, building: 'power' });
    run(sim, 400);
    expect(p.production?.state).toBe('active');
    expect(p.credits).toBeLessThan(2);
    const stalledAt = p.production!.progress;
    run(sim, 50);
    expect(p.production!.progress).toBe(stalledAt);
    p.credits += 500;
    run(sim, 200);
    expect(p.production?.state).toBe('ready');
    expect(p.credits).toBe(600 - BUILDING_DEFS.power.cost);
  });

  it('builds one structure at a time', () => {
    const sim = withYard();
    sim.issue({ type: 'build', player: 0, building: 'power' });
    sim.step();
    grant(sim, 'power', YARD_X + 3, YARD_Y);
    sim.issue({ type: 'build', player: 0, building: 'barracks' });
    run(sim, 5);
    expect(sim.world.players[0].production?.type).toBe('power');
  });

  it('can be put on hold and resumed', () => {
    const sim = withYard();
    const p = sim.world.players[0];
    sim.issue({ type: 'build', player: 0, building: 'power' });
    run(sim, 40);
    sim.issue({ type: 'hold', player: 0 });
    sim.step();
    const held = p.production!.progress;
    run(sim, 60);
    expect(p.production!.progress).toBe(held);
    sim.issue({ type: 'build', player: 0, building: 'power' });
    run(sim, 10);
    expect(p.production!.progress).toBeGreaterThan(held);
  });

  it('refunds everything spent when cancelled', () => {
    const sim = withYard();
    const p = sim.world.players[0];
    sim.issue({ type: 'build', player: 0, building: 'power' });
    run(sim, 70);
    expect(p.credits).toBeLessThan(STARTING_CREDITS);
    sim.issue({ type: 'cancel', player: 0 });
    sim.step();
    expect(p.production).toBeNull();
    expect(p.credits).toBe(STARTING_CREDITS);
  });
});

describe('placement', () => {
  it('places a finished building next to the base', () => {
    const sim = withYard();
    buildAt(sim, 'power', YARD_X + 3, YARD_Y);
    const plant = sim.world.buildings.find((b) => b.type === 'power')!;
    expect([plant.cx, plant.cy, plant.progress]).toEqual([YARD_X + 3, YARD_Y, plant.total]);
    expect(sim.world.players[0].production).toBeNull();
    expect(sim.world.blocked[cellIndex(YARD_X + 4, YARD_Y + 1)]).toBe(1);
  });

  it('allows a one-cell gap but nothing further out', () => {
    const sim = withYard();
    expect(checkPlacement(sim.world, 0, 'power', YARD_X + 4, YARD_Y).ok).toBe(true);
    const far = checkPlacement(sim.world, 0, 'power', YARD_X + 5, YARD_Y);
    expect([far.ok, far.inRange]).toEqual([false, false]);
  });

  it('refuses overlapping buildings, ore and the map edge', () => {
    const sim = withYard();
    expect(checkPlacement(sim.world, 0, 'power', YARD_X + 2, YARD_Y).ok).toBe(false);
    sim.world.ore[cellIndex(YARD_X + 3, YARD_Y)] = 400;
    expect(checkPlacement(sim.world, 0, 'power', YARD_X + 3, YARD_Y).ok).toBe(false);
    expect(checkPlacement(sim.world, 0, 'power', -1, 0).ok).toBe(false);
  });

  it('keeps the building ready when a placement is refused', () => {
    const sim = withYard();
    sim.issue({ type: 'build', player: 0, building: 'power' });
    run(sim, 200);
    sim.issue({ type: 'place', player: 0, cx: 40, cy: 40 });
    sim.step();
    expect(sim.events.some((e) => e.type === 'placeRefused')).toBe(true);
    expect(sim.world.players[0].production?.state).toBe('ready');
    expect(sim.world.buildings).toHaveLength(1);
  });
});

describe('power', () => {
  it('adds up supply and demand from finished buildings only', () => {
    const sim = withYard();
    grant(sim, 'power', YARD_X + 3, YARD_Y);
    grant(sim, 'barracks', YARD_X + 3, YARD_Y + 2);
    addBuilding(sim.world, 'refinery', 0, YARD_X, YARD_Y + 3);
    expect(powerOf(sim.world, 0)).toEqual({ supply: 100, demand: 20, low: false });
  });

  it('slows production in proportion to the shortfall', () => {
    const sim = withYard();
    grant(sim, 'power', YARD_X + 3, YARD_Y);
    // Demand of 200 against supply of 100 gives half speed.
    for (let i = 0; i < 10; i++) grant(sim, 'barracks', 30 + i * 2, 40);
    expect(powerOf(sim.world, 0).low).toBe(true);
    sim.issue({ type: 'build', player: 0, building: 'power' });
    run(sim, 161);
    expect(sim.world.players[0].production?.progress).toBe(80);
    run(sim, 160);
    expect(sim.world.players[0].production?.state).toBe('ready');
  });
});

describe('selling', () => {
  it('packs the building away, frees its cells and refunds half', () => {
    const sim = withYard();
    buildAt(sim, 'power', YARD_X + 3, YARD_Y);
    const p = sim.world.players[0];
    const before = p.credits;
    const plant = sim.world.buildings.find((b) => b.type === 'power')!;
    sim.issue({ type: 'sell', player: 0, buildingId: plant.id });
    sim.step();
    expect(powerOf(sim.world, 0).supply).toBe(0);
    run(sim, 30);
    expect(sim.world.buildings.some((b) => b.type === 'power')).toBe(false);
    expect(sim.world.blocked[cellIndex(YARD_X + 3, YARD_Y)]).toBe(0);
    expect(p.credits).toBe(before + 125);
  });
});

describe('whole build order', () => {
  it('replays identically from its command log', () => {
    const sim = withYard(11);
    buildAt(sim, 'power', YARD_X + 3, YARD_Y);
    buildAt(sim, 'refinery', YARD_X, YARD_Y + 3);
    buildAt(sim, 'barracks', YARD_X + 3, YARD_Y + 2);
    buildAt(sim, 'factory', YARD_X + 3, YARD_Y + 4);
    expect(sim.world.buildings.map((b) => b.type)).toEqual([
      'conyard',
      'power',
      'refinery',
      'barracks',
      'factory',
    ]);
    // The refinery's harvester has been earning in the meantime.
    expect(sim.world.players[0].credits).toBeGreaterThan(STARTING_CREDITS - 250 - 1500 - 400 - 1800);
    const copy = Sim.replay(11, sim.log, sim.world.tick);
    expect(copy.hash()).toBe(sim.hash());
  });
});
