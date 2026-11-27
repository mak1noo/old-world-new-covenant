import { expect, test } from 'vitest';
import { cards, cardBySerial, skills } from './cards';
import { addUnit, applyIntent, attackOptions, createGame, isNumberOnly, type Game, type Intent, type Side } from './game';
import { developmentOptions } from './legal';

const id = (name: string) => skills.find(skill => skill.name === name)!.id;
const buy = (game: Game, name: string) => applyIntent(game, 0, { type: 'skill', skill: id(name) });
const setCard = (game: Game, side: Side, slot: number, serial: string) => {
  const card = cardBySerial.get(serial) ?? cards.find(card => card.name === serial)!;
  const unit = addUnit(game, side, card.id);
  game.players[side].field[slot] = game.players[side].bench.pop()!;
  return unit;
};
const prep = () => { const game = createGame(); game.players[0].lp = 100; return game; };
const ready = (game: Game) => applyIntent(applyIntent(game, 0, { type: 'ready' }), 1, { type: 'ready' });

test('血红星允许凑七，同时保留凑十', () => {
  let game = prep();
  const [first, second] = game.players[0].hand;
  first.serial = '7';
  second.serial = '10';
  const sum = { type: 'sum', ids: [first.id], total: 7 } as const;
  expect(() => applyIntent(game, 0, { ...sum, ids: [...sum.ids] })).toThrow();
  game = buy(game, '血红星');
  game = applyIntent(game, 0, { ...sum, ids: [first.id] });
  game = applyIntent(game, 0, { type: 'sum', ids: [second.id], total: 10 });
  expect(game.players[0].lp).toBe(99);
});
test('王权、命运、爱按当前牌串联，爱限一次', () => {
  let game = prep();
  const raw = game.players[0].hand[0];
  raw.printed = raw.serial = '9';
  for (const name of ['王权', '命运', '爱']) game = buy(game, name);
  const change = (name: string, serial: string): Intent => ({ type: 'change', skill: id(name), id: raw.id, serial });
  game = applyIntent(game, 0, change('王权', '4'));
  game = applyIntent(game, 0, change('命运', '6'));
  game = applyIntent(game, 0, change('爱', '8'));
  expect(game.players[0].hand[0].serial).toBe('8');
  expect(isNumberOnly(game.players[0].hand[0])).toBe(true);
  expect(() => applyIntent(game, 0, change('爱', '10'))).toThrow();
  expect(() => applyIntent(game, 0, change('王权', '0'))).toThrow();
});
test('变号牌可补连号或凑数，升华产物必须来自未变号牌', () => {
  let game = prep();
  const hand = game.players[0].hand;
  ['2', '4', '9', '7'].forEach((serial, index) => { hand[index].printed = hand[index].serial = serial; });
  const [two, four, nine, seven] = hand;
  game = buy(game, '王权');
  game = applyIntent(game, 0, { type: 'change', skill: id('王权'), id: nine.id, serial: '3' });
  const ids = [two.id, four.id, nine.id];
  expect(() => applyIntent(game, 0, { type: 'sublimate', ids, serial: '3' })).toThrow('未变号');
  expect(() => applyIntent(game, 0, { type: 'sublimate', ids: [nine.id], serial: '3' })).toThrow('未变号');
  expect(developmentOptions(game, 0)).not.toContainEqual({ type: 'sublimate', ids, serial: '3' });
  expect(applyIntent(game, 0, { type: 'sublimate', ids, serial: '2' }).players[0].bench[0].card)
    .toBe(cardBySerial.get('2')!.id);
  const cashed = applyIntent(game, 0, { type: 'sum', ids: [nine.id, seven.id], total: 10 });
  expect(cashed.players[0].lp).toBe(game.players[0].lp + 1);
  expect(cashed.players[0].deck.find(card => card.id === nine.id)).toEqual({ id: nine.id, printed: '9', serial: '9' });
});
test('命运变回印刷序号时仍只作数字，回库后恢复卡牌身份', () => {
  let game = prep();
  const [raw, firstA, secondA, five] = game.players[0].hand;
  ['3', 'a', 'a', '5'].forEach((serial, index) => {
    const card = game.players[0].hand[index];
    card.printed = card.serial = serial;
  });
  game = buy(game, '命运');
  for (const serial of ['7', '3']) {
    game = applyIntent(game, 0, { type: 'change', skill: id('命运'), id: raw.id, serial });
  }
  expect(game.players[0].hand[0]).toMatchObject({ printed: '3', serial: '3' });
  expect(isNumberOnly(game.players[0].hand[0])).toBe(true);
  expect(() => applyIntent(game, 0, { type: 'sublimate', ids: [raw.id], serial: '3' })).toThrow('未变号');
  game = applyIntent(game, 0, { type: 'change', skill: id('命运'), id: five.id, serial: 'a' });
  expect(() => applyIntent(game, 0, { type: 'sublimate', ids: [firstA.id, secondA.id, five.id], serial: 'a' })).toThrow('未变号');
  expect(applyIntent(game, 0, { type: 'sum', ids: [five.id], total: 10 }).players[0].lp).toBe(game.players[0].lp + 1);
  setCard(game, 0, 2, '1');
  setCard(game, 1, 2, '1');
  const returned = ready(game).players[0].deck.find(card => card.id === raw.id);
  expect(returned).toEqual({ id: raw.id, printed: '3', serial: '3' });
});
test('常胜二级替换基础版，军队与主教二级都叠加且保留前置', () => {
  let game = prep();
  for (const [name, upgrade] of [['常胜', '常胜二级'], ['军队', '二级军队'], ['主教', '二级主教']]) {
    expect(() => buy(game, upgrade)).toThrow('基础技能');
    game = buy(buy(game, name), upgrade);
  }
  setCard(game, 0, 2, '1');
  const next = ready(game);
  expect(next.players[0].hand).toHaveLength(13);
  expect(next.players[1].hand).toHaveLength(7);
  expect(next.players[0].lp).toBe(84);
});
test('圣域按减伤前的普通伤害，反旗令中位成为强制目标', () => {
  let game = buy(buy(prep(), '圣域'), '反旗');
  const enemy = setCard(game, 1, 2, '倒吊塔');
  const mid = setCard(game, 0, 2, '飞龙');
  setCard(game, 0, 1, '飞龙');
  game = ready(game);
  game.active = 1;
  expect(attackOptions(game, 1, game.players[1].field[2]!).targets.map(unit => unit.id)).toEqual([mid.id]);
  const next = applyIntent(game, 1, { type: 'attack', id: enemy.id, target: mid.id });
  expect(next.players[0].field[2]?.hp).toBe(5);
});
test('奇遇只重抽选定牌数，每准备阶段一次，断金最多发放 5 lp', () => {
  let game = buy(buy(prep(), '奇遇'), '断金');
  const action: Intent = { type: 'reset', ids: [game.players[0].hand[0].id] };
  game = applyIntent(game, 0, action);
  expect(game.players[0].hand).toHaveLength(7);
  expect(() => applyIntent(game, 0, { type: 'reset', ids: [game.players[0].hand[0].id] })).toThrow();
  expect(ready(game).players[0].lp).toBe(98);
  game.players[0].lp = 19;
  expect(ready(game).players[0].lp).toBe(22);
});
test('炼金拆二星，炼心按配方一级一级返还，无原 lp 返还', () => {
  let game = buy(buy(prep(), '炼金'), '炼心');
  const king = cards.find(card => card.name === '国王')!;
  const holy = cards.find(card => card.name === '圣龙')!;
  const golden = addUnit(game, 0, king.id, 2);
  game = applyIntent(game, 0, { type: 'alchemy', id: golden.id });
  expect(game.players[0].bench.map(unit => unit.star)).toEqual([1, 1]);
  const high = addUnit(game, 0, holy.id);
  game = applyIntent(game, 0, { type: 'decompose', id: high.id });
  expect(game.players[0].bench.slice(2).map(unit => unit.card)).toEqual(holy.recipe!.materials.map(material => material.id));
  const [low] = game.players[0].bench;
  game = applyIntent(game, 0, { type: 'decompose', id: low.id });
  expect(game.players[0].bench.slice(-3).map(unit => unit.card)).toEqual(king.recipe!.materials.map(material => material.id));
  expect(game.players[0].lp).toBe(91);
});
