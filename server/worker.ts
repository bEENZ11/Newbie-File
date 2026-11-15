// The Cloudflare side: a Worker that serves the game and hands each room's
// WebSocket connections to a Durable Object, which keeps that room's state.
//
// The game's own files are packed into this program by scripts/embed-site.mjs,
// so one deployment publishes everything.

import { TURN_MS, type ClientMessage, type ServerMessage } from '../src/net/protocol';
import { Room, type Connection } from './room';
import { SITE } from './site.gen';

interface Env {
  ROOMS: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const code = (url.searchParams.get('room') ?? '').toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) return new Response('Bad room code', { status: 400 });
      // Everyone who asks for the same code reaches the same Durable Object.
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }
    const file = SITE[url.pathname === '/' ? '/index.html' : url.pathname];
    if (!file) return new Response('Not found', { status: 404 });
    // The page itself is always fetched fresh, so players get new versions straight away.
    // Everything else has a name that changes when its contents do, so it can be kept.
    const cache = url.pathname === '/' || url.pathname.endsWith('.html') ? 'no-cache' : 'public, max-age=86400';
    return new Response(file.data, { headers: { 'Content-Type': file.type, 'Cache-Control': cache } });
  },
};

export class RoomObject {
  private room: Room | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const code = (new URL(request.url).searchParams.get('room') ?? '').toUpperCase();
    this.room ??= new Room(code);
    const room = this.room;

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const conn: Connection = {
      send: (message: ServerMessage) => {
        try {
          server.send(JSON.stringify(message));
        } catch {
          // The player has gone. Their close event will tidy up.
        }
      },
    };
    server.addEventListener('message', (event) => {
      try {
        room.receive(conn, JSON.parse(String(event.data)) as ClientMessage);
      } catch {
        // Ignore anything that is not a message we understand.
      }
      // The beat starts with the game and stops when the room empties.
      if (room.running && !this.timer) this.timer = setInterval(() => room.tick(), TURN_MS);
    });
    const gone = (): void => {
      room.leave(conn);
      if (room.empty) {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.room = null;
      }
    };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    room.join(conn);
    return new Response(null, { status: 101, webSocket: client });
  }
}
