import { afterEach, describe, expect, it } from 'vitest';
import { canProduce } from '../src/sim/production';
import { Sim } from '../src/sim/sim';
import { canTrain } from '../src/sim/training';
import {
  BUILDING_DEFS,
  FACTION_DEFS,
  SABOTAGE_DAMAGE,
  STARTING_CREDITS,
  UNIT_DEFS,
  type BuildingType,
  type UnitType,
} from '../src/sim/types';
import { addBuilding, spawnUnit } from '../src/sim/world';

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

  it('can each be denied units and buildings, without affecting the other', () => {
    without('aegis', ['rocket'], ['depot']);
    const sim = new Sim(1);
    bases(sim);
    expect(canTrain(sim.world, 0, 'rocket')).toBe(false);
    expect(canProduce(sim.world, 0, 'depot')).toBe(false);
    expect(canTrain(sim.world, 0, 'rifleman')).toBe(true);
    expect(canTrain(sim.world, 1, 'rocket')).toBe(true);
    expect(canProduce(sim.world, 1, 'depot')).toBe(true);
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

describe('what sets the factions apart', () => {
  const only = (faction: 'aegis' | 'dominion'): UnitType[] => {
    const other = faction === 'aegis' ? 'dominion' : 'aegis';
    return [...FACTION_DEFS[other].withoutUnits];
  };

  it('is two soldiers and two vehicles each, and nothing else', () => {
    for (const faction of ['aegis', 'dominion'] as const) {
      const units = only(faction);
      expect(units.filter((u) => UNIT_DEFS[u].queue === 'infantry')).toHaveLength(2);
      expect(units.filter((u) => UNIT_DEFS[u].queue === 'vehicle')).toHaveLength(2);
      expect(FACTION_DEFS[faction].withoutBuildings).toEqual([]);
    }
    expect(only('aegis').sort()).toEqual(['artillery', 'engineer', 'guardian', 'sniper']);
    expect(only('dominion').sort()).toEqual(['flamer', 'flametank', 'heavy', 'saboteur']);
  });

  it('gives each side its own units and denies it the other side\'s', () => {
    const sim = new Sim(1);
    bases(sim);
    for (const owner of [0, 1]) {
      for (const [type, dx] of [['radar', 14], ['tech', 17]] as const) {
        const b = addBuilding(sim.world, type, owner, 8 + dx, owner === 0 ? 30 : 36);
        b.progress = b.total;
      }
    }
    for (const u of only('aegis')) {
      expect(canTrain(sim.world, 0, u)).toBe(true);
      expect(canTrain(sim.world, 1, u)).toBe(false);
    }
    for (const u of only('dominion')) {
      expect(canTrain(sim.world, 1, u)).toBe(true);
      expect(canTrain(sim.world, 0, u)).toBe(false);
    }
    // The common core is open to both.
    for (const u of ['rifleman', 'rocket', 'grenadier', 'tank', 'scout'] as const) {
      expect(canTrain(sim.world, 0, u) && canTrain(sim.world, 1, u)).toBe(true);
    }
  });

  it('keeps every unique unit behind a Radar Station or Tech Centre', () => {
    for (const u of [...only('aegis'), ...only('dominion')]) {
      expect(UNIT_DEFS[u].requires.some((r) => r === 'radar' || r === 'tech')).toBe(true);
    }
  });
});

describe('saboteurs', () => {
  const setup = (hp?: number) => {
    const sim = new Sim(1, { factions: ['dominion', 'aegis'] });
    sim.world.ore.fill(0);
    sim.world.players[1].active = true;
    const keep = addBuilding(sim.world, 'conyard', 1, 50, 50);
    keep.progress = keep.total;
    const target = addBuilding(sim.world, 'factory', 1, 40, 30);
    target.progress = target.total;
    if (hp) target.hp = hp;
    const agent = spawnUnit(sim.world, 'saboteur', 0, 36, 31);
    return { sim, target, agent };
  };

  it('blow up an enemy building from inside, and do not come back', () => {
    const { sim, target, agent } = setup(600);
    sim.issue({ type: 'capture', player: 0, unitIds: [agent.id], buildingId: target.id });
    let seen = false;
    run(sim, 120, () => {
      if (sim.events.some((e) => e.type === 'sabotaged' && e.player === 0)) seen = true;
    });
    expect(seen).toBe(true);
    expect(sim.world.buildings.includes(target)).toBe(false);
    expect(sim.world.units.includes(agent)).toBe(false);
  });

  it('cripple a big building without quite destroying it', () => {
    const { sim, target, agent } = setup();
    sim.issue({ type: 'capture', player: 0, unitIds: [agent.id], buildingId: target.id });
    run(sim, 120);
    expect(sim.world.buildings.includes(target)).toBe(true);
    expect(target.hp).toBe(BUILDING_DEFS.factory.hp - SABOTAGE_DAMAGE);
    expect(target.owner).toBe(1);
  });

  it('will not touch their own side\'s buildings', () => {
    const { sim, agent } = setup();
    const mine = addBuilding(sim.world, 'power', 0, 30, 30);
    mine.progress = mine.total;
    sim.issue({ type: 'capture', player: 0, unitIds: [agent.id], buildingId: mine.id });
    run(sim, 200);
    expect(mine.hp).toBe(BUILDING_DEFS.power.hp);
    expect(sim.world.units.includes(agent)).toBe(true);
    expect(agent.capture).toBe(0);
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
