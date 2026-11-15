// What each player can currently see, and what they have ever seen.

import { BUILDING_SIGHT, MAP_H, MAP_W, UNIT_DEFS, cellIndex, type World } from './types';

/** How many ticks pass between refreshes. Sight does not need to be instant. */
export const VISION_INTERVAL = 4;

function reveal(visible: Uint8Array, cx: number, cy: number, radius: number): void {
  const r2 = radius * radius + radius;
  const y0 = Math.max(0, cy - radius);
  const y1 = Math.min(MAP_H - 1, cy + radius);
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(MAP_W - 1, cx + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) visible[cellIndex(x, y)] = 1;
    }
  }
}

export function updateVision(world: World): void {
  world.vision.forEach((v, player) => {
    v.visible.fill(0);
    for (const u of world.units) {
      if (u.owner !== player) continue;
      const x = u.cell % MAP_W;
      reveal(v.visible, x, (u.cell - x) / MAP_W, UNIT_DEFS[u.type].sight);
    }
    for (const b of world.buildings) {
      if (b.owner !== player) continue;
      // Walls are not lookouts. They see only the ground beside them.
      const sight = b.type === 'wall' ? 1 : BUILDING_SIGHT + (b.w >> 1);
      reveal(v.visible, b.cx + (b.w >> 1), b.cy + (b.h >> 1), sight);
    }
    for (let i = 0; i < v.visible.length; i++) if (v.visible[i]) v.explored[i] = 1;
  });
}
