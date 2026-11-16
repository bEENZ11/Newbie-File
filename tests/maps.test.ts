import { describe, expect, it } from 'vitest';
import { findPath } from '../src/sim/pathfinding';
import { Sim } from '../src/sim/sim';
import { canTrain } from '../src/sim/training';
import {
  BUILDING_DEFS,
  GRASS,
  HARVEST_CAPACITY,
  MAP_H,
  MAP_W,
  ROCK,
  TREES,
  UNIT_DEFS,
  WATER,
  cellIndex,
  type BuildingType,
  type MapKind,
} from '../src/sim/types';
import { BASES, GEM_CELL, ORE_CELL, addBuilding, type Seat } from '../src/sim/world';

const FOUR: Seat[] = [0, 1, 2, 3].map((team) => ({ faction: team % 2 ? 'dominion' : 'aegis', team, ai: false }));
const make = (map: MapKind, seed: number): Sim => new Sim(seed, { terrain: true, map, seats: FOUR, pioneers: true });
const share = (sim: Sim, type: number): number => sim.world.terrain.filter((t) => t === type).length / (MAP_W * MAP_H);
const run = (sim: Sim, n: number): void => {
  for (let i = 0; i < n; i++) sim.step();
};
function grant(sim: Sim, type: BuildingType, x: number, y: number) {
  const b = addBuilding(sim.world, type, 0, x, y);
  b.progress = b.total;
  return b;
}

describe('every map', () => {
  it('lets all four corners reach each other by land', () => {
    for (const map of ['lakes', 'islands', 'desert'] as const) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const world = make(map, seed).world;
        for (const b of BASES.slice(1)) {
          const route = findPath(world.blocked, MAP_W, MAP_H, cellIndex(BASES[0].x, BASES[0].y - 3), b.x, b.y - 3);
          expect(route[route.length - 1]).toBe(cellIndex(b.x, b.y - 3));
        }
      }
    }
  });

  it('gives every corner room to build and ore within reach', () => {
    for (const map of ['lakes', 'islands', 'desert'] as const) {
      const world = make(map, 3).world;
      for (const b of BASES) {
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) expect(world.terrain[cellIndex(b.x + dx, b.y + dy)]).toBe(GRASS);
        const near = world.ore.some((o, i) => o > 0 && Math.abs((i % MAP_W) - b.x) < 14 && Math.abs(Math.floor(i / MAP_W) - b.y) < 14);
        expect(near).toBe(true);
      }
    }
  });
});

describe('the island map', () => {
  it('is mostly sea, with an island for each corner and one in the middle', () => {
    const sim = make('islands', 2);
    expect(share(sim, WATER)).toBeGreaterThan(0.45);
    expect(sim.world.terrain[cellIndex(MAP_W >> 1, MAP_H >> 1)]).toBe(GRASS);
    // Open water between a corner island and the centre, off the causeway.
    expect(sim.world.terrain[cellIndex(60, 22)]).toBe(WATER);
  });

  it('keeps all its gems on the middle island', () => {
    const world = make('islands', 2).world;
    let gems = 0;
    world.rich.forEach((r, i) => {
      if (!r || world.ore[i] <= 0) return;
      gems++;
      expect(Math.abs((i % MAP_W) - (MAP_W >> 1))).toBeLessThanOrEqual(8);
      expect(Math.abs(Math.floor(i / MAP_W) - (MAP_H >> 1))).toBeLessThanOrEqual(8);
    });
    expect(gems).toBeGreaterThan(60);
  });

  it('joins the islands only by narrow strips', () => {
    const world = make('islands', 2).world;
    // Half way along the causeway from the north-west island to the centre, measure the land's width.
    const mx = (BASES[0].x + (MAP_W >> 1)) >> 1;
    const my = (BASES[0].y + (MAP_H >> 1)) >> 1;
    let width = 0;
    for (let d = -10; d <= 10; d++) if (world.terrain[cellIndex(mx + d, my - d)] !== WATER) width++;
    expect(width).toBeGreaterThanOrEqual(2);
    expect(width).toBeLessThanOrEqual(6);
  });
});

describe('the desert map', () => {
  it('has only small pools, and a great deal of rock and scrub', () => {
    for (const seed of [1, 4, 7]) {
      const sim = make('desert', seed);
      expect(share(sim, WATER)).toBeLessThan(0.03);
      expect(share(sim, WATER)).toBeGreaterThan(0.002);
      expect(share(sim, ROCK)).toBeGreaterThan(0.02);
      expect(share(sim, TREES)).toBeGreaterThan(0.02);
      expect(sim.world.map).toBe('desert');
    }
  });
});

describe('ore', () => {
  it('holds less in a cell than a harvester carries, so fields shrink as they are worked', () => {
    expect(ORE_CELL).toBeLessThan(HARVEST_CAPACITY);
    const world = make('lakes', 5).world;
    world.ore.forEach((o, i) => expect(o).toBeLessThanOrEqual(world.rich[i] ? GEM_CELL : ORE_CELL));
  });
});

describe('expanding', () => {
  const base = (): Sim => {
    const sim = new Sim(1);
    sim.world.ore.fill(0);
    grant(sim, 'conyard', 20, 20);
    grant(sim, 'power', 24, 20);
    grant(sim, 'power', 24, 23);
    grant(sim, 'factory', 27, 20);
    grant(sim, 'barracks', 31, 20);
    return sim;
  };

  it('lets a Service Depot unlock more Pioneers, which become more Construction Yards', () => {
    const sim = base();
    expect(canTrain(sim.world, 0, 'pioneer')).toBe(false);
    grant(sim, 'depot', 20, 26);
    expect(canTrain(sim.world, 0, 'pioneer')).toBe(true);
    sim.world.players[0].credits = 10000;
    sim.issue({ type: 'train', player: 0, unit: 'pioneer' });
    run(sim, UNIT_DEFS.pioneer.produceTicks + 60);
    const pioneer = sim.world.units.find((u) => u.type === 'pioneer' && u.id !== 1)!;
    expect(pioneer).toBeDefined();
    expect(sim.world.players[0].credits).toBe(10000 - UNIT_DEFS.pioneer.cost);
    sim.issue({ type: 'move', player: 0, unitIds: [pioneer.id], cx: 40, cy: 40 });
    run(sim, 500);
    sim.issue({ type: 'deploy', player: 0, unitId: pioneer.id });
    run(sim, 60);
    expect(sim.world.buildings.filter((b) => b.type === 'conyard' && b.owner === 0)).toHaveLength(2);
  });

  it('builds half as fast again with a second Construction Yard', () => {
    const time = (yards: number): number => {
      const sim = base();
      for (let i = 1; i < yards; i++) grant(sim, 'conyard', 20 + i * 20, 40);
      sim.issue({ type: 'build', player: 0, building: 'refinery' });
      for (let t = 1; t < 2000; t++) {
        sim.step();
        if (sim.world.players[0].production?.state === 'ready') return t;
      }
      return Infinity;
    };
    const one = time(1);
    expect(one).toBe(BUILDING_DEFS.refinery.produceTicks);
    expect(time(2)).toBe(Math.ceil((one * 2) / 3));
    expect(time(3)).toBe(one / 2);
    // Four is the most that count.
    expect(time(6)).toBe(time(4));
  });

  it('trains infantry faster with more Barracks, and vehicles faster with more War Factories', () => {
    const time = (extra: BuildingType | null, unit: 'rifleman' | 'tank'): number => {
      const sim = new Sim(1, { factions: ['dominion', 'aegis'] });
      sim.world.ore.fill(0);
      grant(sim, 'conyard', 20, 20);
      for (let i = 0; i < 3; i++) grant(sim, 'power', 24 + i * 3, 30);
      grant(sim, 'factory', 27, 20);
      grant(sim, 'barracks', 31, 20);
      if (extra) grant(sim, extra, 40, 40);
      sim.issue({ type: 'train', player: 0, unit });
      for (let t = 1; t < 2000; t++) {
        sim.step();
        if (sim.world.units.some((u) => u.type === unit)) return t;
      }
      return Infinity;
    };
    expect(time('barracks', 'rifleman')).toBeLessThan(time(null, 'rifleman'));
    expect(time('factory', 'tank')).toBeLessThan(time(null, 'tank'));
    // One kind of building does not speed up the other's work.
    expect(time('barracks', 'tank')).toBe(time(null, 'tank'));
  });
});
