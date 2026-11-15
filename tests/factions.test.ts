import { afterEach, describe, expect, it } from 'vitest';
import { canProduce } from '../src/sim/production';
import { Sim } from '../src/sim/sim';
import { canTrain } from '../src/sim/training';
import { FACTION_DEFS, STARTING_CREDITS, type BuildingType, type UnitType } from '../src/sim/types';
import { addBuilding } from '../src/sim/world';

const run = (sim: Sim, n: number, each?: () => void): void => {
  for (let i = 0; i < n; i++) {
    sim.step();
    each?.();
  }
};

/** Both players with a yard, barracks, factory and power, ready to build anything basic. */
function bases(sim: Sim): void {
  for (const owner of [0, 1]) {
    for (const [type, dx] of [['conyard', 0], ['power', 4], ['barracks', 7], ['factory', 10]] as const) {
      const b = addBuilding(sim.world, type, owner, 8 + dx, owner === 0 ? 30 : 36);
      b.progress = b.total;
    }
  }
}

/** Temporarily takes something off a faction's roster. Restored after each test. */
const original = JSON.parse(JSON.stringify(FACTION_DEFS));
function without(faction: 'aegis' | 'dominion', units: UnitType[], buildings: BuildingType[]): void {
  FACTION_DEFS[faction].withoutUnits = units;
  FACTION_DEFS[faction].withoutBuildings = buildings;
}
afterEach(() => {
  for (const f of ['aegis', 'dominion'] as const) {
    without(f, original[f].withoutUnits, original[f].withoutBuildings);
  }
});

describe('factions', () => {
  it('default to Aegis for the player and Dominion for the opponent', () => {
    const sim = new Sim(1);
    expect(sim.world.players.map((p) => p.faction)).toEqual(['aegis', 'dominion']);
  });

  it('can be chosen for each side, including the same one twice', () => {
    expect(new Sim(1, { factions: ['dominion', 'aegis'] }).world.players.map((p) => p.faction)).toEqual([
      'dominion',
      'aegis',
    ]);
    expect(new Sim(1, { factions: ['dominion', 'dominion'] }).world.players[1].faction).toBe('dominion');
  });

  it('share the whole roster for now', () => {
    const sim = new Sim(1);
    bases(sim);
    for (const player of [0, 1]) {
      expect(canTrain(sim.world, player, 'rocket')).toBe(true);
      expect(canTrain(sim.world, player, 'scout')).toBe(true);
      expect(canProduce(sim.world, player, 'turret')).toBe(true);
    }
  });

  it('can each be denied units and buildings, without affecting the other', () => {
    without('aegis', ['rocket'], ['turret']);
    const sim = new Sim(1);
    bases(sim);
    expect(canTrain(sim.world, 0, 'rocket')).toBe(false);
    expect(canProduce(sim.world, 0, 'turret')).toBe(false);
    expect(canTrain(sim.world, 0, 'rifleman')).toBe(true);
    expect(canTrain(sim.world, 1, 'rocket')).toBe(true);
    expect(canProduce(sim.world, 1, 'turret')).toBe(true);
    // The rule follows the faction, not the seat at the table.
    const swapped = new Sim(1, { factions: ['dominion', 'aegis'] });
    bases(swapped);
    expect(canTrain(swapped.world, 0, 'rocket')).toBe(true);
    expect(canTrain(swapped.world, 1, 'rocket')).toBe(false);
  });

  it('cannot queue something their faction lacks, even if ordered to', () => {
    without('aegis', ['rocket'], ['turret']);
    const sim = new Sim(1);
    bases(sim);
    sim.issue({ type: 'train', player: 0, unit: 'rocket' });
    sim.issue({ type: 'build', player: 0, building: 'turret' });
    sim.step();
    expect(sim.world.players[0].queues.infantry.items).toEqual([]);
    expect(sim.world.players[0].production).toBeNull();
  });

  it('are part of what keeps two machines in step', () => {
    expect(new Sim(1).hash()).not.toBe(new Sim(1, { factions: ['dominion', 'aegis'] }).hash());
  });
});

describe('game settings', () => {
  it('set the starting credits for both sides', () => {
    expect(new Sim(1).world.players[0].credits).toBe(STARTING_CREDITS);
    const rich = new Sim(1, { credits: 10000 });
    expect(rich.world.players.map((p) => p.credits)).toEqual([10000, 10000]);
  });

  it('make the computer attack sooner the harder it is set', () => {
    const firstWave = (difficulty: 'easy' | 'normal' | 'hard'): number => {
      const sim = new Sim(4, { ai: [1], difficulty });
      for (let i = 0; i < 12000; i++) {
        sim.step();
        if (sim.world.ai[1]!.wave > 0) return sim.world.tick;
      }
      return Infinity;
    };
    const easy = firstWave('easy');
    const normal = firstWave('normal');
    const hard = firstWave('hard');
    expect(hard).toBeLessThan(normal);
    expect(normal).toBeLessThan(easy);
    expect(easy).toBeGreaterThanOrEqual(7200);
    expect(hard).toBeGreaterThanOrEqual(3000);
  });

  it('give the same game for the same settings', () => {
    const play = (): number => {
      const sim = new Sim(9, { ai: [0, 1], terrain: true, difficulty: 'hard', factions: ['dominion', 'aegis'], credits: 8000 });
      run(sim, 4000);
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});
