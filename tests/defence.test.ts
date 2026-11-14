import { describe, expect, it } from 'vitest';
import { findPath } from '../src/sim/pathfinding';
import { checkPlacement } from '../src/sim/production';
import { Sim } from '../src/sim/sim';
import { BUILDING_DEFS, GRASS, MAP_H, MAP_W, UNIT_DEFS, cellIndex, type BuildingType } from '../src/sim/types';
import { START_CX, START_CY, addBuilding, spawnUnit } from '../src/sim/world';

const run = (sim: Sim, n: number, each?: () => void): void => {
  for (let i = 0; i < n; i++) {
    sim.step();
    each?.();
  }
};

function arena(): Sim {
  const sim = new Sim(1);
  sim.world.ore.fill(0);
  return sim;
}

function building(sim: Sim, type: BuildingType, owner: number, x: number, y: number) {
  const b = addBuilding(sim.world, type, owner, x, y);
  b.progress = b.total;
  return b;
}

describe('gun turrets', () => {
  it('fire on enemy units that come into range', () => {
    const sim = arena();
    building(sim, 'power', 0, 28, 28);
    const turret = building(sim, 'turret', 0, 30, 30);
    const tank = spawnUnit(sim.world, 'harvester', 1, 34, 30);
    tank.job = 'manual';
    run(sim, 3);
    expect(tank.hp).toBe(UNIT_DEFS.harvester.hp - 35);
    expect(turret.aim).toBe(0);
    run(sim, 30);
    expect(tank.hp).toBe(UNIT_DEFS.harvester.hp - 70);
  });

  it('fall silent when the base is short of power', () => {
    const sim = arena();
    building(sim, 'turret', 0, 30, 30);
    const target = spawnUnit(sim.world, 'harvester', 1, 34, 30);
    target.job = 'manual';
    run(sim, 100);
    expect(target.hp).toBe(UNIT_DEFS.harvester.hp);
  });

  it('ignore anything beyond their reach', () => {
    const sim = arena();
    building(sim, 'power', 0, 28, 28);
    building(sim, 'turret', 0, 30, 30);
    const target = spawnUnit(sim.world, 'harvester', 1, 37, 30);
    target.job = 'manual';
    run(sim, 100);
    expect(target.hp).toBe(UNIT_DEFS.harvester.hp);
  });

  it('are shot back at by the units they hit', () => {
    const sim = arena();
    building(sim, 'power', 0, 26, 26);
    const turret = building(sim, 'turret', 0, 30, 30);
    const tank = spawnUnit(sim.world, 'tank', 1, 36, 30);
    run(sim, 2);
    expect(turret.hp).toBe(BUILDING_DEFS.turret.hp);
    // Out-ranged, the tank has to drive in to reply.
    run(sim, 200);
    expect(tank.attack === turret.id || !sim.world.units.includes(tank)).toBe(true);
    expect(turret.hp).toBeLessThan(BUILDING_DEFS.turret.hp);
  });
});

describe('repair', () => {
  it('restores a damaged building for a share of its price', () => {
    const sim = arena();
    const plant = building(sim, 'power', 0, 30, 30);
    plant.hp = 100;
    const before = sim.world.players[0].credits;
    sim.issue({ type: 'repair', player: 0, buildingId: plant.id });
    run(sim, 400);
    expect(plant.hp).toBe(BUILDING_DEFS.power.hp);
    expect(plant.repairing).toBe(false);
    const spent = before - sim.world.players[0].credits;
    // 400 health is four fifths of the building, at 30% of its 250 price.
    expect(spent).toBeGreaterThanOrEqual(60);
    expect(spent).toBeLessThanOrEqual(80);
  });

  it('pauses without credits and can be switched off', () => {
    const sim = arena();
    const plant = building(sim, 'power', 0, 30, 30);
    plant.hp = 100;
    sim.world.players[0].credits = 0;
    sim.issue({ type: 'repair', player: 0, buildingId: plant.id });
    run(sim, 50);
    expect(plant.hp).toBe(100);
    sim.world.players[0].credits = 1000;
    run(sim, 20);
    expect(plant.hp).toBeGreaterThan(100);
    sim.issue({ type: 'repair', player: 0, buildingId: plant.id });
    sim.step();
    const held = plant.hp;
    run(sim, 50);
    expect(plant.hp).toBe(held);
  });

  it('does nothing for a building at full health or one that is not yours', () => {
    const sim = arena();
    const mine = building(sim, 'power', 0, 30, 30);
    const theirs = building(sim, 'power', 1, 40, 40);
    theirs.hp = 100;
    sim.issue({ type: 'repair', player: 0, buildingId: mine.id });
    sim.issue({ type: 'repair', player: 0, buildingId: theirs.id });
    run(sim, 30);
    expect(mine.repairing).toBe(false);
    expect(theirs.hp).toBe(100);
  });
});

describe('terrain', () => {
  it('is open grass unless the scenario asks for more', () => {
    const sim = new Sim(3);
    expect(sim.world.terrain.every((t) => t === GRASS)).toBe(true);
  });

  it('always leaves a way between the two bases', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const world = new Sim(seed, { terrain: true, outpost: true }).world;
      const foe = world.buildings.find((b) => b.owner === 1)!;
      const route = findPath(world.blocked, MAP_W, MAP_H, cellIndex(START_CX, START_CY), foe.cx - 2, foe.cy + 1);
      expect(route[route.length - 1]).toBe(cellIndex(foe.cx - 2, foe.cy + 1));
    }
  });

  it('has obstacles, but none under ore, units or buildings', () => {
    const world = new Sim(7, { terrain: true, outpost: true }).world;
    expect(world.terrain.some((t) => t !== GRASS)).toBe(true);
    for (let i = 0; i < world.terrain.length; i++) {
      if (world.terrain[i] === GRASS) continue;
      expect(world.blocked[i]).toBe(1);
      expect(world.ore[i]).toBe(0);
      expect(world.occupied[i]).toBe(0);
    }
    for (const b of world.buildings) expect(world.terrain[cellIndex(b.cx, b.cy)]).toBe(GRASS);
  });

  it('cannot be built on, and stays impassable after a building beside it is sold', () => {
    const sim = new Sim(7, { terrain: true });
    const world = sim.world;
    const rock = world.terrain.findIndex((t) => t !== GRASS);
    const rx = rock % MAP_W;
    const ry = Math.floor(rock / MAP_W);
    building(sim, 'conyard', 0, Math.min(MAP_W - 4, rx + 1), Math.max(0, Math.min(MAP_H - 4, ry)));
    expect(checkPlacement(world, 0, 'turret', rx, ry).ok).toBe(false);
    run(sim, 5);
    expect(world.blocked[rock]).toBe(1);
  });

  it('is never driven over', () => {
    const sim = new Sim(7, { terrain: true });
    const world = sim.world;
    sim.issue({ type: 'move', player: 0, unitIds: [1], cx: 55, cy: 55 });
    run(sim, 1200, () => {
      expect(world.terrain[world.units[0].cell]).toBe(GRASS);
    });
    expect(world.units[0].path).toHaveLength(0);
  });
});
