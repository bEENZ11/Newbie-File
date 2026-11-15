import { describe, expect, it } from 'vitest';
import { uplinkOnline } from '../src/sim/production';
import { Sim } from '../src/sim/sim';
import {
  GEM_VALUE,
  GRASS,
  HARVEST_CAPACITY,
  MAP_H,
  MAP_W,
  UNIT_DEFS,
  UPLINK_TICKS,
  WATER,
  cellIndex,
  type World,
} from '../src/sim/types';
import { BASES, addBuilding, spawnUnit, type Seat } from '../src/sim/world';

const run = (sim: Sim, n: number, each?: () => void): void => {
  for (let i = 0; i < n && sim.world.winner === -1; i++) {
    sim.step();
    each?.();
  }
};

const seat = (team: number, ai = true, faction: Seat['faction'] = 'aegis'): Seat => ({ faction, team, ai });
const TWO_V_TWO: Seat[] = [seat(0), seat(1, true, 'dominion'), seat(1, true, 'dominion'), seat(0)];
const FREE_FOR_ALL: Seat[] = [seat(0), seat(1, true, 'dominion'), seat(2), seat(3, true, 'dominion')];

function building(world: World, type: 'conyard' | 'power' | 'turret', owner: number, x: number, y: number) {
  const b = addBuilding(world, type, owner, x, y);
  b.progress = b.total;
  return b;
}

describe('the map', () => {
  it('is four times the size it was', () => {
    expect(MAP_W * MAP_H).toBe(64 * 64 * 4);
  });

  it('has big lakes, plenty of ore and some gems', () => {
    for (const seed of [2, 5, 9]) {
      const world = new Sim(seed, { terrain: true, seats: FREE_FOR_ALL }).world;
      const water = world.terrain.filter((t) => t === WATER).length;
      const ore = world.ore.filter((o, i) => o > 0 && !world.rich[i]).length;
      const gems = world.ore.filter((o, i) => o > 0 && world.rich[i]).length;
      expect(water).toBeGreaterThan(500);
      expect(ore).toBeGreaterThan(600);
      expect(gems).toBeGreaterThan(20);
      // Gems lie around the middle, away from everyone's corner.
      world.rich.forEach((r, i) => {
        if (!r) return;
        const x = i % MAP_W;
        const y = Math.floor(i / MAP_W);
        expect(BASES.every((b) => Math.abs(x - b.x) > 10 || Math.abs(y - b.y) > 10)).toBe(true);
      });
    }
  });

  it('always lets every starting position be reached', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const world = new Sim(seed, { terrain: true, seats: FREE_FOR_ALL }).world;
      expect(world.terrain.some((t) => t !== GRASS)).toBe(true);
      // Flood out from the first base and check the others are in the same piece of land.
      const reached = new Uint8Array(MAP_W * MAP_H);
      const queue = [cellIndex(BASES[0].x, BASES[0].y - 3)];
      reached[queue[0]] = 1;
      while (queue.length > 0) {
        const c = queue.pop()!;
        const x = c % MAP_W;
        const y = (c - x) / MAP_W;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          const n = cellIndex(nx, ny);
          if (reached[n] || world.terrain[n] !== GRASS) continue;
          reached[n] = 1;
          queue.push(n);
        }
      }
      for (const b of BASES) expect(reached[cellIndex(b.x, b.y - 3)]).toBe(1);
    }
  });
});

describe('gems', () => {
  it('fill a harvester no faster than ore, but pay double', () => {
    const load = (rich: boolean): { credits: number; ticks: number } => {
      const sim = new Sim(1);
      const world = sim.world;
      world.ore.fill(0);
      world.rich.fill(0);
      building(world, 'conyard', 0, 20, 20);
      const refinery = addBuilding(world, 'refinery', 0, 20, 24);
      refinery.progress = refinery.total;
      const cell = cellIndex(28, 30);
      world.ore[cell] = 5000;
      world.rich[cell] = rich ? 1 : 0;
      const h = spawnUnit(world, 'harvester', 0, 27, 30);
      const before = world.players[0].credits;
      let full = 0;
      for (let t = 0; t < 2000; t++) {
        sim.step();
        if (!full && h.load >= HARVEST_CAPACITY) full = t;
        if (world.players[0].credits >= before + (rich ? GEM_VALUE : 1) * HARVEST_CAPACITY) break;
      }
      return { credits: world.players[0].credits - before, ticks: full };
    };
    const ore = load(false);
    const gems = load(true);
    expect(ore.credits).toBe(HARVEST_CAPACITY);
    expect(gems.credits).toBe(HARVEST_CAPACITY * GEM_VALUE);
    expect(Math.abs(gems.ticks - ore.ticks)).toBeLessThanOrEqual(2);
  });

  it('never create or lose value between the field, the hopper and the bank', () => {
    const sim = new Sim(1);
    const world = sim.world;
    world.ore.fill(0);
    world.rich.fill(0);
    building(world, 'conyard', 0, 20, 20);
    const refinery = addBuilding(world, 'refinery', 0, 20, 24);
    refinery.progress = refinery.total;
    for (let i = 0; i < 4; i++) {
      world.ore[cellIndex(28 + i, 30)] = 700;
      world.rich[cellIndex(28 + i, 30)] = i % 2;
    }
    spawnUnit(world, 'harvester', 0, 27, 30);
    const total = (): number =>
      world.ore.reduce((a, b) => a + b, 0) + world.units.reduce((a, u) => a + u.cargo, 0) + world.players[0].credits;
    const before = total();
    run(sim, 3000, () => {
      expect(total()).toBe(before);
      for (const u of world.units) expect(u.load).toBeLessThanOrEqual(HARVEST_CAPACITY);
    });
    expect(world.ore.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('teams', () => {
  it('never fire on their own side, and do fire on the other', () => {
    const sim = new Sim(1, { seats: TWO_V_TWO.map((s) => ({ ...s, ai: false })) });
    const world = sim.world;
    world.ore.fill(0);
    const mine = spawnUnit(world, 'tank', 0, 60, 60);
    const ally = spawnUnit(world, 'tank', 3, 62, 60);
    run(sim, 200);
    expect([mine.hp, ally.hp]).toEqual([UNIT_DEFS.tank.hp, UNIT_DEFS.tank.hp]);
    const foe = spawnUnit(world, 'harvester', 2, 61, 63);
    foe.job = 'manual';
    run(sim, 100);
    expect(foe.hp).toBeLessThan(UNIT_DEFS.harvester.hp);
  });

  it('cannot be ordered to attack an ally', () => {
    const sim = new Sim(1, { seats: TWO_V_TWO.map((s) => ({ ...s, ai: false })) });
    const world = sim.world;
    world.ore.fill(0);
    const mine = spawnUnit(world, 'tank', 0, 60, 60);
    const ally = spawnUnit(world, 'harvester', 3, 63, 60);
    ally.job = 'manual';
    sim.issue({ type: 'attack', player: 0, unitIds: [mine.id], targetId: ally.id });
    run(sim, 100);
    expect(ally.hp).toBe(UNIT_DEFS.harvester.hp);
    expect(mine.attack).toBe(0);
  });

  it('are left alone by an ally\'s turrets', () => {
    const sim = new Sim(1, { seats: TWO_V_TWO.map((s) => ({ ...s, ai: false })) });
    const world = sim.world;
    world.ore.fill(0);
    building(world, 'power', 3, 56, 56);
    building(world, 'turret', 3, 60, 60);
    const mine = spawnUnit(world, 'harvester', 0, 62, 60);
    mine.job = 'manual';
    const foe = spawnUnit(world, 'harvester', 1, 60, 63);
    foe.job = 'manual';
    run(sim, 60);
    expect(mine.hp).toBe(UNIT_DEFS.harvester.hp);
    expect(foe.hp).toBeLessThan(UNIT_DEFS.harvester.hp);
  });

  it('share what they can see', () => {
    const sim = new Sim(1, { seats: TWO_V_TWO.map((s) => ({ ...s, ai: false })) });
    const world = sim.world;
    const allyBase = cellIndex(BASES[3].x, BASES[3].y);
    const foeBase = cellIndex(BASES[1].x, BASES[1].y);
    expect(world.vision[0].visible[allyBase]).toBe(1);
    expect(world.vision[0].visible[foeBase]).toBe(0);
    expect(world.vision[1].visible[cellIndex(BASES[2].x, BASES[2].y)]).toBe(1);
  });

  it('win together, and only once every enemy is beaten', () => {
    const sim = new Sim(1, { seats: TWO_V_TWO.map((s) => ({ ...s, ai: false })) });
    const world = sim.world;
    world.ore.fill(0);
    const kill = (owner: number): void => {
      for (const b of world.buildings) if (b.owner === owner) b.hp = 0;
    };
    kill(1);
    run(sim, 5);
    expect(world.winner).toBe(-1);
    kill(2);
    run(sim, 5);
    // Team 0 wins, even though seat 3 did none of the work.
    expect(world.winner).toBe(0);
  });

  it('are every player for themselves in a free-for-all', () => {
    const sim = new Sim(1, { seats: FREE_FOR_ALL.map((s) => ({ ...s, ai: false })) });
    const world = sim.world;
    world.ore.fill(0);
    const a = spawnUnit(world, 'harvester', 2, 60, 60);
    a.job = 'manual';
    spawnUnit(world, 'tank', 3, 62, 60);
    run(sim, 100);
    expect(a.hp).toBeLessThan(UNIT_DEFS.harvester.hp);
    for (const owner of [1, 2]) for (const b of world.buildings) if (b.owner === owner) b.hp = 0;
    run(sim, 5);
    expect(world.winner).toBe(-1);
  });
});

describe('the satellite uplink', () => {
  const base = (): Sim => {
    const sim = new Sim(1, { seats: TWO_V_TWO.map((s) => ({ ...s, ai: false })) });
    sim.world.ore.fill(0);
    building(sim.world, 'power', 0, 20, 20);
    return sim;
  };
  const tech = (sim: Sim, owner = 0) => {
    const b = addBuilding(sim.world, 'tech', owner, owner === 0 ? 24 : 100, 20);
    b.progress = b.total;
    return b;
  };
  const far = cellIndex(70, 70);

  it('does nothing without a Tech Centre', () => {
    const sim = base();
    run(sim, 200);
    expect(sim.world.players[0].uplink).toBe(0);
  });

  it('takes two and a half minutes to come online, then shows the whole map', () => {
    const sim = base();
    tech(sim);
    run(sim, UPLINK_TICKS - 10);
    expect(uplinkOnline(sim.world, 0)).toBe(false);
    expect(sim.world.vision[0].visible[far]).toBe(0);
    let announced = false;
    run(sim, 20, () => {
      if (sim.events.some((e) => e.type === 'uplinkOnline' && e.player === 0)) announced = true;
    });
    expect(announced).toBe(true);
    expect(uplinkOnline(sim.world, 0)).toBe(true);
    expect(sim.world.vision[0].visible.every((v) => v === 1)).toBe(true);
    expect(UPLINK_TICKS / 20 / 60).toBe(2.5);
  });

  it('is shared with allies but not with enemies', () => {
    const sim = base();
    tech(sim);
    run(sim, UPLINK_TICKS + 10);
    expect(sim.world.vision[3].visible[far]).toBe(1);
    expect(sim.world.vision[1].visible[far]).toBe(0);
    expect(sim.world.vision[2].visible[far]).toBe(0);
  });

  it('stops charging while the base is short of power', () => {
    const sim = base();
    tech(sim);
    for (let i = 0; i < 4; i++) {
      const b = addBuilding(sim.world, 'barracks', 0, 30 + i * 3, 30);
      b.progress = b.total;
    }
    run(sim, 300);
    expect(sim.world.players[0].uplink).toBe(0);
    building(sim.world, 'power', 0, 20, 26);
    run(sim, 300);
    expect(sim.world.players[0].uplink).toBe(300);
  });

  it('goes dark and starts again if the Tech Centre is lost', () => {
    const sim = base();
    const centre = tech(sim);
    run(sim, UPLINK_TICKS + 10);
    centre.hp = 0;
    run(sim, 10);
    expect(uplinkOnline(sim.world, 0)).toBe(false);
    expect(sim.world.players[0].uplink).toBe(0);
    expect(sim.world.vision[0].visible[far]).toBe(0);
    // What was seen stays on the map, as remembered ground.
    expect(sim.world.vision[0].explored[far]).toBe(1);
  });
});

describe('four computers', () => {
  it('can play a team game through without breaking the rules', () => {
    const sim = new Sim(6, { terrain: true, seats: TWO_V_TWO });
    const world = sim.world;
    run(sim, 30000, () => {
      if (world.tick % 40 !== 0) return;
      const held = new Set<number>();
      for (const u of world.units) {
        for (const c of u.stepTo === -1 ? [u.cell] : [u.cell, u.stepTo]) {
          expect(held.has(c)).toBe(false);
          held.add(c);
          expect(world.terrain[c]).toBe(GRASS);
        }
      }
    });
    // One player may be knocked out while their ally fights on, so check by team:
    // until the game is decided, each side must still have something standing.
    if (world.winner === -1) {
      for (const team of [0, 1]) {
        expect(world.buildings.some((b) => world.players[b.owner].team === team)).toBe(true);
      }
    }
    expect(world.ai.reduce((a, s) => a + (s ? s.wave : 0), 0)).toBeGreaterThan(0);
  });

  it('give the same free-for-all every time', () => {
    const play = (): number => {
      const sim = new Sim(8, { terrain: true, seats: FREE_FOR_ALL });
      run(sim, 5000);
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});
