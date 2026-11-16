// The browser's connection to a game room.

import {
  HASH_EVERY,
  TURN_TICKS,
  type ClientMessage,
  type LobbyPlayer,
  type Mode,
  type ServerMessage,
  type StartInfo,
} from './protocol';
import type { Command, Faction, MapKind } from '../sim/types';

export interface Lobby {
  code: string;
  you: number;
  mode: Mode;
  map: MapKind;
  players: LobbyPlayer[];
}

/** Where the room server lives. Normally the same place the game was loaded from. */
function serverAddress(): string {
  const given = new URLSearchParams(location.search).get('server');
  if (given) return given;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export class RoomClient {
  private socket: WebSocket;
  /** Turns received from the server and not yet played, by turn number. */
  private turns = new Map<number, Command[]>();
  /** Seats whose player has dropped out of the game. */
  readonly left = new Set<number>();
  /** Set if the players' games are found to have drifted apart. */
  desynced = false;
  closed = false;

  onLobby: (lobby: Lobby) => void = () => {};
  onStart: (you: number, info: StartInfo) => void = () => {};
  onError: (message: string) => void = () => {};

  constructor(code: string) {
    const address = serverAddress();
    this.socket = new WebSocket(`${address}${address.includes('?') ? '&' : '?'}room=${code}`);
    this.socket.addEventListener('message', (event) => this.receive(JSON.parse(String(event.data)) as ServerMessage));
    this.socket.addEventListener('close', () => {
      this.closed = true;
      this.onError('The connection to the game was lost');
    });
    this.socket.addEventListener('error', () => this.onError('Could not reach the game server'));
  }

  private receive(message: ServerMessage): void {
    switch (message.t) {
      case 'lobby':
        this.onLobby(message);
        break;
      case 'start':
        this.onStart(message.you, message.info);
        break;
      case 'turn':
        this.turns.set(message.n, message.cmds);
        break;
      case 'left':
        this.left.add(message.seat);
        break;
      case 'desync':
        this.desynced = true;
        break;
      case 'error':
        this.onError(message.message);
        break;
    }
  }

  private send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  chooseFaction(faction: Faction): void {
    this.send({ t: 'faction', faction });
  }

  chooseMode(mode: Mode): void {
    this.send({ t: 'mode', mode });
  }

  chooseMap(map: MapKind): void {
    this.send({ t: 'map', map });
  }

  start(): void {
    this.send({ t: 'start' });
  }

  /** Sends an order to the room. It takes effect when it comes back in a turn, for everyone at once. */
  order(cmd: Command): void {
    this.send({ t: 'cmd', cmd });
  }

  /** True if the game may advance past this tick: either it is mid-turn, or the next turn has arrived. */
  ready(tick: number): boolean {
    return tick % TURN_TICKS !== 0 || this.turns.has(tick / TURN_TICKS);
  }

  /** How many turns are waiting to be played. A growing number means this machine is falling behind. */
  get backlog(): number {
    return this.turns.size;
  }

  /** The orders for the turn that starts on this tick. Call once, at the start of each turn. */
  take(tick: number): Command[] {
    const turn = tick / TURN_TICKS;
    const cmds = this.turns.get(turn) ?? [];
    this.turns.delete(turn);
    return cmds;
  }

  /** Reports this machine's game state now and then, so the server can check everyone still matches. */
  report(tick: number, hash: () => number): void {
    const turn = tick / TURN_TICKS;
    if (tick % TURN_TICKS === 0 && turn % HASH_EVERY === 0) this.send({ t: 'hash', turn, hash: hash() });
  }
}
