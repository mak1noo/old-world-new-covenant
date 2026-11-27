import { expect, test } from 'vitest';
import { aiIntent, type Difficulty } from './ai';
import { applyIntent, createGame, other, type Side } from '../../shared/src/game';
import { captureBoard } from '../../shared/src/view';

test('困难与简单完成 24 局配对比较，困难获胜率至少 60% 且每步少于 300ms', () => {
  let wins = 0;
  let draws = 0;
  let longest = 0;
  for (let index = 0; index < 24; index++) {
    let game = createGame({ seed: 700 + Math.floor(index / 2) });
    let snapshot = captureBoard(game);
    const hard: Side = index % 2 === 0 ? 0 : 1;
    for (let turn = 0; game.phase !== 'finished' && turn < 6000; turn++) {
      const side = game.pending?.side ?? (game.phase === 'battle' ? game.active : game.players[0].ready ? 1 : 0);
      const difficulty: Difficulty = side === hard ? 'hard' : 'easy';
      const start = performance.now();
      const intent = aiIntent(game, side, difficulty, snapshot);
      longest = Math.max(longest, performance.now() - start);
      if (!intent) throw new Error('AI 没有可用行动');
      const next = applyIntent(game, side, intent);
      if (next.phase === 'battle' || next.battle !== game.battle || next.phase === 'finished') snapshot = captureBoard(next);
      game = next;
    }
    expect(game.phase).toBe('finished');
    if (game.winner === hard) wins++;
    else if (game.winner !== other(hard)) draws++;
  }
  console.info(`困难获胜 ${wins}/24，平局 ${draws}，最长决策 ${longest.toFixed(1)}ms`);
  expect(wins / 24).toBeGreaterThanOrEqual(0.6);
  expect(longest).toBeLessThan(300);
}, 40000);

test('准备阶段更改对手实际隐藏数据不会改变 AI 决策', () => {
  const game = createGame();
  const snapshot = captureBoard(game);
  const first = aiIntent(game, 0, 'hard', snapshot);
  game.players[1].hand.reverse();
  game.players[1].deck.length = 0;
  game.players[1].lp = 999;
  game.players[1].skills.push('skill_reverse_flag');
  game.rng = 999;
  expect(aiIntent(game, 0, 'hard', snapshot)).toEqual(first);
});
