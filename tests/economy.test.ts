import { describe, expect, it } from 'vitest';
import { checkPlacement } from '../src/sim/production';
import { Sim } from '../src/sim/sim';
import {
  BUILDING_DEFS,
  HARVEST_CAPACITY,
  MAP_H,
  MAP_W,
  cellIndex,
  dockCell,
  type Unit,
  type World,
} from '../src/sim/types';
import { START_CX, START_CY, addBuilding, spawnUnit } from '../src/sim/world';

const YARD_X = START_CX - 1;
const YARD_Y = START_CY - 1;
const REF_X = YARD_X;
const REF_Y = YARD_Y + 3;

const run = (sim: Sim, ticks: number, each?: () => void): void => {
  for (let i = 0; i < ticks; i++) {
    sim.step();
    each?.();
  }
};

const totalOre = (w: World): number => w.ore.reduce((a, b) => a + b, 0);
const totalCargo = (w: World): number => w.units.reduce((a, u) => a + u.cargo, 0);

/**
 * A yard and a refinery about to finish, with one small ore patch nearby and
 * no other ore, so tests are quick and predictable.
 */
function withRefinery(orePerCell = 300, oreCells = 6): Sim {
  const sim = new Sim(1);
  sim.issue({ type: 'deploy', player: 0, unitId: sim.world.units[0].id });
  run(sim, BUILDING_DEFS.conyard.buildTicks + 2);
  sim.world.ore.fill(0);
  for (let i = 0; i < oreCells; i++) sim.world.ore[cellIndex(REF_X + 8 + (i % 3), REF_Y + 2 + Math.floor(i / 3))] = orePerCell;
  const refinery = addBuilding(sim.world, 'refinery', 0, REF_X, REF_Y);
  refinery.progress = refinery.total - 1;
  sim.step();
  return sim;
}

const harvesters = (w: World): Unit[] => w.units.filter((u) => u.type === 'harvester');

describe('harvesting', () => {
  it('gives every finished refinery a harvester at its dock', () => {
    const sim = withRefinery();
    const [h] = harvesters(sim.world);
    const dock = dockCell(sim.world.buildings[1]);
    expect(h.cell).toBe(cellIndex(dock.x, dock.y));
    expect(h.owner).toBe(0);
  });

  it('collects ore and turns it into credits with no input', () => {
    const sim = withRefinery();
    const start = sim.world.players[0].credits;
    run(sim, 900);
    expect(sim.world.players[0].credits).toBeGreaterThanOrEqual(start + HARVEST_CAPACITY);
  });

  it('never creates or loses ore along the way', () => {
    const sim = withRefinery();
    const world = sim.world;
    const before = totalOre(world) + world.players[0].credits;
    run(sim, 1500, () => {
      expect(totalOre(world) + totalCargo(world) + world.players[0].credits).toBe(before);
      for (const u of world.units) expect(u.cargo).toBeLessThanOrEqual(HARVEST_CAPACITY);
    });
  });

  it('strips the field bare and then stops', () => {
    const sim = withRefinery(100, 4);
    const start = sim.world.players[0].credits;
    run(sim, 1500);
    expect(totalOre(sim.world)).toBe(0);
    expect(sim.world.players[0].credits).toBe(start + 400);
    expect(harvesters(sim.world)[0].job).toBe('idle');
  });

  it('goes back to work when new ore appears', () => {
    const sim = withRefinery(100, 1);
    run(sim, 800);
    const credits = sim.world.players[0].credits;
    sim.world.ore[cellIndex(REF_X + 6, REF_Y + 5)] = 200;
    run(sim, 800);
    expect(sim.world.players[0].credits).toBe(credits + 200);
  });

  it('digs where the player points it', () => {
    const sim = withRefinery();
    const [h] = harvesters(sim.world);
    const far = cellIndex(REF_X + 20, REF_Y + 12);
    sim.world.ore[far] = 800;
    sim.issue({ type: 'move', player: 0, unitIds: [h.id], cx: REF_X + 20, cy: REF_Y + 12 });
    run(sim, 500);
    expect(sim.world.ore[far]).toBeLessThan(800);
  });

  it('waits for orders after a plain move', () => {
    const sim = withRefinery();
    const [h] = harvesters(sim.world);
    sim.issue({ type: 'move', player: 0, unitIds: [h.id], cx: REF_X + 4, cy: REF_Y + 12 });
    run(sim, 600);
    expect(h.cell).toBe(cellIndex(REF_X + 4, REF_Y + 12));
    expect(h.job).toBe('manual');
    expect(h.cargo).toBe(0);
  });

  it('holds its load if the refinery is sold, and delivers to a new one', () => {
    const sim = withRefinery(600, 6);
    const world = sim.world;
    const [h] = harvesters(world);
    run(sim, 300);
    sim.issue({ type: 'sell', player: 0, buildingId: world.buildings[1].id });
    run(sim, 600);
    expect(h.cargo).toBe(HARVEST_CAPACITY);
    const credits = world.players[0].credits;
    const second = addBuilding(world, 'refinery', 0, REF_X + 4, REF_Y);
    second.progress = second.total;
    run(sim, 600);
    expect(world.players[0].credits).toBeGreaterThanOrEqual(credits + HARVEST_CAPACITY);
  });
});

describe('sharing the map', () => {
  it('never lets two units hold the same cell', () => {
    const sim = withRefinery(900, 6);
    const world = sim.world;
    const dock = dockCell(world.buildings[1]);
    for (let i = 0; i < 4; i++) spawnUnit(world, 'harvester', 0, dock.x + 2 + i, dock.y + 1);
    run(sim, 2500, () => {
      const held = new Set<number>();
      for (const u of world.units) {
        for (const c of u.stepTo === -1 ? [u.cell] : [u.cell, u.stepTo]) {
          expect(held.has(c)).toBe(false);
          held.add(c);
          expect(world.occupied[c]).toBe(u.id);
          expect(world.blocked[c]).toBe(0);
        }
      }
    });
  });

  it('queues several harvesters through one dock without jamming', () => {
    const sim = withRefinery(900, 6);
    const world = sim.world;
    const dock = dockCell(world.buildings[1]);
    for (let i = 0; i < 3; i++) spawnUnit(world, 'harvester', 0, dock.x + 2 + i, dock.y + 1);
    const start = world.players[0].credits;
    run(sim, 3000);
    // Four harvesters sharing a dock should manage well over one load each.
    expect(world.players[0].credits - start).toBeGreaterThanOrEqual(HARVEST_CAPACITY * 6);
  });

  it('steers two units round each other when they meet head on', () => {
    const sim = new Sim(1);
    const world = sim.world;
    world.ore.fill(0);
    const a = spawnUnit(world, 'harvester', 0, 30, 30);
    const b = spawnUnit(world, 'harvester', 0, 40, 30);
    sim.issue({ type: 'move', player: 0, unitIds: [a.id], cx: 40, cy: 30 });
    sim.issue({ type: 'move', player: 0, unitIds: [b.id], cx: 30, cy: 30 });
    run(sim, 400);
    expect(a.cell).toBe(cellIndex(40, 30));
    expect(b.cell).toBe(cellIndex(30, 30));
  });

  it('stops beside a destination that someone else is parked on', () => {
    const sim = new Sim(1);
    const world = sim.world;
    world.ore.fill(0);
    const parked = spawnUnit(world, 'harvester', 0, 40, 30);
    parked.job = 'manual';
    const mover = spawnUnit(world, 'harvester', 0, 30, 30);
    sim.issue({ type: 'move', player: 0, unitIds: [mover.id], cx: 40, cy: 30 });
    run(sim, 400);
    expect(mover.path).toHaveLength(0);
    const dx = Math.abs((mover.cell % MAP_W) - 40);
    const dy = Math.abs(Math.floor(mover.cell / MAP_W) - 30);
    expect(Math.max(dx, dy)).toBe(1);
  });
});

describe('refinery docks', () => {
  it('cannot be built over', () => {
    const sim = withRefinery();
    const dock = dockCell(sim.world.buildings[1]);
    harvesters(sim.world)[0].job = 'manual';
    sim.issue({ type: 'move', player: 0, unitIds: [harvesters(sim.world)[0].id], cx: dock.x + 6, cy: dock.y + 6 });
    run(sim, 300);
    expect(checkPlacement(sim.world, 0, 'power', dock.x - 1, dock.y).ok).toBe(false);
    expect(checkPlacement(sim.world, 0, 'power', dock.x - 2, dock.y).ok).toBe(true);
  });

  it('must be on the map for a refinery to be placed', () => {
    const sim = withRefinery();
    // Right at the southern edge, where a dock would fall off the map.
    const b = addBuilding(sim.world, 'power', 0, 20, MAP_H - 6);
    b.progress = b.total;
    expect(checkPlacement(sim.world, 0, 'refinery', 22, MAP_H - 3).ok).toBe(false);
    expect(checkPlacement(sim.world, 0, 'refinery', 22, MAP_H - 7).ok).toBe(true);
  });
});

describe('economy determinism', () => {
  it('replays a harvesting game identically from its command log', () => {
    const play = (): Sim => {
      const sim = new Sim(21);
      sim.issue({ type: 'deploy', player: 0, unitId: 1 });
      run(sim, 45);
      sim.issue({ type: 'build', player: 0, building: 'power' });
      run(sim, 170);
      sim.issue({ type: 'place', player: 0, cx: YARD_X + 3, cy: YARD_Y });
      run(sim, 40);
      sim.issue({ type: 'build', player: 0, building: 'refinery' });
      run(sim, 520);
      sim.issue({ type: 'place', player: 0, cx: REF_X, cy: REF_Y });
      run(sim, 2500);
      return sim;
    };
    const sim = play();
    expect(harvesters(sim.world)).toHaveLength(1);
    expect(sim.world.players[0].credits).toBeGreaterThan(5000 - 1750);
    expect(play().hash()).toBe(sim.hash());
    expect(Sim.replay(21, sim.log, sim.world.tick).hash()).toBe(sim.hash());
  });
});
