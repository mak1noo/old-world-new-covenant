import { expect, test } from 'vitest';
import { cardBySerial, cards } from './cards';
import { addUnit, applyIntent, attackOptions, createGame, forecastCombat, maxHp, type Game, type Side, type Unit } from './game';

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
test('鱼人自己到 1 HP 才会保护友军，先手普通攻击、真伤和主动技都挡住', () => {
  const game = stage();
  const bird = put(game, 0, 2, '1');
  const doctor = put(game, 0, 0, '5');
  const corpse = put(game, 1, 2, '9');
  const fish = put(game, 1, 4, '8', 3);
  game.players[1].skills.push('skill_reverse_flag');
  corpse.hp = 1;
  fish.hp = 2;
  expect(attack(game, bird, corpse).players[1].field[2]).toBeNull();

  fish.hp = 1;
  const normal = { type: 'attack', id: bird.id, target: corpse.id } as const;
  const skill = { type: 'ability', id: doctor.id, target: corpse.id } as const;
  for (const intent of [normal, skill]) {
    expect(forecastCombat(game, 0, intent).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'effect', text: expect.stringContaining('死尸免疫这次伤害') }),
    ]));
    expect(applyIntent(game, 0, intent).players[1].field[2]?.hp).toBe(1);
  }

  const astrologer = put(game, 0, 2, '占星魔术师');
  expect(attack(game, astrologer, corpse).players[1].field[2]?.hp).toBe(1);
  corpse.hp = 3;
  expect(attack(game, astrologer, corpse).players[1].field[2]?.hp).toBe(3);
});
test('鱼人受击降到 1 HP 后立即保护死尸，即使鱼人已行动', () => {
  const game = stage();
  const first = put(game, 0, 0, '8', 2);
  const second = put(game, 0, 2, '1');
  const corpse = put(game, 1, 2, '9');
  const fish = put(game, 1, 4, '8');
  corpse.hp = 1;
  const damaged = attack(game, first, fish);
  expect(damaged.players[1].field[4]?.hp).toBe(1);
  const afterFish = applyIntent(damaged, 1, { type: 'attack', id: fish.id, target: first.id });
  expect(afterFish.players[1].field[4]?.acted).toBe(true);
  expect(attack(afterFish, second, corpse).players[1].field[2]?.hp).toBe(1);
});
test('鱼人不受庇护，鱼人退场即失去保护，死尸自毁仍生效', () => {
  const game = stage();
  const bird = put(game, 0, 2, '1');
  const doctor = put(game, 0, 0, '5');
  const corpse = put(game, 1, 2, '9');
  const fish = put(game, 1, 4, '8');
  fish.hp = 1;
  corpse.hp = 1;
  const killedFish = applyIntent(game, 0, { type: 'ability', id: doctor.id, target: fish.id });
  expect(killedFish.players[1].field[4]).toBeNull();
  killedFish.active = 0;
  expect(attack(killedFish, bird, corpse).players[1].field[2]).toBeNull();

  game.active = 1;
  const selfDestruct = applyIntent(game, 1, { type: 'ability', id: corpse.id, target: bird.id });
  expect(selfDestruct.players[1].field[2]).toBeNull();
  expect(selfDestruct.players[1].field[4]?.hp).toBe(1);
});
test('士兵棋从双方各自左2、右2、中位只可对打指定站位', () => {
  for (const side of [0, 1] as const) {
    const rival = side === 0 ? 1 : 0;
    for (const [own, enemy, star] of [[0, 4, 1], [2, 2, 2], [4, 0, 3]]) {
      const game = stage();
      game.active = side;
      const soldier = put(game, side, own, '2', star);
      const targets = Array.from({ length: 5 }, (_, slot) => put(game, rival, slot, '6', 3));
      expect(attackOptions(game, side, soldier)).toMatchObject({ targets: [targets[enemy]], normal: star + 3 });
      const intent = { type: 'attack', id: soldier.id, target: targets[(enemy + 1) % 5].id } as const;
      expect(() => applyIntent(game, side, intent)).toThrow('攻击目标不合法');
      const after = applyIntent(game, side, { ...intent, target: targets[enemy].id });
      expect(after.players[rival].field[enemy]?.hp).toBe(targets[enemy].hp - star - 3);
    }
  }
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

test('多张存活精灵仅最左一张的击杀生效，它退场后另一张接替', () => {
  const game = stage();
  const first = put(game, 0, 0, 'a');
  const second = put(game, 0, 2, 'a');
  const enemy = put(game, 1, 1, '1');
  enemy.hp = 2;
  expect(attack(game, first, enemy).players[0].lp).toBe(1);
  expect(attack(game, second, enemy).players[0].lp).toBe(0);
  game.players[0].field[0] = null;
  game.players[0].bench.push(first);
  expect(attack(game, second, enemy).players[0].lp).toBe(1);
});
test('对手投降时，存活精灵按对手剩余在场从者数只领取一次 LP', () => {
  const game = stage();
  const first = put(game, 0, 0, 'a');
  const second = put(game, 0, 2, 'a');
  put(game, 0, 4, '2');
  put(game, 1, 0, '1');
  put(game, 1, 2, 'a');
  const fallen = put(game, 1, 4, '3');
  game.players[1].field[4] = null;
  game.players[1].bench.push(fallen);
  const winning = applyIntent(game, 1, { type: 'surrender', battle: 1 });
  expect(winning.players[0].lp).toBe(2);
  expect(winning.players[1].lp).toBe(0);
  expect(winning.log.filter(entry => entry.text.includes('精灵因对手投降')))
    .toMatchObject([{ unit: first.id, player: 0 }]);
  game.players[0].field[0] = game.players[0].field[2] = null;
  game.players[0].bench.push(first, second);
  expect(applyIntent(game, 1, { type: 'surrender', battle: 1 }).players[0].lp).toBe(0);
});
