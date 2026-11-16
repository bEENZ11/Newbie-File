// One game room: a lobby, then a relay for the players' orders.
//
// This file knows nothing about Cloudflare or Node. It is given a way to send
// a message to each connection, and told when connections arrive, speak and
// leave. That keeps it easy to test, and lets the same logic run in a
// Cloudflare Durable Object in production and a small Node server in development.

import {
  HASH_EVERY,
  MAX_PLAYERS,
  type ClientMessage,
  type LobbyPlayer,
  type Mode,
  type ServerMessage,
  type StartInfo,
} from '../src/net/protocol';
import type { Command, Faction, MapKind } from '../src/sim/types';

export interface Connection {
  send(message: ServerMessage): void;
}

interface Member {
  conn: Connection;
  seat: number;
  faction: Faction;
}

const FACTIONS: Faction[] = ['aegis', 'dominion'];
const MODES: Mode[] = ['duel', 'teams', 'ffa'];
const MAPS: MapKind[] = ['lakes', 'islands', 'desert'];

export class Room {
  private members: Member[] = [];
  private mode: Mode = 'duel';
  private map: MapKind = 'lakes';
  private started = false;
  private turn = 0;
  private pending: Command[] = [];
  /** The state hash each seat reported for a turn, to spot games drifting apart. */
  private hashes = new Map<number, Map<number, number>>();

  constructor(
    readonly code: string,
    private random: () => number = Math.random,
  ) {}

  get running(): boolean {
    return this.started;
  }

  get empty(): boolean {
    return this.members.length === 0;
  }

  private member(conn: Connection): Member | undefined {
    return this.members.find((m) => m.conn === conn);
  }

  /** The lowest seat nobody is sitting in. The first to arrive is the host. */
  private freeSeat(): number {
    for (let s = 0; s < MAX_PLAYERS; s++) if (!this.members.some((m) => m.seat === s)) return s;
    return -1;
  }

  private get host(): number {
    return Math.min(...this.members.map((m) => m.seat));
  }

  private broadcast(message: ServerMessage): void {
    for (const m of this.members) m.conn.send(message);
  }

  private sendLobby(): void {
    const players: LobbyPlayer[] = this.members
      .map((m) => ({ seat: m.seat, faction: m.faction, host: m.seat === this.host }))
      .sort((a, b) => a.seat - b.seat);
    for (const m of this.members) {
      m.conn.send({ t: 'lobby', code: this.code, you: m.seat, mode: this.mode, map: this.map, players });
    }
  }

  join(conn: Connection): void {
    if (this.started) {
      conn.send({ t: 'error', message: 'That game has already started' });
      return;
    }
    const seat = this.freeSeat();
    if (seat === -1) {
      conn.send({ t: 'error', message: 'That game is full' });
      return;
    }
    // Alternate factions by default, so the first two players are on different sides.
    this.members.push({ conn, seat, faction: FACTIONS[seat % 2] });
    this.sendLobby();
  }

  leave(conn: Connection): void {
    const who = this.member(conn);
    if (!who) return;
    this.members = this.members.filter((m) => m !== who);
    if (this.started) this.broadcast({ t: 'left', seat: who.seat });
    else this.sendLobby();
  }

  receive(conn: Connection, message: ClientMessage): void {
    const who = this.member(conn);
    if (!who) return;
    switch (message.t) {
      case 'faction':
        if (this.started || !FACTIONS.includes(message.faction)) return;
        who.faction = message.faction;
        this.sendLobby();
        break;
      case 'mode':
        if (this.started || who.seat !== this.host || !MODES.includes(message.mode)) return;
        this.mode = message.mode;
        this.sendLobby();
        break;
      case 'map':
        if (this.started || who.seat !== this.host || !MAPS.includes(message.map)) return;
        this.map = message.map;
        this.sendLobby();
        break;
      case 'start':
        if (this.started || who.seat !== this.host) return;
        this.start();
        break;
      case 'cmd':
        if (!this.started || !message.cmd || typeof message.cmd !== 'object') return;
        // A player can only give orders for their own seat, whatever they claim.
        this.pending.push({ ...message.cmd, player: who.seat });
        break;
      case 'hash':
        if (this.started) this.checkHash(who.seat, message.turn, message.hash);
        break;
    }
  }

  private start(): void {
    const humans = new Map(this.members.map((m) => [m.seat, m]));
    // A duel has two seats. The other games always have four, with the
    // computer in any that nobody took.
    const count = this.mode === 'duel' ? Math.max(2, this.members.length > 2 ? 4 : 2) : MAX_PLAYERS;
    const mode: Mode = this.mode === 'duel' && count > 2 ? 'ffa' : this.mode;
    const seats = Array.from({ length: count }, (_, seat) => {
      const human = humans.get(seat);
      // In a team game the west (seats 0 and 3) plays the east (seats 1 and 2).
      const team = mode === 'teams' ? (seat === 0 || seat === 3 ? 0 : 1) : seat;
      return { faction: human?.faction ?? FACTIONS[seat % 2], team, ai: !human };
    });
    const info: StartInfo = {
      seed: 1 + Math.floor(this.random() * 0x7ffffffe),
      mode,
      map: this.map,
      difficulty: 'normal',
      seats,
    };
    this.started = true;
    this.turn = 0;
    for (const m of this.members) m.conn.send({ t: 'start', you: m.seat, info });
  }

  /** Called on a steady beat once the game is running. Sends out the orders gathered since the last one. */
  tick(): void {
    if (!this.started) return;
    this.broadcast({ t: 'turn', n: this.turn, cmds: this.pending });
    this.pending = [];
    this.turn++;
  }

  private checkHash(seat: number, turn: number, hash: number): void {
    if (turn % HASH_EVERY !== 0) return;
    let seen = this.hashes.get(turn);
    if (!seen) {
      seen = new Map();
      this.hashes.set(turn, seen);
      // Only the recent past matters, so forget anything older.
      for (const old of this.hashes.keys()) if (old < turn - HASH_EVERY * 10) this.hashes.delete(old);
    }
    seen.set(seat, hash);
    if (new Set(seen.values()).size > 1) this.broadcast({ t: 'desync', turn });
  }
}

/** A short code that is easy to read out, with no letters that look like numbers. */
export function roomCode(random: () => number = Math.random): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  return Array.from({ length: 4 }, () => letters[Math.floor(random() * letters.length)]).join('');
}
