// Paints the ground texture: grass with dry and lush patches, forest floor,
// bare rock, and lakes with sandy shores. The desert map swaps the grass for
// sand, with scrub where the woods would be and green banks round its pools. Everything is blended smoothly
// across cell boundaries so the map reads as land, not as a grid.

import { MAP_H, MAP_W, ROCK, TREES, WATER, type MapKind } from '../sim/types';

type RGB = readonly [number, number, number];

const GRASS_A: RGB = [70, 102, 46];
const GRASS_B: RGB = [96, 124, 56];
const DRY: RGB = [136, 128, 72];
const FOREST: RGB = [44, 70, 38];
const STONE: RGB = [122, 116, 106];
const STONE_DARK: RGB = [86, 82, 76];
const SAND: RGB = [182, 166, 116];
const SHALLOW: RGB = [62, 138, 156];
const DEEP: RGB = [26, 72, 120];

/** The colours that change from one kind of map to another. */
interface Theme {
  groundA: RGB;
  groundB: RGB;
  patch: RGB;
  woods: RGB;
  stone: RGB;
  stoneDark: RGB;
  shore: RGB;
}
const GREEN: Theme = { groundA: GRASS_A, groundB: GRASS_B, patch: DRY, woods: FOREST, stone: STONE, stoneDark: STONE_DARK, shore: SAND };
const DESERT: Theme = {
  groundA: [206, 176, 118],
  groundB: [224, 198, 140],
  patch: [186, 146, 96],
  woods: [128, 136, 72],
  stone: [164, 128, 96],
  stoneDark: [112, 84, 66],
  // Pools in the desert have green banks.
  shore: [110, 138, 70],
};

function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263 + salt * 2246822519, 3266489917);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Smoothly varying noise between 0 and 1. */
function smooth(x: number, y: number, salt: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, salt);
  const b = hash(ix + 1, iy, salt);
  const c = hash(ix, iy + 1, salt);
  const d = hash(ix + 1, iy + 1, salt);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Several layers of noise at different scales, for a natural, cloudy look. */
function clouds(x: number, y: number, salt: number): number {
  return (smooth(x, y, salt) + smooth(x * 2.1, y * 2.1, salt + 1) * 0.5 + smooth(x * 4.3, y * 4.3, salt + 2) * 0.25) / 1.75;
}

const step = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function paintGround(terrain: Uint8Array, texels: number, map: MapKind = 'lakes'): HTMLCanvasElement {
  const theme = map === 'desert' ? DESERT : GREEN;
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W * texels;
  canvas.height = MAP_H * texels;
  const g = canvas.getContext('2d')!;
  const image = g.createImageData(canvas.width, canvas.height);
  const data = image.data;

  // How strongly a ground type is present at a point, blended between cell centres.
  const presence = (type: number, u: number, v: number): number => {
    const fx = u - 0.5;
    const fy = v - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const at = (x: number, y: number): number => {
      const cx = Math.min(MAP_W - 1, Math.max(0, x));
      const cy = Math.min(MAP_H - 1, Math.max(0, y));
      return terrain[cy * MAP_W + cx] === type ? 1 : 0;
    };
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
    const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
    return top + (bottom - top) * ty;
  };

  const c = [0, 0, 0];
  const mix = (to: RGB, t: number): void => {
    c[0] += (to[0] - c[0]) * t;
    c[1] += (to[1] - c[1]) * t;
    c[2] += (to[2] - c[2]) * t;
  };

  for (let py = 0; py < canvas.height; py++) {
    for (let px = 0; px < canvas.width; px++) {
      const u = (px + 0.5) / texels;
      const v = (py + 0.5) / texels;
      // Wobble the lookup so shorelines and rock edges wander instead of following the grid.
      const wu = u + (smooth(u * 0.9, v * 0.9, 7) - 0.5) * 0.8;
      const wv = v + (smooth(u * 0.9, v * 0.9, 8) - 0.5) * 0.8;

      c[0] = theme.groundA[0];
      c[1] = theme.groundA[1];
      c[2] = theme.groundA[2];
      mix(theme.groundB, clouds(u * 0.16, v * 0.16, 1));
      mix(theme.patch, step(0.56, 0.74, clouds(u * 0.09, v * 0.09, 20)) * 0.55);

      const trees = presence(TREES, wu, wv);
      if (trees > 0.05) mix(theme.woods, step(0.15, 0.6, trees));

      const rock = presence(ROCK, wu, wv);
      if (rock > 0.05) {
        const grain = clouds(u * 1.4, v * 1.4, 30);
        const blend = step(0.28, 0.55, rock);
        mix([
          theme.stoneDark[0] + (theme.stone[0] - theme.stoneDark[0]) * grain,
          theme.stoneDark[1] + (theme.stone[1] - theme.stoneDark[1]) * grain,
          theme.stoneDark[2] + (theme.stone[2] - theme.stoneDark[2]) * grain,
        ], blend);
      }

      const water = presence(WATER, wu, wv);
      if (water > 0.2) {
        mix(theme.shore, step(0.22, 0.4, water));
        if (water > 0.42) {
          const depth = step(0.5, 0.9, water);
          const ripple = (smooth(u * 2.2, v * 5.5, 40) - 0.5) * 14;
          mix([
            SHALLOW[0] + (DEEP[0] - SHALLOW[0]) * depth + ripple,
            SHALLOW[1] + (DEEP[1] - SHALLOW[1]) * depth + ripple,
            SHALLOW[2] + (DEEP[2] - SHALLOW[2]) * depth + ripple,
          ], step(0.42, 0.5, water));
        }
      }

      // Fine grain, so nothing looks like flat paint up close.
      const grain = 0.93 + hash(px, py, 50) * 0.14;
      const i = (py * canvas.width + px) * 4;
      data[i] = c[0] * grain;
      data[i + 1] = c[1] * grain;
      data[i + 2] = c[2] * grain;
      data[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  return canvas;
}
