import type { World } from './types';

/** Mulberry32. Integer-only, so every browser produces the same sequence. */
export function nextRandom(world: World): number {
  let t = (world.rng = (world.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** A whole number from 0 up to, but not including, n. */
export function randInt(world: World, n: number): number {
  return nextRandom(world) % n;
}
