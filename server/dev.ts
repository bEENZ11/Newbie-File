// A small stand-in for the Cloudflare server, for playing and testing on one
// machine. It runs the same room logic over ordinary WebSockets.
//
//   npm run server
//
// Then open the game with ?server=ws://localhost:8787 on the end of its address.

import { WebSocketServer } from 'ws';
import { TURN_MS, type ClientMessage, type ServerMessage } from '../src/net/protocol';
import { Room, type Connection } from './room';

const port = Number(process.env.PORT ?? 8787);
const rooms = new Map<string, Room>();
const server = new WebSocketServer({ port });

server.on('connection', (socket, request) => {
  const code = (new URL(request.url ?? '/', 'http://localhost').searchParams.get('room') ?? '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) {
    socket.close();
    return;
  }
  let room = rooms.get(code);
  if (!room) {
    room = new Room(code);
    rooms.set(code, room);
  }
  const mine = room;
  const conn: Connection = {
    send: (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    },
  };
  socket.on('message', (data) => {
    try {
      mine.receive(conn, JSON.parse(String(data)) as ClientMessage);
    } catch {
      // Ignore anything that is not a message we understand.
    }
  });
  socket.on('close', () => {
    mine.leave(conn);
    if (mine.empty) rooms.delete(code);
  });
  mine.join(conn);
});

// One beat for every room that has a game under way.
setInterval(() => {
  for (const room of rooms.values()) room.tick();
}, TURN_MS);

console.log(`Room server listening on ws://localhost:${port}`);
