import { randomBytes, randomInt } from 'node:crypto';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { constants } from '../../shared/src/cards';
import { applyIntent, createGame, forecastCombat, type Game, type Intent, type Side } from '../../shared/src/game';
import { battleIntents } from '../../shared/src/legal';
import { reconnectGraceMs, type ClientMessage, type Difficulty, type ServerMessage } from '../../shared/src/protocol';
import { captureBoard, spectatorView, viewFor, type PublicBoard } from '../../shared/src/view';
import { aiIntent } from './ai';
import { observedAction } from './observe';

type Room = {
  code: string; seats: [Member | null, Member | null]; spectators: Set<Member>; ai?: Difficulty;
  playerHpLimit: number; observedLog: Game['log'];
  game?: Game; snapshot?: PublicBoard; timer?: ReturnType<typeof setTimeout>;
};
type Member = {
  room: Room; side: Side | null; token?: string; socket: WebSocket | null;
  expiry?: ReturnType<typeof setTimeout>;
};
const spectatorLimit = 16;
const positive = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) > 0;
const number = (value: unknown): boolean => Number.isSafeInteger(value);
const short = (value: unknown): boolean => typeof value === 'string' && value.length > 0 && value.length <= 80;
const ids = (value: unknown): boolean => Array.isArray(value) && value.length > 0 && value.length <= 36 && value.every(positive);
const optional = (value: unknown): boolean => value === undefined || positive(value);

function validIntent(value: unknown): value is Intent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const intent = value as Record<string, unknown>;
  switch (intent.type) {
    case 'ready': case 'unready': case 'refresh': return true;
    case 'surrender': return positive(intent.battle);
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
  if (socket?.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 2 * 1024 * 1024) {
    socket.terminate();
    return;
  }
  socket.send(JSON.stringify(message));
}

export function attachRooms(server: Server, options: {
  seed?: () => number; aiDelay?: number; reconnectMs?: number;
} = {}): WebSocketServer {
  const wss = new WebSocketServer({
    server, path: '/ws', maxPayload: 8_192,
    perMessageDeflate: { serverNoContextTakeover: true, clientNoContextTakeover: true, threshold: 1024 },
  });
  const rooms = new Map<string, Room>();
  const occupied = new Map<WebSocket, Member>();
  const sessions = new Map<string, Member>();
  const alive = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!alive.delete(socket)) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN) socket.ping();
    }
  }, 15_000);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  const seed = options.seed ?? (() => randomInt(0, 2 ** 32));
  const aiDelay = options.aiDelay ?? 140;
  const reconnectMs = options.reconnectMs ?? reconnectGraceMs;
  const members = (room: Room) => [...room.seats.filter(member => member !== null), ...room.spectators];
  const paused = (room: Room) => room.game?.phase !== 'finished' &&
    room.seats.some(member => member && !member.socket);

  function publishRoom(room: Room): void {
    if (room.ai) return;
    for (const member of members(room)) send(member.socket, { type: 'room', room: {
      code: room.code, role: member.side === null ? 'spectator' : 'player',
      seats: room.seats.filter(Boolean).length, spectators: room.spectators.size, paused: paused(room), playerHpLimit: room.playerHpLimit,
    } });
  }
  function detach(member: Member): void {
    if (member.socket) occupied.delete(member.socket);
    member.socket = null;
    if (member.token) sessions.delete(member.token);
    clearTimeout(member.expiry);
    if (member.side === null) member.room.spectators.delete(member);
    else member.room.seats[member.side] = null;
  }
  function remove(member: Member): void {
    const { room, side } = member;
    detach(member);
    if (side === null || room.game?.phase === 'finished') {
      publishRoom(room);
      return;
    }
    rooms.delete(room.code);
    clearTimeout(room.timer);
    for (const peer of members(room)) {
      send(peer.socket, { type: 'disconnected', message: '有战斗席玩家离开，房间已关闭' });
      detach(peer);
    }
  }
  function loseConnection(socket: WebSocket): void {
    const member = occupied.get(socket);
    if (!member) return;
    occupied.delete(socket);
    member.socket = null;
    if (!member.token || reconnectMs <= 0) {
      remove(member);
      return;
    }
    member.expiry = setTimeout(() => remove(member), reconnectMs);
    member.expiry.unref();
    publishRoom(member.room);
  }
  function leave(socket: WebSocket): void {
    const member = occupied.get(socket);
    if (member) remove(member);
  }
  function publishState(member: Member): void {
    const { room, side, socket } = member;
    if (!room.game) {
      send(socket, { type: 'lobby', code: room.code });
      return;
    }
    const view = side === null ? spectatorView(room.game, room.observedLog) : viewFor(room.game, side, room.snapshot!);
    send(socket, { type: 'state', view, legal: side === null ? [] : battleIntents(room.game, side) });
  }
  function publish(room: Room): void {
    for (const member of members(room)) if (member.socket) publishState(member);
  }
  function update(room: Room, side: Side, intent: Intent): void {
    const before = room.game!;
    const next = applyIntent(before, side, intent);
    if (!room.ai) {
      const effects = next.log.slice(before.log.length).filter(entry => entry.kind !== 'action');
      room.observedLog.push(observedAction(before, side, intent), ...effects);
    }
    room.game = next;
    if (next.phase !== 'prep' || next.battle !== before.battle) room.snapshot = captureBoard(next);
    publish(room);
    if (next.phase === 'finished') {
      if (!room.ai) rooms.delete(room.code);
      clearTimeout(room.timer);
    } else scheduleAi(room);
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
        send(room.seats[0]?.socket ?? null, { type: 'error', message: error instanceof Error ? error.message : 'AI 行动失败' });
      }
    }, aiDelay);
  }
  function start(room: Room): void {
    room.game = createGame({ seed: seed(), playerHp: room.playerHpLimit });
    room.snapshot = captureBoard(room.game);
    publish(room);
    scheduleAi(room);
  }
  function admit(socket: WebSocket, room: Room, side: Side | null): Member {
    leave(socket);
    const member: Member = { room, side, socket };
    if (side === null) room.spectators.add(member);
    else room.seats[side] = member;
    occupied.set(socket, member);
    if (!room.ai) {
      member.token = randomBytes(24).toString('hex');
      sessions.set(member.token, member);
      send(socket, { type: 'session', token: member.token });
    }
    return member;
  }
  function create(socket: WebSocket, playerHpLimit = constants.playerHp, ai?: Difficulty): void {
    if (!positive(playerHpLimit)) throw new Error('初始生命必须为正整数');
    let code: string;
    do { code = String(randomInt(100000, 1000000)); } while (rooms.has(code));
    const room: Room = { code, seats: [null, null], spectators: new Set(), playerHpLimit, observedLog: [], ai };
    const member = admit(socket, room, 0);
    if (ai) start(room);
    else {
      rooms.set(code, room);
      publishRoom(room);
      publishState(member);
    }
  }
  function playerSeat(socket: WebSocket): { room: Room & { game: Game }; side: Side } {
    const member = occupied.get(socket);
    if (!member?.room.game) throw new Error('对局尚未开始');
    if (member.side === null) throw new Error('观战席不能进行战斗操作');
    if (paused(member.room)) throw new Error('等待战斗席玩家重新连接');
    return { room: member.room as Room & { game: Game }, side: member.side };
  }
  function onMessage(socket: WebSocket, data: RawData): void {
    try {
      const input = JSON.parse(data.toString()) as ClientMessage | null;
      if (!input || typeof input !== 'object') throw new Error('消息无效');
      switch (input.type) {
        case 'create': create(socket, input.playerHp); return;
        case 'solo':
          if (input.difficulty !== 'easy' && input.difficulty !== 'hard') throw new Error('AI 难度无效');
          create(socket, input.playerHp, input.difficulty);
          return;
        case 'join': {
          if (typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) throw new Error('请输入 6 位房间码');
          if (input.role !== undefined && input.role !== 'player' && input.role !== 'spectator') throw new Error('席位类型无效');
          const room = rooms.get(input.code);
          if (!room) throw new Error('房间不存在或对局已结束');
          const previous = occupied.get(socket);
          const side = input.role === 'spectator' ? null : 1;
          if (previous?.room === room && previous.side === side) return;
          if (previous?.room === room && previous.side !== null) throw new Error('你已在本房间的战斗席');
          if (side === null && room.spectators.size >= spectatorLimit) throw new Error('观战席已满');
          if (side !== null && (room.game || room.seats[1])) throw new Error('战斗席已满，可选择观战席');
          const member = admit(socket, room, side);
          publishRoom(room);
          if (side !== null && !paused(room)) start(room);
          else publishState(member);
          return;
        }
        case 'resume': {
          const member = typeof input.token === 'string' && sessions.get(input.token);
          if (!member || occupied.has(socket)) {
            send(socket, { type: 'resumeError', message: '席位已失效' });
            return;
          }
          clearTimeout(member.expiry);
          if (member.socket) {
            occupied.delete(member.socket);
            member.socket.close(1000, 'Session resumed');
          }
          member.socket = socket;
          occupied.set(socket, member);
          const { room } = member;
          publishRoom(room);
          if (!room.game && room.seats.every(Boolean) && !paused(room)) start(room);
          else publishState(member);
          return;
        }
        case 'leave': leave(socket); return;
        case 'forecast': {
          if (!positive(input.requestId)) throw new Error('预估请求无效');
          try {
            const { room, side } = playerSeat(socket);
            const intent = input.intent;
            if (!validIntent(intent) || !['attack', 'ability', 'arcane'].includes(intent.type)) {
              throw new Error('攻技预估格式无效');
            }
            send(socket, { type: 'forecast', requestId: input.requestId, forecast: forecastCombat(room.game, side, intent) });
          } catch (error) {
            send(socket, { type: 'forecastError', requestId: input.requestId,
              message: error instanceof Error ? error.message : '无法预估此行动' });
          }
          return;
        }
        case 'intent': {
          const { room, side } = playerSeat(socket);
          if (!validIntent(input.intent)) throw new Error('操作格式无效');
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
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
    socket.on('close', () => loseConnection(socket));
    socket.on('error', () => socket.terminate());
  });
  return wss;
}
