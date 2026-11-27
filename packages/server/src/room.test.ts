import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, test } from 'vitest';
import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '../../shared/src/protocol';
import { attachRooms } from './room';

async function testNetwork(run: (connect: () => Promise<ReturnType<typeof client>>) => Promise<void>): Promise<void> {
  const server = createServer();
  const wss = attachRooms(server, { seed: () => 12, aiDelay: 0, reconnectMs: 1000 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  try {
    await run(async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
      const peer = client(socket);
      await once(socket, 'open');
      return peer;
    });
  } finally {
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>(resolve => wss.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
function client(socket: WebSocket) {
  const queue: ServerMessage[] = [];
  let available: (() => void) | undefined;
  socket.on('message', raw => { queue.push(JSON.parse(raw.toString())); available?.(); });
  return {
    send: (message: ClientMessage) => socket.send(JSON.stringify(message)),
    close: () => socket.close(),
    async take<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
      while (!queue.some(message => message.type === type)) await new Promise<void>(resolve => { available = resolve; });
      available = undefined;
      const index = queue.findIndex(message => message.type === type);
      const message = queue[index];
      queue.splice(0, index + 1);
      return message as Extract<ServerMessage, { type: T }>;
    },
  };
}

test('两个 websocket 客户端创建、加入、打满 50 场，失败操作和隐私均由服务器校验', async () => {
  await testNetwork(async connect => {
    const alice = await connect();
    const bob = await connect();
    alice.send({ type: 'create' });
    const { code } = await alice.take('lobby');
    expect(code).toMatch(/^\d{6}$/);
    bob.send({ type: 'join', code });
    const initial = await alice.take('state');
    expect(initial.view.own.hand).toHaveLength(7);
    expect(initial.view.opponent).not.toHaveProperty('hand');
    expect(initial.view.opponent).not.toHaveProperty('shop');
    expect(initial.view.opponent).not.toHaveProperty('deck');
    expect(initial.view.opponent).not.toHaveProperty('lp');
    expect(initial.view.opponent).not.toHaveProperty('bench');
    expect(initial.view).not.toHaveProperty('rng');
    const bobInitial = await bob.take('state');
    expect(bobInitial.view.side).toBe(1);
    alice.send({ type: 'intent', intent: { type: 'buy', slot: 0 } });
    expect((await alice.take('error')).message).toBe('lp 不足');
    for (let battle = 1; battle <= 50; battle++) {
      alice.send({ type: 'intent', intent: { type: 'ready' } });
      expect((await bob.take('state')).view.opponent.ready).toBe(true);
      await alice.take('state');
      bob.send({ type: 'intent', intent: { type: 'ready' } });
      const [left, right] = await Promise.all([alice.take('state'), bob.take('state')]);
      expect(left.view.battle).toBe(battle === 50 ? 50 : battle + 1);
      expect(left.view.phase).toBe(right.view.phase);
      expect(left.view.phase).toBe(battle === 50 ? 'finished' : 'prep');
    }
    const late = await connect();
    late.send({ type: 'join', code });
    expect((await late.take('error')).message).toContain('房间不存在');
  });
});
test('准备状态更新不会暴露对手实际阵容，掉线通知另一客户端', async () => {
  await testNetwork(async connect => {
    const alice = await connect();
    const bob = await connect();
    alice.send({ type: 'create' });
    bob.send({ type: 'join', code: (await alice.take('lobby')).code });
    const initial = (await alice.take('state')).view.own.hand;
    await bob.take('state');
    const raw = initial.find(card => card.serial === 'a' || card.serial === '10');
    if (raw) {
      alice.send({ type: 'intent', intent: { type: 'sum', ids: [raw.id], total: 10 } });
      expect((await alice.take('state')).view.own.lp).toBe(1);
      expect((await bob.take('state')).view.opponent.benchCount).toBe(0);
    }
    alice.send({ type: 'leave' });
    await bob.take('disconnected');
  });
});

test('观战席只收到公开阵容，远程战斗席断线暂停且能恢复', async () => {
  await testNetwork(async connect => {
    const host = await connect();
    const guest = await connect();
    const watcher = await connect();
    host.send({ type: 'create' });
    const { token } = await host.take('session');
    const { code } = await host.take('lobby');
    watcher.send({ type: 'join', code, role: 'spectator' });
    expect((await watcher.take('room')).room).toMatchObject({ role: 'spectator', spectators: 1, seats: 1 });
    await watcher.take('lobby');
    guest.send({ type: 'join', code, role: 'player' });
    const initial = (await host.take('state')).view;
    await guest.take('state');
    const watching = await watcher.take('state');
    expect(watching.legal).toEqual([]);
    expect(watching.view.own).toMatchObject({ hand: [], shop: [], bench: [], lp: 0 });
    expect(watching.view.opponent).not.toHaveProperty('hand');
    watcher.send({ type: 'intent', intent: { type: 'ready' } });
    expect((await watcher.take('error')).message).toContain('观战席');
    watcher.send({ type: 'forecast', requestId: 1, intent: { type: 'attack', id: 101 } });
    expect((await watcher.take('forecastError')).message).toContain('观战席');
    host.send({ type: 'intent', intent: { type: 'ready' } });
    expect((await guest.take('state')).view.opponent.ready).toBe(true);
    host.close();
    expect((await guest.take('room')).room.paused).toBe(true);
    guest.send({ type: 'intent', intent: { type: 'ready' } });
    expect((await guest.take('error')).message).toContain('重新连接');
    const resumed = await connect();
    resumed.send({ type: 'resume', token });
    expect((await resumed.take('state')).view.own).toMatchObject({ ready: true, hand: initial.own.hand, shop: initial.own.shop });
    expect((await guest.take('room')).room.paused).toBe(false);
    resumed.send({ type: 'intent', intent: { type: 'unready' } });
    expect((await guest.take('state')).view.opponent.ready).toBe(false);
    resumed.send({ type: 'leave' });
    await Promise.all([guest.take('disconnected'), watcher.take('disconnected')]);
  });
});
