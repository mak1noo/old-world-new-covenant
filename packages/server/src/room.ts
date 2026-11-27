import { randomInt } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { applyIntent, createGame, forecastCombat, other, type Game, type Intent, type Side } from '../../shared/src/game';
import { battleIntents } from '../../shared/src/legal';
import type { ClientMessage, Difficulty, ServerMessage } from '../../shared/src/protocol';
import { captureBoard, viewFor, type PublicBoard } from '../../shared/src/view';
import { aiIntent } from './ai';

type Room = {
  code: string; peers: [WebSocket | null, WebSocket | null]; ai?: Difficulty;
  game?: Game; snapshot?: PublicBoard; timer?: ReturnType<typeof setTimeout>;
};
const positive = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) > 0;
const number = (value: unknown): boolean => Number.isSafeInteger(value);
const short = (value: unknown): boolean => typeof value === 'string' && value.length > 0 && value.length <= 80;
const ids = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.length <= 36 && value.every(positive);
const optional = (value: unknown): boolean => value === undefined || positive(value);

function validIntent(value: unknown): value is Intent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const intent = value as Record<string, unknown>;
  switch (intent.type) {
    case 'ready': case 'refresh': return true;
    case 'buy': return number(intent.slot);
    case 'sublimate': return ids(intent.ids) && short(intent.serial);
    case 'sum': return ids(intent.ids) && (intent.total === 7 || intent.total === 10);
    case 'place': return positive(intent.id) && number(intent.slot);
    case 'bench': case 'sell': case 'alchemy': case 'decompose': case 'skip': return positive(intent.id);
    case 'fuse': return short(intent.card) && ids(intent.ids);
    case 'star': case 'reset': return ids(intent.ids);
    case 'skill': return short(intent.skill);
    case 'change': return short(intent.skill) && positive(intent.id) && short(intent.serial);
    case 'attack': return positive(intent.id) && optional(intent.target);
    case 'ability': return positive(intent.id) && optional(intent.target) && optional(intent.ally);
    case 'choose': return number(intent.value);
    case 'arcane': return positive(intent.id) && positive(intent.first) && positive(intent.second);
    default: return false;
  }
}
function send(socket: WebSocket | null, message: ServerMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export function attachRooms(server: Server, options: { seed?: () => number; aiDelay?: number } = {}): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8_192 });
  const rooms = new Map<string, Room>();
  const occupied = new Map<WebSocket, Room>();
  const seed = options.seed ?? (() => randomInt(0, 2 ** 32));
  const aiDelay = options.aiDelay ?? 140;
  const seats = [0, 1] as const;
  function remove(socket: WebSocket): void {
    const room = occupied.get(socket);
    if (!room) return;
    rooms.delete(room.code);
    occupied.delete(socket);
    clearTimeout(room.timer);
    if (room.game?.phase === 'finished') return;
    for (const peer of room.peers) {
      if (peer && peer !== socket) {
        send(peer, { type: 'disconnected' });
        occupied.delete(peer);
      }
    }
  }
  function publish(room: Room): void {
    const game = room.game!;
    for (const side of seats) {
      const view = viewFor(game, side, room.snapshot!);
      send(room.peers[side], { type: 'state', view, legal: battleIntents(game, side) });
    }
  }
  function update(room: Room, side: Side, intent: Intent): void {
    const before = room.game!;
    const next = applyIntent(before, side, intent);
    room.game = next;
    if (next.phase !== 'prep' || next.battle !== before.battle) room.snapshot = captureBoard(next);
    publish(room);
    if (next.phase === 'finished') rooms.delete(room.code);
    else scheduleAi(room);
  }
  function scheduleAi(room: Room): void {
    if (!room.ai || room.timer) return;
    const game = room.game!;
    const wants = game.pending ? game.pending.side === 1 : game.phase === 'battle' ? game.active === 1
      : game.phase === 'prep' && !game.players[1].ready;
    if (!wants) return;
    room.timer = setTimeout(() => {
      room.timer = undefined;
      try {
        const action = aiIntent(room.game!, 1, room.ai!, room.snapshot!);
        if (action) update(room, 1, action);
      } catch (error) {
        send(room.peers[0], { type: 'error', message: error instanceof Error ? error.message : 'AI 行动失败' });
      }
    }, aiDelay);
  }
  function start(room: Room): void {
    room.game = createGame({ seed: seed() });
    room.snapshot = captureBoard(room.game);
    publish(room);
    scheduleAi(room);
  }
  function create(socket: WebSocket, ai?: Difficulty): void {
    remove(socket);
    let code: string;
    do { code = String(randomInt(100000, 1000000)); } while (rooms.has(code));
    const room: Room = { code, peers: [socket, null], ai };
    occupied.set(socket, room);
    if (ai) start(room);
    else {
      rooms.set(code, room);
      send(socket, { type: 'lobby', code });
    }
  }
  function onMessage(socket: WebSocket, data: RawData): void {
    try {
      const input = JSON.parse(data.toString()) as ClientMessage | null;
      if (!input || typeof input !== 'object') throw new Error('消息无效');
      switch (input.type) {
        case 'create': create(socket); return;
        case 'solo':
          if (input.difficulty !== 'easy' && input.difficulty !== 'hard') throw new Error('AI 难度无效');
          create(socket, input.difficulty);
          return;
        case 'join': {
          if (typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) throw new Error('请输入 6 位房间码');
          const room = rooms.get(input.code);
          if (!room || room.game || room.peers[0] === socket) throw new Error('房间不存在、已满或无法加入');
          remove(socket);
          room.peers[1] = socket;
          occupied.set(socket, room);
          start(room);
          return;
        }
        case 'leave': remove(socket); return;
        case 'forecast': {
          if (!positive(input.requestId)) throw new Error('预估请求无效');
          try {
            const room = occupied.get(socket);
            if (!room?.game) throw new Error('对局尚未开始');
            const intent = input.intent;
            if (!validIntent(intent) || !['attack', 'ability', 'arcane'].includes(intent.type)) {
              throw new Error('攻技预估格式无效');
            }
            const side: Side = room.peers[0] === socket ? 0 : 1;
            send(socket, { type: 'forecast', requestId: input.requestId, forecast: forecastCombat(room.game, side, intent) });
          } catch (error) {
            send(socket, { type: 'forecastError', requestId: input.requestId,
              message: error instanceof Error ? error.message : '无法预估此行动' });
          }
          return;
        }
        case 'intent': {
          const room = occupied.get(socket);
          if (!room?.game) throw new Error('对局尚未开始');
          if (!validIntent(input.intent)) throw new Error('操作格式无效');
          const side: Side = room.peers[0] === socket ? 0 : 1;
          if (room.peers[other(side)]?.readyState === WebSocket.CLOSED) throw new Error('对手已离开');
          update(room, side, input.intent);
          return;
        }
        default: throw new Error('未知消息');
      }
    } catch (error) {
      send(socket, { type: 'error', message: error instanceof Error ? error.message : '操作失败' });
    }
  }
  wss.on('connection', socket => {
    socket.on('message', data => onMessage(socket, data));
    socket.on('close', () => remove(socket));
    socket.on('error', () => remove(socket));
  });
  return wss;
}
