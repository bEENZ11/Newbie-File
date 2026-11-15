// The colours each side wears. Every player has a palette, taken from their
// faction. If both players pick the same faction, the second gets that
// faction's alternate colours so the two armies can still be told apart.

import type { Faction } from '../sim/types';

export interface Palette {
  main: number;
  dark: number;
  light: number;
}

const FACTION_PALETTES: Record<Faction, [Palette, Palette]> = {
  aegis: [
    { main: 0x3f86e0, dark: 0x24569c, light: 0x9cc4f7 },
    { main: 0x2fa7a0, dark: 0x1b6b66, light: 0x9be0da },
  ],
  dominion: [
    { main: 0xd8483c, dark: 0x8f2a22, light: 0xf5a59c },
    { main: 0xe08a2e, dark: 0x93561a, light: 0xf6c990 },
  ],
};

/** One palette per player, in player order. */
export const palettes: Palette[] = [FACTION_PALETTES.aegis[0], FACTION_PALETTES.dominion[0]];

/** Works out each player's colours from the factions in play. Call before anything is drawn. */
export function setFactions(factions: readonly Faction[]): void {
  factions.forEach((faction, player) => {
    const taken = factions.slice(0, player).includes(faction);
    palettes[player] = FACTION_PALETTES[faction][taken ? 1 : 0];
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
