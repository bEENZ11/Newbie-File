// The colours each side wears. Every player has a palette, taken from their
// faction. If both players pick the same faction, the second gets that
// faction's alternate colours so the two armies can still be told apart.

import type { Faction } from '../sim/types';

export interface Palette {
  main: number;
  dark: number;
  light: number;
}

// Four shades each, so a game of four can have every seat in the same faction
// and the armies can still be told apart.
const FACTION_PALETTES: Record<Faction, Palette[]> = {
  aegis: [
    { main: 0x3f86e0, dark: 0x24569c, light: 0x9cc4f7 },
    { main: 0x2fa7a0, dark: 0x1b6b66, light: 0x9be0da },
    { main: 0x7a6be0, dark: 0x4a3fa0, light: 0xc9c2f7 },
    { main: 0xa9bccd, dark: 0x66798c, light: 0xe8eef4 },
  ],
  dominion: [
    { main: 0xd8483c, dark: 0x8f2a22, light: 0xf5a59c },
    { main: 0xe08a2e, dark: 0x93561a, light: 0xf6c990 },
    { main: 0xd2ad36, dark: 0x8a6f1e, light: 0xf3e0a0 },
    { main: 0xc8418f, dark: 0x7f255a, light: 0xf0a9d0 },
  ],
};

/** One palette per player, in player order. */
export const palettes: Palette[] = [FACTION_PALETTES.aegis[0], FACTION_PALETTES.dominion[0]];

/** Works out each player's colours from the factions in play. Call before anything is drawn. */
export function setFactions(factions: readonly Faction[]): void {
  palettes.length = 0;
  factions.forEach((faction, player) => {
    // Each player takes the next shade of their faction that nobody before them has.
    const earlier = factions.slice(0, player).filter((f) => f === faction).length;
    palettes.push(FACTION_PALETTES[faction][earlier % FACTION_PALETTES[faction].length]);
  });
}

/** A palette colour as a CSS string, for the interface. */
export const css = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

/** A palette colour as red, green and blue from 0 to 255, for the radar map. */
export const rgb = (colour: number): [number, number, number] => [
  (colour >> 16) & 255,
  (colour >> 8) & 255,
  colour & 255,
];
