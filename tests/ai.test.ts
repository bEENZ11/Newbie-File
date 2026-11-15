import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { BUILDING_DEFS, GRASS, UNIT_DEFS, type World } from '../src/sim/types';

const run = (sim: Sim, n: number, each?: () => void): void => {
  for (let i = 0; i < n && sim.world.winner === -1; i++) {
    sim.step();
    each?.();
  }
};

const buildings = (w: World, p: number): string[] => w.buildings.filter((b) => b.owner === p).map((b) => b.type);
const army = (w: World, p: number): number =>
  w.units.filter((u) => u.owner === p && UNIT_DEFS[u.type].weapon).length;

describe('the computer opponent', () => {
  it('builds a working base from a Construction Yard', () => {
    const sim = new Sim(4, { ai: [1], terrain: true });
    run(sim, 3600);
    const b = buildings(sim.world, 1);
    for (const type of ['conyard', 'power', 'refinery', 'barracks', 'factory', 'turret']) {
      expect(b).toContain(type);
    }
    expect(sim.world.units.some((u) => u.owner === 1 && u.type === 'harvester')).toBe(true);
  });

  it('never runs its own base short of power for long', () => {
    const sim = new Sim(4, { ai: [1] });
    let lowTicks = 0;
    run(sim, 5000, () => {
      let supply = 0;
      let demand = 0;
      for (const b of sim.world.buildings) {
        if (b.owner !== 1 || b.progress < b.total) continue;
        const pw = BUILDING_DEFS[b.type].power;
        if (pw > 0) supply += pw;
        else demand -= pw;
      }
      if (demand > supply) lowTicks++;
    });
    expect(lowTicks).toBeLessThan(600);
  });

  it('raises an army and sends it at the player', () => {
    const sim = new Sim(4, { ai: [1] });
    let attacked = false;
    run(sim, 12000, () => {
      if (sim.world.ai[1]!.wave > 0) attacked = true;
    });
    expect(attacked).toBe(true);
    expect(sim.world.ai[1]!.wave).toBeGreaterThanOrEqual(1);
  });

  it('wins against a player who does nothing', () => {
    const sim = new Sim(4, { ai: [1] });
    sim.issue({ type: 'deploy', player: 0, unitId: 1 });
    run(sim, 60000);
    expect(sim.world.winner).toBe(1);
  });

  it('can play a whole game against itself without breaking the rules', () => {
    const sim = new Sim(12, { ai: [0, 1], terrain: true });
    const world = sim.world;
    run(sim, 24000, () => {
      if (world.tick % 25 !== 0) return;
      const held = new Set<number>();
      for (const u of world.units) {
        for (const c of u.stepTo === -1 ? [u.cell] : [u.cell, u.stepTo]) {
          expect(held.has(c)).toBe(false);
          held.add(c);
          expect(world.terrain[c]).toBe(GRASS);
          expect(world.blocked[c]).toBe(0);
        }
      }
      for (const p of world.players) expect(p.credits).toBeGreaterThanOrEqual(0);
    });
    expect(buildings(world, 0).length + buildings(world, 1).length).toBeGreaterThan(0);
    expect(world.ai[0]!.wave + world.ai[1]!.wave).toBeGreaterThan(0);
  });

  it('makes the same decisions every time', () => {
    const play = (): Sim => {
      const sim = new Sim(12, { ai: [0, 1], terrain: true });
      run(sim, 6000);
      return sim;
    };
    const a = play();
    expect(play().hash()).toBe(a.hash());
    expect(army(a.world, 0) + army(a.world, 1)).toBeGreaterThan(0);
  });
});
