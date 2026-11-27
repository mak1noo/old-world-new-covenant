import { expect, test } from 'vitest';
import { cardBySerial, cards } from './cards';
import { addUnit, applyIntent, attackOptions, createGame, maxHp, type Game, type Side, type Unit } from './game';

function put(game: Game, side: Side, slot: number, name: string, star = 1): Unit {
  const card = cardBySerial.get(name) ?? cards.find(card => card.name === name)!;
  const unit = addUnit(game, side, card.id, star);
  game.players[side].bench.pop();
  game.players[side].field[slot] = unit;
  return unit;
}
function stage(game = createGame()): Game {
  game.phase = 'battle';
  game.round = 1;
  return game;
}
function attack(game: Game, unit: Unit, target?: Unit) {
  return applyIntent(game, 0, { type: 'attack', id: unit.id, target: target?.id });
}

test('天使：受伤造成伤害后可回复，满血没有提示', () => {
  const game = stage();
  const angel = put(game, 0, 2, '0');
  const enemy = put(game, 1, 2, '6', 3);
  expect(attack(game, angel, enemy).pending).toBeUndefined();
  angel.hp = 2;
  const pending = attack(game, angel, enemy);
  expect(pending.pending?.side).toBe(0);
  expect(applyIntent(pending, 0, { type: 'choose', value: 1 }).players[0].field[2]?.hp).toBe(3);
  expect(applyIntent(pending, 0, { type: 'choose', value: 0 }).players[0].field[2]?.hp).toBe(2);
});
test('小鸟：正对且仅正对，攻击数值随星级', () => {
  const game = stage();
  const bird = put(game, 0, 1, '1', 2);
  const front = put(game, 1, 3, '6', 3);
  put(game, 1, 2, '6', 3);
  expect(attackOptions(game, 0, bird).targets).toEqual([front]);
  expect(attack(game, bird, front).players[1].field[3]?.hp).toBe(2);
});
test('士兵棋：相邻加上限，左右一不能攻击，退场立即失效', () => {
  let game = createGame();
  const soldier = put(game, 0, 1, '2', 2);
  put(game, 0, 0, '4');
  put(game, 0, 3, '4');
  const enemy = put(game, 1, 3, '1', 3);
  game = applyIntent(applyIntent(game, 0, { type: 'ready' }), 1, { type: 'ready' });
  expect(maxHp(game.players[0].field[0]!)).toBe(7);
  expect(maxHp(game.players[0].field[3]!)).toBe(5);
  expect(attackOptions(game, 0, game.players[0].field[1]!).targets).toHaveLength(0);
  game = applyIntent(game, 0, { type: 'skip', id: soldier.id });
  game = applyIntent(game, 1, { type: 'attack', id: enemy.id, target: soldier.id });
  expect(maxHp(game.players[0].field[0]!)).toBe(5);
  expect(game.players[0].field[0]?.hp).toBe(5);
});
test('战旗：相邻 +2，远处无加成，退场后停止', () => {
  const game = stage();
  const ally = put(game, 0, 1, '1');
  put(game, 0, 0, '3');
  const enemy = put(game, 1, 3, '6', 3);
  expect(attack(game, ally, enemy).players[1].field[3]?.hp).toBe(4);
  game.players[0].field[0] = null;
  put(game, 0, 4, '3');
  expect(attack(game, ally, enemy).players[1].field[3]?.hp).toBe(6);
});
test('使徒：只奶其他友军，1 HP 无法支付', () => {
  const game = stage();
  const apostle = put(game, 0, 0, '4');
  const ally = put(game, 0, 2, '1');
  put(game, 1, 2, '1');
  ally.hp = 1;
  const intent = { type: 'ability', id: apostle.id } as const;
  const result = applyIntent(game, 0, intent);
  expect(result.players[0].field[0]?.hp).toBe(4);
  expect(result.players[0].field[2]?.hp).toBe(3);
  apostle.hp = 1;
  expect(() => applyIntent(game, 0, intent)).toThrow('生命不足');
});
test('疫医：可治疗自身或伤害敌人，必须选有效目标', () => {
  const game = stage();
  const plague = put(game, 0, 0, '5');
  const enemy = put(game, 1, 2, '1');
  plague.hp = 2;
  const use = (target: number) => applyIntent(game, 0, { type: 'ability', id: plague.id, target });
  expect(use(plague.id).players[0].field[0]?.hp).toBe(3);
  expect(use(enemy.id).players[1].field[2]?.hp).toBe(3);
  expect(() => use(-1)).toThrow('请选择在场目标');
});
test('骑士棋：中位加三，非中位只能打原伤害', () => {
  const game = stage();
  const knight = put(game, 0, 2, '6');
  const enemy = put(game, 1, 2, '6', 3);
  expect(attack(game, knight, enemy).players[1].field[2]?.hp).toBe(7);
  game.players[0].field[2] = null;
  game.players[0].field[1] = knight;
  expect(attack(game, knight, enemy).players[1].field[2]?.hp).toBe(10);
});
test('巨鸟：中位双目标，其他位置正对单目标', () => {
  const game = stage();
  const giant = put(game, 0, 2, '7', 2);
  const left = put(game, 1, 1, '6', 3);
  const right = put(game, 1, 3, '6', 3);
  const result = attack(game, giant);
  expect([result.players[1].field[1]?.hp, result.players[1].field[3]?.hp]).toEqual([9, 9]);
  game.players[0].field[2] = null;
  game.players[0].field[1] = giant;
  expect(attackOptions(game, 0, giant).targets).toEqual([right]);
  expect(() => attack(game, giant, left)).toThrow('目标不合法');
});
test('鱼人：低血免疫攻击，跨阈值击杀或效果破坏有效', () => {
  const game = stage();
  const bird = put(game, 0, 2, '1');
  const doctor = put(game, 0, 0, '5');
  const fish = put(game, 1, 2, '8');
  expect(attack(game, bird, fish).players[1].field[2]).toBeNull();
  fish.hp = 1;
  expect(attack(game, bird, fish).players[1].field[2]?.hp).toBe(1);
  expect(applyIntent(game, 0, { type: 'ability', id: doctor.id, target: fish.id }).players[1].field[2]).toBeNull();
  game.players[1].skills.push('skill_reverse_flag');
  expect(attack(game, bird, fish).players[1].field[2]).toBeNull();
});
test('死尸：主动伤害后自毁，三星无视螺旋的防御', () => {
  const game = stage();
  const corpse = put(game, 0, 2, '9', 3);
  const enemy = put(game, 1, 2, '螺旋终灭');
  put(game, 0, 1, '6');
  const intent = { type: 'ability', id: corpse.id, target: enemy.id } as const;
  const result = applyIntent(game, 0, intent);
  expect(result.players[1].field[2]?.hp).toBe(19);
  expect(result.players[0].field[2]).toBeNull();
  corpse.star = 2;
  expect(applyIntent(game, 0, intent).players[1].field[2]?.hp).toBe(25);
});
test('长尾鸟：当前 HP 折半，中位重合只算一次', () => {
  const game = stage();
  const longtail = put(game, 0, 2, '10');
  put(game, 1, 2, '6', 3);
  expect(attack(game, longtail).players[1].field[2]?.hp).toBe(9);
  longtail.hp = 1;
  expect(attack(game, longtail).players[1].field[2]?.hp).toBe(11);
});
test('精灵：击杀立即给 lp，未杀不加', () => {
  const game = stage();
  const fairy = put(game, 0, 0, 'a');
  const target = put(game, 1, 1, '1');
  expect(attack(game, fairy, target).players[0].lp).toBe(0);
  target.hp = 2;
  expect(attack(game, fairy, target).players[0].lp).toBe(1);
});
