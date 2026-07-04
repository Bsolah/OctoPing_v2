import type { WebSocket } from 'ws';

type SocketMeta = {
  socket: WebSocket;
  merchantId: string;
  role: 'customer' | 'merchant' | 'agent';
  agentId?: string;
  rooms: Set<string>;
};

const sockets = new Map<WebSocket, SocketMeta>();
const rooms = new Map<string, Set<WebSocket>>();

export function registerSocket(
  socket: WebSocket,
  meta: Omit<SocketMeta, 'socket' | 'rooms'>,
): void {
  sockets.set(socket, { ...meta, socket, rooms: new Set() });
}

export function unregisterSocket(socket: WebSocket): void {
  const meta = sockets.get(socket);
  if (!meta) return;
  for (const room of meta.rooms) {
    leaveRoom(socket, room);
  }
  sockets.delete(socket);
}

export function joinRoom(socket: WebSocket, room: string): void {
  const meta = sockets.get(socket);
  if (!meta) return;
  meta.rooms.add(room);
  const set = rooms.get(room) ?? new Set();
  set.add(socket);
  rooms.set(room, set);
}

export function leaveRoom(socket: WebSocket, room: string): void {
  const meta = sockets.get(socket);
  meta?.rooms.delete(room);
  const set = rooms.get(room);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) {
    rooms.delete(room);
  }
}

export function broadcast(
  room: string,
  payload: unknown,
  except?: WebSocket,
): void {
  const set = rooms.get(room);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const socket of set) {
    if (except && socket === except) continue;
    if (socket.readyState === socket.OPEN) {
      socket.send(data);
    }
  }
}

export function getSocketMeta(socket: WebSocket): SocketMeta | undefined {
  return sockets.get(socket);
}

export function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export function merchantRoom(merchantId: string): string {
  return `merchant:${merchantId}`;
}
