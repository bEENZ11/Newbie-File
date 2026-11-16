// The messages that pass between a player's browser and the room server.
//
// The server does not run the game. Every player's machine runs the same
// simulation, and the server's only jobs are to gather everyone's orders and
// hand them back in the same order to everybody, a turn at a time. Because the
// simulation is deterministic, the games stay identical.

import type { Command, Difficulty, Faction, MapKind } from '../sim/types';

/** Simulation ticks in one network turn. Orders take effect at the start of a turn. */
export const TURN_TICKS = 2;
/** How often the server sends out a turn, in milliseconds. Matches TURN_TICKS at twenty ticks a second. */
export const TURN_MS = 100;
/** How many turns pass between each check that every player's game still matches. */
export const HASH_EVERY = 20;
export const MAX_PLAYERS = 4;

export type Mode = 'duel' | 'teams' | 'ffa';

export interface LobbyPlayer {
  seat: number;
  faction: Faction;
  host: boolean;
}

export interface StartInfo {
  seed: number;
  mode: Mode;
  map: MapKind;
  difficulty: Difficulty;
  /** One entry per seat. Seats nobody is sitting in are played by the computer. */
  seats: { faction: Faction; team: number; ai: boolean }[];
}

export type ClientMessage =
  | { t: 'faction'; faction: Faction }
  | { t: 'mode'; mode: Mode }
  | { t: 'map'; map: MapKind }
  | { t: 'start' }
  | { t: 'cmd'; cmd: Command }
  | { t: 'hash'; turn: number; hash: number };

export type ServerMessage =
  | { t: 'lobby'; code: string; you: number; mode: Mode; map: MapKind; players: LobbyPlayer[] }
  | { t: 'start'; you: number; info: StartInfo }
  | { t: 'turn'; n: number; cmds: Command[] }
  | { t: 'left'; seat: number }
  | { t: 'desync'; turn: number }
  | { t: 'error'; message: string };
