import { setImmediate as yieldToWorker } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { constants } from './cards';
import { applyIntent, createGame, definition, units, type Game, type Intent, type Side } from './game';
import { battleIntents, developmentOptions } from './legal';

function assertState(game: Game): void {
  for (const player of game.players) {
    if (player.lp < 0 || player.hp < 0) throw new Error('玩家资源低于 0');
    const raw = [...player.deck, ...player.hand, ...player.shop.filter(Boolean)];
    if (raw.length !== constants.deckSizePerPlayer || new Set(raw.map(card => card!.id)).size !== raw.length) {
      throw new Error('牌库数量不守恒');
    }
    const field = units(player);
    const created = [...player.bench, ...field];
    if (created.some(unit => unit.hp < 0) || new Set(created.map(unit => unit.id)).size !== created.length) {
      throw new Error('实体重复或生命为负');
    }
    if (game.phase === 'battle' && field.some(unit => unit.hp <= 0)) throw new Error('零血从者留场');
    const fusions = field.filter(unit => definition(unit).category !== 'base' && !unit.temporary);
    if (new Set(fusions.map(unit => unit.card)).size !== fusions.length) throw new Error('同名融合重复上阵');
  }
  if (game.players.some(player => player.hp === 0) && game.phase !== 'finished') throw new Error('零血仍继续对局');
  if (game.battle > constants.battleCap) throw new Error('场次超限');
}
function randomMatch(seed: number): { game: Game; actions: number; battlesWithDamage: number } {
  let state = createGame({ seed });
  let random = seed + 12345;
  let actions = 0;
  const choose = <T,>(options: T[]): T => {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return options[Math.floor(random / 4294967296 * options.length)];
  };
  while (state.phase !== 'finished' && actions < 6000) {
    const side: Side = state.pending?.side ?? (state.phase === 'battle' ? state.active : state.players[0].ready ? 1 : 0);
    let intents: Intent[];
    if (state.pending || state.phase === 'battle') {
      intents = battleIntents(state, side);
    } else {
      const options = developmentOptions(state, side);
      const conversions = options.filter(intent => !['ready', 'place'].includes(intent.type));
      const deployment = options.filter(intent => intent.type === 'place');
      const ready = options.filter(intent => intent.type === 'ready');
      intents = [...conversions, ...deployment, ...deployment, ...ready];
    }
    if (!intents.length) throw new Error(`seed ${seed} 没有合法行动`);
    state = applyIntent(state, side, choose(intents));
    assertState(state);
    actions++;
  }
  if (state.phase !== 'finished') throw new Error(`seed ${seed} 未完成`);
  return { game: state, actions, battlesWithDamage: new Set(state.log.filter(entry => entry.kind === 'damage').map(entry => entry.battle)).size };
}

test('500 局随机合法对战验证牌库、资源、站位、终局及序列化', async () => {
  const start = performance.now();
  let actions = 0;
  let battlesWithDamage = 0;
  let longest = 0;
  for (let index = 0; index < 500; index++) {
    if (index % 5 === 0) await yieldToWorker();
    const begin = performance.now();
    const summary = randomMatch(index * 1019 + 17);
    longest = Math.max(longest, performance.now() - begin);
    actions += summary.actions;
    battlesWithDamage += summary.battlesWithDamage;
    expect(JSON.parse(JSON.stringify(summary.game))).toMatchObject({ phase: 'finished', battle: summary.game.battle });
  }
  console.info(`500 局 / ${actions} 次合法操作 / ${battlesWithDamage} 场造成伤害 / 总耗时 ${((performance.now() - start) / 1000).toFixed(2)}s / 最长单局 ${longest.toFixed(1)}ms`);
  expect(battlesWithDamage).toBeGreaterThan(500);
  expect(longest).toBeLessThan(30000);
}, 160000);
