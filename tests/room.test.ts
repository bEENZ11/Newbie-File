import { describe, expect, it } from 'vitest';
import { Room, roomCode, type Connection } from '../server/room';
import { HASH_EVERY, type ServerMessage } from '../src/net/protocol';
import { Sim } from '../src/sim/sim';
import type { Command } from '../src/sim/types';

/** A pretend player: remembers everything the room sends it. */
function player(): Connection & { got: ServerMessage[]; last: <T extends ServerMessage['t']>(t: T) => Extract<ServerMessage, { t: T }> } {
  const got: ServerMessage[] = [];
  return {
    got,
    send: (m) => got.push(m),
    last: (t) => [...got].reverse().find((m) => m.t === t) as never,
  };
}

const move = (claimedPlayer: number): Command => ({ type: 'move', player: claimedPlayer, unitIds: [1], cx: 5, cy: 5 });

describe('a room', () => {
  it('seats players in order and makes the first one host', () => {
    const room = new Room('ABCD');
    const a = player();
    const b = player();
    room.join(a);
    room.join(b);
    const lobby = b.last('lobby');
    expect(lobby.code).toBe('ABCD');
    expect(lobby.you).toBe(1);
    expect(lobby.players.map((p) => [p.seat, p.host])).toEqual([[0, true], [1, false]]);
    expect(a.last('lobby').you).toBe(0);
  });

  it('turns away a fifth player, and anyone arriving after the start', () => {
    const room = new Room('ABCD');
    const five = [player(), player(), player(), player(), player()];
    five.forEach((p) => room.join(p));
    expect(five[4].last('error').message).toMatch(/full/);
    room.receive(five[0], { t: 'start' });
    const late = player();
    room.join(late);
    expect(late.last('error').message).toMatch(/started/);
  });

  it('lets players pick a faction, but only the host pick the game or start it', () => {
    const room = new Room('ABCD');
    const a = player();
    const b = player();
    room.join(a);
    room.join(b);
    room.receive(b, { t: 'faction', faction: 'aegis' });
    room.receive(b, { t: 'mode', mode: 'ffa' });
    room.receive(b, { t: 'start' });
    expect(a.last('lobby').players[1].faction).toBe('aegis');
    expect(a.last('lobby').mode).toBe('duel');
    expect(room.running).toBe(false);
    room.receive(a, { t: 'mode', mode: 'teams' });
    room.receive(a, { t: 'start' });
    expect(room.running).toBe(true);
  });

  it('starts everyone with the same game, and tells each which seat is theirs', () => {
    const room = new Room('ABCD', () => 0.5);
    const a = player();
    const b = player();
    room.join(a);
    room.join(b);
    room.receive(a, { t: 'start' });
    const sa = a.last('start');
    const sb = b.last('start');
    expect([sa.you, sb.you]).toEqual([0, 1]);
    expect(sa.info).toEqual(sb.info);
    expect(sa.info.seats).toEqual([
      { faction: 'aegis', team: 0, ai: false },
      { faction: 'dominion', team: 1, ai: false },
    ]);
  });

  it('fills empty seats with the computer in a four-player game', () => {
    const room = new Room('ABCD');
    const a = player();
    const b = player();
    room.join(a);
    room.join(b);
    room.receive(a, { t: 'mode', mode: 'teams' });
    room.receive(a, { t: 'start' });
    const seats = a.last('start').info.seats;
    expect(seats.map((s) => s.ai)).toEqual([false, false, true, true]);
    expect(seats.map((s) => s.team)).toEqual([0, 1, 1, 0]);
  });

  it('lets only the host choose the map, and starts everyone on it', () => {
    const room = new Room('ABCD');
    const a = player();
    const b = player();
    room.join(a);
    room.join(b);
    expect(a.last('lobby').map).toBe('lakes');
    room.receive(b, { t: 'map', map: 'desert' });
    expect(a.last('lobby').map).toBe('lakes');
    room.receive(a, { t: 'map', map: 'islands' });
    expect(b.last('lobby').map).toBe('islands');
    room.receive(a, { t: 'start' });
    expect(b.last('start').info.map).toBe('islands');
  });

  it('hands every player the same orders, in the same turn, in the same order', () => {
    const room = new Room('ABCD');
    const a = player();
    const b = player();
    room.join(a);
    room.join(b);
    room.receive(a, { t: 'start' });
    room.receive(b, { t: 'cmd', cmd: move(1) });
    room.receive(a, { t: 'cmd', cmd: move(0) });
    room.tick();
    room.tick();
    const turns = (p: ReturnType<typeof player>) => p.got.filter((m) => m.t === 'turn');
    expect(turns(a)).toEqual(turns(b));
    expect(turns(a).map((t) => (t.t === 'turn' ? [t.n, t.cmds.map((c) => c.player)] : null))).toEqual([
      [0, [1, 0]],
      [1, []],
    ]);
  });

  it('never lets a player give orders for someone else', () => {
    const room = new Room('ABCD');
    const a = player();
    const b = player();
    room.join(a);
    room.join(b);
    room.receive(a, { t: 'start' });
    room.receive(b, { t: 'cmd', cmd: move(0) });
    room.tick();
    expect(a.last('turn').cmds[0].player).toBe(1);
  });

  it('ignores orders before the game has started', () => {
    const room = new Room('ABCD');
    const a = player();
    room.join(a);
    room.receive(a, { t: 'cmd', cmd: move(0) });
    room.receive(a, { t: 'start' });
    room.tick();
    expect(a.last('turn').cmds).toEqual([]);
  });

  it('raises the alarm if two players\' games stop matching', () => {
    const room = new Room('ABCD');
    const a = player();
    const b = player();
    room.join(a);
    room.join(b);
    room.receive(a, { t: 'start' });
    room.receive(a, { t: 'hash', turn: HASH_EVERY, hash: 111 });
    room.receive(b, { t: 'hash', turn: HASH_EVERY, hash: 111 });
    expect(a.got.some((m) => m.t === 'desync')).toBe(false);
    room.receive(a, { t: 'hash', turn: HASH_EVERY * 2, hash: 111 });
    room.receive(b, { t: 'hash', turn: HASH_EVERY * 2, hash: 222 });
    expect(a.last('desync').turn).toBe(HASH_EVERY * 2);
    expect(b.last('desync').turn).toBe(HASH_EVERY * 2);
  });

  it('tells the others when someone leaves, and moves the host on in the lobby', () => {
    const room = new Room('ABCD');
    const a = player();
    const b = player();
    room.join(a);
    room.join(b);
    room.leave(a);
    expect(b.last('lobby').players).toEqual([{ seat: 1, faction: 'dominion', host: true }]);
    room.receive(b, { t: 'start' });
    const c = player();
    room.leave(c);
    room.leave(b);
    expect(room.empty).toBe(true);
  });

  it('makes codes that are four plain letters', () => {
    for (let i = 0; i < 50; i++) expect(roomCode()).toMatch(/^[A-HJ-NP-Z]{4}$/);
  });
});

describe('two machines playing through a room', () => {
  it('stay in step when they only ever see the room\'s turns', () => {
    const room = new Room('ABCD', () => 0.25);
    const a = player();
    const b = player();
    room.join(a);
    room.join(b);
    room.receive(a, { t: 'start' });
    const info = a.last('start').info;
    const make = (): Sim => new Sim(info.seed, { seats: info.seats, terrain: true, pioneers: true });
    const games = [make(), make()];
    expect(games[0].world.units.map((u) => [u.type, u.owner])).toEqual([
      ['pioneer', 0],
      ['pioneer', 1],
    ]);

    // Each player sends orders to the room. Neither applies them directly.
    const orders: [number, ReturnType<typeof player>, Command][] = [
      [0, a, { type: 'deploy', player: 0, unitId: 1 }],
      [3, b, { type: 'deploy', player: 1, unitId: 2 }],
      [40, a, { type: 'build', player: 0, building: 'power' }],
      // An attempt to move the other player's Pioneer, which the room re-labels and the game then refuses.
      [45, a, { type: 'move', player: 1, unitIds: [2], cx: 10, cy: 10 }],
    ];
    for (let turn = 0; turn < 200; turn++) {
      for (const [when, who, cmd] of orders) if (when === turn) room.receive(who, { t: 'cmd', cmd });
      room.tick();
      const packet = a.last('turn');
      expect(packet.n).toBe(turn);
      for (const game of games) {
        for (const cmd of packet.cmds) game.issue(cmd);
        game.step();
        game.step();
      }
      expect(games[0].hash()).toBe(games[1].hash());
    }
    const world = games[0].world;
    expect(world.buildings.filter((x) => x.type === 'conyard').map((x) => x.owner).sort()).toEqual([0, 1]);
    expect(world.players[0].production?.type).toBe('power');
  });
});
